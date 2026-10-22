"""POST /extraction — the offer-upload boundary (WS2).

Accepts the offer as a multipart upload (stored in the uploads volume and
kept even when extraction fails — it stays attached to what becomes the
draft) or as pasted text. PDFs are read server-side with PyMuPDF — the text
and the rendered page images both feed the composite in
app/services/extraction.py:

    L1  deterministic parse over the PyMuPDF text (zero LLM calls) — the
        README sample offer resolves here
    L2  llm_ocr_fuse, only when L1's validation fails, tier-gated through
        app/services/llm.py (LLM_TIER=on AND key set); every answer
        re-checked by the same validators

Degradation is part of the contract: an unreadable document or an
off/unreachable LLM answers 200 with ok:false and a manual-entry detail —
the user is the safety net, never an error page."""

from fastapi import APIRouter, Depends, File, Form, UploadFile

from ..auth import get_current_user
from ..services import classifier, document as documents_service, extraction as extraction_service

router = APIRouter(prefix="/api", tags=["extraction"])


def _is_pdf_bytes(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def _is_pdf(filename: str | None, mime: str | None) -> bool:
    name = (filename or "").lower()
    return (mime or "").lower() == "application/pdf" or name.endswith(".pdf")


@router.post("/extraction")
def extract(
    file: UploadFile | None = File(None),
    content: str | None = Form(None),
    user: dict = Depends(get_current_user),
) -> dict:
    data = file.file.read() if file is not None else None
    filename = (file.filename if file is not None else None) or None
    mime = file.content_type if file is not None else None

    # The upload itself is kept, like the backend's uploads volume — even if
    # extraction fails, the document stays attached to the draft.
    document_id = None
    if file is not None and data is not None:
        row = documents_service.save_upload(user["id"], filename or "upload", mime, data)
        document_id = str(row["id"])

    # Reading order: a PDF (detected by header sniff, or declared by name/mime)
    # is read with PyMuPDF; pasted text and plain-text files ride as text.
    text = None
    images: list[str] = []
    if data is not None and (_is_pdf_bytes(data) or _is_pdf(filename, mime)):
        try:
            text = extraction_service.pdf_to_text(data)
            images = extraction_service.pdf_page_images(data)
        except Exception:
            text = None
    elif isinstance(content, str) and content.strip():
        text = content
    elif data is not None:
        # A plain-text upload: decode leniently, let validation grade it.
        text = data.decode("utf-8", errors="replace")

    result = (
        extraction_service.extract_offer(text, images)
        if text is not None
        else {
            "layer": None,
            "unreadable": True,
            "fields": None,
            "detected": {},
            "problems": ["unreadable"],
            "detail": "The document could not be read as text. Please enter the details manually.",
        }
    )

    if result["layer"] is None:
        return {
            "ok": False,
            "document_id": document_id,
            "detail": result["detail"],
        }

    # Commodity suggestion comes along on extraction success (WS3): the
    # department and item texts the document showed are the classifier's
    # input, exactly the mock contract's shape.
    suggestion = classifier.suggest_commodity(
        {
            "title": None,
            "department": result["fields"].get("department"),
            "items": result["fields"].get("order_lines", []),
        }
    )
    return {
        "ok": True,
        "layer": result["layer"],
        "document_id": document_id,
        "fields": result["fields"],
        "detected": result["detected"],
        "problems": result["problems"],
        "confidences": result.get("confidences") or {},
        "low_confidence": result["low_confidence"],
        "llm": result.get("llm"),
        "commodity_suggestion": suggestion["suggestion"],
    }