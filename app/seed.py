"""Account seeding at startup — working logins without a signup flow
(LOGIN_ARCHITECTURE.md: "Accounts seeded via env (e.g. SEED_USERS), admin
manages them; registration is disabled").

Idempotent: existing emails are left untouched (ON CONFLICT DO NOTHING), so
restarting the stack never overwrites a changed password or role. Expired
sessions are purged on the way through. A small demo-request set mirrors the
mock API's seed (the same three requests Ana/Tom see on first login), keyed
by fixed UUIDs so reruns never duplicate anything."""

import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config
from .auth import hash_password
from .db import connect
from .money import cents_to_decimal

ROLES = ("requestor", "procurement", "admin")

# Fixed identities for the seed rows (kept so a restart never duplicates).
_SEED_DOC_ID = "00000000-0000-4000-8000-0000000000d1"
_SEED_REQUESTS = (
    {
        "id": "00000000-0000-4000-8000-000000000001",
        "email": "ana@example.com",
        "requestor_name": "Ana Weber",
        "title": "Adobe Creative Cloud Subscription",
        "vendor_name": "Adobe Systems",
        "vendor_vat_id": "DE123456789",
        "department": "Creative Marketing Department",
        "commodity_group_id": "031",
        "total_cost": 210000,
        "status": "In Progress",
        "with_document": True,
        "created": 3,
        "updated": 2,
        "lines": [
            {"desc": "Adobe Photoshop License", "price": 15000, "amount": 10, "unit": "licenses", "total": 150000},
            {"desc": "Adobe Illustrator License", "price": 12000, "amount": 5, "unit": "licenses", "total": 60000},
        ],
        "history": [
            {"old": None, "new": "Open", "by": "Ana Weber", "comment": None, "at": 3},
            {"old": "Open", "new": "In Progress", "by": "Kim Schneider", "comment": "Checking existing company licenses.", "at": 2},
        ],
    },
    {
        "id": "00000000-0000-4000-8000-000000000002",
        "email": "ana@example.com",
        "requestor_name": "Ana Weber",
        "title": "Standing Desks for Design Team",
        "vendor_name": "Büro Einrichtung GmbH",
        "vendor_vat_id": "DE987654321",
        "department": "Creative Marketing Department",
        "commodity_group_id": "015",
        "total_cost": 474000,
        "status": "Open",
        "with_document": False,
        "created": 1,
        "updated": 1,
        "lines": [
            {"desc": "Electric standing desk, 160×80 cm", "price": 69000, "amount": 6, "unit": "pieces", "total": 414000},
            {"desc": "Assembly service", "price": 60000, "amount": 1, "unit": "flat", "total": 60000},
        ],
        "history": [
            {"old": None, "new": "Open", "by": "Ana Weber", "comment": None, "at": 1},
        ],
    },
    {
        "id": "00000000-0000-4000-8000-000000000003",
        "email": "tom@example.com",
        "requestor_name": "Tom Richter",
        "title": "Annual Cyber Insurance Renewal",
        "vendor_name": "Rheinland Versicherungen",
        "vendor_vat_id": "DE555444333",
        "department": "HR",
        "commodity_group_id": "010",
        "total_cost": 950000,
        "status": "Closed",
        "with_document": False,
        "created": 9,
        "updated": 4,
        "lines": [
            {"desc": "Cyber risk policy, annual premium", "price": 950000, "amount": 1, "unit": "policy", "total": 950000},
        ],
        "history": [
            {"old": None, "new": "Open", "by": "Tom Richter", "comment": None, "at": 9},
            {"old": "Open", "new": "In Progress", "by": "Kim Schneider", "comment": None, "at": 6},
            {"old": "In Progress", "new": "Closed", "by": "Kim Schneider", "comment": "Renewed through 2027.", "at": 4},
        ],
    },
)

