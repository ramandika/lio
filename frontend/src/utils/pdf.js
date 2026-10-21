/*
 * PDF → text, in the browser. In the real backend PyMuPDF does this
 * server-side (ARCHITECTURE.md L1); in the mock, pdf.js stands in so the
 * uploaded-PDF case runs end-to-end without a backend. Text is
 * reconstructed into lines the same way PyMuPDF's layout output behaves:
 * one line per text-run row, using pdf.js' EOL markers.
 */

// Lazy so the worker only loads when a PDF is actually uploaded.
let pdfjsPromise = null

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(async (pdfjs) => {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })
  }
  return pdfjsPromise
}

export async function pdfToText(dataUrl) {
  const pdfjs = await getPdfjs()
  const pdf = await pdfjs.getDocument({ url: dataUrl }).promise
  const lines = []
  for (const pageNo of Array.from({ length: pdf.numPages }, (_, i) => i + 1)) {
    const page = await pdf.getPage(pageNo)
    const content = await page.getTextContent()
    let current = ''
    let currentY = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = item.transform?.[5]
      if (y != null && currentY != null && Math.abs(y - currentY) > 2) {
        lines.push(current)
        current = ''
      }
      currentY = y ?? currentY
      current += item.str
      if (item.hasEOL) {
        lines.push(current)
        current = ''
        currentY = null
      }
    }
    if (current.trim()) lines.push(current)
  }
  return lines.join('\n')
}

/**
 * Render each page of a PDF (as a data URL) to a <canvas>, sized to
 * maxWidth. Used by the document viewer — this renders deterministically in
 * any browser, unlike <embed>/'<iframe>' which depend on the browser's PDF
 * plugin (absent in some headless builds).
 */
export async function renderPdfPages(dataUrl, maxWidth = 720) {
  const pdfjs = await getPdfjs()
  const pdf = await pdfjs.getDocument({ url: dataUrl }).promise
  const canvases = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const dpr = window.devicePixelRatio || 1
    // Raster scale is capped (×3.5 of device pixels) to bound canvas memory;
    // past the cap the page simply sharpens less, it still displays larger.
    const fit = Math.min(maxWidth / base.width, 3.5 / dpr)
    const viewport = page.getViewport({ scale: fit * dpr })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    canvas.className = 'pdfpage'
    canvas.style.width = `${Math.round(maxWidth)}px`
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    canvases.push(canvas)
  }
  return { canvases, numPages: pdf.numPages }
}