import { useEffect, useState } from 'react'
import { requests as requestsApi } from '../api'
import ExtractionPanel from './ExtractionPanel'
import DraftForm from './DraftForm'
import { Tag, PageLoading } from './ui'

/*
 * Right pane of the workbench — the extraction layer. While drafting a
 * request it hosts the upload/extract panel and the editable form itself, so
 * the extracted values are reviewed next to the document readable in the
 * center pane. For a saved request it keeps the paper trail as a compact
 * strip above the editable form while the request is Open, and locked prose
 * once it is not.
 */

export default function ExtractionPane({
  mode,
  requestId,
  extraction,
  onExtracted,
  onReset,
  onDraftDone,
  onRequestSaved,
  onLeave,
}) {
  return (
    <aside className="extraction" aria-label="Extraction layer">
      <p className="extraction__eyebrow">Extraction Layer</p>
      {mode === 'draft' && (
        <>
          <ExtractionPanel key="draft" onExtracted={onExtracted} onReset={onReset} />
          <DraftForm extraction={extraction} onDone={onDraftDone} onLeave={onLeave} />
        </>
      )}
      {mode === 'request' && (
        <RequestTools requestId={requestId} onSaved={onRequestSaved} onLeave={onLeave} />
      )}
      {mode === 'idle' && (
        <div className="extraction__idle">
          <p className="extraction__note">
            Add a request and its offer is uploaded and extracted here, with the
            editable form below it — the document itself unfolds in the center while
            you fill the draft in, and the paper trail (document + layer) is kept with
            the request afterward.
          </p>
        </div>
      )}
    </aside>
  )
}

/**
 * A saved request in the pane: a compact provenance strip and — while the
 * request is still Open — the editable form, prefilled from the saved record
 * (`onSaved` refreshes the center and the rail). In Progress/Closed requests
 * are locked; their facts are fixed and only their trail moves.
 */
function RequestTools({ requestId, onSaved, onLeave }) {
  const [data, setData] = useState(null)
  const [version, setVersion] = useState(0) // remounts the form after save / discard

  useEffect(() => {
    let alive = true
    setData(null)
    setVersion(0)
    requestsApi
      .get(requestId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ request: null }))
    return () => {
      alive = false
    }
  }, [requestId])

  if (!data) return <div className="extraction__loading"><PageLoading /></div>
  const r = data.request
  if (!r) return <p className="extraction__note">The request is not available.</p>

  const editable = r.status === 'Open'
  return (
    <>
      <ProvenanceStrip source={r.source} editable={editable} />
      {editable ? (
        <DraftForm
          key={`${r.id}:${version}`}
          initial={data}
          onDone={onSaved} // the center and rail reload; the form already holds the saved values
          onLeave={() => setVersion((v) => v + 1)} // discard: back to the saved values
        />
      ) : (
        <p className="extraction__note extraction__locked">
          This request is <strong>{r.status}</strong> — its record is locked; only the
          status trail beside keeps moving.
        </p>
      )}
    </>
  )
}

/** Compact paper trail: which document, which layer — the form below (or the tab beside). */
function ProvenanceStrip({ source, editable }) {
  if (!source) {
    return (
      <div className="card card--panel">
        <h3 className="block__title">Entered Manually</h3>
        <p className="extraction__note">
          No offer document was uploaded for this request — every field was typed by
          hand and validated at submission.
        </p>
      </div>
    )
  }
  return (
    <div className="card card--panel">
      <h3 className="block__title">Document Source</h3>
      <p className="extraction__fileline">{source.filename}</p>
      <p className="extract__meta">
        <Tag tone={source.layer === 'L1' ? 'primary' : 'neutral'}>
          {source.layer === 'L1' ? 'Extracted deterministically (L1)' : 'Extracted via LLM (L2)'}
        </Tag>
      </p>
      <p className="extraction__note">
        {editable
          ? 'Edit the prefilled values in the form below — the document itself is readable on the Offer Document tab beside.'
          : 'The uploaded document is readable on the Offer Document tab beside.'}
      </p>
    </div>
  )
}