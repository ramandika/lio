import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { requests as requestsApi } from '../api'
import { useAuth } from '../context/AuthContext'
import RequestsRail from '../components/RequestsRail'
import RequestDocument from '../components/RequestDocument'
import DraftDocument from '../components/DraftDocument'
import ExtractionPane from '../components/ExtractionPane'

/*
 * The one page (docs/DESIGN.md): requests rail on the left, the document in
 * the middle — the uploaded offer while drafting, the request rendered as a
 * document once saved — and the extraction layer on the right, holding the
 * drafting form so values are edited beside the readable offer. Selection
 * lives in the URL (?selected=<id|new>) so views stay linkable.
 */

export default function Workbench() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const selected = params.get('selected')

  const [rows, setRows] = useState(null)
  const [status, setStatus] = useState('All')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [error, setError] = useState(null)
  const [extraction, setExtraction] = useState(null) // {result, nonce} while drafting
  const [reloadKey, setReloadKey] = useState(0) // bumped when an edit saves elsewhere

  const drafting = selected === 'new'
  // Both pane-with-form modes give the extraction layer the room the form needs.
  const paneHasForm = Boolean(selected)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const load = async () => {
    setError(null)
    try {
      const { requests } = await requestsApi.list({ status, q: qDebounced })
      setRows(requests)
      return requests
    } catch (err) {
      setError(err.payload?.detail ?? 'Could not load requests.')
      return null
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, qDebounced])

  const select = (id) => {
    if (id) setParams({ selected: id }, { replace: false })
    else setParams({}, { replace: true })
  }

  const refreshList = () => load()

  return (
    <div className={`workbench${paneHasForm ? ' workbench--drafting' : ''}`}>
      <div className="workbench__rail">
        <RequestsRail
          rows={rows}
          error={error}
          status={status}
          onStatus={setStatus}
          q={q}
          onQ={setQ}
          selected={selected}
          onSelect={select}
          role={user.role}
        />
      </div>
      <div className="workbench__center">
        {drafting ? (
          <DraftDocument extraction={extraction} />
        ) : selected ? (
          <RequestDocument id={selected} onChanged={refreshList} reloadKey={reloadKey} />
        ) : (
          <EmptyDoc onAdd={() => select('new')} />
        )}
      </div>
      <div className="workbench__side">
        <ExtractionPane
          mode={drafting ? 'draft' : selected ? 'request' : 'idle'}
          requestId={selected && !drafting ? selected : null}
          extraction={extraction}
          onExtracted={(result) => setExtraction({ result, nonce: Date.now() })}
          onReset={() => setExtraction(null)}
          onDraftDone={(request) => {
            setExtraction(null)
            refreshList()
            select(request.id)
          }}
          onRequestSaved={() => {
            setReloadKey((k) => k + 1)
            refreshList()
          }}
          onLeave={() => {
            setExtraction(null)
            select(null)
          }}
        />
      </div>
    </div>
  )
}

function EmptyDoc({ onAdd }) {
  return (
    <div className="docempty">
      <h1 className="docempty__title">Select a Request</h1>
      <p className="docempty__body">Pick one from the list to read it as a document — or file a new request.</p>
      <button type="button" className="btn btn--primary" onClick={onAdd}>
        Add Request
      </button>
    </div>
  )
}