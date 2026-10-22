/*
 * The ApiError shape the views know: `status`, `payload`, and a message
 * built from the payload. Lives here — not inside the mock — so the live
 * HTTP transport (api/http.js) throws the identical class and the views
 * (api/index.js re-exports it) never change. The mock re-exports it.
 */

export class ApiError extends Error {
  constructor(status, payload) {
    super(typeof payload === 'string' ? payload : JSON.stringify(payload))
    this.status = status
    this.payload = typeof payload === 'string' ? { detail: payload } : payload
  }
}