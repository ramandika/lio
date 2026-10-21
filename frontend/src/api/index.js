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

export { ApiError } from './mock/server'

const useMock = true // flip once the real backend is wired up

async function call(method, path, opts) {
  if (useMock) return mockServer.call(method, path, opts)
  // Live transport goes here (fetch with credentials: 'include').
  throw new Error('Live API transport not implemented yet')
}

const GET = (path, opts) => call('GET', path, opts)
const POST = (path, opts) => call('POST', path, opts)

export const auth = {
  login: (email, password) => POST('/auth/login', { body: { email, password } }),
  logout: () => POST('/auth/logout', {}),
  me: () => GET('/auth/me', {}),
}

export const requests = {
  list: (query = {}) => GET('/requests', { query }),
  get: (id) => GET(`/requests/${id}`, {}),
  create: (payload) => POST('/requests', { body: payload }),
  updateStatus: (id, newStatus, comment) =>
    POST(`/requests/${id}/status`, { body: { new_status: newStatus, comment } }),
}

/** Offer extraction. body: { filename, mimeType, content? , file? } */
export const extraction = {
  submit: async ({ filename, mimeType, content }, onProgress) => {
    if (mimeType === 'application/pdf' || /\.(pdf)$/i.test(filename)) {
      // PDFs are read by PyMuPDF in the real backend; the mock cannot parse
      // binary payloads, so it exercises the documented degradation path.
      await new Promise((r) => setTimeout(r, 400))
      return { ok: false, detail: 'PDF extraction needs the backend service — this browser build reads text documents (.txt, .md, .csv). The full stack handles PDFs.'
      }
    }
    return POST('/extraction', { body: { filename, content }, onProgress })
  },
}

export const commodity = {
  suggest: (payload) => POST('/commodity/suggest', { body: payload }),
}