"""Session-auth primitives (LOGIN_ARCHITECTURE.md).

- Passwords: bcrypt (pinned in requirements.txt), cost >= 12, constant-time
  `checkpw` — never logged, never returned.
- Sessions: opaque random token (secrets, >= 128 bits) in a server-side row,
  carried in an HTTP-only cookie; idle expiry slides on every authenticated
  request, capped by an absolute TTL."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import HTTPException, Request

from . import config
from .db import connect

# Known bcrypt behavior: only the first 72 bytes of a password take part in
# hashing. Inputs are capped at the API boundary (routers/auth.py) — keep that
# cap in sync if this ever changes.
BCRYPT_MAX_BYTES = 72

# Static one-time hash used to equalize the login timing between the
# "unknown email" path (no bcrypt) and the "real user" path (bcrypt ~300 ms
# at cost 12). It hashes no real secret — it exists only to be compared.
DUMMY_HASH = bcrypt.hashpw(
    b"asklio-timing-equalizer", bcrypt.gensalt(rounds=config.SESSION_COST)
).decode()  # str, like password_hash columns — verify_password takes str


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(
        plain.encode(), bcrypt.gensalt(rounds=config.SESSION_COST)
    ).decode()


def verify_password(plain: str, hashed: str) -> bool:
    # Unknown/malformed hashes must not raise — the caller only learns "no".
    # (A NUL byte or non-UTF8 input lands here too, i.e. as "invalid".)
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


MAX_TOKEN_LENGTH = 512  # a valid cookie token is far shorter; bound hashing


def _token_hash(token: str) -> str:
    """Sessions are stored as SHA-256 digests, never the raw token — a DB
    leak then yields no usable session credentials (only the cookie holds
    the usable secret)."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(24)  # ~192 bits (spec: >= 128)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=config.SESSION_IDLE_TTL)
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)"
            " VALUES (%s, %s, %s, %s, %s)",
            (_token_hash(token), user_id, now, now, expires),
        )
    return token


def load_session_user(token: str | None) -> dict | None:
    """Resolve a session token to an active user, sliding the idle expiry.
    Returns the user row (id, email, role, display_name) or None."""
    if not token or len(token) > MAX_TOKEN_LENGTH:
        return None
    stored = _token_hash(token)
    bump = datetime.now(timezone.utc) + timedelta(seconds=config.SESSION_IDLE_TTL)
    with connect() as conn:
        row = conn.execute(
            "SELECT u.id, u.email, u.role, u.display_name"
            " FROM sessions s JOIN users u ON u.id = s.user_id"
            " WHERE s.id = %s AND s.expires_at > now() AND u.disabled_at IS NULL",
            (stored,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE sessions s SET last_seen_at = now(),"
                " expires_at = LEAST(%s, s.created_at + make_interval(secs => %s))"
                " WHERE s.id = %s",
                (bump, float(config.SESSION_ABS_TTL), stored),
            )
    return row or None


def delete_session(token: str | None) -> None:
    if not token or len(token) > MAX_TOKEN_LENGTH:
        return
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE id = %s", (_token_hash(token),))


def purge_expired() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < now()")


def get_current_user(request: Request) -> dict:
    """FastAPI dependency: session cookie → user, else a uniform 401 (the
    front-end redirects to /login); every other router uses this to keep the
    auth decision in one place."""
    user = load_session_user(request.cookies.get(config.SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user


def set_session_cookie(response, token: str, secure: bool) -> None:
    # HttpOnly (not readable by JS), SameSite=Lax (blocks cross-site POSTs),
    # Secure only on HTTPS contexts (LOGIN_ARCHITECTURE.md security checklist).
    response.set_cookie(
        config.SESSION_COOKIE,
        token,
        max_age=config.SESSION_IDLE_TTL,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(config.SESSION_COOKIE, path="/")