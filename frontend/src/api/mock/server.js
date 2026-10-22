/*
 * Mock API server — an in-browser stand-in for the FastAPI backend, so the
 * UI can be built and demoed before `app/` exists. It mirrors the documented
 * REST surface (ARCHITECTURE.md, LOGIN_ARCHITECTURE.md) and enforces the same
 * rules at this API boundary:
 *
 *   - only valid requests persist (required fields, VAT format, line math…)
 *   - status history is append-only; every change is retained with its actor
 *   - role scoping: requestor sees own requests only, procurement sees all
 *   - the uploads store is scoped the same way: a stored document is read by
 *     its uploader, by whomever may see the request it back, or by staff;
 *     a request may only carry a document its submitter may access
 *
 * Sessions live in localStorage here purely as a dev convenience — the real
 * backend uses HttpOnly cookies (see LOGIN_ARCHITECTURE.md). Swapping this
 * module out for app/api/http.js must not require view changes.
 */

import { extractOffer } from './extraction'
import { suggestCommodity, resuggestCommodity } from './classifier'
import { COMMODITY_BY_ID } from './commodity'
import { SAMPLE_PDF_DATA_URL, SAMPLE_PDF_FILENAME } from './samplePdf'

const STORAGE_KEY = 'asklio.mockdb.v2' // v2: requests carry an uploaded document (r1 ships one)
const SESSION_KEY = 'asklio.mock.session'

export { ApiError } from '../ApiError'

const VAT_RE = /^DE[0-9]{9}$/

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const latency = () => delay(120 + Math.random() * 180)

// --- seed data -------------------------------------------------------------

