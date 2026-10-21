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
| Approach | LLM-based extraction (OpenAI API key provided), structured output, with a deterministic pre/post-processing layer. |
| Review step | Extraction results are **pre-filled, not submitted** — the user reviews and corrects before saving. |
| Fallback | Fields the extractor cannot find are left blank for manual entry; the user is told which fields were not detected. |

Done when: uploading the README sample offer produces the "Extracted Information" block shown there, and the pre-filled form is editable.

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

## Key risks

| Risk | Mitigation |
|------|-----------|
| LLM extraction is unreliable on unseen offer formats | Strict schema + validation on extraction output; user reviews everything before submit; clear "not detected" UX. |
| Commodity classification is wrong | Suggestion is overridable; show the classification reasoning at a glance. |
| Scope creep on workflow features | Non-goals list above; status history is the only audit requirement. |