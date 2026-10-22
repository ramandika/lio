"""Backend test suite (TESTING.md): must run offline — no LLM/API key needed,
only the Postgres from `docker compose up -d db`.

    docker compose up -d db
    DB_PORT is published, so from the host:   pytest  (DATABASE_URL points at localhost)
    or in the app container:  pytest          (DATABASE_URL already points at db)
"""

import os
import sys

# The `pytest` console script does not put the rootdir on sys.path (tests/ is
# not a package), so import the `app` module explicitly — this keeps the
# documented one-liners (`pytest`, `python -m pytest`) both working.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://lio:lio@localhost:5432/lio"
)
# Uploads in tests land in a scratch dir (never the real /data/uploads volume)
# — must be set before app.config is first imported.
os.environ.setdefault("UPLOADS_DIR", "/tmp/asklio-test-uploads")

from app.db import connect  # noqa: E402