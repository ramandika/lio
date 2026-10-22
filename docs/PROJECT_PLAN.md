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

**Status — done end-to-end, proven by journey J3** (`e2e/cypress/e2e/j3-offer-upload-extract-submit.cy.js`): the README offer resolves at L1 (zero LLM calls), an unseen-format fixture goes through a real L2 (see decision 15 below), a partial-offer fixture stays honest about missing totals, and the `LLM_TIER=off` case degrades to manual entry with a clear message.

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

Decision (Oct 2025, at implementation time): the suggestion is available on
two paths — `POST /commodity/suggest` (the auto path while typing: keyword
scorer first, tier-gated LLM only on a gap) and `POST /commodity/resuggest`
(the explicit "Suggest from my entries" button). The button's policy: with no
group assigned, heuristic advice with at least medium confidence applies, else
the LLM's validated answer; with a group already assigned, the LLM is consulted
and its advice replaces the current pick only when it names the same group or
ranks strictly higher in confidence (high > medium > low) — otherwise the
current pick stays and the card explains why. The click is the user's consent,
so this never replaces a manual choice silently; the mock mirrors the policy
with its LLM branch permanently tier-off (deterministic keyword advice only).

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

Progress: M1–M4 are implemented in the **backend** (`app/`) — intake (`/requests` CRUD + validation), extraction (PyMuPDF L1 + `llm_ocr_fuse` L2 via the tier-aware `services/llm.py` funnel), uploads volume (`/documents/:id` with the same role scoping), commodity suggestion (`/commodity/suggest`), and the status trail (`status_history` append-only in Postgres). The frontend now runs against the real API: `api/index.js` routes through `api/http.js` (`useMock = false`; the in-browser mock stays in the repo as the offline/AI-degradation demo transport). Verified by the pytest suite (auth + request boundary) and the Cypress journeys, retargeted to the real stack (`baseUrl` = `http://localhost:8020` — the built SPA served by FastAPI; `resetAppData` is a real DB reset via `scripts/e2e_reset.py`, J3's L2 variants run live when `LLM_TIER=on`). Remaining: wire CI (J6 landed — see item 9; E2E journey J1–J6 are all implemented and passing).

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

1. ~~`docker-compose.yml` → `db` service~~ **done** (`postgres:17`, named volume `postgres-data`, healthcheck; `uploads` volume keeps the uploaded offer files only — no DB inside it). The "vite dev service" idea was dropped: dev runs `npm run dev` in `frontend/` with the Vite dev proxy (`/api` → the app container, config in `frontend/vite.config.js`); production needs no proxy (FastAPI serves the SPA itself).
2. ~~`requirements.txt` → add `psycopg[binary]`~~ **done** (`psycopg[binary]==3.2.3`); SQLAlchemy/Alembic stay open until the ORM/migration route is decided.
3. ~~Config: `DATABASE_URL`~~ **done** — `DB_PATH` is dropped; compose sets `DATABASE_URL: ${DATABASE_URL:-postgresql+psycopg://lio:lio@db:5432/lio}` and `.env.example` documents the override.
4. ~~`app/db.py` → PostgreSQL connection + schema init (or Alembic migrations); numeric columns stored as `NUMERIC`, not floats.~~ **done** — plain psycopg 3 with schema-init-on-boot kept (consistent with the auth slice's no-ORM choice); `requests`/`request_lines`/`status_history`/`documents` tables added. Money arrives as integer cents (the frontend mirror's contract) and is stored as `NUMERIC(14,2)` amounts; view serialization converts back to exact integer cents (`app/money.py`). A malformed id reads as 404, never a Postgres cast error.
5. ~~`Dockerfile` → multi-stage~~ **done** (`node:20-alpine` stage mirrors the repo layout — `design/` beside `frontend/` — and runs `npm ci && npm run build`; the python stage copies `app/`, `scripts/` and the built `frontend/dist` in, plus `requirements-dev.txt` so host-run `pytest` against the container needs no per-run install; `.dockerignore` keeps node_modules, tests and docs out of the context). Served by the new **production profile** `docker-compose.prod.yml` (compose project `lio-prod`, self-contained image, no bind-mounts or `--reload`, db port unpublished, app `/health` healthcheck) — see DEPLOYMENT.md; dev (`docker-compose.yml`) is unchanged. (Needed no DB-specific change.)
6. ~~`.gitignore` → add `frontend/node_modules/` and `frontend/dist/`~~ **done**.
7. ~~`docs/DEPLOYMENT.md` rewrite~~ **done** — now documents the Postgres service, `DATABASE_URL`, and the two volumes (`postgres-data`, `uploads`).
8. `static/` as a source directory disappears — it becomes build output only.
9. **`e2e/` directory at repo root (done).** Standalone npm package (`e2e/package.json`, keeps the app build slim) with `cypress.config.js` + Testing Library accessible-name queries; `sample-offer.txt` fixture still to come with J3. ~~J1/J2/J3 specs to follow~~ — **J1 (intake happy path), J2 (invalid intake rejected) and J3 (offer upload → auto-fill → submit) implemented and passing — now against the real stack** (J1–J3 were first proven against the mock dev server; the retarget changed `resetAppData` to a real DB reset (`scripts/e2e_reset.py` via the `db:reset` task), replaced the mock-only `disableAi`/`validateTransition` hooks with the live boundary (env `LLM_TIER` gating, `POST /api/requests/:id/status`), and made the URL assertions UUID-tolerant — see the "changes required at implementation time" entry on `resetAppData` above). **J4 (commodity group: suggestion, not selection) implemented against the real stack** (`j4-commodity-suggestion.cy.js`) — the card's "appears on its own" empty state, the untouched-path suggestion (031), the override honored with its "Overridden — the suggestion was …" reason, and the override being what persists (the classifier's keyword path, so it runs in any tier). **J5 (overview: status management and history) implemented against the real stack** (`j5-status-history.cy.js`) — one continuous run: the rail's status filter and search box are driven for the find step (no other spec exercises them; the no-match "Nothing matches this filter." path is included), then Open → In Progress → Closed with the trail asserted to grow in order (creation → first transition → second transition) with a timestamp on every entry (locale-tolerant clock-time pattern, since `formatDateTime` renders per-locale), a reload proving the trail is persisted not session state, and the Closed re-open guard as designed — no mover rendered, boundary refusals for stale screens staying in `status-close.cy.js`. **J6 (persistence across restarts) implemented against the real stack** (`j6-persistence-across-restarts.cy.js`) — the J1 creation flow files a request under a run-unique title, the new `app:restart` task bounces the app container (`docker compose restart app`; the db keeps running) and polls `/health` until uvicorn answers again, and the still-signed-in session then finds the row in the rail (search over the seeded siblings, exactly one match) with its creation trail intact. J1–J6 are all implemented; CI is the remaining item.
10. ~~`docs/E2E_TESTING.md` → replace the Playwright-default paragraph with Cypress as the chosen harness~~ **done** — journey specs carried over as-is (Cypress lacks WebKit — Chromium/Firefox/Electron is enough); the Running section now documents the concrete commands.
11. ~~**Frontend bootstrapped with a mocked backend**~~ **done + flipped.** The front end now runs against the real API: `api/index.js` (`useMock = false`) routes through `api/http.js` — same-origin `/api` (Vite dev proxy → the app container; in production FastAPI serves the SPA itself), session cookies, `ApiError` unwrapped out of FastAPI's `{detail: …}` envelope, extraction posted as a **multipart upload** so PDFs are read server-side with PyMuPDF (the browser-side pdf.js pass was the mock-era stand-in). No streaming progress channel over one response — the panel's own phase state carries the UX. The in-browser mock stays in the repo as the offline demo transport (flip `useMock = true`; also the AI-tier degradation harness for tests). The demo seed (`seed.py::seed_demo_requests`) reproduces the mock's three demo requests, document included.
12. **UI is a single-page workbench (done, supersedes the multi-page draft).** All roles land on `/`: left rail = request list (search + status filter + "Add Request"), center = the document itself (while drafting: the uploaded offer, page-rendered, with an "appears here" prompt before an upload; once saved: the request rendered as a document sheet — fields, order-line table, status trail, procurement status controls inline — with an "Offer Document" tab over the sheet when the request carries an upload), right = the extraction layer. While drafting that pane hosts the upload/extract panel **and the draft form itself**, so extracted values are edited beside the readable offer. For a **saved request** the same form opens there (`components/DraftForm.jsx`, prefilled from the record) below a compact provenance strip — editable while the request is `Open`, locked with a note from `In Progress` on; **editing is a `PUT /requests/:id`** (same payload and validation as create, order lines re-keyed, provenance kept, status history untouched — a backend decision worth revisiting if an amendments audit is wanted) and the user-facing rule mirrors it: edits happen beside the document, invalid edits persist nothing, `Discard Changes` reverts. Selection is URL state (`?selected=<id|new>`), so routes stay linkable and the old paths (`/requests`, `/requests/new`, `/requests/:id`) are redirects. Extraction results live in workbench state and flow into the draft as a prop. Journeys J1–J6 are unaffected — they describe flows, not pages.
13. **Uploaded-PDF case is real end-to-end in the mock (done).** Requests can carry an actual uploaded document instead of pasted text. In the mock, `pdfjs-dist` (lazy-loaded, `frontend/src/utils/pdf.js`) stands in for the backend's PyMuPDF: PDF bytes → text lines → the same L1/L2 parsers and validators; an unparseable PDF degrades to manual entry with a clear message. Uploaded bytes persist in a mock `documents` store (the analog of the compose `uploads` volume); a request links them via `source {filename, layer, document_id?, detected}`, request views embed a brief `document {id, filename, mime, size}`, and the full bytes come back from `GET /documents/:id`. The workbench center pane shows the offer **while drafting too** (the draft form lives in the extraction pane beside it), and document-backed requests on an "Offer Document" tab (PDF rendered page-by-page to canvas, `components/PdfPages.jsx`, shared with the draft viewer) beside the "Request Sheet". Fixture: `scripts/sample-offer-adobe.pdf` (built by `scripts/make_sample_offer_pdf.py`), mirroring the README sample offer. **Backend contract to implement — implemented:** multipart upload stored in the `uploads` volume (bytes on disk under `UPLOADS_DIR`, indexed by the `documents` table), `GET /documents/:id` serving the full payload as a data URL with the same ownership check at the boundary (404-disguise for foreign uploads), the `document` brief in request views, `source.document_id` provenance kept, and `PUT /requests/:id` for the edit flow (Open-only, ownership for requestors, same 422 shape; 409 when locked). The mock scopes its uploads store the same way, so `tests/test_requests.py` pins the check over both.
14. **Login backend implemented as the backend's first slice (done).** `app/` now hosts the FastAPI entrypoint (`main.py` — lifespan schema-init + seeding, `/health` for CI wait-on, serves `frontend/dist` when present so the same container can act as the e2e target). Auth per [LOGIN_ARCHITECTURE.md](LOGIN_ARCHITECTURE.md): `users`/`sessions` tables via plain psycopg 3 with schema-init-on-boot (the SQLAlchemy/Alembic decision stays deferred until request data forces it); bcrypt cost 12; opaque session token (`secrets.token_urlsafe(24)`) in an HttpOnly `SameSite=Lax` cookie, sliding 12 h idle expiry under a 7 d absolute cap, purged on boot; per-(ip,email) in-memory failed-attempt counter (5/15 min) with the uniform-failure rule ("Invalid email or password."); soft-disabled users rejected from both login and session resolution; accounts seeded idempotently from `SEED_USERS` (compose default: the four demo accounts, password `demo`). No signup flow. Tests: `tests/test_auth.py` (12 cases — uniform failure, 401s, rate limit, hash-never-plaintext, disabled account, idempotent seeding, expired-session purge) via `requirements-dev.txt`, run against the compose db (`pytest` from the host with the now-published db port, or inside the app container). When the request endpoints land: `REQUEST.created_by`/`STATUS_HISTORY.changed_by` fill from `get_current_user`, and the frontend flips `useMock` by adding the `api/http.js` transport (Vite dev proxy or same-origin via FastAPI — cookies need no CORS work either way).
15. **J3's L2 extraction is real `llm_ocr_fuse`, not a canned response (done).** Following the reference pattern of the user's quotation-extraction benchmark (`pdf-extractor`'s `llm_ocr_fuse` backend — page-marked text plus rendered page images in one multimodal message, temperature 0, JSON output, ≤2 value-level re-prompts on arithmetic failures, fail-soft — see [E2E_TESTING.md](E2E_TESTING.md) for the journey). **The call now lives server-side: `app/services/llm.py` (the single tier-aware funnel — `LLM_TIER=on` AND `LLM_API_KEY` set, OpenAI-compatible base URL from compose) + `app/services/extraction.py` (page images rendered by PyMuPDF, defensive JSON parse with the alias mapping onto the documented field names, same validators at the API boundary).** Without the tier, L2 degrades to the documented manual-entry contract and there is no browser proxy, no CORS, and no key in the frontend. The mock-era seam (Vite `/llm` proxy + `VITE_LLM_TIER`/sessionStorage tier switch) remains only under the mock transport (`useMock = true`) as the offline demo/AI-degradation harness; over the live transport the tier is environment-level (`LLM_TIER`), which is what the e2e CI job fixtures with, and what J3's spec gates on (`llm:tier` task — L2 variants run only in an `LLM_TIER=on` deployment, the manual-entry degradation only in an off one). Journey *flows* stay unchanged.
16. **API prefix + SPA serving (decided at the e2e retarget, 2026-10-21).** All backend routes live under `/api` (the routers' own prefix: `/api/auth`, `/api/requests`, `/api/extraction`, `/api/documents`, `/api/commodity`) — same shape in dev and prod, no Vite rewrite: the proxy just forwards `/api/*` to the app container. `main.py` serves the built SPA with an asset-scoped `/assets` mount and a catch-all falling back to `index.html` so client routes (`/login`, `/?selected=…`) survive deep links and reloads; `/api/*` misses stay real 404s, and paths resolving outside the bundle are refused (no traversal). Found when the retarget surfaced that `/api/*` 404'd on the built stack (the dev proxy rewrite had masked it) and `/login` was no index.html fallback. `LLM_BASE_URL` includes the server's `/v1` (`http://host.docker.internal:11444/v1`) — the mock-era `/llm` proxy had masked that prefix too.
   

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