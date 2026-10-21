import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { requests } from '../api'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../utils/money'
import { StatusPill, Banner, formatDate, Spinner } from '../components/ui'

const STATUS_FILTERS = ['All', 'Open', 'In Progress', 'Closed']

export default function Overview() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState('All')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let alive = true
    setError(null)
    requests
      .list({ status, q: qDebounced })
      .then(({ requests }) => alive && setRows(requests))
      .catch((err) => alive && setError(err.payload?.detail ?? 'Could not load requests.'))
    return () => {
      alive = false
    }
  }, [status, qDebounced])

  return (
    <div className="container">
      <header className="page-head">
        <h1 className="page-head__title">
          {user.role === 'requestor' ? 'My Requests' : 'Requests'}
        </h1>
        <p className="page-head__standfirst">
          {user.role === 'requestor'
            ? 'Everything you have submitted, with its current state of play.'
            : 'All incoming requests — filter, inspect, and move them along.'}
        </p>
      </header>

      <div className="toolbar">
        <div className="toolbar__filters" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${status === s ? ' chip--active' : ''}`}
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="input toolbar__search"
          placeholder="Search title, vendor or requestor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search requests"
        />
      </div>

      {error && (
        <Banner kind="error" title="Something went wrong">
          <p>{error}</p>
        </Banner>
      )}

      {rows === null && !error && <Spinner />}

      {rows !== null && rows.length === 0 && (
        <div className="empty">
          <h2 className="empty__title">No Requests Here</h2>
          <p className="empty__body">
            {status !== 'All' || qDebounced
              ? 'Nothing matches this filter — widen it or clear the search.'
              : 'Create the first request to see it here.'}
          </p>
          <Link className="btn btn--primary" to="/requests/new">
            Create a Request
          </Link>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="table-scroller">
          <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Requestor</th>
              <th>Vendor</th>
              <th>Commodity Group</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th className="num">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="table__row" onClick={() => navigate(`/requests/${r.id}`)}>
                <td className="table__title">{r.title}</td>
                <td>{r.requestor_name}</td>
                <td>{r.vendor_name}</td>
                <td className="table__muted">
                  {r.commodity_group
                    ? `${r.commodity_group.category} · ${r.commodity_group.name}`
                    : '—'}
                </td>
                <td className="num">{formatMoney(r.total_cost)}</td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td className="num table__muted">{formatDate(r.updated_at)}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </div>
  )
}