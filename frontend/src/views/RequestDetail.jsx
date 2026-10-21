import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ApiError, requests } from '../api'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../utils/money'
import {
  Card,
  StatusPill,
  Banner,
  Btn,
  TextArea,
  Tag,
  PageLoading,
  formatDateTime,
} from '../components/ui'
import { COMMODITY_BY_ID } from '../api/mock/commodity'

const NEXT_STATUS_ACTIONS = { Open: ['In Progress'], 'In Progress': ['Closed'], Closed: [] }

export default function RequestDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const canManage = user.role !== 'requestor'

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(location.state?.created ?? false)
  const [comment, setComment] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const d = await requests.get(id)
      setData(d)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Request not found.' : err.payload?.detail ?? 'Could not load this request.')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const changeStatus = async (newStatus) => {
    setStatusBusy(true)
    setStatusError(null)
    try {
      const d = await requests.updateStatus(id, newStatus, comment)
      setData(d)
      setComment('')
      setCreated(false)
    } catch (err) {
      setStatusError(err.payload?.detail ?? 'Updating failed.')
    } finally {
      setStatusBusy(false)
    }
  }

  if (error) {
    return (
      <div className="container container--narrow">
        <Banner kind="error" title="Request Not Available">
          <p>{error}</p>
        </Banner>
        <Link className="linklike" to="/requests">
          ← Back to the overview
        </Link>
      </div>
    )
  }
  if (!data) return <PageLoading />

  const { request: r, status_history: history } = data
  const group = COMMODITY_BY_ID.get(r.commodity_group_id)
  const nextStatuses = canManage ? (NEXT_STATUS_ACTIONS[r.status] ?? []) : []

  return (
    <div className="container container--narrow">
      <Link className="linklike detail-back" to="/requests">
        ← Back to the overview
      </Link>
      {created && (
        <Banner kind="success" title="Request Submitted" onDismiss={() => setCreated(false)}>
          <p>It is saved and visible in the overview with status “Open”.</p>
        </Banner>
      )}

      <header className="page-head page-head--row">
        <div>
          <h1 className="page-head__title">{r.title}</h1>
          <p className="detail-meta">
            #{r.id.replace(/^r/, '')} · Requested by <strong>{r.requestor_name}</strong> ·{' '}
            {formatDateTime(r.created_at)}
          </p>
        </div>
        <StatusPill status={r.status} />
      </header>

      <div className="detail-grid">
        <div className="detail-grid__main">
          <Card className="block">
            <h3 className="block__title">Details</h3>
            <dl className="deflist">
              <dt>Requestor</dt>
              <dd>{r.requestor_name}</dd>
              <dt>Department</dt>
              <dd>{r.department}</dd>
              <dt>Vendor Name</dt>
              <dd>{r.vendor_name}</dd>
              <dt>VAT ID</dt>
              <dd>{r.vendor_vat_id}</dd>
              <dt>Commodity Group</dt>
              <dd>
                {group ? (
                  <>
                    <Tag tone="primary">{group.category}</Tag> {group.name}{' '}
                    <span className="detail-muted">(ID {group.id})</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Total Cost</dt>
              <dd>
                <strong>{formatMoney(r.total_cost)}</strong>
              </dd>
            </dl>
          </Card>

          <Card className="block">
            <h3 className="block__title">Order Lines</h3>
            <div className="table-scroller">
            <table className="table table--lines">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th className="num">Unit Price</th>
                  <th className="num">Amount</th>
                  <th>Unit</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {r.order_lines.map((line) => (
                  <tr key={line.id}>
                    <td className="table__muted">{line.position}</td>
                    <td>{line.position_description}</td>
                    <td className="num">{formatMoney(line.unit_price)}</td>
                    <td className="num">{line.amount}</td>
                    <td>{line.unit}</td>
                    <td className="num">{formatMoney(line.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>

          <Card className="block">
            <h3 className="block__title">Status History</h3>
            <ol className="history">
              {history.map((h) => (
                <li className="history__entry" key={h.id}>
                  <span className="history__marker" aria-hidden="true" />
                  <div className="history__body">
                    <p className="history__line">
                      {h.old_status ? (
                        <>
                          {h.old_status} <span className="history__arrow">→</span>{' '}
                          <strong>{h.new_status}</strong>
                        </>
                      ) : (
                        <>
                          Created as <strong>{h.new_status}</strong>
                        </>
                      )}
                    </p>
                    <p className="history__meta">
                      {formatDateTime(h.changed_at)} · {h.changed_by}
                    </p>
                    {h.comment && <p className="history__comment">“{h.comment}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {canManage && (
          <aside className="detail-grid__side">
            <Card className="block block--panel">
              <h3 className="block__title">Manage Status</h3>
              <StatusPill status={r.status} />
              {nextStatuses.length > 0 ? (
                <>
                  <div className="status-actions">
                    {nextStatuses.map((s) => (
                      <Btn key={s} onClick={() => changeStatus(s)} disabled={statusBusy}>
                        {s === 'Closed' ? 'Close Request' : `Move to “${s}”`}
                      </Btn>
                    ))}
                  </div>
                  <label className="field__label" htmlFor="status-comment">
                    Comment (kept in the history)
                  </label>
                  <TextArea
                    id="status-comment"
                    value={comment}
                    maxLength={500}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="e.g. Offer received from a second vendor."
                  />
                </>
              ) : (
                <p className="status-closed-note">
                  This request is closed — its history stays as it is.
                </p>
              )}
              {statusError && (
                <p className="field__error" role="alert">
                  {statusError}
                </p>
              )}
            </Card>
          </aside>
        )}
      </div>
    </div>
  )
}