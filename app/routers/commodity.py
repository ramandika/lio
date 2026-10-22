"""Commodity suggestion boundaries (WS3) — the mock contract's shape:
{title, department, items}. Never a forced selection; the UI keeps an
override select over the fixed 50-group list.

POST /commodity/suggest    the auto path (fires while typing).
POST /commodity/resuggest  the explicit button policy (classifier.py)
                           — carries the currently assigned group and its
                           confidence so the LLM advice must be same-or-better
                           to replace it.
"""

from fastapi import APIRouter, Body, Depends

from ..auth import get_current_user
from ..services import classifier

router = APIRouter(prefix="/api", tags=["commodity"])


@router.post("/commodity/suggest")
def suggest(body: dict = Body(default=None), user: dict = Depends(get_current_user)) -> dict:
    payload = body if isinstance(body, dict) else {}
    return classifier.suggest_commodity(payload)


@router.post("/commodity/resuggest")
def resuggest(body: dict = Body(default=None), user: dict = Depends(get_current_user)) -> dict:
    payload = body if isinstance(body, dict) else {}
    return classifier.resuggest_commodity(payload)