function seedDb() {
  const now = Date.now()
  const days = (n) => now - n * 24 * 60 * 60 * 1000
  const users = [
    {
      id: 'u1',
      email: 'ana@example.com',
      password: 'demo',
      role: 'requestor',
      display_name: 'Ana Weber',
    },
    {
      id: 'u2',
      email: 'tom@example.com',
      password: 'demo',
      role: 'procurement',
      display_name: 'Tom Richter',
    },
    {
      id: 'u3',
      email: 'kim@example.com',
      password: 'demo',
      role: 'procurement',
      display_name: 'Kim Schneider',
    },
    {
      id: 'u4',
      email: 'admin@example.com',
      password: 'demo',
      role: 'admin',
      display_name: 'Sam Admin',
    },
  ]
  const requests = [
    {
      id: 'r1',
      requestor_name: 'Ana Weber',
      created_by: 'u1',
      title: 'Adobe Creative Cloud Subscription',
      vendor_name: 'Adobe Systems',
      vendor_vat_id: 'DE123456789',
      department: 'Creative Marketing Department',
      commodity_group_id: '031',
      total_cost: 210000,
      status: 'In Progress',
      // r1 is the seeded uploaded-PDF case: the real README sample offer as a
      // PDF, stored like the backend's uploads volume would.
      source: {
        filename: SAMPLE_PDF_FILENAME,
        layer: 'L1',
        document_id: 'd1',
        detected: {
          vendor_name: true,
          vendor_vat_id: true,
          department: true,
          order_lines: true,
          total_cost: true,
        },
      },
      created_at: new Date(days(3)).toISOString(),
      updated_at: new Date(days(2)).toISOString(),
      order_lines: [
        {
          id: 'r1l1',
          position: 1,
          position_description: 'Adobe Photoshop License',
          unit_price: 15000,
          amount: 10,
          unit: 'licenses',
          total_price: 150000,
        },
        {
          id: 'r1l2',
          position: 2,
          position_description: 'Adobe Illustrator License',
          unit_price: 12000,
          amount: 5,
          unit: 'licenses',
          total_price: 60000,
        },
      ],
      status_history: [
        {
          id: 'r1h1',
          old_status: null,
          new_status: 'Open',
          changed_by: 'Ana Weber',
          comment: null,
          changed_at: new Date(days(3)).toISOString(),
        },
        {
          id: 'r1h2',
          old_status: 'Open',
          new_status: 'In Progress',
          changed_by: 'Kim Schneider',
          comment: 'Checking existing company licenses.',
          changed_at: new Date(days(2)).toISOString(),
        },
      ],
    },
    {
      id: 'r2',
      requestor_name: 'Ana Weber',
      created_by: 'u1',
      title: 'Standing Desks for Design Team',
      vendor_name: 'Büro Einrichtung GmbH',
      vendor_vat_id: 'DE987654321',
      department: 'Creative Marketing Department',
      commodity_group_id: '015',
      total_cost: 474000,
      status: 'Open',
      created_at: new Date(days(1)).toISOString(),
      updated_at: new Date(days(1)).toISOString(),
      order_lines: [
        {
          id: 'r2l1',
          position: 1,
          position_description: 'Electric standing desk, 160×80 cm',
          unit_price: 69000,
          amount: 6,
          unit: 'pieces',
          total_price: 414000,
        },
        {
          id: 'r2l2',
          position: 2,
          position_description: 'Assembly service',
          unit_price: 60000,
          amount: 1,
          unit: 'flat',
          total_price: 60000,
        },
      ],
      status_history: [
        {
          id: 'r2h1',
          old_status: null,
          new_status: 'Open',
          changed_by: 'Ana Weber',
          comment: null,
          changed_at: new Date(days(1)).toISOString(),
        },
      ],
    },
    {
      id: 'r3',
      requestor_name: 'Tom Richter',
      created_by: 'u2',
      title: 'Annual Cyber Insurance Renewal',
      vendor_name: 'Rheinland Versicherungen',
      vendor_vat_id: 'DE555444333',
      department: 'HR',
      commodity_group_id: '010',
      total_cost: 950000,
      status: 'Closed',
      created_at: new Date(days(9)).toISOString(),
      updated_at: new Date(days(4)).toISOString(),
      order_lines: [
        {
          id: 'r3l1',
          position: 1,
          position_description: 'Cyber risk policy, annual premium',
          unit_price: 950000,
          amount: 1,
          unit: 'policy',
          total_price: 950000,
        },
      ],
      status_history: [
        {
          id: 'r3h1',
          old_status: null,
          new_status: 'Open',
          changed_by: 'Tom Richter',
          comment: null,
          changed_at: new Date(days(9)).toISOString(),
        },
        {
          id: 'r3h2',
          old_status: 'Open',
          new_status: 'In Progress',
          changed_by: 'Kim Schneider',
          comment: null,
          changed_at: new Date(days(6)).toISOString(),
        },
        {
          id: 'r3h3',
          old_status: 'In Progress',
          new_status: 'Closed',
          changed_by: 'Kim Schneider',
          comment: 'Renewed through 2027.',
          changed_at: new Date(days(4)).toISOString(),
        },
      ],
    },
  ]
  return {
    users,
    requests,
    documents: [
      {
        id: 'd1',
        // Ana uploaded r1's offer — same ownership field as runtime uploads.
        created_by: 'u1',
        filename: SAMPLE_PDF_FILENAME,
        mime: 'application/pdf',
        size: 1908,
        data: SAMPLE_PDF_DATA_URL,
      },
    ],
    sessions: {},
    counters: { request: 4, history: 4, line: 10, document: 2 },
  }
}

// --- persistence ------------------------------------------------------------

let db
try {
  db = JSON.parse(localStorage.getItem(STORAGE_KEY))
} catch {
  /* corrupted storage falls through to a fresh seed */
}
if (!db || !Array.isArray(db.users)) db = seedDb()
if (!Array.isArray(db.documents)) db.documents = []

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    /* private window / storage full — the mock then lives for one page load */
  }
}

function currentSession() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function userForSession() {
  const token = currentSession()
  const userId = token ? db.sessions[token] : null
  return db.users.find((u) => u.id === userId && !u.disabled_at) ?? null
}

