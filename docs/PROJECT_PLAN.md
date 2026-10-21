# Project Plan

This document breaks the challenge described in the [README](../README.md) into workstreams and milestones. It reflects the order in which the product is built and what "done" means for each step.

## Scope

Build a web-based procurement request system ("askLio") with:

1. **Intake** — create and submit new procurement requests.
2. **Auto-fill from offer document** — upload a vendor offer and extract the fields automatically.
3. **Automatic commodity group suggestion** — users should not have to pick the commodity group themselves.
4. **Request overview** — procurement staff browse requests and manage status (Open / In Progress / Closed), with every status change retained as history.

Non-goals for this iteration:

- Authentication / role management beyond a simple requestor vs. procurement view.
- Full approval workflows (budgets, multiple approvers).
- Payment or invoice processing.

## Workstreams

### WS1 — Intake form

| Item | Detail |
|------|--------|
| Goal | Users can create and submit a valid request. |
| Fields | Requestor name, title, vendor name, vendor VAT ID, order lines (description, unit price, amount, unit, line total), total cost, department. |
| Validation | Required fields, VAT ID format (`DE…` per README example), positive amounts, line totals = unit price × amount, request total = sum of line totals. |
| Key rule | **Only valid requests can be submitted.** Invalid input stays on the form with inline errors. |
| Persistence | Every request is saved, including drafts-in-progress after submit attempts fail? — No: only valid requests are persisted; invalid submissions are rejected at the API boundary. |

Done when: a user can fill the form, see validation errors, save, and see the request in the overview.

### WS2 — Document extraction (offer upload)

| Item | Detail |
|------|--------|
| Goal | User uploads a vendor offer document; the request form auto-fills. |
| Input | PDF/text offer document (see sample in README). |
| Output | Vendor name, VAT ID, requestor department, order lines, total cost. |
| Approach | **Two-layer composite**: deterministic parsing first, LLM as a measured fallback (details below). |
| Review step | Extraction results are **pre-filled, not submitted** — the user reviews and corrects before saving. |
| Fallback | Fields the extractor cannot find are left blank for manual entry; the user is told which fields were not detected. |

Extraction pipeline (composite, not LLM-first):

| Layer | What | Cost |
|-------|------|------|
| L1 | Text extraction (PyMuPDF, text layer) + deterministic label/line parsing, followed by schema & math validation per line and for totals, VAT ID format, required fields | 0 — in-process, milliseconds, zero LLM calls |
| Trigger | Validation fails (line math mismatch, VAT format, missing required fields) or detection confidence is low | 0 |
| L2 | LLM extraction (structured output, temperature 0, ≤2 re-prompts) over the raw document text; result passes the same validators before reaching the UI | LLM calls on triggered cases only |

The trigger is **validation-based, not confidence-scored**: in a procurement offer, line math, VAT format and required-field presence are cheap deterministic signals of failure — a cleaner gate than OCR self-confidence, which is unreliable for per-field fallback judgment. In-distribution documents (README-style offers) should resolve at L1; L2 exists for unseen formats, where the LLM remains a suggestion that the same validators re-check. Both layers feed the same review step, so the user is the safety net that L1 alone cannot be.

Done when: uploading the README sample offer produces the "Extracted Information" block shown there (resolved at L1, zero LLM calls), an unseen-format offer triggers L2 and still yields a validated extraction, and the pre-filled form is editable.

### WS3 — Commodity group suggestion

| Item | Detail |
|------|--------|
| Goal | Users do not select the commodity group by hand. |
| Input | Title, item descriptions, vendor info, department. |
| Output | One of the 50 commodity groups (see [COMMODITY_GROUPS.md](COMMODITY_GROUPS.md)). |
| Approach | Structured classification over the fixed group list — prompt the LLM with the full list and have it return ID + label, or a lightweight local classifier with LLM fallback. |
| UX | The suggested group is shown with a confidence cue; the user may override, but must never be forced to browse the list first. |
| Requirement | Departments like "Creative Marketing" must map plausibly (e.g. Marketing & Advertising / Advertising). |

Done when: a request saved through the normal flow gets a sensible commodity group with zero manual selection steps.

### WS4 — Request overview & status management

| Item | Detail |
|------|--------|
| Goal | Procurement sees all requests, updates status, and history is auditable. |
| Statuses | `Open` → `In Progress` → `Closed`. |
| Key rule | **Every status update is retained** — requests store a status history (timestamp, old status, new status), not just the current status. |

Done when: changing a status produces a permanent history entry, and the history is visible in the UI.

### WS5 — Testing, packaging, deployment

- Automated tests for the API (validation, extraction parsing, status history) and core front-end flows.
- Runs on a local machine: `README`-level quick-start, one command to start the stack.
- Repository hosted on GitHub/Bitbucket with this documentation.

