"""Request endpoints (WS1/WS4) — intake, overview, edit and the status trail.

Boundary rules mirrored from the mock contract (frontend/src/api/mock/
server.js), same messages, same status codes:

    GET  /requests               role-scoped list (requestor: own only), filters
    POST /requests                only valid payloads persist (422 {errors});
                                  provenance must be an accessible document (403)
    GET  /requests/:id            404 for another requestor's request (not 403 —
                                  never confirm foreign data exists)
    PUT  /requests/:id            editable only while Open (409 once locked)
    POST /requests/:id/status     procurement/admin only; append-only history

Payloads are read as plain dicts here, not pydantic models: the 422 contract
is `{errors: {field: message}}` — the inline-UX shape the frontend mirror
produces — and flexible-but-strict pydantic typing would introduce a second,
competing error shape. The validation lives in app/validation.py, and every
numbered check happens BEFORE anything is written."""

import json
import uuid
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import get_current_user
from ..commodity import commodity_view
from ..db import connect
from ..services import document as documents_service
from ..validation import transition_problem, validate_request_payload

router = APIRouter(prefix="/api", tags=["requests"])

EDIT_LOCKED_MESSAGE = "A request can only be edited while it is still “Open”."
STATUS_FORBIDDEN_MESSAGE = "Only procurement staff can update a request status."
NOT_FOUND_MESSAGE = "Request not found."


def _uuid_or_none(raw) -> str | None:
    """Request ids are UUIDs; a malformed one is simply not a request —
    404, never a Postgres cast error."""
    try:
        return str(uuid.UUID(raw))
    except (ValueError, AttributeError, TypeError):
        return None


def _cents(value) -> int:
    """NUMERIC currency amount → integer cents (exact; stored from cents)."""
    return int((Decimal(value) * 100).to_integral_value())


def _line_view(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "position": row["position"],
        "position_description": row["position_description"],
        "unit_price": _cents(row["unit_price"]),
        "amount": row["amount"],
        "unit": row["unit"],
        "total_price": _cents(row["total_price"]),
    }


def _history_view(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "old_status": row["old_status"],
        "new_status": row["new_status"],
        "changed_by": row["changed_by"],
        "comment": row["comment"],
        "changed_at": row["changed_at"].isoformat(),
    }


def _load_lines(conn, request_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, request_id, position, position_description, unit_price,"
        " amount, unit, total_price FROM request_lines"
        " WHERE request_id = %s ORDER BY position",
        (request_id,),
    ).fetchall()
    return [_line_view(r) for r in rows]


def _load_history(conn, request_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, request_id, old_status, new_status, changed_by, comment, changed_at"
        " FROM status_history WHERE request_id = %s ORDER BY changed_at, id",
        (request_id,),
    ).fetchall()
    return [_history_view(r) for r in rows]


def _document_brief(conn, source) -> dict | None:
    """The uploaded document, brief form — full data comes from
    GET /documents/:id (the mock contract's view shape)."""
    if not isinstance(source, dict) or not source.get("document_id"):
        return None
    row = documents_service.get_document_row(source["document_id"])
    return documents_service.document_view(row) if row else None


def request_view(conn, row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "requestor_name": row["requestor_name"],
        "created_by": str(row["created_by"]),
        "title": row["title"],
        "vendor_name": row["vendor_name"],
        "vendor_vat_id": row["vendor_vat_id"],
        "department": row["department"],
        "commodity_group_id": row["commodity_group_id"],
        "commodity_group": commodity_view(row["commodity_group_id"]),
        "total_cost": _cents(row["total_cost"]),
        "status": row["status"],
        # Provenance carries through as-is (the extraction layer that prefilled
        # the request, its detected-map); null when entered manually.
        "source": row["source"],
        "document": _document_brief(conn, row["source"]),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "order_lines": _load_lines(conn, row["id"]),
    }


