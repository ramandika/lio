"""askLio API entrypoint. The auth slice (LOGIN_ARCHITECTURE.md) plus the
request endpoints (PROJECT_PLAN.md M1–M4): intake, extraction, documents,
commodity grouping, status trail."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import seed
from .db import init_db
from .routers import auth as auth_module
from .routers import commodity as commodity_module
from .routers import documents as documents_module
from .routers import extraction as extraction_module
from .routers import requests as requests_module

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST = REPO_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed.seed_users()
    seed.seed_demo_requests()
    yield


app = FastAPI(title="askLio", lifespan=lifespan)
app.include_router(auth_module.router)
app.include_router(requests_module.router)
app.include_router(documents_module.router)
app.include_router(extraction_module.router)
app.include_router(commodity_module.router)


@app.get("/health")
def health() -> dict:
    # No auth — the compose healthcheck / CI wait-on reads this.
    return {"status": "ok"}


# FastAPI serves the built SPA when it exists (PROJECT_PLAN.md stack decision).
# Client routes (/login, /?selected=<uuid>) are deep-linked and reloaded, so
# the static mount is asset-scoped and anything it does not resolve falls back
# to the SPA shell — the client router decides what a client path shows. API
# and health routes are registered before this catch-all, so a miss under
# /api/* is a real 404, never the frontend bundle.
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa_shell(path: str):
        candidate = (DIST / path).resolve()
        if path and not candidate.is_relative_to(DIST.resolve()):
            # Never serve resolved paths outside the bundle (path traversal).
            raise HTTPException(status_code=404, detail="Not found.")
        if path and candidate.is_file():
            return FileResponse(candidate)
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found.")
        return FileResponse(DIST / "index.html")