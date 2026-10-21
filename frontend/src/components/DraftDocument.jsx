import { useEffect, useState } from 'react'
import PdfPages from './PdfPages'
import { Tag } from './ui'

/*
 * Center pane while a request is being drafted. The uploaded offer lives
 * here — it stays readable beside the prefilled form in the Extraction
 * Layer — mirroring what the saved request will look like (Offer Document
 * tab over the request sheet).
 */
export default function DraftDocument({ extraction }) {
  const draft = extraction?.result // {filename, dataUrl, mimeType, …}

  return (
    <div className="docview">
      <header className="docview__head">
        <p className="docview__eyebrow">New Request · Offer Document</p>
        <Tag tone="neutral">Draft</Tag>
      </header>
      {draft?.dataUrl ? (
        draft.isPdf ? (
          <div className="pdfview">
            <p className="pdfview__file">{draft.filename}</p>
            <PdfPages dataUrl={draft.dataUrl} />
          </div>
        ) : (
          <TextDocument dataUrl={draft.dataUrl} filename={draft.filename} />
        )
      ) : (
        <div className="docempty">
          <h1 className="docempty__title">Your Offer Appears Here</h1>
          <p className="docempty__body">
            Upload the vendor offer in the Extraction Layer — you edit the prefilled
            form beside it while the document itself stays readable, then submit.
            Entering the details manually works without any document.
          </p>
        </div>
      )}
    </div>
  )
}

/** A text/CSV offer, read from its data URL and shown as received. */
function TextDocument({ dataUrl, filename }) {
  const [text, setText] = useState(null)

  useEffect(() => {
    let alive = true
    fetch(dataUrl)
      .then((r) => r.text())
      .then((t) => alive && setText(t))
      .catch(() => alive && setText(''))
    return () => {
      alive = false
    }
  }, [dataUrl])

  return (
    <article className="sheet">
      <p className="pdfview__file">{filename}</p>
      <pre className="draftdoc__text">{text ?? '…'}</pre>
    </article>
  )
}