"""Auth endpoints (LOGIN_ARCHITECTURE.md):

    POST /auth/login    no session     authenticate, create session cookie
    POST /auth/logout   none required   destroy session (best-effort)
    GET  /auth/me       session         current user — the front-end
                                        bootstraps role-dependent UI from this
"""

from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import config
from ..auth import (
    BCRYPT_MAX_BYTES,
    DUMMY_HASH,
    clear_session_cookie,
    create_session,
    delete_session,
    get_current_user,
    set_session_cookie,
    verify_password,
)
from ..db import connect

# Every API route lives under /api — the frontend transport's same-origin
# BASE (frontend/src/api/http.js), no proxy rewrite in any environment.
router = APIRouter(prefix="/api/auth", tags=["auth"])

# Uniform failure for unknown user and bad password — no user enumeration.
UNIFORM_FAILURE = "Invalid email or password."

# Inputs are bounded before they reach bcrypt/DB: a 72-byte bcrypt limit and a
# sane email length mean anything longer cannot be valid credentials. Overlong
# input gets the same uniform 401 — it must not become a size oracle.
MAX_EMAIL_LENGTH = 254
MAX_PASSWORD_LENGTH = 1024

# Per-(ip, email) failed-attempt counters, in-process (no Redis dependency;
# LOGIN_ARCHITECTURE.md: plain counters, not a Redis-backed limiter).
# Only failures count; a success clears the key. Unauthenticated traffic could
# otherwise grow the table without end, so it is pruned and hard-capped.
_FAILED: dict[tuple[str, str], list[float]] = {}
_FAILED_CAP = 10_000


def _evict_failed() -> None:
    cutoff = time() - config.LOGIN_WINDOW_SECONDS
    for key in [
        k for k, ts in _FAILED.items() if all(t <= cutoff for t in ts)
    ]:
        del _FAILED[key]
    while len(_FAILED) >= _FAILED_CAP:  # safety net against unbounded memory
        _FAILED.pop(next(iter(_FAILED)))  # oldest insertion


def _rate_limited(key: tuple[str, str]) -> bool:
    cutoff = time() - config.LOGIN_WINDOW_SECONDS
    attempts = [t for t in _FAILED.get(key, []) if t > cutoff]
    if len(attempts) >= config.LOGIN_MAX_ATTEMPTS:
        _FAILED[key] = attempts
        return True
    return False


def _record_failure(key: tuple[str, str]) -> None:
    _evict_failed()
    _FAILED.setdefault(key, []).append(time())


class LoginIn(BaseModel):
    email: str
    password: str


def user_view(user: dict) -> dict:
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "display_name": user["display_name"],
    }


def _lookup_user(email: str) -> dict | None:
    """Returns the row including password_hash (verified one layer up)."""
    with connect() as conn:
        return conn.execute(
            "SELECT id, email, password_hash, role, display_name"
            " FROM users WHERE email = %s AND disabled_at IS NULL",
            (email.strip().lower(),),
        ).fetchone()


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response) -> dict:
    if len(body.email) > MAX_EMAIL_LENGTH or len(body.password) > MAX_PASSWORD_LENGTH:
        # Same uniform failure as any other bad credential — never a size oracle.
        raise HTTPException(401, UNIFORM_FAILURE)

    client = request.client.host if request.client else ""
    key = (client, body.email.strip().lower())
    if _rate_limited(key):
        raise HTTPException(429, "Too many login attempts. Try again later.")

    user = _lookup_user(body.email)
    if user is None:
        # Equalize timing with the found-user path (which runs bcrypt) — the
        # lookup alone answers in ~17 ms, so without a dummy check the
        # response time would enumerate which emails exist despite the
        # uniform message.
        verify_password(body.password, DUMMY_HASH)
        _record_failure(key)
        raise HTTPException(401, UNIFORM_FAILURE)
    if not verify_password(body.password, user["password_hash"]):
        _record_failure(key)
        raise HTTPException(401, UNIFORM_FAILURE)

    _FAILED.pop(key, None)
    set_session_cookie(response, create_session(user["id"]), secure=request.url.scheme == "https")
    return {"user": user_view(user)}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict:
    # Best-effort: tolerate a missing/invalid session so a stale cookie can
    # always be cleared; revocation only ever applies to the caller's token.
    delete_session(request.cookies.get(config.SESSION_COOKIE))
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    return {"user": user_view(user)}