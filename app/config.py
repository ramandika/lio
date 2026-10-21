"""Runtime configuration — environment-first, defaults mirror docker-compose.yml
(which is the source of truth). Read once at import; process-local."""

import os

def db_dsn() -> str:
    """psycopg 3 wants a plain URL; `postgresql+psycopg://` (the compose /
    .env spelling, aimed at a SQLAlchemy future) is normalized on the way in."""
    raw = os.getenv("DATABASE_URL", "postgresql+psycopg://lio:lio@db:5432/lio")
    prefix = "postgresql+psycopg://"
    if raw.startswith(prefix):
        return "postgresql://" + raw[len(prefix):]
    return raw


# Accounts seeded on first start so demo/evaluation environments have working
# logins without a signup flow (LOGIN_ARCHITECTURE.md). Registration is
# disabled — the admin creates accounts.
# Format: display_name:email:role[:password], comma-separated.
SEED_USERS = os.getenv(
    "SEED_USERS",
    ",".join(
        [
            "Ana Weber:ana@example.com:requestor",
            "Tom Richter:tom@example.com:requestor",
            "Kim Schneider:kim@example.com:procurement",
            "Sam Admin:admin@example.com:admin",
        ]
    ),
)
SEED_PASSWORD = "demo"

def _int_env(name: str, default: int) -> int:
    # Compose passes empty-string values for unset opt-ins — tolerate them.
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default

# Server-side sessions, opaque token in an HTTP-only cookie.
SESSION_COOKIE = "asklio_session"
SESSION_IDLE_TTL = _int_env("SESSION_IDLE_TTL", 12 * 3600)  # sliding, s (LOGIN_ARCHITECTURE.md: ~12h)
SESSION_ABS_TTL = _int_env("SESSION_ABS_TTL", 7 * 24 * 3600)  # hard cap, s

# bcrypt cost (LOGIN_ARCHITECTURE.md: hash cost >= 12)
SESSION_COST = int(os.getenv("SESSION_COST", "12"))
SESSION_COST = 12  # bcrypt cost (LOGIN_ARCHITECTURE.md: >= 12)

# Login rate limiting — plain in-process counters, no Redis (LOGIN_ARCHITECTURE.md).
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60