def _scoped_row(conn, user: dict, request_id: str) -> dict | None:
    """The role scoping: a requestor reaches only their own requests —
    anything else reads as not found."""
    row = conn.execute(
        "SELECT id, created_by, requestor_name, title, vendor_name, vendor_vat_id,"
        " department, commodity_group_id, total_cost, status, source, created_at, updated_at"
        " FROM requests WHERE id = %s",
        (request_id,),
    ).fetchone()
    if row is None or (user["role"] == "requestor" and str(row["created_by"]) != str(user["id"])):
        return None
    return row


def _insert_lines(conn, request_id: str, order_lines: list[dict]) -> None:
    for i, line in enumerate(order_lines):
        conn.execute(
            "INSERT INTO request_lines (request_id, position, position_description,"
            " unit_price, amount, unit, total_price)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                request_id,
                i + 1,
                str(line["position_description"]).strip(),
                Decimal(int(line["unit_price"])) / 100,
                int(line["amount"]),
                str(line["unit"]).strip(),
                Decimal(int(line["total_price"])) / 100,
            ),
        )


def _insert_history(conn, request_id: str, old_status, new_status: str, user: dict, comment) -> None:
    conn.execute(
        "INSERT INTO status_history (request_id, old_status, new_status, changed_by_id, changed_by, comment)"
        " VALUES (%s, %s, %s, %s, %s, %s)",
        (request_id, old_status, new_status, user["id"], user["display_name"], comment),
    )


@router.get("/requests")
def list_requests(
    status: str | None = None,
    q: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    where = ["TRUE"]
    args: list = []
    if user["role"] == "requestor":
        where.append("created_by = %s")
        args.append(user["id"])
    if status and status != "All":
        where.append("status = %s")
        args.append(status)
    if q:
        where.append("(title ILIKE %s OR vendor_name ILIKE %s OR requestor_name ILIKE %s)")
        args += [f"%{q}%", f"%{q}%", f"%{q}%"]
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, created_by, requestor_name, title, vendor_name, vendor_vat_id,"
            " department, commodity_group_id, total_cost, status, source, created_at, updated_at"
            f" FROM requests WHERE {' AND '.join(where)} ORDER BY updated_at DESC",
            args,
        ).fetchall()
        return {"requests": [request_view(conn, r) for r in rows]}


@router.post("/requests")
def create_request(body: dict = Body(...), user: dict = Depends(get_current_user)) -> dict:
    # Provenance must point at a document the submitter may access (403 —
    # same boundary rule as reading it), BEFORE field validation runs.
    documents_service.assert_source_access(user, body.get("source"))
    errors = validate_request_payload(body)
    if errors:
        raise HTTPException(422, {"errors": errors})
    source = body.get("source")
    with connect() as conn:
        row = conn.execute(
            "INSERT INTO requests (created_by, requestor_name, title, vendor_name,"
            " vendor_vat_id, department, commodity_group_id, total_cost, status, source)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Open', %s) RETURNING"
            " id, created_by, requestor_name, title, vendor_name, vendor_vat_id,"
            " department, commodity_group_id, total_cost, status, source, created_at, updated_at",
            (
                user["id"],
                str(body["requestor_name"]).strip(),
                str(body["title"]).strip(),
                str(body["vendor_name"]).strip(),
                str(body["vendor_vat_id"]).strip(),
                str(body["department"]).strip(),
                body.get("commodity_group_id"),
                Decimal(int(body["total_cost"])) / 100,
                json.dumps(source) if source is not None else None,
            ),
        ).fetchone()
        _insert_lines(conn, str(row["id"]), body["order_lines"])
        _insert_history(conn, str(row["id"]), None, "Open", user, None)
        return {"request": request_view(conn, row)}


