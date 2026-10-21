"""Account seeding at startup — working logins without a signup flow
(LOGIN_ARCHITECTURE.md: "Accounts seeded via env (e.g. SEED_USERS), admin
manages them; registration is disabled").

Idempotent: existing emails are left untouched (ON CONFLICT DO NOTHING), so
restarting the stack never overwrites a changed password or role. Expired
sessions are purged on the way through."""

import sys

from . import config
from .auth import hash_password
from .db import connect

ROLES = ("requestor", "procurement", "admin")


def parse_seed_users(raw: str) -> list[dict]:
    """`display_name:email:role[:password]`, comma-separated; invalid entries
    are skipped with a warning so one typo cannot block startup."""
    users = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) not in (3, 4):
            print(f"seed: skipping malformed SEED_USERS entry {entry!r}", file=sys.stderr)
            continue
        name, email, role = parts[0].strip(), parts[1].strip().lower(), parts[2].strip()
        password = parts[3].strip() if len(parts) == 4 else config.SEED_PASSWORD
        if role not in ROLES:
            print(f"seed: skipping entry with unknown role {role!r}: {entry!r}", file=sys.stderr)
            continue
        if not email or not password:
            print(f"seed: skipping entry with empty email/password: {entry!r}", file=sys.stderr)
            continue
        users.append({"email": email, "display_name": name, "role": role, "password": password})
    return users


def seed_users(raw: str | None = None) -> None:
    users = parse_seed_users(raw if raw is not None else config.SEED_USERS)
    with connect() as conn:
        for user in users:
            conn.execute(
                "INSERT INTO users (email, password_hash, role, display_name)"
                " VALUES (%s, %s, %s, %s) ON CONFLICT (email) DO NOTHING",
                (user["email"], hash_password(user["password"]), user["role"], user["display_name"]),
            )
        purge = conn.execute("DELETE FROM sessions WHERE expires_at < now()").statusmessage
    if purge and purge.split()[-1] != "0":
        print("seed: purged expired sessions")