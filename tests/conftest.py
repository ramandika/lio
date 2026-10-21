"""Backend test suite (TESTING.md): must run offline — no LLM/API key needed,
only the Postgres from `docker compose up -d db`.

    docker compose up -d db
    DB_PORT is published, so from the host:   pytest  (DATABASE_URL points at localhost)
    or in the app container:  pytest          (DATABASE_URL already points at db)
"""

import os

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://lio:lio@localhost:5432/lio"
)

from app.db import connect  # noqa: E402