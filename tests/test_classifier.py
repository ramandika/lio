"""The resuggest policy (app/services/classifier.py): the explicit "Suggest
from my entries" button — heuristic-first when nothing is assigned, and a
same-or-better gate over an already-assigned group. Offline: the LLM tier is
pinned off and the branch is exercised through monkeypatching the factored-out
_llm_classified."""

import pytest

from app.services import classifier


@pytest.fixture(autouse=True)
def llm_off(monkeypatch):
    """The suite contract is offline (TESTING.md): pin the tier gate off, so
    the compose environment's LLM_TIER/key can never leak into a run — the
    LLM-branch cases below supply their own fake answers instead."""
    monkeypatch.setattr(classifier.llm, "tier_on", lambda: False)


def body(**over):
    """An English office-furniture request: the keyword bank scores 015 high."""
    base = {
        "title": "New office desks for the annex",
        "department": "Operations",
        "items": [{"position_description": "office furniture, five desks"}],
    }
    base.update(over)
    return base


def fake_llm(result):
    return lambda _body: result


# --- nothing assigned ----------------------------------------------------------


def test_no_group_high_confidence_keyword_rules():
    out = classifier.resuggest_commodity(body())
    assert out["suggestion"]["id"] == "015"
    assert out["suggestion"]["confidence"] == "high"
    assert out["suggestion"]["source"] == "heuristic"
    assert out["declined"] is None


def test_substring_traps_do_not_mint_suggestions():
    # Short generic keywords (erp, tax, ups, books, print, event, desk,
    # leasing, guard, ppe) are word-bounded: a substring inside unrelated
    # vocabulary used to mint a medium-confidence suggestion ("Üb*erp*rüfung"
    # → Software via "erp").
    traps = [
        "Überprüfung der Anlage, Belege aus der Oberpflege",
        "Taxi vouchers, group updates in folders, releasing a version, eventuell verschieben",
        "Sprint planning am Whiteboard, desktop themes abschreiben",
    ]
    for text in traps:
        out = classifier.resuggest_commodity(
            {"title": "", "department": "", "items": [{"position_description": text}]}
        )
        assert out["suggestion"]["id"] == "009", text  # fallback, not a keyword hit
        assert out["suggestion"]["confidence"] == "low", text  # medium = a rule fired

    # The real terms still classify, at high confidence with a title match.
    out = classifier.resuggest_commodity(body(title="ERP renewal", items=[]))
    assert out["suggestion"]["id"] == "031"  # Software
    assert out["suggestion"]["confidence"] == "high"


def test_no_group_low_keyword_falls_to_llm(monkeypatch):
    # German-domain text scores no rule → the low 009 fallback; a usable LLM
    # answer is trusted ahead of a low-confidence keyword one.
    monkeypatch.setattr(
        classifier,
        "_llm_classified",
        fake_llm({"id": "043", "category": "Marketing & Advertising", "name": "Promotional Materials",
                  "confidence": "medium", "reasoning": "branded office decor"}),
    )
    german = {"title": "", "department": "", "items": [{"position_description": "Moosbild mit Schriftzug"}]}
    out = classifier.resuggest_commodity(german)
    assert out["suggestion"]["id"] == "043"


def test_no_group_tier_off_keeps_the_low_keyword_fallback():
    # Tier off (the suite default): the low fallback is still better than
    # an empty suggestion.
    german = {"title": "", "department": "", "items": [{"position_description": "Moosbild mit Schriftzug"}]}
    out = classifier.resuggest_commodity(german)
    assert out["suggestion"]["id"] == "009"
    assert out["suggestion"]["confidence"] == "low"
    assert out["suggestion"]["source"] == "heuristic"  # the fallback is the scorer's answer too


def test_llm_answer_is_stamped_llm(monkeypatch):
    # The suggestion source stamp says who advised: a validated LLM answer
    # through the real _llm_classified must be stamped "llm".
    monkeypatch.setattr(classifier.llm, "tier_on", lambda: True)
    monkeypatch.setattr(classifier.llm, "chat", lambda *_a, **_k: "raw model output")
    monkeypatch.setattr(
        classifier.llm,
        "parse_json_message",
        lambda _raw: {"id": "031", "confidence": "high", "reasoning": "subscription software"},
    )
    out = classifier._llm_classified({"title": "Photoshop licenses", "department": "Design", "items": []})
    assert out is not None
    assert out["id"] == "031"
    assert out["source"] == "llm"


# --- a group is already assigned -------------------------------------------------


def test_assigned_same_group_is_reapplied(monkeypatch):
    monkeypatch.setattr(
        classifier,
        "_llm_classified",
        fake_llm({"id": "015", "category": "Facility Management", "name": "Office Equipment",
                  "confidence": "medium", "reasoning": "office furniture"}),
    )
    out = classifier.resuggest_commodity({**body(), "current_group_id": "015", "current_confidence": None})
    assert out["suggestion"]["id"] == "015"


def test_assigned_replaced_by_strictly_higher_confidence(monkeypatch):
    monkeypatch.setattr(
        classifier,
        "_llm_classified",
        fake_llm({"id": "043", "category": "Marketing & Advertising", "name": "Promotional Materials",
                  "confidence": "high", "reasoning": "branded signage"}),
    )
    out = classifier.resuggest_commodity({**body(), "current_group_id": "015", "current_confidence": "medium"})
    assert out["suggestion"]["id"] == "043"


def test_assigned_kept_when_advice_is_no_better(monkeypatch):
    monkeypatch.setattr(
        classifier,
        "_llm_classified",
        fake_llm({"id": "043", "category": "Marketing & Advertising", "name": "Promotional Materials",
                  "confidence": "medium", "reasoning": "branded decor"}),
    )
    out = classifier.resuggest_commodity({**body(), "current_group_id": "015", "current_confidence": "high"})
    assert out["suggestion"] is None
    assert out["declined"]["kept"] == {"id": "015", "name": "Office Equipment", "confidence": "high"}
    assert out["declined"]["alternative"]["id"] == "043"


def test_assigned_tier_off_keyword_fallback_is_gated_the_same_way():
    # Tier off, so the keyword answer is the only advice: equal-confidence
    # advice on a different group must not unseat the assigned one.
    out = classifier.resuggest_commodity({**body(), "current_group_id": "029", "current_confidence": "high"})
    assert out["suggestion"] is None
    assert out["declined"]["alternative"]["id"] == "015"


def test_assigned_low_group_upgraded_by_keyword_fallback():
    # A 009 fallback pick carries no confidence — a high keyword answer is
    # strictly better and applies (the click was explicit consent).
    german = {"title": "", "department": "", "items": [{"position_description": "Moosbild mit Schriftzug"}],
              "current_group_id": "009", "current_confidence": None}
    with_desks = {"title": "New office desks", "department": "", "items": [],
                  "current_group_id": "009", "current_confidence": None}
    out = classifier.resuggest_commodity(with_desks)
    assert out["suggestion"]["id"] == "015"
    assert german["current_group_id"] == "009"  # sanity: input untouched


def test_assigned_invalid_current_group_is_ignored():
    out = classifier.resuggest_commodity({**body(), "current_group_id": "999"})
    assert out["suggestion"]["id"] == "015"  # treated as nothing assigned