@router.get("/requests/{request_id}")
def get_request(request_id: str, user: dict = Depends(get_current_user)) -> dict:
    rid = _uuid_or_none(request_id)
    if rid is None:
        raise HTTPException(404, NOT_FOUND_MESSAGE)
    with connect() as conn:
        row = _scoped_row(conn, user, rid)
        if row is None:
            raise HTTPException(404, NOT_FOUND_MESSAGE)
        return {"request": request_view(conn, row), "status_history": _load_history(conn, rid)}


@router.put("/requests/{request_id}")
def update_request(
    request_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)
) -> dict:
    rid = _uuid_or_none(request_id)
    if rid is None:
        raise HTTPException(404, NOT_FOUND_MESSAGE)
    with connect() as conn:
        row = _scoped_row(conn, user, rid)
        if row is None:
            raise HTTPException(404, NOT_FOUND_MESSAGE)
        # Editing rule: the record is only mutable while it is still Open —
        # once a request is in progress its facts are fixed and the trail rules.
        if row["status"] != "Open":
            raise HTTPException(409, EDIT_LOCKED_MESSAGE)
        # The PUT keeps provenance as-is, but it never re-points it at a
        # document the editor cannot access — same 403 as on create.
        documents_service.assert_source_access(user, body.get("source"))
        errors = validate_request_payload(body)
        if errors:
            raise HTTPException(422, {"errors": errors})
        conn.execute(
            "UPDATE requests SET requestor_name = %s, title = %s, vendor_name = %s,"
            " vendor_vat_id = %s, department = %s, commodity_group_id = %s,"
            " total_cost = %s, updated_at = now() WHERE id = %s",
            (
                str(body["requestor_name"]).strip(),
                str(body["title"]).strip(),
                str(body["vendor_name"]).strip(),
                str(body["vendor_vat_id"]).strip(),
                str(body["department"]).strip(),
                body.get("commodity_group_id"),
                Decimal(int(body["total_cost"])) / 100,
                rid,
            ),
        )
        # Order lines are replaced (re-keyed) rows. The uploaded document's
        # provenance (source) is left untouched — an edit never re-attaches
        # the paper trail.
        conn.execute("DELETE FROM request_lines WHERE request_id = %s", (rid,))
        _insert_lines(conn, rid, body["order_lines"])
        updated = _scoped_row(conn, user, rid)
        return {"request": request_view(conn, updated), "status_history": _load_history(conn, rid)}


@router.post("/requests/{request_id}/status")
def update_status(
    request_id: str, body: dict = Body(...), user: dict = Depends(get_current_user)
) -> dict:
    if user["role"] == "requestor":
        raise HTTPException(403, STATUS_FORBIDDEN_MESSAGE)
    rid = _uuid_or_none(request_id)
    if rid is None:
        raise HTTPException(404, NOT_FOUND_MESSAGE)
    with connect() as conn:
        row = conn.execute(
            "SELECT id, status, updated_at FROM requests WHERE id = %s", (rid,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, NOT_FOUND_MESSAGE)
        new_status = body.get("new_status")
        comment = body.get("comment")
        problem = transition_problem(row["status"], new_status)
        if problem:
            # The documented refusal shape: the problem is the body's detail.
            raise HTTPException(422, problem)
        conn.execute(
            "INSERT INTO status_history (request_id, old_status, new_status, changed_by_id, changed_by, comment)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (
                rid,
                row["status"],
                new_status,
                user["id"],
                user["display_name"],
                str(comment).strip() if isinstance(comment, str) and comment.strip() else None,
            ),
        )
        conn.execute(
            "UPDATE requests SET status = %s, updated_at = now() WHERE id = %s",
            (new_status, rid),
        )
        updated = conn.execute(
            "SELECT id, created_by, requestor_name, title, vendor_name, vendor_vat_id,"
            " department, commodity_group_id, total_cost, status, source, created_at, updated_at"
            " FROM requests WHERE id = %s",
            (rid,),
        ).fetchone()
        return {"request": request_view(conn, updated), "status_history": _load_history(conn, rid)}