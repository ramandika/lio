/*
 * Mocked commodity classifier. Stands in for the LLM suggestion endpoints:
 * given title, item descriptions and department they return a suggestion
 * over the fixed 50-group list, with a confidence cue and reasoning —
 * never a forced selection (docs/PROJECT_PLAN.md WS3).
 *
 * suggestCommodity            the auto path (app/services/classifier.py).
 * resuggestCommodity          the explicit button policy — same control flow,
 *                             with the mock's LLM branch permanently tier-off:
 *                             the keyword advice is the only brain here, and
 *                             the same-or-better gate still applies.
 */

import { COMMODITY_GROUPS, commodity } from './commodity'

const RULES = [
  // 1:1 with app/services/classifier.py — short generic tokens (erp, tax,
  // ups, books, print, event, desk, …) are word-bounded so substrings inside
  // unrelated vocabulary ("Überprüfung", "taxi", "groups", "notebooks") never
  // mint a suggestion here either.
  { id: '031', kw: /photoshop|illustrator|indesign|adobe|licen[cs]e|software|subscription|saas|\berp\b/i },
  { id: '029', kw: /laptop|notebook|monitor|keyboard|mouse|server|printer|hardware|pc\b/i },
  { id: '030', kw: /hosting|cloud|vpn|dns|it[- ]?service|it[- ]?support|helpdesk|network/i },
  { id: '026', kw: /app development|digital product|website development/i },
  { id: '023', kw: /publishing software|cms|plugin development/i },
  { id: '041', kw: /seo|google ads|social media|online marketing|newsletter/i },
  { id: '038', kw: /marketing agency|creative agency|pr agency/i },
  { id: '036', kw: /advertis[ei]|campaign|banner design/i },
  { id: '037', kw: /billboard|outdoor ad|plakat/i },
  { id: '042', kw: /events?\b|conference|trade show|fair\b|venue/i },
  { id: '043', kw: /giveaway|promotional|merch|brochure|flyer/i },
  { id: '039', kw: /direct mail|mailing/i },
  { id: '040', kw: /customer communication|crm|support hotline/i },
  { id: '019', kw: /cleaning|janitor|disinfection/i },
  { id: '018', kw: /cafeteria|canteen|coffee|kitchenette|catering/i },
  { id: '015', kw: /office chair|\bdesks?\b|office equipment|furniture/i },
  { id: '014', kw: /renovat|repaint|painting work|remodel/i },
  { id: '011', kw: /electrical installation|wiring|electrician/i },
  { id: '016', kw: /energy|power supply|heating|solar/i },
  { id: '013', kw: /security|guards?\b|access control/i },
  { id: '017', kw: /maintenance|repair|servicing/i },
  { id: '050', kw: /maintenance and repairs|machin[e] [a-z]* repair/i },
  { id: '008', kw: /training|course|workshop|seminar|certification/i },
  { id: '007', kw: /recruit|headhunt|sourcing candidates/i },
  { id: '004', kw: /consult|advisory|audit/i },
  { id: '005', kw: /accounting|\btax(?:es)?\b|payroll|banking|financial/i },
  { id: '010', kw: /insurance/i },
  { id: '001', kw: /rental|accommodation|hotel|apartment|coworking/i },
  { id: '002', kw: /membership|annual fee|subscription fee/i },
  { id: '003', kw: /safety|workwear|\bppe\b|first aid/i },
  { id: '006', kw: /fleet|vehicle|\bleas|car pool/i },
  { id: '022', kw: /\bprint/i },
  { id: '021', kw: /\bbooks?\b|\bvideos?\b|\bcds\b|\be-books?\b/i },
  { id: '020', kw: /video production|audio|film|podcast/i },
  { id: '028', kw: /post[- ]production|editing studio/i },
  { id: '027', kw: /pre[- ]production|storyboard/i },
  { id: '025', kw: /shipping (?:for|of) production|production shipping/i },
  { id: '032', kw: /courier|express|postal|dhl|\bups\b/i },
  { id: '034', kw: /transport logistics|freight|haulage/i },
  { id: '035', kw: /delivery|shipping/i },
  { id: '033', kw: /warehous|storage space|material handling|pallet/i },
  { id: '044', kw: /operational equipment|warehouse equipment|forklift/i },
  { id: '045', kw: /machin|production equipment/i },
  { id: '046', kw: /spare part/i },
  { id: '048', kw: /raw material|production material|steel|resin/i },
  { id: '049', kw: /consumable|gloves|lubricant|toner/i },
  { id: '047', kw: /internal transport|conveyor/i },
]

