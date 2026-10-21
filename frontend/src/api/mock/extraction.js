/*
 * Mocked extraction service. Stands in for the app backend's two-layer
 * composite (docs/PROJECT_PLAN.md WS2): L1 deterministic parsing first and,
 * only when L1 fails validation, the real L2 — llm_ocr_fuse
 * (mock/llmOcrFuse.js: document text + page images → local OpenAI-compatible
 * LLM → same validators, ≤2 re-prompts, fail-soft). The LLM's answer is a
 * suggestion re-checked by the same rules; whatever still fails stays blank
 * for manual entry, and an unreachable/disabled LLM degrades exactly like
 * the documented AI-unavailable case.
 */

import { parseMoney } from '../../utils/money'
import { extractOfferFuse, llmTier } from './llmOcrFuse'

const VAT_RE = /^DE[0-9]{9}$/

// --- L1: strict label parsing -------------------------------------------

const FIELD_LABELS = {
  vendor_name: /vendor(?:'s)?\s*name\s*:\s*(.+)/i,
  vendor_vat_id:
    /umsatzsteuer[- ]?identifikationsnummer(?:\s*\(vat id\))?\s*:\s*([a-z]{2}[0-9]{8,15})/i,
  department: /offered\s*to\s*:\s*(.+)/i,
}

function parseField(text, key) {
  const m = text.match(FIELD_LABELS[key])
  return m ? m[1].trim().replace(/[.,;]+$/, '') : null
}

function parseLinesStrict(text) {
  // README offer shape: numbered "Product:"/labels under "Items Offered:".
  const itemSection = text.split(/items\s*offered\s*:|positions?\s*:/i).slice(1).join('\n')
  const scope = itemSection || text
  const items = []
  let current = null
  for (const raw of scope.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const product = line.match(/^(?:\d+[.)]\s*)?product\s*:\s*(.+)$/i)
    if (product) {
      current = { fields: {} }
      current.fields.position_description = product[1].replace(/[.,;]+$/, '').trim()
      items.push(current)
      continue
    }
    if (!current) continue
    const price = line.match(/^(?:unit\s*price|price)\s*:\s*([\d.,\s€]+)$/i)
    const qty = line.match(/^(?:quantity|amount|qty)\s*:\s*([\d.,\s]+)$/i)
    const total = line.match(/^(?:total(?:\s*price)?)\s*:\s*([\d.,\s€]+)$/i)
    if (price) current.fields.unit_price = price[1].trim()
    else if (qty) current.fields.amount = qty[1].trim()
    else if (total) current.fields.total_price = total[1].trim()
  }
  return items.filter((it) => Object.keys(it.fields).length > 0).map((it) => it.fields)
}

function normalizeLine(raw) {
  return {
    position_description: raw.position_description ?? null,
    unit_price: raw.unit_price != null ? parseMoney(raw.unit_price) : null,
    amount:
      raw.amount != null ? Number(String(raw.amount).replace(/[^\d]/g, '')) || null : null,
    total_price: raw.total_price != null ? parseMoney(raw.total_price) : null,
  }
}

function parseOffer(text) {
  const out = {}
  for (const key of ['vendor_name', 'vendor_vat_id', 'department']) {
    const v = parseField(text, key)
    if (v !== null) out[key] = v
  }
  const total = text.match(/total\s*(?:offer\s*)?cost\s*:\s*([\d.,\s€]+)/i)
  if (total) out.total_cost = parseMoney(total[1])
  out.order_lines = parseLinesStrict(text).map(normalizeLine)
  return out
}

// --- validation shared by both layers ------------------------------------

export function validateExtraction(fields) {
  const problems = new Set()
  for (const key of ['vendor_name', 'vendor_vat_id', 'total_cost']) {
    if (fields[key] == null || fields[key] === '') problems.add(`field:${key}`)
  }
  if (fields.vendor_vat_id && !VAT_RE.test(fields.vendor_vat_id)) {
    problems.add('format:vendor_vat_id')
  }
  const lines = fields.order_lines || []
  if (lines.length === 0) problems.add('field:order_lines')
  lines.forEach((line, i) => {
    if (line.unit_price == null || line.total_price == null || line.amount == null) {
      problems.add(`line:${i}`)
    } else if (line.unit_price * line.amount !== line.total_price) {
      problems.add(`line:${i}:math`)
    }
  })
  if (
    fields.total_cost != null &&
    lines.length > 0 &&
    lines.every((l) => l.total_price != null) &&
    lines.reduce((s, l) => s + l.total_price, 0) !== fields.total_cost
  ) {
    problems.add('total_cost')
  }
  return problems
}