function saveSession(token, userId) {
  try {
    localStorage.setItem(SESSION_KEY, token)
  } catch {
    /* ignore — login then only lasts this page load */
  }
  db.sessions[token] = userId
  persist()
}

// --- serializers -----------------------------------------------------------

const userView = ({ id, email, role, display_name }) => ({
  id,
  email,
  role,
  display_name,
})

function requestView(r) {
  const group = COMMODITY_BY_ID.get(r.commodity_group_id) ?? null
  // Uploaded document, brief form (full data comes from GET /documents/:id).
  const doc = (db.documents ?? []).find((d) => d.id === r.source?.document_id)
  const document = doc
    ? { id: doc.id, filename: doc.filename, mime: doc.mime, size: doc.size }
    : null
  return {
    id: r.id,
    requestor_name: r.requestor_name,
    created_by: r.created_by,
    title: r.title,
    vendor_name: r.vendor_name,
    vendor_vat_id: r.vendor_vat_id,
    department: r.department,
    commodity_group_id: r.commodity_group_id,
    commodity_group: group
      ? { id: group.id, category: group.category, name: group.name }
      : null,
    total_cost: r.total_cost,
    status: r.status,
    // Provenance: the uploaded offer document and the extraction layer that
    // prefilled it (null when entered manually). UI nicety until the backend
    // decides whether provenance is a first-class column.
    source: r.source ?? null,
    document,
    created_at: r.created_at,
    updated_at: r.updated_at,
    order_lines: r.order_lines,
  }
}

// --- validation (mirrors the future API boundary) ---------------------------

export function validateRequestPayload(p) {
  const errors = {}
  const err = (field, msg) => {
    if (!errors[field]) errors[field] = msg
  }
  const req = (field, msg = 'Required.') => {
    if (p[field] == null || String(p[field]).trim() === '') err(field, msg)
  }

  req('requestor_name')
  req('title')
  req('vendor_name')
  req('department')
  req('vendor_vat_id', 'VAT ID must match the DE123456789 format.')
  if (p.vendor_vat_id && !VAT_RE.test(String(p.vendor_vat_id).trim())) {
    err('vendor_vat_id', 'VAT ID must match the DE123456789 format.')
  }

  const lines = Array.isArray(p.order_lines) ? p.order_lines : []
  if (lines.length === 0) err('order_lines', 'At least one order line is required.')
  let sum = 0
  lines.forEach((line, i) => {
    if (!line.position_description || !String(line.position_description).trim()) {
      err(`order_lines.${i}.position_description`, 'Description required.')
    }
    if (!line.unit || !String(line.unit).trim()) {
      err(`order_lines.${i}.unit`, 'Unit required.')
    }
    if (line.unit_price == null || !Number.isFinite(line.unit_price) || line.unit_price <= 0) {
      err(`order_lines.${i}.unit_price`, 'Unit price must be greater than 0.')
    }
    if (line.amount == null || !Number.isInteger(line.amount) || line.amount <= 0) {
      err(`order_lines.${i}.amount`, 'Amount must be a whole number greater than 0.')
    }
    if (line.total_price == null || !Number.isFinite(line.total_price)) {
      err(`order_lines.${i}.total_price`, 'Line total required.')
    } else if (
      Number.isFinite(line.unit_price) &&
      Number.isInteger(line.amount) &&
      line.unit_price > 0 &&
      line.amount > 0 &&
      line.total_price !== line.unit_price * line.amount
    ) {
      err(
        `order_lines.${i}.total_price`,
        'Line total must equal unit price × amount.',
      )
    }
    if (Number.isFinite(line.total_price)) sum += line.total_price
  })

  if (p.total_cost == null || !Number.isFinite(p.total_cost)) {
    err('total_cost', 'Total cost required.')
  } else if (lines.length > 0 && lines.every((l) => Number.isFinite(l.total_price))) {
    if (p.total_cost !== sum) {
      err('total_cost', 'Total cost must equal the sum of the line totals.')
    }
  }

  if (p.commodity_group_id != null && !COMMODITY_BY_ID.has(p.commodity_group_id)) {
    err('commodity_group_id', 'Unknown commodity group.')
  }

  return errors
}

