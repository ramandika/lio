# Architecture

High-level design of the askLio procurement request system. Requirements are in the [README](../README.md); the plan that produced this structure is in [PROJECT_PLAN.md](PROJECT_PLAN.md).

## System overview

```
┌─────────────────────────────────────────────────────────────┐
│ Web Front-end (SPA)                                         │
│  • Intake form (+ offer upload / auto-fill)                 │
│  • Request overview + status management + history           │
└──────────────┬───────────────────────────────▲──────────────┘
               │ REST/JSON                     │
┌──────────────▼───────────────────────────────┴──────────────┐
│ Back-end API                                                │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │ Requests   │  │ Extraction  │  │ Commodity classifier │  │
│  │ module     │  │ service     │  │ (LLM over fixed list)│  │
│  │ (valid.)   │  │ (LLM)       │  └──────────┬───────────┘  │
│  └─────┬──────┘  └──────┬──────┘             │              │
│        │                └──── calls LLM ────┤              │
│  ┌─────▼────────────────────────────────────▼───────────┐  │
│  │ Persistence (PostgreSQL via `db` service)            │  │
│  │ requests · order_lines · status_history              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Front-end

- Single-page app that talks to the API over JSON.
- Two main views:
  - **Intake form** — the full field set from the README, inline validation, an "upload offer" affordance that triggers extraction and pre-fills the form, and the suggested commodity group.
  - **Request overview** — list of requests with status badge, filters (status), a detail view showing all fields, order lines, current commodity group and the **status history**.
- Validation errors from the API surface next to the offending fields.

### 2. Back-end API

Responsibilities, all at the API boundary so the front-end can stay thin:

- **Validation** — rejects invalid requests (required fields, VAT ID format, `amount > 0`, line totals, total cost consistency). Only valid requests are persisted.
- **Extraction orchestration** — takes an uploaded offer document, calls the extraction service, normalizes the result to the request schema, and reports which fields were detected.
- **Commodity classification** — given title/descriptions/department, returns a commodity group ID + label from the fixed 50-item list.
- **Status management** — transitions between `Open` / `In Progress` / `Closed`, appending to the status history on every change.

### 3. AI layer

Two LLM touchpoints with the OpenAI API key, each structured-output based:

| Feature | Input | Output contract |
|---------|-------|-----------------|
| Offer extraction | Document text | Vendor name, VAT ID, department, order lines (description, unit price, amount, unit, total), total cost |
| Commodity suggestion | Title, item descriptions, department | Commodity group `{id, category, name}` from the fixed list only |

Both are treated as **suggestions, not truth**: extraction pre-fills a form the user reviews, and classification can be overridden. The back-end validates LLM output against the schema and the commodity list before it reaches the UI.

## Data model

```
REQUEST                                          ORDER_LINE
├─ id                                            ├─ id
├─ requestor_name                                ├─ request_id (FK)
├─ title                                         ├─ position_description
├─ vendor_name                                   ├─ unit_price (decimal)
├─ vendor_vat_id                                 ├─ amount (int)
├─ commodity_group_id  (001–050, nullable)       ├─ unit
├─ department                                    ├─ total_price (decimal)
├─ total_cost (decimal)                          └─ position
├─ status          (Open | In Progress | Closed)
├─ created_at
└─ updated_at

STATUS_HISTORY          (immutable append-only)
├─ id
├─ request_id (FK)
├─ old_status
├─ new_status
├─ changed_at
└─ comment (optional)
```

Key decisions:

- **Order lines are separate rows**, not JSON blobs — they are user-editable, validated per line, and should be queryable.
- **Status history is append-only.** `request.status` is a denormalized "current" column for fast listing; the history table is the source of truth for the audit trail ("retain every status update accurately").
- Commodity group is stored as the stable numeric ID with the category/name joined from the reference list, so renames never invalidate stored data.

## Commodity groups

Fixed reference list of 50 groups across 8 categories, maintained in [COMMODITY_GROUPS.md](COMMODITY_GROUPS.md). It lives in code/config as the single source, is served to both the UI (for the override select) and the classifier's prompt, and never requires user selection.

## Non-functional notes

- **Local deployment is fine** — the stack must start with one documented command and no cloud dependencies; PostgreSQL runs as a dedicated compose service (`db`) with its data in a named volume, so one command still brings up the whole stack.
- Secrets: the OpenAI API key is read from the environment, never committed.
- Extraction calls are the only latency-sensitive path; the upload affordance shows progress and degrades to manual entry on failure.