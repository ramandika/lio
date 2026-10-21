import { StatusPill, formatDate } from './ui'
import { formatMoney } from '../utils/money'

/*
 * Left rail of the workbench: the request list with search and status
 * filter, plus the "add request" affordance. Role scoping is done by the
 * API (requestor → own requests only).
 */

const STATUS_FILTERS = ['All', 'Open', 'In Progress', 'Closed']

export default function RequestsRail({
  rows,
  error,
  status,
  onStatus,
  q,
  onQ,
  selected,
  onSelect,
  role,
}) {
  return (
    <div className="rail">
      <div className="rail__top">
        <h2 className="rail__title">{role === 'requestor' ? 'My Requests' : 'Requests'}</h2>
        <button type="button" className="btn btn--primary btn--small" onClick={() => onSelect('new')}>
          + Add Request
        </button>
      </div>

      <input
        type="search"
        className="input rail__search"
        placeholder="Search…"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        aria-label="Search requests"
      />
      <div className="rail__filters" role="tablist" aria-label="Filter by status">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            className={`chip${status === s ? ' chip--active' : ''}`}
            aria-pressed={status === s}
            onClick={() => onStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="rail__error" role="alert">{error}</p>}
      {rows === null && !error && (
        <div className="rail__loading">
          <span className="spinner" />
        </div>
      )}
      {rows !== null && rows.length === 0 && (
        <p className="rail__empty">
          {status !== 'All' || q ? 'Nothing matches this filter.' : 'No requests yet — add the first one.'}
        </p>
      )}

      <ul className="rail__list">
        {(rows ?? []).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`railitem${selected === r.id ? ' railitem--active' : ''}`}
              aria-current={selected === r.id ? 'true' : undefined}
              onClick={() => onSelect(r.id)}
            >
              <span className="railitem__title">{r.title}</span>
              <span className="railitem__meta">
                <span>{r.vendor_name}</span>
                <span>{formatMoney(r.total_cost)}</span>
              </span>
              <span className="railitem__foot">
                <span className="railitem__when">{formatDate(r.updated_at)}</span>
                <StatusPill status={r.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}