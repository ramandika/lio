import { useEffect, useRef, useState } from 'react'
import { renderPdfPages } from '../utils/pdf'
import { PageLoading } from './ui'

/*
 * The rendered pages of a PDF (a data URL), drawn to canvas. Shared by the
 * request's "Offer Document" tab and the draft's center pane — the canvas
 * pages are appended imperatively, so React owns nothing inside the host div.
 *
 * Pages are drawn at the pane's measured width times the zoom factor
 * (capped, so a maximized window doesn't blow past legible scale) and
 * re-drawn when the pane resizes or the zoom changes. A slim toolbar offers
 * page stepping and zoom; the active page is tracked from scroll position.
 */

const PANI_MAX = 1100 // render width cap at zoom 1 (fit)
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 1.25
const MIN_WIDTH = 320 // never draw narrower than this
const MAX_WIDTH = 2400 // zoom ceiling in pixels
const REDRAW_STEP = 48 // ignore sub-step pane-size jitter so resizes don't re-render in bursts

export default function PdfPages({ dataUrl, onPages }) {
  const pagesRef = useRef(null)
  const drawnRef = useRef(null) // {pane, zoom} of the last draw
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)
  const [numPages, setNumPages] = useState(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let alive = true
    let observer
    let pending = 0

    const draw = () => {
      const host = pagesRef.current
      if (!host) return
      const pane = host.clientWidth || 720
      const width = Math.round(
        Math.min(Math.max(pane * zoom, MIN_WIDTH), Math.min(MAX_WIDTH, pane * ZOOM_MAX)),
      )
      const drawn = drawnRef.current
      if (drawn && drawn.zoom === zoom && Math.abs(drawn.pane - pane) < REDRAW_STEP) return
      drawnRef.current = { pane, zoom }
      renderPdfPages(dataUrl, width)
        .then(({ canvases, numPages: n }) => {
          if (!alive) return
          pagesRef.current?.replaceChildren(...canvases)
          setNumPages(n)
          onPages?.(n)
        })
        .catch(() => alive && setFailed(true))
    }

    // Host width is only measurable once mounted; observe it from then on.
    const raf = requestAnimationFrame(() => {
      draw()
      if (!pagesRef.current || typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(() => {
        window.clearTimeout(pending)
        pending = window.setTimeout(draw, 120)
      })
      observer.observe(pagesRef.current)
    })
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(pending)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl, zoom])

  // Track which page is on screen so the stepper reflects scrolling.
  useEffect(() => {
    if (!numPages) return
    const host = pagesRef.current
    const scroller = host?.closest('.workbench__center') ?? document.scrollingElement
    if (!scroller) return
    let raf = 0
    const compute = () => {
      if (!pagesRef.current) return
      const top = scroller.getBoundingClientRect().top
      let current = 1
      for (const [i, el] of Array.from(pagesRef.current.children).entries()) {
        if (el.getBoundingClientRect().top - top <= 80) current = i + 1
        else break
      }
      setPage(current)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }
    compute()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [numPages])

  const goToPage = (n) => {
    if (!numPages) return
    const target = Math.min(Math.max(n, 1), numPages)
    const el = pagesRef.current?.children[target - 1]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPage(target)
  }

  const zoomBy = (factor) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z * factor) * 100) / 100)))

  if (failed) {
    return (
      <div className="pdfview pdfview--missing">
        <p>The document could not be rendered.</p>
      </div>
    )
  }
  return (
    <>
      <div className="pdftools" role="toolbar" aria-label="Document view controls">
        <button
          type="button"
          className="chip chip--small"
          onClick={() => goToPage(page - 1)}
          disabled={!numPages || page <= 1}
        >
          ‹ Prev
        </button>
        <span className="pdftools__page">
          {numPages ? `${page} / ${numPages}` : '– / –'}
        </span>
        <button
          type="button"
          className="chip chip--small"
          onClick={() => goToPage(page + 1)}
          disabled={!numPages || page >= numPages}
        >
          Next ›
        </button>
        <span className="pdftools__sep" aria-hidden="true" />
        <button type="button" className="chip chip--small" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          −
        </button>
        <span className="pdftools__zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="chip chip--small" onClick={() => zoomBy(ZOOM_STEP)}>
          +
        </button>
        <button
          type="button"
          className="chip chip--small pdftools__fit"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
        >
          Fit
        </button>
      </div>
      {numPages == null && (
        <div className="pdfview__loading">
          <PageLoading />
        </div>
      )}
      <div className={`pdfview__pages${zoom !== 1 ? ' pdfview__pages--zoomed' : ''}`} ref={pagesRef} />
    </>
  )
}