## Milestones

1. **M1** — Data model + intake API + form (WS1).
2. **M2** — Overview list + status management with history (WS4). No AI required to have an end-to-end product.
3. **M3** — Offer upload + extraction + auto-fill (WS2).
4. **M4** — Commodity group suggestion (WS3).
5. **M5** — Tests, polish, docs, deployment (WS5).

Progress: M1–M4 are demonstrated end-to-end by the frontend against the mocked backend (`frontend/src/api/mock/`); the backend (`app/`) that makes them real is the next step, followed by M5's test layers.

## Stack decisions

| Layer | Choice |
|-------|--------|
| Back-end | FastAPI with **PostgreSQL** (not SQLite), Python package in `app/` (routers, services, schemas, commodity list). |
| Task queue | **None** — document extraction runs in-process (async handlers, bounded timeout, UI progress + manual-entry degradation). Celery is deliberately not used: the user waits for the pre-filled form anyway, and a broker + worker stack contradicts the one-command local deployment. Upgrade path if ever needed: `202 {job_id}` + in-process task store + polling endpoint; a broker is added only for needs like horizontal scaling or scheduled retries. |
| Database | PostgreSQL as a dedicated compose service (`db`), data in a named volume (`postgres-data`); the app connects via `DATABASE_URL`. |
| Front-end | **React + Vite**, source in a standalone `frontend/` directory; FastAPI serves the built output (`frontend/dist`). No server-side templating. |
| Design tokens | `design/tokens.css` stays the single source and is imported/bundled by Vite. |
| E2E testing | **Cypress** (supersedes the Playwright default in E2E_TESTING.md; journeys J1–J6 stay unchanged). Tests live in `e2e/`, run against the real stack; LLM mocked by config. |
| CI | **GitHub Actions** (`ubuntu-latest`, public repo → free runners). |

Planned layout:

```
frontend/            React + Vite source (package.json, vite.config.js, src/, dist/)
app/                 FastAPI package (main, config, db, schemas, commodity, auth,
                     routers/ requests·extraction·status·commodity,
                     services/ document·llm·extraction·classifier)
scripts/             seed/demo utilities
design/              lio.ai tokens (served as-is, single source)
```

Frontend conventions agreed (not yet implemented):

- No build tooling inside the Python image — `npm` runs only in the Docker build stage; requirements.txt stays frontend-free.
- Validation lives at the API boundary; `frontend/src/validation.js` only mirrors the rules for inline UX.
- LLM calls funnel through a single tier-aware wrapper in `app/services/llm.py` (on only when `LLM_TIER=on` and the key is set).

Changes required at implementation time (currently deferred):