# The README sample offer, built by scripts/make_sample_offer_pdf.py — the
# demo r1 carries it as its uploaded document (uploaded by Ana, like any
# runtime upload would be).
_SAMPLE_PDF_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "scripts" / "sample-offer-adobe.pdf",
    Path("/srv/scripts/sample-offer-adobe.pdf"),
    Path("/data/samples/sample-offer-adobe.pdf"),
)


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

def seed_demo_requests() -> None:
    """Seed the mock's demo request set (same three requests, same history),
    only when the demo rows are absent — the fixed UUIDs keep restarts
    idempotent, and ON CONFLICT DO NOTHING keeps them inert."""
    now = datetime.now(timezone.utc)
    demo_doc = None
    sample = next((p for p in _SAMPLE_PDF_CANDIDATES if p.is_file()), None)
    if sample is not None:
        demo_doc = _seed_document(sample)

    with connect() as conn:
        for spec in _SEED_REQUESTS:
            if conn.execute(
                "SELECT 1 FROM requests WHERE id = %s", (spec["id"],)
            ).fetchone():
                continue
            owner = conn.execute(
                "SELECT id FROM users WHERE email = %s", (spec["email"],)
            ).fetchone()
            if owner is None:
                print(f"seed: demo request skipped, no user {spec['email']!r}", file=sys.stderr)
                continue
            source = None
            if spec["with_document"]:
                if demo_doc is None:
                    print("seed: demo r1 carries no document (sample PDF not found)", file=sys.stderr)
                else:
                    source = {
                        "filename": demo_doc["filename"],
                        "layer": "L1",
                        "document_id": demo_doc["id"],
                        "detected": {
                            "vendor_name": True,
                            "vendor_vat_id": True,
                            "department": True,
                            "order_lines": True,
                            "total_cost": True,
                        },
                    }
            created_at = now - timedelta(days=spec["created"])
            updated_at = now - timedelta(days=spec["updated"])
            conn.execute(
                "INSERT INTO requests (id, created_by, requestor_name, title, vendor_name,"
                " vendor_vat_id, department, commodity_group_id, total_cost, status, source,"
                " created_at, updated_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    spec["id"], owner["id"], spec["requestor_name"], spec["title"],
                    spec["vendor_name"], spec["vendor_vat_id"], spec["department"],
                    spec["commodity_group_id"], cents_to_decimal(spec["total_cost"]),
                    spec["status"], json.dumps(source) if source is not None else None,
                    created_at, updated_at,
                ),
            )
            for i, line in enumerate(spec["lines"]):
                conn.execute(
                    "INSERT INTO request_lines (request_id, position, position_description,"
                    " unit_price, amount, unit, total_price) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (
                        spec["id"], i + 1, line["desc"],
                        cents_to_decimal(line["price"]), line["amount"], line["unit"],
                        cents_to_decimal(line["total"]),
                    ),
                )
            for entry in spec["history"]:
                conn.execute(
                    "INSERT INTO status_history (request_id, old_status, new_status, changed_by, comment, changed_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    (spec["id"], entry["old"], entry["new"], entry["by"], entry["comment"],
                     now - timedelta(days=entry["at"])),
                )


def _seed_document(sample: Path) -> dict | None:
    """The demo upload: copy the sample PDF into the uploads volume once, then
    index it. Returns the row-shaped dict the demo request references."""
    with connect() as conn:
        if conn.execute("SELECT 1 FROM documents WHERE id = %s", (_SEED_DOC_ID,)).fetchone():
            return None
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    stored = config.UPLOADS_DIR / f"{_SEED_DOC_ID}.bin"
    shutil.copyfile(sample, stored)
    size = stored.stat().st_size
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO documents (id, created_by, filename, mime, size, stored_path)"
            " VALUES (%s, (SELECT id FROM users WHERE email = 'ana@example.com'),"
            " 'sample-offer-adobe.pdf', 'application/pdf', %s, %s)"
            " ON CONFLICT (id) DO NOTHING RETURNING id, filename",
            (_SEED_DOC_ID, size, str(stored)),
        ).fetchone()
    if row is None:
        return None
    return {"id": str(row["id"]), "filename": row["filename"]}
