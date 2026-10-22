"""GET /documents/:id — the uploads-volume read boundary (PROJECT_PLAN.md
item 13). Same role scoping as /requests: a requestor reaches their own
uploads and documents backing requests they can see; anything else reads as
404 — never confirm foreign data exists."""

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..services import document as documents_service

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/documents/{document_id}")
def get_document(document_id: str, user: dict = Depends(get_current_user)) -> dict:
    row = documents_service.get_document_row(document_id)
    if row is None or not documents_service.can_access_document(user, row):
        raise HTTPException(404, "Document not found.")
    # The full payload rides back as a data URL — the same shape the mock
    # contract returned, so the document viewer is transport-agnostic.
    return {
        "document": documents_service.document_view(
            row, data=documents_service.read_document_bytes(row)
        )
    }