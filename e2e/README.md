# askLio E2E journeys (Cypress)

Browser-level journeys **J1–J6** exactly as specified in [docs/E2E_TESTING.md](../docs/E2E_TESTING.md). Cypress is the chosen harness (docs/PROJECT_PLAN.md — supersedes the Playwright default there); journeys stay unchanged. Selectors use accessible names, labels and roles only.

This is a standalone package so the app build stays slim.

## Running

```bash
# 1. start the app the documented way (mock-API backend until the FastAPI
#    request endpoints land)
cd ../frontend && npm run dev          # http://localhost:5173

# 2. run the E2E suite
npm run cy:run                         # headless, all journeys, screenshots on failure
npm run cy:open                        # interactive
```

The base URL defaults to `http://localhost:5173`; when the frontend is wired
to the real FastAPI stack, point it there instead:

```bash
CYPRESS_BASE_URL=http://localhost:8020 npm run cy:run
```

## Conventions

- **One journey per test** — each test performs a full user journey (sign-in
  included, since the app requires it); no coupling between tests.
- **Deterministic data** — every test starts from the app's seeded empty state
  (a browser-storage wipe; the real backend will swap this for a test-DB
  reset) and titles its created requests with a run-unique prefix, so
  repeated/parallel runs never collide and nothing depends on order.
- **Failure artifacts** — screenshots on failure land in
  `cypress/screenshots/`, videos when `CI` is set, in `cypress/videos/`.

## Status

| Journey | Spec | State |
|---------|------|-------|
| J1 — Intake happy path | `cypress/e2e/j1-intake-happy-path.cy.js` | ✅ passing |
| J2 — invalid submission rejected | `cypress/e2e/j2-intake-invalid-rejected.cy.js` | ✅ passing |
| J3 — offer upload → auto-fill → submit | — | to do |
| J4 — commodity suggestion | — | to do |
| J5 — overview status & history | — | to do |
| J6 — persistence across restarts | — | to do |