/*
 * API facade — the only module views may import for data access. Today it
 * delegates to the in-browser mock (api/mock/server.js); when the FastAPI
 * backend lands, only this file changes (see api/http.js for the target
 * transport). Its method surface mirrors the documented REST API:
 *
 *   LOGIN_ARCHITECTURE.md  → auth.login / auth.logout / auth.me
 *   ARCHITECTURE.md §2     → requests.*, extraction, commodity.suggest
 */

import * as mockServer from './mock/server'
import { pdfToText, pdfPageImages } from '../utils/pdf'

export { ApiError } from './mock/server'

const useMock = true // flip once the real backend is wired up

async function call(method, path, opts) {
  if (useMock) return mockServer.call(method, path, opts)
  // Live transport goes here (fetch with credentials: 'include').
  throw new Error('Live API transport not implemented yet')
}

const GET = (path, opts) => call('GET', path, opts)
const POST = (path, opts) => call('POST', path, opts)
const PUT = (path, opts) => call('PUT', path, opts)

export const auth = {
  login: (email, password) => POST('/auth/login', { body: { email, password } }),
  logout: () => POST('/auth/logout', {}),
  me: () => GET('/auth/me', {}),
}

export const requests = {
  list: (query = {}) => GET('/requests', { query }),
  get: (id) => GET(`/requests/${id}`, {}),
  create: (payload) => POST('/requests', { body: payload }),
  // Edit a saved request (same payload as create). Server-side rules:
  // only while the request is still Open; ownership for requestors.
  update: (id, payload) => PUT(`/requests/${id}`, { body: payload }),
  updateStatus: (id, newStatus, comment) =>
    POST(`/requests/${id}/status`, { body: { new_status: newStatus, comment } }),
}

/** Offer extraction. body: { filename, mimeType, content? , data? } */
export const extraction = {
  submit: async ({ filename, mimeType = '', content, data }, onProgress) => {
    // The real backend sniffs/stores the MIME server-side; here the filename
    // is authoritative (some browsers label PDFs application/octet-stream).
    if (/\.pdf$/i.test(filename)) mimeType = 'application/pdf'
    // PDFs are read with PyMuPDF in the real backend; the mock reads them
    // in-browser with pdf.js (utils/pdf.js) and runs the same L1/L2 pipeline
    // on the text, with the rendered page images riding along for the L2
    // fuse (llm_ocr_fuse). The original file travels along as a data URL so
    // the mock can store it where the backend would keep it in the uploads
    // volume.
    let images = []
    if (mimeType === 'application/pdf') {
      try {
        content = await pdfToText(data)
      } catch (err) {
        console.warn('pdf.js text extraction failed, degrading to manual entry:', err)
        await new Promise((r) => setTimeout(r, 400))
        return {
          ok: false,
          detail: 'The PDF could not be read in this browser build. The full stack reads PDFs with PyMuPDF — enter the details manually.',
        }
      }
      try {
        images = await pdfPageImages(data)
      } catch (err) {
        console.warn('pdf.js page rendering failed; the LLM fuse reads text only:', err)
        images = []
      }
    }
    return POST('/extraction', { body: { filename, mimeType, content, data, images }, onProgress })
  },
}

/** Uploaded offer documents. The real backend stores files in the uploads volume. */
export const documents = {
  get: (id) => GET(`/documents/${id}`, {}),
}

export const commodity = {
  suggest: (payload) => POST('/commodity/suggest', { body: payload }),
}