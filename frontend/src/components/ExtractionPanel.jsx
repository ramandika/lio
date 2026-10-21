import { useRef, useState } from 'react'
import { extraction } from '../api'
import { Tag, Spinner } from './ui'

/*
 * Offer-upload affordance: pick a vendor offer, the (mocked) extraction
 * service pre-fills the form, and the result is summarized so the user
 * reviews before touching a field. Extraction is a suggestion, never truth.
 */

const DETECTED_FIELDS = [
  ['vendor_name', 'Vendor Name'],
  ['vendor_vat_id', 'VAT ID'],
  ['department', 'Department'],
  ['order_lines', 'Order Lines'],
  ['total_cost', 'Total Cost'],
]

export default function ExtractionPanel({ onExtracted }) {
  const fileInput = useRef(null)
  const [phase, setPhase] = useState('idle') // idle | working | done | failed
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [failDetail, setFailDetail] = useState(null)
  const [filename, setFilename] = useState('')

  const readFile = async (file) => {
    if (!file) return
    setFilename(file.name)
    setPhase('working')
    setResult(null)
    setFailDetail(null)
    let content = ''
    try {
      content = await file.text()
    } catch {
      setFailDetail('The file could not be read as text.')
      setPhase('failed')
      return
    }
    try {
      const res = await extraction.submit(
        { filename: file.name, mimeType: file.type, content },
        setProgress,
      )
      if (res.ok) {
        setResult(res)
        setPhase('done')
        onExtracted(res)
      } else {
        setFailDetail(res.detail ?? 'Extraction failed.')
        setPhase('failed')
      }
    } catch {
      setFailDetail('Extraction failed.')
      setPhase('failed')
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    readFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="extract card card--panel">
      <div className="extract__head">
        <h3 className="extract__title">Have a Vendor Offer?</h3>
        <p className="extract__standfirst">
          Upload it and this form fills itself — you review every value before submitting.
        </p>
      </div>

      {(phase === 'idle' || phase === 'failed') && (
        <div
          className="extract__drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.csv,.pdf"
            aria-label="Upload offer document"
            onChange={(e) => readFile(e.target.files?.[0])}
          />
          <button type="button" className="btn btn--primary" onClick={() => fileInput.current?.click()}>
            Upload Offer
          </button>
          <span className="extract__hint">…or drag a .txt file here (PDF needs the full stack)</span>
        </div>
      )}

      {phase === 'working' && (
        <div className="extract__progress" aria-busy="true">
          <Spinner />
          <span>
            {progress || 'Starting'} — reading “{filename}”…
          </span>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="extract__summary">
          <div className="extract__meta">
            <Tag tone={result.layer === 'L1' ? 'primary' : 'neutral'}>
              {result.layer === 'L1'
                ? 'Extracted deterministically (L1)'
                : 'Extracted via LLM (L2)'}
            </Tag>
            <span className="extract__file">{filename}</span>
          </div>
          <ul className="extract__fields">
            {DETECTED_FIELDS.map(([key, label]) => {
              const ok = result.detected?.[key]
              return (
                <li key={key} className={ok ? 'extract__field extract__field--ok' : 'extract__field extract__field--miss'}>
                  <span className="extract__mark" aria-hidden="true">
                    {ok ? '✓' : '✕'}
                  </span>
                  {label}
                  {!ok && <em>not detected — please enter manually</em>}
                </li>
              )
            })}
          </ul>
          {result.layer === 'L2' && (
            <p className="extract__note">
              The standard parse didn’t validate, so a language model produced this draft.
              All fields were re-checked — anything still missing is left blank for you.
            </p>
          )}
          <p className="extract__note">Review every value before submitting — these are suggestions.</p>
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setPhase('idle')
              setResult(null)
            }}
          >
            Upload a different document
          </button>
        </div>
      )}

      {phase === 'failed' && (
        <div className="extract__failed" role="alert">
          <p>Couldn’t extract from “{filename}” — enter the details manually, everything below works without it.</p>
          {failDetail && <p className="extract__hint">{failDetail}</p>}
        </div>
      )}
    </div>
  )
}