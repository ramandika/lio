# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

askLio — a procurement request system built for the take-home challenge in [README.md](README.md): intake with validation, offer-document upload with auto-extraction, automatic commodity-group suggestion over a fixed 50-item list, and a request overview with immutable status history.

**Status: frontend implemented against a mocked backend; FastAPI backend not yet built.** The docs in `docs/` are the spec. `frontend/` is a React + Vite SPA whose data access funnels through `frontend/src/api/index.js` → `api/mock/server.js` (in-browser mock of the documented REST API, enforcing validation/role/history rules; run `npm run dev` in `frontend/`). `app/services/` exists but is empty; `e2e/` not yet bootstrapped. [PROJECT_PLAN.md](docs/PROJECT_PLAN.md) is the living implementation plan — read it before building anything, and update it (including its "changes required at implementation time" checklist) as decisions are made. The mock is swapped for the real API in one place (`api/index.js`, `useMock` flag); views and `src/validation.js` (the inline-UX mirror of the API-boundary rules) are transport-agnostic.

## Commands

```bash
cp .env.example .env       # then set LLM_API_KEY (optional — without it, AI features degrade to manual entry)
docker compose up -d --build   # db (postgres:17) + app; http://localhost:8020
docker compose logs -f app
cd frontend && npm run dev    # frontend alone, against the in-browser mock API; http://localhost:5173
```

- Frontend dev loop: `npm run dev` (Vite) with the mock backend — no Python/compose needed; persisted to `localStorage` (key `asklio.mockdb.v1`, reset via a console `localStorage.removeItem` + reload). Demo logins: ana@example.com (requestor) · kim@example.com (procurement) · admin@example.com · password `demo`.
- Backend dev loop: compose bind-mounts `./app`, `./static`, `./scripts` and runs `uvicorn --reload` — code changes need no rebuild. Rebuild only for `requirements.txt` or Dockerfile changes.
- No test suite, lint, or frontend exist yet. Per the plan: pytest for backend (must run offline, without an API key), Vite build as the frontend gate, Cypress for E2E journeys J1–J6 (this **supersedes** the Playwright default stated in E2E_TESTING.md). What each layer must cover — and the key fixtures (README sample offer, invalid-payload categories, status-history persistence) — is in [TESTING.md](docs/TESTING.md).

## Intended layout (from PROJECT_PLAN.md — not yet implemented)

```
frontend/     React + Vite (npm only runs in the Docker build stage, never in the Python image)
app/          FastAPI package: main, config, db, schemas, commodity, auth;
              routers/ (requests · extraction · status · commodity);
              services/ (document · llm · extraction · classifier)
scripts/      seed/demo utilities
design/       lio.ai-derived tokens (tokens.css is the single source, bundled by Vite)
e2e/          Cypress config + J1–J6 specs
```

## Architecture decisions (do not drift from these)

The decisions below are the load-bearing ones; the full design rationale is in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Extraction is a two-layer composite, not LLM-first.** L1 = PyMuPDF text extraction + deterministic label/line parsing + validation (line math, VAT format, required fields) — zero LLM calls, in-process. L2 = LLM extraction (structured output, temperature 0) triggered only when L1 validation fails. Both layers feed the same validators and the same human review step.

**The LLM is suggestion, never truth.** Extraction pre-fills an editable form; commodity suggestions are overridable. All LLM output is validated against the schema and the commodity list before reaching the UI (out-of-list IDs → "no suggestion").

**Validation lives at the API boundary.** Only valid requests persist (required fields, VAT ID format, `unit_price > 0`, `amount > 0` integer, line totals = price × amount, total = Σ lines, commodity ID exists). The frontend only mirrors rules for inline UX. Invalid submissions persist nothing.

**Persistence:** PostgreSQL via the compose `db` service (connection string `postgresql+psycopg://lio:lio@db:5432/lio`, overridable by `DATABASE_URL`). Order lines are separate rows, not JSON. `status_history` is append-only and the source of truth for the audit trail — `request.status` is a denormalized current-value column. Commodity group stored as stable numeric ID (001–050); numeric columns as `NUMERIC`, not floats. Valid statuses: `Open → In Progress → Closed`.

**Auth (LOGIN_ARCHITECTURE.md):** local accounts + server-side sessions with HTTP-only cookies (not JWT); bcrypt pinned as the hasher (requirements.txt). Roles `requestor` / `procurement` / `admin`; authorization enforced server-side at the API boundary, frontend only hides what the role cannot see. Authorization: requestor sees own requests only; procurement sees all and manages status. No signup — accounts seeded via env (e.g. `SEED_USERS`), admin manages them.

**No task queue.** Extraction runs in-process (async, bounded timeout) with UI progress and manual-entry degradation. Celery is deliberately excluded; the documented upgrade path is a `202 {job_id}` + polling endpoint.

**LLM access funnels through a single tier-aware wrapper** (`app/services/llm.py`): enabled only when `LLM_TIER=on` AND the key is set. Compose points `LLM_BASE_URL` at an OpenAI-compatible endpoint (`host.docker.internal:11444`). Note: DEPLOYMENT.md says `OPENAI_API_KEY` but `.env.example`/docker-compose.yml use `LLM_API_KEY` — the compose file is the source of truth.

**Frontend convention:** flat editorial design language mirroring lio.ai (see docs/DESIGN.md and `design/tokens.css`) — white canvas, single light-blue accent `#bbddff`, pill buttons, hairline borders, light + dark mode. Any new color pairing must preserve the AAA accessibility score of the extracted token set.

## Reference data

[docs/COMMODITY_GROUPS.md](docs/COMMODITY_GROUPS.md) holds the fixed list: 8 categories × 50 groups (IDs 001–050). It lives in code as the single source, serves both the UI override select and the classifier prompt — never hardcode group names elsewhere.