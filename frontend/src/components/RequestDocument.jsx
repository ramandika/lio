import { useCallback, useEffect, useState } from 'react'
import { ApiError, documents as documentsApi, requests as requestsApi } from '../api'
import { useAuth } from '../context/AuthContext'
import PdfPages from './PdfPages'
import { formatMoney } from '../utils/money'
import { COMMODITY_BY_ID } from '../data/commodity'
import {
  StatusPill,
  Banner,
  Btn,
  TextArea,
  Tag,
  PageLoading,
  formatDateTime,
} from './ui'

/*
 * Middle pane of the workbench: the selected request rendered as a
 * document — a paper-like sheet with the record's fields, its order lines
 * as a document table, and the status trail a procurement clerk reads. When
 * the request came from an uploaded offer (typically a PDF), those bytes are
 * shown next to it: tabs "Request Sheet" ⇄ "Offer Document".
 */

const NEXT_STATUS_ACTIONS = { Open: ['In Progress'], 'In Progress': ['Closed'], Closed: [] }

export default function RequestDocument({ id, onChanged, reloadKey = 0 }) {
  const { user } = useAuth()
  const canManage = user.role !== 'requestor'

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState(null)
  // A short success confirmation for the last status move — "Approved" for a
  // close (the clerk's grant), the status name for any other move.
  const [statusNote, setStatusNote] = useState(null)
  const [tab, setTab] = useState('sheet') // 'sheet' | 'document'
  const [focus, setFocus] = useState(false) // full-height document view

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await requestsApi.get(id))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Request not found.'
          : err.payload?.detail ?? 'Could not load this request.',
      )
    }
  }, [id])

  useEffect(() => {
    setData(null)
    setStatusNote(null)
    load()
  }, [load])

  // A save elsewhere (the edit form in the extraction pane) re-reads the sheet.
  useEffect(() => {
    if (reloadKey) load()
  }, [reloadKey, load])

  // A request created from an uploaded document opens on that document —
  // the request sheet stays one tab away.
  const requestViewId = data?.request?.id
  const hasDoc = Boolean(data?.request?.document)
  useEffect(() => {
    if (hasDoc) setTab('document')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestViewId])

  // Full height is a document-view affordance; the sheet is never long.
  useEffect(() => {
    if (tab !== 'document') setFocus(false)
  }, [tab])

  const changeStatus = async (newStatus) => {
    setStatusBusy(true)
    setStatusError(null)
    setStatusNote(null)
    try {
      const d = await requestsApi.updateStatus(id, newStatus, comment)
      setData(d)
      setComment('')
      setStatusNote(newStatus === 'Closed' ? 'Approved' : newStatus)
      onChanged?.()
    } catch (err) {
      setStatusError(err.payload?.detail ?? 'Updating failed.')
    } finally {
      setStatusBusy(false)
    }
  }

  if (error) {
    return (
      <div className="docview">
        <Banner kind="error" title="Request Not Available">
          <p>{error}</p>
        </Banner>
      </div>
    )
  }
  if (!data) return <PageLoading />

  const { request: r, status_history: history } = data
  const group = COMMODITY_BY_ID.get(r.commodity_group_id)
  const nextStatuses = canManage ? (NEXT_STATUS_ACTIONS[r.status] ?? []) : []
  const doc = r.document

  return (
    <div className={`docview${focus ? ' docview--focus' : ''}`}>
      <header className="docview__head">
        <p className="docview__eyebrow">
          Request #{r.id.replace(/^r/, '')} · {formatDateTime(r.created_at)}
        </p>
        <div className="docview__headtools">
          {doc && (
            <div className="docview__tabs" role="tablist" aria-label="Request view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'document'}
                className={`chip chip--small${tab === 'document' ? ' chip--active' : ''}`}
                onClick={() => setTab('document')}
              >
                Offer Document
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'sheet'}
                className={`chip chip--small${tab === 'sheet' ? ' chip--active' : ''}`}
                onClick={() => setTab('sheet')}
              >
                Request Sheet
              </button>
            </div>
          )}
          {/* Only meaningful over the long PDF — the sheet is short. */}
          {doc && tab === 'document' && (
            <button
              type="button"
              className="chip chip--small docview__expand"
              aria-pressed={focus}
              title={focus ? 'Bring back the header' : 'Let the document fill the pane'}
              onClick={() => setFocus((v) => !v)}
            >
              {focus ? '⤡ Show Header' : '⤢ Full Height'}
            </button>
          )}
          <StatusPill status={r.status} />
        </div>
      </header>

      {/* Slim status strip — the trail a clerk reads at a glance; comments
          ride along as tooltips so the row never grows taller. */}
      <section className="docview__trail">
        <span className="docview__traillabel">Status Trail</span>
        <ol className="history">
          {history.map((h) => (
            <li className="history__entry" key={h.id} title={h.comment}>
              <span className="history__marker" aria-hidden="true" />
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
                <span className="history__meta">
                  {' '}
                  · {formatDateTime(h.changed_at)} · {h.changed_by}
                </span>
              </p>
            </li>
          ))}
        </ol>
        {canManage && nextStatuses.length > 0 && (
          <div className="docview__manage">
            {nextStatuses.map((s) => (
              <Btn key={s} onClick={() => changeStatus(s)} disabled={statusBusy}>
                {s === 'Closed' ? 'Close Request' : `Move to “${s}”`}
              </Btn>
            ))}
            <TextArea
              className="docview__statuscomment"
              aria-label="Comment (kept in the history)"
              value={comment}
              maxLength={500}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment (kept in the history)…"
            />
            {statusError && (
              <p className="field__error" role="alert">
                {statusError}
              </p>
            )}
          </div>
        )}
        {/* Outside the mover block — once Closed the mover itself is gone
            and only this confirmation marks the move. */}
        {statusNote && (
          <Banner kind="success" onDismiss={() => setStatusNote(null)}>
            <p>{statusNote}</p>
          </Banner>
        )}
      </section>

      {doc && tab === 'document' ? (
        <OfferDocument doc={doc} />
      ) : (
        <RequestSheet request={r} group={group} />
      )}
    </div>
  )
}

