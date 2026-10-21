# Deployment & Operations Notes

The README allows local deployment; this document describes how the app runs and what a hosted environment would add.

## Local deployment (supported for this submission)

Prerequisites:

- Runtime for the chosen stack (e.g. Node.js or Python + the front-end toolchain)
- An OpenAI API key (provided by askLio) — used only for offer extraction and commodity suggestion

Run steps (placeholders to be filled with the concrete commands of the implementation):

```bash
# 1. Install dependencies
# 2. Set the API key
export OPENAI_API_KEY="sk-…"
# 3. Start the stack (back-end API + front-end, or a single combined process)
```

- The application is reachable at the printed local URL; SQLite/embedded storage means no database server is needed.
- First start seeds nothing automatically; requests are created through the UI.

## Configuration

| Setting | Source | Default |
|---------|--------|---------|
| `OPENAI_API_KEY` | Environment variable | none — AI features disabled with a clear message if absent |
| Database path / connection | Environment variable | local file next to the app |
| Port | Environment variable | conventional default for the stack |

## AI feature degradation

Because the AI features depend on an external API:

- Missing/invalid key → the extraction and suggestion endpoints respond with an explicit "AI unavailable" status; the UI falls back to fully manual entry. Manual use of the product never depends on the LLM.
- Long extraction calls show progress in the upload affordance and can be cancelled (the user just continues in manual entry).

## What "hosted production" would add

If this were deployed rather than run locally:

1. **Persistent storage** — managed database instead of the local file; backups for requests and the immutable status history.
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