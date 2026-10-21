"""askLio API entrypoint. Status: auth slice (LOGIN_ARCHITECTURE.md) — the
request/extraction/commodity routers land as the backend grows."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import seed
from .db import init_db
from .routers import auth as auth_module

REPO_ROOT = Path(__file__).resolve().parent.parent
DIST = REPO_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed.seed_users()
    yield


app = FastAPI(title="askLio", lifespan=lifespan)
app.include_router(auth_module.router)


@app.get("/health")
def health() -> dict:
    # No auth — the compose healthcheck / CI wait-on reads this.
    return {"status": "ok"}


# FastAPI serves the built SPA when it exists (PROJECT_PLAN.md stack decision);
# static mounts match after all API routes, so API paths win the prefix clash.
if DIST.is_dir():
    app.mount("/", StaticFiles(html=True, directory=DIST), name="frontend")