# askLio E2E journeys (Cypress)

Browser-level journeys **J1–J6** exactly as specified in [docs/E2E_TESTING.md](../docs/E2E_TESTING.md). Cypress is the chosen harness (docs/PROJECT_PLAN.md — supersedes the Playwright default there); journeys stay unchanged. Selectors use accessible names, labels and roles only.

This is a standalone package so the app build stays slim.

## Running

```bash
# 1. start the real stack (the built SPA served by the FastAPI backend)
docker compose up -d                   # http://localhost:8020

# 2. run the E2E suite
npm run cy:run                         # headless, all journeys, screenshots on failure
npm run cy:open                        # interactive
```

The base URL defaults to `http://localhost:8020`; override with
`CYPRESS_BASE_URL` (e.g. the Vite dev server at `:5173`).

**LLM tier.** The backend's AI features are an environment switch:
`LLM_TIER=on` AND `LLM_API_KEY` set (compose points `LLM_BASE_URL` at the
OpenAI-compatible endpoint, default `http://host.docker.internal:11444`).
J3's L2 journey variants run live against that endpoint and skip otherwise;
the manual-entry degradation variant runs only when the tier is off. So:

```bash
# full suite (L1 + both L2 journeys) — requires the LLM server to be running
LLM_TIER=on LLM_API_KEY=demo docker compose up -d app

# L1 + degradation variants only (the default compose setup)
docker compose up -d                   # LLM_TIER defaults to off
```

**Reset.** Every test starts from the seeded demo state: the `db:reset` task
wipes request/document rows and the uploads volume inside the app container
(`docker compose exec app python scripts/e2e_reset.py`) and re-applies the
demo seed — users and sessions stay; journeys sign in through the login form.

## Conventions

- **One journey per test** — each test performs a full user journey (sign-in
  included, since the app requires it); no coupling between tests.
- **Deterministic data** — every test starts from the stack's seeded demo
  state (a reset task inside the app container; see Running) and titles its
  created requests with a run-unique prefix, so repeated/parallel runs never
  collide and nothing depends on order.
- **Failure artifacts** — screenshots on failure land in
  `cypress/screenshots/`, videos when `CI` is set, in `cypress/videos/`.

## Status

| Journey | Spec | State |
|---------|------|-------|
| J1 — Intake happy path | `cypress/e2e/j1-intake-happy-path.cy.js` | ✅ passing |
| J2 — invalid submission rejected | `cypress/e2e/j2-intake-invalid-rejected.cy.js` | ✅ passing |
| J3 — offer upload → auto-fill → submit | `cypress/e2e/j3-offer-upload-extract-submit.cy.js` | ✅ passing (L2 variants live: `llm_ocr_fuse` through the backend's tier-aware funnel; `LLM_TIER=on` runs them, an off tier runs the degradation variant) |
| J4 — commodity suggestion | `cypress/e2e/j4-commodity-suggestion.cy.js` | ✅ passing (suggestion appears untouched, override honored & stored; runs in any tier — the classifier's keyword path needs no LLM) |
| J5 — overview status & history | `cypress/e2e/j5-status-history.cy.js` | ✅ passing (one continuous run: rail filter + search to find it, Open → In Progress → Closed with the trail order/timestamps asserted, reload-persistence, and the no-mover-on-Closed re-open guard — boundary refusals for stale screens stay in `status-close.cy.js`) |
| J6 — persistence across restarts | `cypress/e2e/j6-persistence-across-restarts.cy.js` | ✅ passing (files a request on the J1 flow, restarts the app container via the `app:restart` task (`docker compose restart app`, polled to a healthy `/health`; the db never bounces), then the filed request and its creation trail are read back from the rail on the still-signed-in session) |

Beyond the journeys, an authorization suite pins the boundary rules in the UI:
`authz-procurement.cy.js` (procurement sees all and manages status),
`authz-documents.cy.js` (requestors reach only their own uploads) and
`authz-locked.cy.js` (nothing already In Progress is editable by anyone — the
lock renders for requestor, procurement and admin alike; the boundary itself
rejects any `PUT` on a non-Open request with 409, `tests/test_requests.py`).
`status-close.cy.js` covers the close move itself: Kim closes the seeded
In Progress request and the confirmation reads exactly "Approved" (an
Open → In Progress move confirms with the status name in the same shape),
while a Closed request renders no mover at all — no invalid transition is
clickable, so the boundary's enriched refusal (which statuses could still be
reached, or that the chain has ended) is asserted against
`POST /api/requests/:id/status` itself. All passing.