1. ~~`docker-compose.yml` → `db` service~~ **done** (`postgres:17`, named volume `postgres-data`, healthcheck; `uploads` volume keeps the uploaded offer files only — no DB inside it). Remaining: add the `vite` dev service (port 5173, `/api` proxied to the app) when the frontend is wired to the real backend; until then the frontend runs with an in-browser mock API (`npm run dev` in `frontend/`).
2. ~~`requirements.txt` → add `psycopg[binary]`~~ **done** (`psycopg[binary]==3.2.3`); SQLAlchemy/Alembic stay open until the ORM/migration route is decided.
3. ~~Config: `DATABASE_URL`~~ **done** — `DB_PATH` is dropped; compose sets `DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://lio:lio@db:5432/lio}` and `.env.example` documents the override.
4. `app/db.py` → PostgreSQL connection + schema init (or Alembic migrations); numeric columns stored as `NUMERIC`, not floats.
5. `Dockerfile` → multi-stage: `node:20-slim` stage runs `npm ci && npm run build`; the python stage copies `frontend/dist` in. (Needs no DB-specific change.)
6. ~~`.gitignore` → add `frontend/node_modules/` and `frontend/dist/`~~ **done**.
7. ~~`docs/DEPLOYMENT.md` rewrite~~ **done** — now documents the Postgres service, `DATABASE_URL`, and the two volumes (`postgres-data`, `uploads`).
8. `static/` as a source directory disappears — it becomes build output only.
9. `e2e/` directory at repo root: Cypress config + J1–J6 spec files + `sample-offer.txt` fixture; add `cypress` npm devDependency to `frontend/` (or a standalone `e2e/package.json` to keep the app build slim).
10. `docs/E2E_TESTING.md` → replace the Playwright-default paragraph with Cypress as the chosen harness; journey specs carry over as-is (Cypress lacks WebKit — Chromium/Firefox/Electron is enough).
11. **Frontend bootstrapped with a mocked backend (done).** `frontend/` is a React 18 + Vite SPA on the lio.ai design tokens. Its data access funnels through `frontend/src/api/index.js`, which delegates to `frontend/src/api/mock/server.js` — an in-browser stand-in enforcing the documented API-boundary rules (validation, append-only status history, role scoping) and simulating the two-layer extraction and the classifier. When the FastAPI backend lands, implement `frontend/src/api/http.js` transport and flip `useMock` in `api/index.js`; views and validation mirror (`frontend/src/validation.js`) stay untouched.
12. **UI is a single-page workbench (done, supersedes the multi-page draft).** All roles land on `/`: left rail = request list (search + status filter + "Add Request"), center = the document itself (while drafting: the uploaded offer, page-rendered, with an "appears here" prompt before an upload; once saved: the request rendered as a document sheet — fields, order-line table, status trail, procurement status controls inline — with an "Offer Document" tab over the sheet when the request carries an upload), right = the extraction layer. While drafting that pane hosts the upload/extract panel **and the draft form itself**, so extracted values are edited beside the readable offer. For a **saved request** the same form opens there (`components/DraftForm.jsx`, prefilled from the record) below a compact provenance strip — editable while the request is `Open`, locked with a note from `In Progress` on; **editing is a `PUT /requests/:id`** (same payload and validation as create, order lines re-keyed, provenance kept, status history untouched — a backend decision worth revisiting if an amendments audit is wanted) and the user-facing rule mirrors it: edits happen beside the document, invalid edits persist nothing, `Discard Changes` reverts. Selection is URL state (`?selected=<id|new>`), so routes stay linkable and the old paths (`/requests`, `/requests/new`, `/requests/:id`) are redirects. Extraction results live in workbench state and flow into the draft as a prop. Journeys J1–J6 are unaffected — they describe flows, not pages.
13. **Uploaded-PDF case is real end-to-end in the mock (done).** Requests can carry an actual uploaded document instead of pasted text. In the mock, `pdfjs-dist` (lazy-loaded, `frontend/src/utils/pdf.js`) stands in for the backend's PyMuPDF: PDF bytes → text lines → the same L1/L2 parsers and validators; an unparseable PDF degrades to manual entry with a clear message. Uploaded bytes persist in a mock `documents` store (the analog of the compose `uploads` volume); a request links them via `source {filename, layer, document_id?, detected}`, request views embed a brief `document {id, filename, mime, size}`, and the full bytes come back from `GET /documents/:id`. The workbench center pane shows the offer **while drafting too** (the draft form lives in the extraction pane beside it), and document-backed requests on an "Offer Document" tab (PDF rendered page-by-page to canvas, `components/PdfPages.jsx`, shared with the draft viewer) beside the "Request Sheet". Fixture: `scripts/sample-offer-adobe.pdf` (built by `scripts/make_sample_offer_pdf.py`), mirroring the README sample offer. **Backend contract to implement:** accept the offer as a multipart upload (store in the `uploads` volume), serve stored files (`GET /documents/:id`), include the `document` brief in request views, keep `source.document_id` provenance, and add `PUT /requests/:id` for the edit flow (Open-only, ownership for requestors, same 422 shape; 409 when locked) — the frontend seam (`api/index.js`) is the only file that changes.

### CI — GitHub Actions (`.github/workflows/ci.yml`)

Three jobs on `ubuntu-latest`, all wired to the same compose stack:

1. **backend** — checkout → `docker compose up -d db` (Postgres only) → set `DATABASE_URL` → run unit + API tests (`pytest`); no API key needed (offline suite).
2. **frontend** — checkout → `actions/setup-node@v4` with `cache: npm` → `npm ci && npm run build` in `frontend/` (build itself is the lint gate; add `npm run lint` when configured).
3. **e2e** — checkout → build the frontend image stage → `docker compose up -d` (db + app; app serves `dist`) → `cypress-io/github-action@v6` with `wait-on` pointing at the app's health endpoint → run J1–J6 against the real app with the LLM mock tier enabled via env (`LLM_TIER` fixture mode, no API key).

Runner hygiene: cache `~/.cache/Cypress` between e2e runs (the binary download is the slowest step); `actions/upload-artifact` gated `if: failure()` for Cypress screenshots/videos so a red run is diagnosable without re-running; J6's "restart the application" step is implemented as a `cy.task` executing `docker compose restart app` (valid: the runner has Docker; the browser session survives, persistence is asserted).

## Key risks

| Risk | Mitigation |
|------|-----------|
| LLM extraction is unreliable on unseen offer formats | Strict schema + validation on extraction output; user reviews everything before submit; clear "not detected" UX. |
| Commodity classification is wrong | Suggestion is overridable; show the classification reasoning at a glance. |
| Scope creep on workflow features | Non-goals list above; status history is the only audit requirement. |