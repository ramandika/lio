import { useMemo } from 'react'
import { COMMODITY_GROUPS } from '../api/mock/commodity'
import { Field, Select, Tag, Spinner } from './ui'

/*
 * Commodity-group suggestion UX: the group appears on its own (never a
 * forced browse), shows why it was suggested, and can be overridden via a
 * grouped select. The user is never made to pick by hand.
 *
 * Props:
 *   suggestion  the latest auto suggestion {category, name, confidence, reasoning} | null
 *   value       currently selected group id (auto-follows the suggestion unless overridden)
 *   manual      true once the user has explicitly chosen — the suggestion is then
 *               shown only as the overridden value, never reapplied
 *   onChange(groupId|null)  called on select change
 */

const CONFIDENCE_LABEL = { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' }

export default function CommoditySuggestion({
  suggestion,
  loading,
  manual,
  value,
  onChange,
  invalidMessage,
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
                {manual ? 'Manually Selected' : CONFIDENCE_LABEL[suggestion?.confidence ?? 'low']}
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
      </div>
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