const STATUS_TRANSITIONS = {
  Open: ['In Progress'],
  'In Progress': ['Closed'],
  Closed: [],
}

export function validateTransition(oldStatus, newStatus) {
  if (!(newStatus in STATUS_TRANSITIONS)) return `Unknown status “${newStatus}”.`
  const allowed = STATUS_TRANSITIONS[oldStatus] ?? []
  if (allowed.includes(newStatus)) return null
  // The refusal carries the actionable reason: which statuses the request
  // may still reach — none from Closed, where the documented chain ends.
  const may =
    allowed.length > 0
      ? `it may only move to ${allowed.map((s) => `“${s}”`).join(', ')}`
      : 'it has reached the end of the chain and can no longer move'
  return `A request in “${oldStatus}” cannot move to “${newStatus}” — ${may} (requests follow Open → In Progress → Closed).`
}

// --- handlers (method, path) -----------------------------------------------

const handlers = {
  'POST /auth/login': async ({ body }) => {
    await latency()
    const user = db.users.find(
      (u) => u.email.toLowerCase() === String(body.email ?? '').toLowerCase() && !u.disabled_at,
    )
    // Uniform failure for unknown user and bad password — no enumeration.
    if (!user || user.password !== body.password) {
      throw new ApiError(401, 'Invalid email or password.')
    }
    const token = cryptoRandomId()
    saveSession(token, user.id)
    return { user: userView(user) }
  },

  'POST /auth/logout': async () => {
    const token = currentSession()
    if (token) {
      delete db.sessions[token]
      persist()
    }
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
    return { ok: true }
  },

  'GET /auth/me': async () => {
    const user = userForSession()
    if (!user) throw new ApiError(401, 'Not authenticated.')
    return { user: userView(user) }
  },

  'GET /requests': async ({ query }) => {
    const user = requireUser()
    let rows = db.requests
    if (user.role === 'requestor') rows = rows.filter((r) => r.created_by === user.id)
    if (query.status && query.status !== 'All') {
      rows = rows.filter((r) => r.status === query.status)
    }
    if (query.q) {
      const q = query.q.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.vendor_name.toLowerCase().includes(q) ||
          r.requestor_name.toLowerCase().includes(q),
      )
    }
    rows = [...rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    return { requests: rows.map(requestView) }
  },

  'POST /requests': async ({ body }) => {
    const user = requireUser()
    await latency()
    // Provenance must point at a document the submitter may access (403 —
    // same boundary rule as reading it), before the field validation runs.
    assertSourceAccess(user, body.source)
    const errors = validateRequestPayload(body)
    if (Object.keys(errors).length > 0) throw new ApiError(422, { errors })

    const now = new Date().toISOString()
    const requestId = `r${db.counters.request++}`
    const request = {
      id: requestId,
      requestor_name: body.requestor_name.trim(),
      created_by: user.id,
      title: body.title.trim(),
      vendor_name: body.vendor_name.trim(),
      vendor_vat_id: body.vendor_vat_id.trim(),
      department: body.department.trim(),
      commodity_group_id: body.commodity_group_id ?? null,
      total_cost: body.total_cost,
      status: 'Open',
      source: body.source ?? null,
      created_at: now,
      updated_at: now,
      order_lines: body.order_lines.map((line, i) => ({
        id: `${requestId}l${db.counters.line++}`,
        position: i + 1,
        position_description: line.position_description.trim(),
        unit_price: line.unit_price,
        amount: line.amount,
        unit: line.unit.trim(),
        total_price: line.total_price,
      })),
      status_history: [
        {
          id: `h${db.counters.history++}`,
          old_status: null,
          new_status: 'Open',
          changed_by: user.display_name,
          comment: null,
          changed_at: now,
        },
      ],
    }
    db.requests.push(request)
    persist()
    return { request: requestView(request) }
  },

  'GET /requests/:id': async ({ params }) => {
    const user = requireUser()
    const r = db.requests.find((r) => r.id === params.id)
    if (!r || (user.role === 'requestor' && r.created_by !== user.id)) {
      throw new ApiError(404, 'Request not found.')
    }
    return { request: requestView(r), status_history: r.status_history }
  },

  'PUT /requests/:id': async ({ params, body }) => {
    const user = requireUser()
    await latency()
    const r = db.requests.find((r) => r.id === params.id)
    if (!r || (user.role === 'requestor' && r.created_by !== user.id)) {
      throw new ApiError(404, 'Request not found.')
    }
    // Editing rule: the record is only mutable while it is still Open —
    // once a request is in progress its facts are fixed and the trail rules.
    if (r.status !== 'Open') {
      throw new ApiError(409, 'A request can only be edited while it is still “Open”.')
    }
    // The PUT keeps provenance as-is, but it never re-points it at a
    // document the editor cannot access — same 403 as on create.
    assertSourceAccess(user, body.source)
    const errors = validateRequestPayload(body)
    if (Object.keys(errors).length > 0) throw new ApiError(422, { errors })

    const now = new Date().toISOString()
    r.requestor_name = body.requestor_name.trim()
    r.title = body.title.trim()
    r.vendor_name = body.vendor_name.trim()
    r.vendor_vat_id = body.vendor_vat_id.trim()
    r.department = body.department.trim()
    r.commodity_group_id = body.commodity_group_id ?? null
    r.total_cost = body.total_cost
    r.updated_at = now
    // Order lines are re-keyed rows (the backend would replace them the same
    // way). The uploaded document's provenance (source) is kept as it is —
    // an edit never re-attaches the paper trail.
    r.order_lines = body.order_lines.map((line, i) => ({
      id: `${r.id}l${db.counters.line++}`,
      position: i + 1,
      position_description: line.position_description.trim(),
      unit_price: line.unit_price,
      amount: line.amount,
      unit: line.unit.trim(),
      total_price: line.total_price,
    }))
    persist()
    return { request: requestView(r), status_history: r.status_history }
  },

  'POST /requests/:id/status': async ({ params, body }) => {
    const user = requireUser()
    await latency()
    if (user.role === 'requestor') {
      throw new ApiError(403, 'Only procurement staff can update a request status.')
    }
    const r = db.requests.find((r) => r.id === params.id)
    if (!r) throw new ApiError(404, 'Request not found.')

    const problem = validateTransition(r.status, body.new_status)
    if (problem) throw new ApiError(422, { detail: problem })

    const entry = {
      id: `h${db.counters.history++}`,
      old_status: r.status,
      new_status: body.new_status,
      changed_by: user.display_name,
      comment: body.comment?.trim() || null,
      changed_at: new Date().toISOString(),
    }
    r.status_history.push(entry)
    r.status = body.new_status
    r.updated_at = entry.changed_at
    persist()
    return { request: requestView(r), status_history: r.status_history }
  },

  'POST /extraction': async ({ body, onProgress }) => {
    await delay(500)
    onProgress?.('Reading document')
    await delay(400)
    // The upload itself is kept, like the backend's uploads volume — even if
    // extraction fails, the document stays attached to what becomes the draft.
    let document_id = null
    if (body.data) {
      document_id = `d${db.counters.document++}`
      db.documents.push({
        id: document_id,
        // Stored with its uploader, like request.created_by — the boundary
        // checks below scope the uploads store the same way as /requests.
        created_by: userForSession()?.id ?? null,
        filename: body.filename ?? 'upload',
        mime: body.mime ?? body.mimeType ?? 'application/octet-stream',
        size: Math.round((body.data.length * 3) / 4),
        data: body.data,
      })
      persist()
    }
    const result = await extractOffer({
      content: String(body.content ?? ''),
      images: body.images ?? [],
      onProgress,
    })
    await delay(300)
    if (result.layer === null) {
      // The upload was kept (above) even on failure — the degrades message
      // says the user completes the request manually, document attached.
      return {
        ok: false,
        document_id,
        detail: result.detail ?? 'Extraction failed. Please enter the details manually.',
      }
    }
    onProgress?.('Validating extracted fields')
    await delay(250)
    const suggestion = suggestCommodity({
      title: null,
      department: result.fields.department,
      items: result.fields.order_lines,
    })
    return {
      ok: true,
      layer: result.layer,
      document_id,
      fields: result.fields,
      detected: result.detected,
      problems: [...result.problems],
      confidences: result.confidences ?? {},
      low_confidence: result.low_confidence ?? [],
      llm: result.llm ?? null,
      commodity_suggestion: suggestion.suggestion,
    }
  },

  'GET /documents/:id': async ({ params }) => {
    const user = requireUser()
    const doc = (db.documents ?? []).find((d) => d.id === params.id)
    // Same role scoping as /requests, applied to the uploads store: a
    // requestor reaches only documents they uploaded or that back a request
    // they can see; procurement/admin see all. A rejection reads as "not
    // found" — no more than the request handlers confirm about another
    // requestor's data.
    if (!doc || !canAccessDocument(user, doc)) {
      throw new ApiError(404, 'Document not found.')
    }
    return { document: doc }
  },

  'POST /commodity/suggest': async ({ body }) => {
    await delay(350 + Math.random() * 300)
    const { suggestion, candidates } = suggestCommodity(body ?? {})
    return { suggestion, candidates }
  },

  'POST /commodity/resuggest': async ({ body }) => {
    await delay(350 + Math.random() * 300)
    return resuggestCommodity(body ?? {})
  },
}

