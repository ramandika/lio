# End-to-End Testing

How the product is tested through the browser, as a real user experiences it. This extends [TESTING.md](TESTING.md) — unit and API layers stay there; this file owns the E2E layer.

## Tooling

**Cypress** is the chosen harness — it supersedes the Playwright default originally stated here (decision recorded in [PROJECT_PLAN.md](PROJECT_PLAN.md)); the journey specs below carry over unchanged. Cypress drives Chromium/Firefox/Electron (WebKit unsupported — irrelevant for this product), with auto-waiting, built-in screenshots/video on failure and readable run reports; element queries use Testing Library's accessible-name queries (`cy.findByRole`/`cy.findByLabelText`).

- E2E tests live in `e2e/` (a standalone npm package, `cypress.config.js` at `e2e/`) at the repository root.
- They run against the **running application**, started the same documented way users run it — E2E bootstraps the app itself, not a special test server with mocked data paths. Until the FastAPI request endpoints land, the documented run is `npm run dev` in `frontend/` (in-browser mock API); when the real stack serves the app, `CYPRESS_BASE_URL` points the suite at it and the journeys stay unchanged.
- The **back-end is real** (the same local DB/API the app ships with); only the LLM is mocked at the boundary, see [Test doubles](#test-doubles).

## Principles

1. **Test the flows the README describes, from the outside.** Click, type, upload, and assert what a user sees — not internal state.
2. **No implementation details in selectors.** Use accessible names, labels, roles, and visible text (`cy.findByRole`/`cy.findByLabelText` accessible-name queries), which also keeps the suite validating accessibility basics.
3. **One journey per test.** Each test performs a full user journey; no hidden coupling between tests. Runs are independent and order-insensitive.
4. **Deterministic seed data.** Every run starts from a known database state; tests create their own requests and clean up via a per-worker data prefix rather than depending on each other.

## Coverage — the user journeys

### J1. Intake: create and submit a valid request

The full happy path of the README's challenge 1, step "Intake":

```text
1. Open the app → navigate to "New request"
2. Fill: requestor name, title, vendor name, vendor VAT ID (e.g. DE123456789), department
3. Add two order lines (description, unit price, amount, unit)
   → assert line totals and total cost are computed/shown for the user
4. Submit
5. Assert: confirmation is shown; the request appears in the overview
   with status "Open", correct title, vendor and total cost
6. Open the detail view
   → assert every field, both order lines with unit prices/amounts/totals,
     and that a commodity group is present (suggested, not manually chosen)
7. Assert status history already contains the creation entry ("Open")
```

Key README rule under test here: **every request is saved** — nothing valid is lost, and the overview shows exactly what was submitted.

### J2. Intake: invalid submission is rejected

The README's rule **only valid requests can be submitted**, exercised as a user hits it:

```text
1. Start a new request with meaningful data
2. Break one rule at a time and assert the form rejects it:
   - missing requestor name → inline error
   - malformed VAT ID (e.g. "123", "XX123456789") → inline error
   - order line with amount 0 → inline error
   - edited unit price that no longer matches the line total → inline error
3. Submit each broken variant
   → assert inline errors are shown next to the offending fields
   → assert NO new entry appears in the overview (nothing persisted)
4. Fix all fields → submit succeeds → request exists once (no duplicates
   from the earlier failed attempts)
```

### J3. Offer upload → auto-fill → submit

The extraction feature from the README (step: "upload a document, which then auto-fills the request"):

```text
1. New request → click "Upload offer"
2. Upload sample-offer.txt (the README's "Vendor Offer")
3. Assert the extraction summary names detected fields
4. Assert the form is pre-filled to match the README's "Extracted Information":
   - Vendor Name: Global Tech Solutions
   - VAT ID: DE987654321
   - Department: Creative Marketing Department
   - 2 order lines: Photoshop (€150 × 10 = €1500), Illustrator (€120 × 5 = €600)
   - Total cost: €2100
5. Assert the extraction also produced a commodity group suggestion
6. Submit → request persisted
7. Detail view again shows the extracted values verbatim
```

Negative variants in the same journey file:

- **Partial document** — an offer missing the totals → missing fields stay blank and are flagged "not detected"; the user fills them manually and can still submit.
- **Extraction failure / AI unavailable** — the UI degrades to manual entry with a clear message (see [DEPLOYMENT.md → AI feature degradation](DEPLOYMENT.md)); the user can complete the request without the AI.

### J4. Commodity group: suggestion, not selection

The procurement manager's complaint ("users always pick the wrong one") — the E2E asserts the user is **not** asked to choose:

```text
1. Open a new request with the Adobe-license scenario
2. Fill only the non-AI fields; do NOT touch any commodity control
3. Assert a suggested commodity group (category "Information Technology",
   group "Software", ID 031) is displayed once enough context exists
4. Override path: choose a different group → override is honored and stored
5. Submit → detail view shows the stored group
```

### J5. Overview: status management and history

README step "Request Overview" and its key point **"Implement a system to retain every status update accurately"**:

```text
1. From earlier journeys, a request exists in status "Open"
2. Overview → find it (filter by status, search by title, or both)
3. Change status: Open → "In Progress"
   → assert status badge updates, and history grows by one entry
     (old status, new status, timestamp)
4. Change status again: In Progress → "Closed"
   → assert history now has three entries in chronological order:
     creation, first transition, second transition
5. Reload the page → history is unchanged (it is persisted, not session state)
6. Re-open guard (where the status model forbids it): "Closed" cannot go
   directly back to "In Progress" → transition is refused in the UI
```

### J6. Persistence across restarts

The README's deployment is local, so the E2E suite also proves the storage contract (not just session state):

```text
1. Journey J1 creates a request; note its title
2. Restart the application process
3. Overview → the request is still there, with history intact
```

## Test doubles

The suite stays fast and deterministic by mocking exactly one dependency:

| Dependency | E2E behavior | How |
|------------|-------------|-----|
| Back-end API + DB | **Real** | The app under run, against a throwaway local DB |
| OpenAI extraction/classification | **Mocked** | A fixture-driven LLM stand-in, selected by configuration at app start (e.g. response file per scenario), so journeys J3/J4 run without any API key |

This split mirrors [TESTING.md](TESTING.md): deterministic product behavior end-to-end; the LLM's own quality lives in the unit-layer tests with recorded fixtures.

A small optional shard of "live-AI" journeys (same journeys, real API key, opt-in via environment variable) exists for manual runs before demoing the product — they are skipped in normal CI runs.

## Data management

- **Seed & teardown:** every worker gets a database namespace (e.g. suffixed request titles) and wipes its own rows after its journey. Nothing assumes pre-existing application data beyond the commodity-group reference list and the status taxonomy.
- **Fixtures:** `sample-offer.txt` lives with the E2E tests and is the README's vendor offer verbatim, so a failure immediately points at a requirement.

## Running

```bash
# start the app in test mode (seeded DB + LLM mocks)
cd frontend && npm run dev        # http://localhost:5173 — the documented run until the FastAPI request endpoints land

# run the E2E suite
cd ../e2e && npm run cy:run       # headless; `npm run cy:open` to debug
```

Exactly two commands; `CYPRESS_BASE_URL` retargets the suite (e.g. the composed FastAPI app at `http://localhost:8020`). Traces/screenshots on failure are enabled and land in the E2E report so a red run is diagnosable without repeating it. The per-journey status table lives in [e2e/README.md](../e2e/README.md).

## Definition of done for E2E

- All six journeys (J1–J6) pass on a clean local checkout.
- The suite runs without an OpenAI API key.
- A single failing journey produces a trace/report pointing at the step.