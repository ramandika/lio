import { useMemo } from 'react'
import { COMMODITY_GROUPS } from '../data/commodity'
import { Btn, Field, Select, Tag, Spinner } from './ui'

/*
 * Commodity-group suggestion UX: the group appears on its own (never a
 * forced browse), shows why it was suggested, and can be overridden via a
 * grouped select. The user is never made to pick by hand.
 *
 * Props:
 *   suggestion  the latest auto suggestion {category, name, source, confidence, reasoning} | null
 *               (`source` = 'heuristic' | 'llm' — who advised; shown beside the confidence tag)
 *   value       currently selected group id (auto-follows the suggestion unless overridden)
 *   manual      true once the user has explicitly chosen — the suggestion is then
 *               shown only as the overridden value, never reapplied
 *   onChange(groupId|null)  called on select change
 *   note        why the explicit re-run decided NOT to change the current pick
 *               (the same-or-better policy declined) — shown in the card
 *   onSuggest   the explicit re-run action: recomputes the suggestion from the
 *               current entries and follows it again (the user's consent, so it
 *               may replace a manual choice). Null where there is nothing to
 *               suggest from (e.g. a locked request) — the button then hides.
 *   canSuggest  false while title/department/lines are all empty; disables the button
 */

const CONFIDENCE_LABEL = { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' }

// Who produced the suggestion (app/services/classifier.py `source` stamp):
// the deterministic keyword scorer or the tier-gated LLM. Kept separate from
// the confidence tag text so an unknown or missing source degrades to the
//bare confidence label.
const SOURCE_LABEL = { heuristic: 'Heuristic', llm: 'LLM' }

export default function CommoditySuggestion({
  suggestion,
  loading,
  manual,
  value,
  onChange,
  invalidMessage,
  note = null,
  onSuggest = null,
  canSuggest = true,
}) {
  const categories = useMemo(() => {
    const map = new Map()
    for (const g of COMMODITY_GROUPS) {
      if (!map.has(g.category)) map.set(g.category, [])
      map.get(g.category).push(g)
    }
    return [...map.entries()]
  }, [])

  const selected = COMMODITY_GROUPS.find((g) => g.id === value) ?? null

  return (
    <div className="commodity">
      <div className="commodity__suggestion" aria-live="polite">
        {loading && (
          <span className="commodity__loading">
            <Spinner /> Suggesting a commodity group…
          </span>
        )}
        {!loading && selected && (
          <>
            <div className="commodity__headline">
              <p className="commodity__name">
                {selected.category} <span aria-hidden="true">·</span> {selected.name}
              </p>
              <Tag
                tone={
                  manual ? 'neutral' : suggestion?.confidence === 'high' ? 'primary' : 'neutral'
                }
              >
                {manual
                  ? 'Manually Selected'
                  : [
                      CONFIDENCE_LABEL[suggestion?.confidence ?? 'low'],
                      SOURCE_LABEL[suggestion?.source],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Tag>
            </div>
            {manual ? (
              <p className="commodity__reason">
                Overridden
                {suggestion ? <> — the suggestion was “{suggestion.name}”</> : null}. Your choice is
                what gets stored.
              </p>
            ) : (
              suggestion && <p className="commodity__reason">{suggestion.reasoning}</p>
            )}
          </>
        )}
        {!loading && !selected && (
          <p className="commodity__reason">
            Describe the title and order lines — a suggestion appears here automatically.
          </p>
        )}
        {!loading && note && <p className="commodity__reason">{note}</p>}
      </div>
      {onSuggest && (
        <div className="commodity__actions">
          <Btn
            variant="quiet"
            onClick={onSuggest}
            disabled={loading || !canSuggest}
            title="Recompute the suggestion from the current title, department and order lines — your explicit consent to follow it again."
          >
            {manual ? 'Re-run suggestion' : 'Suggest from my entries'}
          </Btn>
        </div>
      )}
      <Field
        label="Commodity Group (override if needed)"
        htmlFor="commodity-select"
        hint="The suggestion above is preselected — you only touch this if it's wrong."
        error={invalidMessage}
      >
        <Select
          id="commodity-select"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— No group selected —</option>
          {categories.map(([category, groups]) => (
            <optgroup key={category} label={category}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id} · {g.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
    </div>
  )
}