function requireUser() {
  const user = userForSession()
  if (!user) throw new ApiError(401, 'Not authenticated.')
  return user
}

// Can this user read this stored document? The mirror of the /requests
// scoping over the uploads store: requestors — own uploads and documents
// attached to requests they may see; procurement/admin — everything.
function canAccessDocument(user, doc) {
  if (user.role !== 'requestor') return true
  if (doc.created_by === user.id) return true
  return db.requests.some(
    (r) => r.created_by === user.id && r.source?.document_id === doc.id,
  )
}

// Boundary check for a request payload's provenance: a request may only
// carry (and keep carrying) a document the submitting user may access —
// otherwise a requestor could attach another requestor's upload.
function assertSourceAccess(user, source) {
  const docId = source?.document_id
  if (!docId) return
  const doc = (db.documents ?? []).find((d) => d.id === docId)
  if (!doc || !canAccessDocument(user, doc)) {
    throw new ApiError(403, 'A request can only carry a document you uploaded yourself.')
  }
}

function cryptoRandomId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function call(method, path, { body, query, params, onProgress } = {}) {
  let key = `${method} ${path}`
  let pathParams = {}
  if (!handlers[key]) {
    // Path templates: /requests/:id, /requests/:id/status, /documents/:id
    let m = path.match(/^\/requests\/([^/]+)(\/status)?$/)
    if (m) {
      pathParams = { id: m[1] }
      key = `${method} /requests/:id${m[2] ?? ''}`
    } else if ((m = path.match(/^\/documents\/([^/]+)$/))) {
      pathParams = { id: m[1] }
      key = 'GET /documents/:id'
    }
  }
  const handler = handlers[key]
  if (!handler) throw new ApiError(404, `No mock handler for ${method} ${path}`)
  return handler({ body, query, params: { ...pathParams, ...params }, onProgress })
}