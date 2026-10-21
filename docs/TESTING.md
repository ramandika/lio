# Testing Strategy

How the system is tested, aligned with the README's instruction to "organize, design, test, and deploy… as if it were going into production."

## Test layers

### 1. Unit tests — validation & domain logic

The back-end validation is the rule **only valid requests can be submitted**, so it gets the densest coverage:

- Required fields: requestor name, title, vendor name, VAT ID, department, ≥1 order line.
- VAT ID format (README example: `DE123456789`, alphanumeric country prefix + digits).
- Numeric rules: `unit_price > 0`, `amount > 0` (integer), `line_total == unit_price × amount`, `total_cost == Σ line_totals`.
- Status transitions: `Open → In Progress → Closed`, rejection of invalid transitions.
- Commodity group: supplied IDs must exist in the reference list ([COMMODITY_GROUPS.md](COMMODITY_GROUPS.md)).

### 2. Unit/integration tests — AI features

LLM calls are behind seam-tested boundaries; tests use mocked client responses plus real fixtures:

- **Extraction parsing**: the sample offer text from the README must parse to exactly the "Extracted Information" block shown there (vendor name, VAT ID `DE987654321`, department "Creative Marketing Department", 2 order lines, total `€2100`).
- **Extraction robustness**: malformed or unrelated documents → clean "field not detected" result, no crash, no garbage rows.
- **Output guardrails**: any LLM result is validated against the request schema before use — unknown fields dropped, order-line math re-checked, numbers re-parsed.
- **Commodity classification**: mocked LLM outputs are mapped against the list; an out-of-list answer is rejected and falls back to "no suggestion" rather than an invalid ID.

### 3. Integration tests — API

- `POST /requests` with a valid payload persists request + order lines.
- `POST /requests` with each category of invalid payload returns a structured field-level error and **persists nothing**.
- Status update appends to the immutable status history; history survives subsequent updates (README: "retain every status update accurately").
- Extraction endpoint returns the normalized extraction result without persisting it (until the user submits the form).

### 4. Front-end / end-to-end

Full browser-driven journeys of the running product — owned by [E2E_TESTING.md](E2E_TESTING.md), which covers:

- J1 intake happy path → J2 invalid submission rejection → J3 offer upload auto-fill → J4 commodity suggestion → J5 status history → J6 persistence across restart.

## Fixtures

- `sample_offer.txt` / `sample_offer.pdf` — the README's vendor offer.
- Edge-case offers (missing totals, extra items, non-EUR currencies).
- A seed set of requests spanning all three statuses for the overview list.

## CI / running locally

Tests run on a documented one-command local run (same contract as the app: "deployment on your local machine is fine"), e.g. a single test script or container target. The AI-dependent tests are split so the offline validation/integration suite runs without an API key.