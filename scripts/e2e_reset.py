"""Reset the backend's request data for the Cypress journeys — the real
stack's resetAppData (e2e/cypress/support/commands.js). Wipes request, line,
status-history and document rows plus the uploads volume, then re-applies the
demo seed (app/seed.py), so every journey starts from the same seeded state
the specs' comments describe. Runs inside the app container:

    docker compose exec -T app python scripts/e2e_reset.py

Users and sessions are kept: journeys sign in through the login form and
accounts are seeded on boot.
"""

import shutil
import sys

sys.path.insert(0, "/srv")  # script mode puts scripts/ on sys.path, not /srv

from app import config, db, seed  # noqa: E402


def main() -> None:
    conn = db.connect()
    conn.execute("TRUNCATE request_lines, status_history, requests, documents")
    conn.close()

    if config.UPLOADS_DIR.is_dir():
        for path in config.UPLOADS_DIR.iterdir():
            shutil.rmtree(path) if path.is_dir() else path.unlink()

    seed.seed_demo_requests()
    print("demo state reset")


if __name__ == "__main__":
    main()