// --- entry point ----------------------------------------------------------

/**
 * Two-layer composite extraction over document text.
 * Returns { layer, fields, detected, problems } — the same shape the real
 * /extraction endpoint will return. prices/totals are integer cents.
 * `layer: null` means the document was not readable (or the LLM tier was
 * off/unreachable for the documents L1 cannot parse); `detail` then carries
 * the manual-entry degradation message the UI shows.
 */
export async function extractOffer({ content, images = [], onProgress } = {}) {
  const rawText = String(content ?? '')
  if (rawText.includes('\u0000') || /%PDF-\d/.test(rawText)) {
    // Binary/PDF content reaching the text path: the real backend extracts
    // text with PyMuPDF; here the PDF was supposed to be read in-browser.
    return {
      layer: null,
      fields: null,
      detected: {},
      problems: ['unreadable'],
      detail: 'The document could not be read as text. Please enter the details manually.',
    }
  }

  const l1 = parseOffer(rawText)
  const l1Problems = validateExtraction(l1)
  if (l1Problems.size === 0) {
    // Deterministic parse: no self-confidence is attached — the yellow
    // low-confidence mark is an LLM-extraction-only concept.
    return { layer: 'L1', fields: l1, detected: detectMap(l1), problems: [], low_confidence: [] }
  }

  // L2 — triggered only when L1 validation fails (validation-based gate,
  // docs/PROJECT_PLAN.md WS2). The LLM tier decides between the fuse and the
  // documented manual-entry degradation.
  if (llmTier() !== 'on') {
    return {
      layer: null,
      unavailable: true,
      fields: null,
      detected: {},
      problems: [...l1Problems],
      detail: 'AI extraction is switched off in this environment — enter the details manually.',
    }
  }

  onProgress?.('The deterministic read did not fully validate — extracting with the LLM')
  const fused = await extractOfferFuse({ text: rawText, images, onProgress })
  if (!fused.ok) {
    return {
      layer: null,
      unavailable: true,
      fields: null,
      detected: {},
      problems: [...l1Problems],
      detail: `The LLM extraction failed (${fused.reason}) — enter the details manually.`,
    }
  }

  const l2 = fused.fields
  // LLM output is a suggestion re-checked by the same validators; whatever
  // still fails is reported as "not detected" for manual entry.
  //
  // `confidences` is the model's per-field self-assessment (0–100, LLM
  // extraction only). Fields it scored BELOW_LOW become `low_confidence` —
  // the yellow "Low confidence" mark the draft form shows beside those
  // fields. Deterministic L1 output gets none (nothing was uncertain there),
  // and an unscored-but-present field is not flagged (no invented doubt).
  const confidences = fused.confidences ?? {}
  const present = detectMap(l2)
  const low = Object.entries(confidences)
    .filter(([key, score]) => present[key] && score < BELOW_THRESHOLD)
    .map(([key]) => key)
  return {
    layer: 'L2',
    fields: l2,
    detected: present,
    problems: [...validateExtraction(l2)],
    confidences,
    low_confidence: low,
    llm: fused.meta,
  }
}

/** Self-confidence below this (0–100) makes a field's value suspect. */
const BELOW_THRESHOLD = 60

function detectMap(fields) {
  const ok = (v) => v !== null && v !== undefined && v !== ''
  const lines = fields.order_lines || []
  return {
    vendor_name: ok(fields.vendor_name),
    vendor_vat_id: ok(fields.vendor_vat_id),
    department: ok(fields.department),
    total_cost: fields.total_cost != null,
    order_lines:
      lines.length > 0 &&
      lines.every((l) => l.unit_price != null && l.amount != null && l.total_price != null),
  }
}