/** The uploaded offer itself, exactly as it arrived — rendered page by page. */
function OfferDocument({ doc }) {
  const [data, setData] = useState(null)
  const [numPages, setNumPages] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setNumPages(null)
    setFailed(false)
    if (doc.mime !== 'application/pdf') {
      // Non-PDF uploads have no viewer; the text is already in the request.
      return undefined
    }
    documentsApi
      .get(doc.id)
      .then(({ document: d }) => {
        if (alive) setData(d.mime === 'application/pdf' ? d : null)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [doc.id])

  if (failed) {
    return (
      <div className="pdfview pdfview--missing">
        <p>The document could not be loaded (size {Math.round(doc.size / 1024)} KB · {doc.filename}).</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="pdfview pdfview--missing">
        <p>{doc.filename}</p>
        <p className="extraction__note">Uploaded as stored text; its contents are in the request sheet.</p>
      </div>
    )
  }
  return (
    <div className="pdfview">
      <p className="pdfview__file">
        {doc.filename}
        {numPages != null && numPages > 1 ? ` · ${numPages} pages` : ''}
      </p>
      <PdfPages dataUrl={data.data} onPages={setNumPages} />
      <DocumentDownload doc={doc} />
    </div>
  )
}

function DocumentDownload({ doc }) {
  const [href, setHref] = useState(null)
  useEffect(() => {
    let alive = true
    documentsApi
      .get(doc.id)
      .then(({ document: d }) => alive && setHref(d.data))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [doc.id])
  if (!href) return null
  return (
    <a className="linklike pdfview__download" href={href} download={doc.id}>
      Download the original ({doc.mime}, {Math.round(doc.size / 1024)} KB)
    </a>
  )
}

/** The paper representation of the request record. */
function RequestSheet({ request: r, group }) {
  return (
    <article className="sheet">
      <h1 className="sheet__title">{r.title}</h1>
      <p className="sheet__byline">
        Requested by <strong>{r.requestor_name}</strong>, {r.department}
      </p>

      <div className="sheet__parties">
        <div>
          <p className="sheet__label">Vendor</p>
          <p className="sheet__value">{r.vendor_name}</p>
        </div>
        <div>
          <p className="sheet__label">VAT ID</p>
          <p className="sheet__value">{r.vendor_vat_id}</p>
        </div>
        <div>
          <p className="sheet__label">Commodity Group</p>
          <p className="sheet__value">
            {group ? (
              <>
                <Tag tone="primary">{group.category}</Tag> {group.name}{' '}
                <span className="sheet__muted">(ID {group.id})</span>
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
      </div>

      <table className="sheet__lines">
        <thead>
          <tr>
            <th>#</th>
            <th>Position Description</th>
            <th className="num">Unit Price</th>
            <th className="num">Amount</th>
            <th>Unit</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {r.order_lines.map((line) => (
            <tr key={line.id}>
              <td className="sheet__muted">{line.position}</td>
              <td>{line.position_description}</td>
              <td className="num">{formatMoney(line.unit_price)}</td>
              <td className="num">{line.amount}</td>
              <td>{line.unit}</td>
              <td className="num">{formatMoney(line.total_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="sheet__total">
        Total Cost <strong>{formatMoney(r.total_cost)}</strong>
      </p>
    </article>
  )
}