# Deployment & Operations Notes

The README allows local deployment; this document describes how the app runs and what a hosted environment would add.

## Local deployment (supported for this submission)

Prerequisites:

- Docker with the Compose plugin — the stack runs as two containers: the app (API + front-end) and a PostgreSQL 17 database
- An LLM API key (provided by askLio) — used only for offer extraction and commodity suggestion; optional

Run steps:

```bash
# 1. Create .env from the sample and set the API key (optional — AI degrades cleanly without it)
cp .env.example .env
# 2. Build and start the stack
docker compose up -d --build
# 3. The app is at http://localhost:8020
```

- `docker compose` is the canonical way to run the environment; the two named volumes survive rebuilds: `lio-interview_postgres-data` (the database) and `lio-interview_uploads` (uploaded offer files only — no DB inside it).
- The app connects via `DATABASE_URL` (default `postgresql+psycopg://lio:lio@db:5432/lio`, overridable in `.env`) and waits for the `db` healthcheck before starting.
- First start seeds the demo accounts (`SEED_USERS`, see [LOGIN_ARCHITECTURE.md](LOGIN_ARCHITECTURE.md)) and the three demo requests; requests are then created through the UI.

### Dev profile vs production profile

- `docker-compose.yml` — the dev profile. Source (`app/`, `scripts/`, `static/`, `tests/`) is bind-mounted and uvicorn runs with `--reload`; code changes need no rebuild.
- `docker-compose.prod.yml` — the production profile. The multi-stage [Dockerfile](../Dockerfile) builds the SPA in a Node stage and bakes `frontend/dist` into the Python image, so the image is self-contained: no source bind-mounts, no `--reload`, the db port is not published, and the app container gets a `/health`-based healthcheck. It uses its own compose project (`lio-prod`), so it can run beside the dev stack without touching its containers or volumes:

  ```bash
  docker compose -f docker-compose.prod.yml up -d --build   # APP_PORT=… to move off 8020
  docker compose -f docker-compose.prod.yml down           # keep volumes; add -v to drop data
  ```

  The app serves the built SPA and the API on the same origin (`/` the workbench, `/api/*` the routers); deep links like `/login` fall back to the SPA shell. In the dev profile the same happens once `frontend/dist` exists locally — in the prod profile the build always produces it.

## Configuration

| Setting | Source | Default |
|---------|--------|---------|
| `LLM_API_KEY` + `LLM_TIER=on` | Environment variable | none — AI features disabled; extraction degrades to manual entry (docker-compose.yml is the source of truth for variable names) |
| `DATABASE_URL` | Environment variable (`DATABASE_URL` in compose) | `postgresql+psycopg://lio:lio@db:5432/lio` |
| Port | Environment variable | conventional default for the stack |

## AI feature degradation

Because the AI features depend on an external API:

- Missing/invalid key → the extraction and suggestion endpoints respond with an explicit "AI unavailable" status; the UI falls back to fully manual entry. Manual use of the product never depends on the LLM.
- Long extraction calls show progress in the upload affordance and can be cancelled (the user just continues in manual entry).

## What "hosted production" would add

If this were deployed rather than run locally:

1. **Managed database** — swap the `db` compose service for a managed Postgres instance (change `DATABASE_URL` only); backups for requests and the immutable status history.
2. **Authentication** — requestor vs. procurement roles (out of scope for this iteration, listed in [PROJECT_PLAN.md](PROJECT_PLAN.md)).
3. **Observability** — structured request logs (correlation IDs for extraction calls), error rates for the AI endpoints, audit trail retention for status history.
4. **Rate limiting / quotas** — extraction endpoints are metered because they cost API budget per call.
5. **File handling** — uploaded offer documents scanned, size-limited, and (if retained) stored with a retention policy.

## Repository handoff

Per the README's final instruction, the hosted repository link is the deliverable. It ships with these docs:

- [README.md](../README.md) — challenge description (kept intact)
- [PROJECT_PLAN.md](PROJECT_PLAN.md) — scope, workstreams, milestones
- [ARCHITECTURE.md](ARCHITECTURE.md) — design, data model
- [COMMODITY_GROUPS.md](COMMODITY_GROUPS.md) — reference list
- [TESTING.md](TESTING.md) — test strategy
- This file — deployment notes