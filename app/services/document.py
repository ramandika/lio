"""Document storage — the uploads-volume boundary (PROJECT_PLAN.md item 13):

    save_upload(...)         store a file, return the row the rest of the API sees
    read_document_bytes(...) the bytes for GET /documents/:id
    can_access_document()    role scoping at the boundary (CLAUDE.md: requestors
                             see their own uploads; a request can only carry a
                             document its submitter may access)
    assert_source_access()   the same check as a payload-boundary gate

Bytes never go into Postgres: the row points at a file under
config.UPLOADS_DIR (compose `uploads` volume → /data/uploads), with an
opaque generated name so a guessed filename reaches nothing."""

import base64
import re
import uuid
from pathlib import Path

from fastapi import HTTPException

from .. import config
from ..db import connect

# A dataURL "size" is measured on the base64 payload at the frontend; the
# backend stores the real byte count.
DATAURL_RE = re.compile(r"^data:([^;]+);base64,(.*)$", re.DOTALL)


def save_upload(user_id: str, filename: str, mime: str, data: bytes) -> dict:
    """Persist one upload: bytes under the uploads dir, row in the documents
    table. The upload is kept even if extraction later fails — it stays
    attached to what becomes the draft (the mock boundary behaves the same)."""
    document_id = str(uuid.uuid4())
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    stored = config.UPLOADS_DIR / f"{document_id}.bin"
    stored.write_bytes(data)
    with connect() as conn:
        return conn.execute(
            "INSERT INTO documents (id, created_by, filename, mime, size, stored_path)"
            " VALUES (%s, %s, %s, %s, %s, %s) RETURNING"
            " id, created_by, filename, mime, size, stored_path, created_at",
            (document_id, user_id, filename or "upload",
             mime or "application/octet-stream", len(data), str(stored)),
        ).fetchone()


def parse_data_url(data_url: str) -> bytes | None:
    m = DATAURL_RE.match(data_url or "")
    if not m:
        return None
    try:
        return base64.b64decode(m.group(2), validate=False)
    except ValueError:
        return None


def document_view(row: dict, *, data: bytes | None = None) -> dict:
    """The brief the request views embed; `data` attaches the full payload as
    a data URL so the frontend keeps one shape over mock and live transport."""
    view = {
        "id": str(row["id"]),
        "filename": row["filename"],
        "mime": row["mime"],
        "size": row["size"],
    }
    if data is not None:
        view["data"] = f"data:{row['mime']};base64," + base64.b64encode(data).decode()
    return view


def read_document_bytes(row: dict) -> bytes:
    return Path(row["stored_path"]).read_bytes()


def get_document_row(document_id: str) -> dict | None:
    try:
        canonical = str(uuid.UUID(document_id))
    except (ValueError, AttributeError, TypeError):
        return None
    with connect() as conn:
        return conn.execute(
            "SELECT id, created_by, filename, mime, size, stored_path, created_at"
            " FROM documents WHERE id = %s",
            (canonical,),
        ).fetchone()


def can_access_document(user: dict, row: dict) -> bool:
    """The mirror of the /requests role scoping over the uploads store:
    requestors reach only documents they uploaded or that back a request they
    may see; procurement/admin see everything. A rejection reads as 404 —
    never more than the request handlers confirm about another requestor's
    data (CLAUDE.md, LOGIN_ARCHITECTURE.md boundary rules)."""
    if user["role"] != "requestor":
        return True
    if str(row["created_by"]) == str(user["id"]):
        return True
    with connect() as conn:
        backed = conn.execute(
            "SELECT 1 FROM requests"
            " WHERE created_by = %s AND source->>'document_id' = %s LIMIT 1",
            (user["id"], str(row["id"])),
        ).fetchone()
    return backed is not None


def assert_source_access(user: dict, source) -> None:
    """Payload-boundary gate (403 before any field validation, like the mock):
    a request may only carry (and keep carrying) a document the submitting
    user can access — otherwise a requestor could attach another requestor's
    upload."""
    if not isinstance(source, dict):
        return
    document_id = source.get("document_id")
    if not document_id:
        return
    row = get_document_row(document_id)
    if row is None or not can_access_document(user, row):
        raise HTTPException(
            403, "A request can only carry a document you uploaded yourself."
        )