const FALLBACK = '009'

/**
 * Mock commodity suggestion.
 * Returns { suggestion: {id, category, name, source, confidence, reasoning}, candidates }
 * or { suggestion: null } when there is nothing to go on. `source` mirrors the
 * live boundary's stamp ("heuristic" | "llm"); the mock's LLM branch is
 * permanently tier-off, so every suggestion here is "heuristic".
 */
export function suggestCommodity({ title, department, items }) {
  const haystack = [title, department, ...(items || []).map((i) => i?.position_description)]
    .filter(Boolean)
    .join('\n')

  const scores = new Map()
  const reasons = new Map()
  for (const { id, kw } of RULES) {
    const m = title?.match(kw)
    const fields = haystack.match(kw)
    if (!fields) continue
    const score = (m ? 3 : 0) + (fields ? 1 : 0)
    scores.set(id, Math.max(scores.get(id) ?? 0, score))
    reasons.set(id, m ? `“${m[0]}” in the title` : `“${fields[0]}” in the item descriptions`)
  }

  if (scores.size === 0 && !haystack.trim()) return { suggestion: null, candidates: [] }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const best = ranked[0]
  if (!best) {
    // The haystack may be non-empty yet match no rule (e.g. a German-domain
    // offer outside the keyword bank) — that is the fallback's job, not a
    // crash: suggest the generic group at low confidence and let the user override.
    return {
      suggestion: {
        id: FALLBACK,
        category: commodity(FALLBACK).category,
        name: commodity(FALLBACK).name,
        source: 'heuristic',
        confidence: 'low',
        reasoning: 'No strong signal found — defaulted to a generic group.',
      },
      candidates: [],
    }
  }
  const suggestion = commodity(best[0]) && {
    id: best[0],
    category: commodity(best[0]).category,
    name: commodity(best[0]).name,
    source: 'heuristic',
    confidence: best[1] >= 3 ? 'high' : 'medium',
    reasoning: `Matched ${reasons.get(best[0])}.`,
  }
  const candidates = ranked.slice(0, 3).map(([id]) => commodity(id)).filter(Boolean)
  const noMatch =
    suggestion ? null : {
      id: FALLBACK,
      category: commodity(FALLBACK).category,
      name: commodity(FALLBACK).name,
      source: 'heuristic',
      confidence: 'low',
      reasoning: 'No strong signal found — defaulted to a generic group.',
    }
  return { suggestion: suggestion ?? noMatch, candidates }
}

export { COMMODITY_GROUPS }

// high > medium > low; a manual or saved pick carries no confidence — the
// weakest standing (app/services/classifier.py CONFIDENCE_RANK).
const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 }

/**
 * The explicit re-run (POST /commodity/resuggest in the live boundary):
 * nothing assigned → the keyword advice wins at any confidence; something
 * assigned → the advice must name the same group or rank strictly higher in
 * confidence, otherwise the current pick is kept and the runner-up returned
 * in `declined` so the UI can say why nothing changed. The always-tier-off
 * LLM branch means the keyword scorer is the only advisee here.
 */
export function resuggestCommodity(body = {}) {
  const { suggestion: kw, candidates } = suggestCommodity(body)
  const current = typeof body.current_group_id === 'string' ? commodity(body.current_group_id) : null
  const currentConfidence = CONFIDENCE_RANK[body.current_confidence] != null ? body.current_confidence : null

  if (!current) return { suggestion: kw, candidates, declined: null }

  const kept = { id: current.id, name: current.name, confidence: currentConfidence }
  if (kw) {
    const same = kw.id === current.id
    const better = (CONFIDENCE_RANK[kw.confidence] ?? 0) > (CONFIDENCE_RANK[currentConfidence] ?? 0)
    if (same || better) return { suggestion: kw, candidates: [], declined: null }
    return { suggestion: null, candidates: [], declined: { kept, alternative: kw } }
  }
  return { suggestion: null, candidates: [], declined: { kept, alternative: null } }
}