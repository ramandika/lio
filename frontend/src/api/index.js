/*
 * API facade — the only module views may import for data access. The mock
 * transport is DORMANT: nothing from api/mock/ (or the pdf.js stand-ins)
 * executes unless `useMock` is flipped true for an offline demo. With
 * `useMock = false` everything runs over the live HTTP transport
 * (api/http.js — same-origin `/api`, session cookies, multipart extraction).
 * Method surface mirrors the documented REST API:
 *
 *   LOGIN_ARCHITECTURE.md  → auth.login / auth.logout / auth.me
 *   ARCHITECTURE.md §2     → requests.*, extraction, commodity.suggest
 */

import * as http from './http'

export { ApiError } from './ApiError'

const useMock = false // flip true ONLY for the offline/mock demo (localStorage mockdb)

async function call(method, path, opts) {
  if (useMock) {
    // Dynamic import: the mock is loaded (and initializes its storage) only
    // on this dormant branch — never during normal runs.
    const mock = await import('./mock/server')
    return mock.call(method, path, opts)
  }
  return http.call(method, path, opts)
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

/** Offer extraction. input: { filename, mimeType, content? , data? } */
export const extraction = {
  submit: async ({ filename, mimeType = '', content, data }, onProgress) => {
    if (/\.pdf$/i.test(filename)) mimeType = 'application/pdf'
    if (useMock) {
      // Mock-era path (dormant): PDFs are read in-browser with pdf.js (the
      // PyMuPDF stand-in) and the parsed text rides along. With the live
      // transport the original file goes to the backend verbatim (multipart)
      // and PyMuPDF reads it server-side.
      const { pdfToText, pdfPageImages } = await import('../utils/pdf.js')
      let images = []
      if (mimeType === 'application/pdf') {
        try {
          content = await pdfToText(data)
        } catch (err) {
          console.warn('pdf.js text extraction failed, degrading to manual entry:', err)
          await new Promise((r) => setTimeout(r, 400))
          return {
            ok: false,
            detail:
              'The PDF could not be read in this browser build. The full stack reads PDFs with PyMuPDF — enter the details manually.',
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
    }
    return http.extractionSubmit({ filename, mimeType, content, data }, onProgress)
  },
}

/** Uploaded offer documents. The backend stores files in the uploads volume. */
export const documents = {
  get: (id) => call('GET', `/documents/${encodeURIComponent(id)}`, {}),
}

export const commodity = {
  suggest: (payload) => POST('/commodity/suggest', { body: payload }),
  // The explicit re-run (the "Suggest from my entries" button): carries the
  // currently assigned group + its confidence so the advice must be
  // same-or-better to replace it (app/services/classifier.py policy).
  resuggest: (payload) => POST('/commodity/resuggest', { body: payload }),
}