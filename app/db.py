"""PostgreSQL connection + schema init (PROJECT_PLAN.md item 4 — "PostgreSQL
connection + schema init"; the SQLAlchemy/Alembic route is deliberately still
open, so this stays plain psycopg 3 until request data forces an ORM decision).

Numeric policy: money arrives over the API as integer cents (the frontend
mirror's contract) and is stored as NUMERIC amounts — exact across the
boundary, never a float."""

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

-- Request data (CLAUDE.md architecture decisions): order lines are separate
-- rows, not JSON; money is NUMERIC, never floats (payloads arrive as integer
-- cents from the frontend mirror and are stored as currency amounts).
CREATE TABLE IF NOT EXISTS requests (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by         UUID         NOT NULL REFERENCES users(id),
  requestor_name     TEXT         NOT NULL,
  title              TEXT         NOT NULL,
  vendor_name        TEXT         NOT NULL,
  vendor_vat_id      TEXT         NOT NULL,
  department         TEXT         NOT NULL,
  commodity_group_id TEXT,                          -- stable "001".."050"
  total_cost         NUMERIC(14,2),
  status             TEXT         NOT NULL DEFAULT 'Open'
                     CHECK (status IN ('Open','In Progress','Closed')),
  source             JSONB,                         -- provenance {filename, layer, document_id?, detected}
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_updated_idx ON requests (updated_at DESC);

CREATE TABLE IF NOT EXISTS request_lines (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           UUID          NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  position             INTEGER       NOT NULL,
  position_description TEXT          NOT NULL,
  unit_price           NUMERIC(14,2) NOT NULL,
  amount               INTEGER       NOT NULL CHECK (amount > 0),
  unit                 TEXT          NOT NULL,
  total_price          NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS request_lines_request_idx ON request_lines (request_id, position);

-- Append-only audit trail — the source of truth for status history
-- (CLAUDE.md); request.status is the denormalized current value.
CREATE TABLE IF NOT EXISTS status_history (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  old_status   TEXT,                             -- null on the bootstrapping "Open" entry
  new_status   TEXT        NOT NULL,
  changed_by_id UUID       REFERENCES users(id),  -- kept even if the user is later disabled
  changed_by   TEXT        NOT NULL,              -- display name, the view's actor
  comment      TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_history_request_idx ON status_history (request_id, changed_at);

-- Uploaded offer documents: bytes on the uploads volume, this is the index
-- (filename/mime/size back the view brief; stored_path points at the file).
CREATE TABLE IF NOT EXISTS documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  UUID        NOT NULL REFERENCES users(id),
  filename    TEXT        NOT NULL,
  mime        TEXT        NOT NULL,
  size        INTEGER     NOT NULL,
  stored_path TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def connect():
    """One connection per unit of work — fine at demo scale, no pool dep."""
    return psycopg.connect(config.db_dsn(), row_factory=dict_row, autocommit=True)


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA)