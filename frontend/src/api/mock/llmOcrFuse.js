/*
 * L2 — llm_ocr_fuse, the extraction benchmark's verified-best input mode
 * (/home/pranamulia/pdf-extractor → src/pdf_extractor/backends/llm_ocr_fuse.py
 * + llm_client.run_extraction). One multimodal user message carries the
 * per-page document text ('--- page N ---' markdown) plus — when pages could
 * be rendered — the page images themselves; the model answers with one JSON
 * object (temperature 0) that is parsed defensively, mapped onto the
 * extraction contract, and re-checked by the SAME validators as L1
 * (mock/extraction.js → validateExtraction). Value-level (arithmetic)
 * failures re-prompt the model at most twice — first attempt + 2 re-prompts,
 * keeping the attempt with the fewest arithmetic errors — and the whole flow
 * fails soft: an unreachable server, a disabled tier or no usable JSON never
 * crashes the extraction; the caller degrades to manual entry.
 *
 * Mock-era transport: the real stack makes this call server-side through the
 * tier-aware wrapper (app/services/llm.py — LLM_TIER=on AND key set). In the
 * browser mock the call goes to the local OpenAI-compatible server through a
 * same-origin Vite dev proxy (/llm → LLM_PROXY_TARGET, default
 * http://localhost:11444), so there is no CORS and no API key. The tier can
 * be switched off per environment (VITE_LLM_TIER) or per browser session
 * (sessionStorage 'asklio.llm_tier=off') — the session switch is what tests
 * use to exercise the manual-entry degradation journey.
 */

import { parseMoney } from '../../utils/money'

const TIER_SESSION_KEY = 'asklio.llm_tier'

const BASE_URL = import.meta.env.VITE_LLM_BASE_URL ?? '/llm/v1'
export const MODEL_NAME = import.meta.env.VITE_LLM_MODEL ?? 'glm-5.3-flash'
const TIMEOUT_MS = Number(import.meta.env.VITE_LLM_TIMEOUT_S ?? 240) * 1000
// First attempt + at most 2 re-prompts on value-level failures (like the
// benchmark's run_extraction MAX_RETRIES).
const MAX_RETRIES = 2

/** The tier gate, read per call: session switch → build-time env → on. */
export function llmTier() {
  try {
    const override = sessionStorage.getItem(TIER_SESSION_KEY)
    if (override === 'on' || override === 'off') return override
  } catch {
    // Session storage unavailable (private window etc.) — fall through to env.
  }
  return import.meta.env.VITE_LLM_TIER ?? 'on'
}

// ---------------------------------------------------------------------------
// Prompt — one system prompt with the honesty rule (null + missing_fields,
// never guess) and a compact label bank; input-mode preamble in the message
// builder, exactly like the benchmark's llm_client.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You extract structured data from vendor offer documents into one JSON object, keyed exactly:
vendor_name, vendor_vat_id, department, order_lines (array of objects with position_description, unit_price, amount, unit, total_price), total_cost, missing_fields (array of the key names you could not find), confidences (map of extracted key → integer 0-100).

Rules:
1. Copy every value EXACTLY as it appears in the document. Never infer, compute or guess.
2. If a field is not present, set it to null AND list the key name in missing_fields. Example: no grand total in the document → "total_cost": null and "total_cost" in missing_fields. Reporting absence matters as much as extracting values — an absent field must NEVER be invented.
3. unit is the per-line unit of measure as the document states it (pieces, licenses, hours, …), or null when absent. Amounts are whole numbers.
4. Numbers are plain JSON numbers: no currency symbols (€/EUR), no thousands separators.
5. order_lines holds only the lines the document really shows, in document order — never invent one.
6. The document may use German or English labels. Common ones: Lieferant/Supplier/Vendor → vendor_name; USt.-IdNr./USt-IdNr./VAT ID/Umsatzsteuer-Identifikationsnummer → vendor_vat_id; Angeboten für/Offered to/Attention/Prepared for/Customer/Department → department; Position/Produkt/Item/Article → position_description; Menge/Anzahl/Qty/Quantity → amount; Einheit/Unit → unit; Einzelpreis/Unit price/Price → unit_price; Gesamtpreis/Line total/Amount/Total → total_price; Gesamtbetrag/Endsumme/Grand total/Total cost → total_cost.
Respond with the JSON object only.`

const USER_PREAMBLE =
  "Below is the vendor offer document as reconstructed text ('--- page N ---' markers separate pages)" +
  ' followed by the rendered page images, where available. Use BOTH: the text for a precise reading, ' +
  'the images whenever the text is ambiguous, broken or incomplete. Extract exactly what the document shows.\n\n'

function buildMessages(text, images, feedback) {
  let userText = USER_PREAMBLE + text
  if (feedback) {
    userText += '\n\n[Validation feedback on your previous answer]\n' + feedback
  }
  const parts = [{ type: 'text', text: userText }]
  for (const uri of images) {
    if (typeof uri === 'string' && uri) {
      parts.push({ type: 'image_url', image_url: { url: uri } })
    }
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts },
  ]
}

// ---------------------------------------------------------------------------
// Defensive parse — the local server does not enforce a response_format
// schema, so the answer may arrive fenced, wrapped in prose, or (ollama
// quirk) with an empty content and the payload in the reasoning field.
// Mirrors pdf_extractor.llm_client._parse_json_message.
// ---------------------------------------------------------------------------

function candidateTexts(message) {
  if (!message) return []
  const texts = []
  const content = message.content
  if (typeof content === 'string' && content.trim()) texts.push(content)
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) texts.push(message.reasoning)
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part.text === 'string') texts.push(part.text)
    }
  }
  return texts
}

function jsonCandidates(text) {
  const stripped = text.trim()
  if (!stripped) return []
  const out = [stripped]
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first !== -1 && last > first) out.push(stripped.slice(first, last + 1))
  return out
}

function parsePayload(responseBody) {
  const message = responseBody?.choices?.[0]?.message
  for (const text of candidateTexts(message)) {
    for (const candidate of jsonCandidates(text)) {
      try {
        const value = JSON.parse(candidate)
        if (value && typeof value === 'object' && !Array.isArray(value)) return value
      } catch {
        // Not usable JSON — try the next candidate.
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Response → contract mapping. The server ignores the requested schema, so
// field names arrive under common aliases; each contract key reads the first
// present alias. Schema-shape normalization only — values are never corrected
// beyond shape (the validators below remain the truth).
// ---------------------------------------------------------------------------

const SCALAR_ALIASES = {
  vendor_name: ['vendor_name', 'vendor', 'supplier', 'company'],
  vendor_vat_id: ['vendor_vat_id', 'vat_id', 'vat_number', 'vat', 'ust_id', 'vatin'],
  department: ['department', 'customer', 'offered_to', 'attention', 'client'],
  total_cost: ['total_cost', 'grand_total', 'total', 'total_amount'],
}

const LINE_ALIASES = {
  position_description: ['position_description', 'description', 'product', 'item', 'article'],
  unit_price: ['unit_price', 'price_per_unit', 'price', 'unit_cost'],
  amount: ['amount', 'quantity', 'qty'],
  unit: ['unit', 'unit_of_measure', 'uom'],
  total_price: ['total_price', 'line_total', 'line_amount', 'amount_total', 'subtotal'],
}

function pick(raw, aliases) {
  for (const key of aliases) {
    const v = raw[key]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

function toStr(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s || null
}

/** Scalar → cents: plain numbers ×100, money-ish strings via parseMoney. */
function toMoney(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100)
  const s = toStr(v)
  if (s == null) return null
  // Currency words/symbols ride along in some answers — strip to the figure.
  const figure = s.replace(/[a-z]/gi, '').trim()
  const cents = parseMoney(figure)
  return cents != null && cents > 0 ? cents : null
}

function toAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.round(v)
    return n > 0 ? n : null
  }
  const s = toStr(v)
  if (s == null) return null
  const n = Math.round(Number(String(s).replace(/[^\d.,-]/g, '').replace(',', '.')))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** VAT ids tolerate spacing/punctuation in the answer; the format gate still applies. */
function toVatId(v) {
  const s = toStr(v)
  return s == null ? null : s.toUpperCase().replace(/[\s.:/-]/g, '')
}

function mapLine(raw) {
  if (!raw || typeof raw !== 'object') return null
  const line = {
    position_description: toStr(pick(raw, LINE_ALIASES.position_description)),
    unit_price: toMoney(pick(raw, LINE_ALIASES.unit_price)),
    amount: toAmount(pick(raw, LINE_ALIASES.amount)),
    unit: toStr(pick(raw, LINE_ALIASES.unit)),
    total_price: toMoney(pick(raw, LINE_ALIASES.total_price)),
  }
  // A line with nothing but a name is still a finding the validators grade.
  return line.position_description || line.unit_price != null || line.total_price != null
    ? line
    : null
}

function mapPayload(parsed) {
  const fields = {
    vendor_name: toStr(pick(parsed, SCALAR_ALIASES.vendor_name)),
    vendor_vat_id: toVatId(pick(parsed, SCALAR_ALIASES.vendor_vat_id)),
    department: toStr(pick(parsed, SCALAR_ALIASES.department)),
    total_cost: toMoney(pick(parsed, SCALAR_ALIASES.total_cost)),
  }
  const lines = Array.isArray(parsed.order_lines) ? parsed.order_lines : Array.isArray(parsed.line_items) ? parsed.line_items : []
  fields.order_lines = lines.map(mapLine).filter(Boolean)
  return fields
}

// ---------------------------------------------------------------------------
// The flow — completion → validate → re-prompt ≤2 → best attempt, fail-soft.
// ---------------------------------------------------------------------------

/**
 * Extract the offer contract from a document with the LLM fuse.
 * Returns { ok: true, fields, meta } on a usable answer — fields already
 * mapped to the extraction contract (money in cents) — or
 * { ok: false, reason } without throwing, so the caller can degrade to
 * manual entry. `text` is the page-marked document text; `images` optional
 * rendered page images as PNG data URIs (the fuse half of the method).
 */
export async function extractOfferFuse({ text, images = [], onProgress } = {}) {
  const started = Date.now()
  const attemptsMeta = { model: MODEL_NAME, attempts: 0, n_retries: 0, tokens: null }

  let best = null // { problems, fields }
  let feedback = null
  let unreachable = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attemptsMeta.attempts = attempt + 1
    onProgress?.(
      attempt === 0
        ? `Asking the language model to read the offer (${MODEL_NAME})`
        : `Re-prompting the language model (attempt ${attempt + 1})`,
    )

    let parsed = null
    let usage = null
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_NAME,
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'offer_extraction',
              strict: true,
              schema: EXTRACTION_JSON_SCHEMA,
            },
          },
          messages: buildMessages(text, images, feedback),
        }),
        signal: AbortSignal?.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
      })
      if (!res.ok) {
        unreachable = `the extraction server answered HTTP ${res.status}`
        break
      }
      try {
        usage = (await res.json()) ?? null
      } catch {
        usage = null
      }
    } catch (err) {
      unreachable = err?.name === 'TimeoutError' ? 'the extraction server timed out' : 'the extraction server is unreachable'
      break
    }

    parsed = parsePayload(usage) // usage here is the still-unparsed response body
    if (!parsed) {
      feedback = 'Your previous response was not usable JSON. Respond with the JSON object only.'
      continue
    }
    attemptsMeta.tokens = usage?.usage?.total_tokens ?? attemptsMeta.tokens

    const fields = mapPayload(parsed)
    const arith = arithmeticProblems(fields)
    if (best === null || arith.length < best.arith) best = { arith: arith.length, fields }
    if (arith.length === 0) break
    feedback =
      'These checks against the extracted data failed:\n' +
      arith.join('\n') +
      '\nRe-read the document, fix ONLY these problems (do not change anything else), and respond with the full corrected JSON object.'
  }

  if (unreachable != null) {
    if (best === null) return { ok: false, reason: unreachable }
  } else if (best === null) {
    return {
      ok: false,
      reason: 'the model returned no usable JSON in any attempt',
    }
  }

  attemptsMeta.n_retries = Math.max(0, attemptsMeta.attempts - 1)
  attemptsMeta.wall_time = Math.round((Date.now() - started) / 100) / 10
  return { ok: true, fields: best.fields, meta: attemptsMeta }
}

/**
 * Value-level problems ONLY (the re-prompt decision): a line's total must
 * equal unit_price × amount and the grand total must equal the sum of the
 * line totals. Everything else (missing fields etc.) is honest absence and
 * is graded by the shared validators in mock/extraction.js, never re-asked.
 */
function arithmeticProblems(fields) {
  const problems = []
  const lines = fields.order_lines || []
  lines.forEach((line, i) => {
    if (line.unit_price == null || line.amount == null) return
    if (line.total_price != null && line.total_price !== line.unit_price * line.amount) {
      problems.push(
        `- line ${i + 1}: total_price (${line.total_price}) does not equal unit_price × amount`,
      )
    }
  })
  const withTotals = lines.filter((l) => l.total_price != null)
  if (fields.total_cost != null && withTotals.length > 0 && withTotals.length === lines.length) {
    const sum = withTotals.reduce((s, l) => s + l.total_price, 0)
    if (sum !== fields.total_cost) {
      problems.push(`- total_cost (${fields.total_cost}) does not equal the sum of the line totals (${sum})`)
    }
  }
  return problems
}

// The schema rides in the request even though the local server ignores
// response_format — a hosted OpenAI-compatible endpoint would honor it.
const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    vendor_name: { type: ['string', 'null'] },
    vendor_vat_id: { type: ['string', 'null'] },
    department: { type: ['string', 'null'] },
    order_lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position_description: { type: ['string', 'null'] },
          unit_price: { type: ['number', 'null'] },
          amount: { type: ['integer', 'null'] },
          unit: { type: ['string', 'null'] },
          total_price: { type: ['number', 'null'] },
        },
        required: ['position_description', 'unit_price', 'amount', 'unit', 'total_price'],
        additionalProperties: false,
      },
    },
    total_cost: { type: ['number', 'null'] },
    missing_fields: { type: 'array', items: { type: 'string' } },
    confidences: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: { type: 'integer' },
    },
  },
  required: ['vendor_name', 'vendor_vat_id', 'department', 'order_lines', 'total_cost', 'missing_fields', 'confidences'],
  additionalProperties: false,
}