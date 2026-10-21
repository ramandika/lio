"""PostgreSQL connection + schema init (PROJECT_PLAN.md item 4 — "PostgreSQL
connection + schema init"; the SQLAlchemy/Alembic route is deliberately still
open, so this stays plain psycopg 3 until request data forces an ORM decision).

Numeric policy: these are the auth tables only — no numeric business data yet.
When REQUEST arrives, its money columns follow the NUMERIC-not-float rule."""

import psycopg
from psycopg.rows import dict_row

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,          -- bcrypt, never plaintext
  role          TEXT        NOT NULL CHECK (role IN ('requestor','procurement','admin')),
  display_name  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at   TIMESTAMPTZ                    -- soft-disable keeps history authors
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT        PRIMARY KEY,        -- opaque random token (>= 128 bits)
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
"""


def connect():
    """One connection per unit of work — fine at demo scale, no pool dep."""
    return psycopg.connect(config.db_dsn(), row_factory=dict_row, autocommit=True)


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA)