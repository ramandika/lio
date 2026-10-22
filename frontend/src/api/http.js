/*
 * Live HTTP transport — the thing `useMock = false` in api/index.js routes to.
 * Same call surface as the mock (`call(method, path, {body, query,
 * onProgress})`), same ApiError shape, so views and validation mirrors are
 * transport-agnostic (PROJECT_PLAN.md item 11).
 *
 * Transport notes:
 *   - requests are same-origin under the Vite dev proxy (`/api` → the app
 *     container; in production FastAPI serves the SPA at the same origin),
 *     so session cookies flow with default same-origin credentials;
 *   - an HTTP failure is unwrapped into the ApiError the views throw and
 *     catch against the mock; FastAPI wraps HTTPException detail in
 *     `{detail: <value>}` — an object detail (e.g. `{errors: {...}}`) is
 *     surfaced as the payload itself, a string one as `{detail: string}`;
 *   - extraction posts the original file as a multipart upload — PDFs are
 *     read server-side with PyMuPDF (the browser-side pdf.js pass was the
 *     mock-era stand-in); there is no streaming progress channel, so
 *     onProgress is accepted and not called (the extraction panel keeps its
 *     own phase state).
 */

import { ApiError } from './ApiError'

const BASE = '/api'

export async function call(method, path, { body, query, onProgress } = {}) {
  void onProgress // no live progress over a single response — phases only
  const url = BASE + path + (query ? `?${new URLSearchParams(query)}` : '')
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let payload = null
    try {
      payload = await res.json()
    } catch {
      /* non-JSON error body — fall through to a bare status */
    }
    if (payload && typeof payload.detail === 'object' && payload.detail !== null) {
      throw new ApiError(res.status, payload.detail)
    }
    throw new ApiError(res.status, payload?.detail ?? payload ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  try {
    return await res.json()
  } catch {
    return null
  }
}

function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' })
}

/**
 * Offer extraction over the live boundary: the file rides as a multipart
 * upload ({filename, mimeType, content, data} is what the panel passes —
 * `data` is the original file as a data URL, `content` the extracted plain
 * text). The server sniffs PDFs, reads them with PyMuPDF and answers the
 * same {ok, layer, fields, …} shape the mock produced.
 */
export async function extractionSubmit({ filename, mimeType = '', content, data }, onProgress) {
  void onProgress
  const form = new FormData()
  const blob = data ? dataUrlToBlob(data) : null
  if (blob) {
    form.append('file', blob, filename || 'upload')
  }
  if (content != null && data == null) {
    form.append('content', content)
  }
  const res = await fetch(`${BASE}/extraction`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, payload?.detail ?? `HTTP ${res.status}`)
  }
  return payload
}