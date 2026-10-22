"""Commodity group suggestions (PROJECT_PLAN.md WS3): given title, item
descriptions and department, suggest over the fixed 50-group list
(app/commodity.py) with a confidence cue and reasoning — never a forced
selection (the UI keeps an override select).

Two paths, two policies:

  suggest_commodity    the auto path (fires while typing): the deterministic
                       keyword scorer first, the tier-gated LLM only when the
                       scorer has nothing.
  resuggest_commodity  the explicit button (POST /api/commodity/resuggest):
                       heuristic-first when nothing is assigned; same-or-better
                       LLM advice when a group is already assigned; never
                       silent about what replaced or kept the current pick.

Every suggestion dict carries a `source` stamp — "heuristic" for the
keyword scorer (the L1-analogue) or "llm" for the tier-gated LLM (the
L2-analogue) — so the UI can always say who advised, including in a
declined note where the alternative and the kept pick come from
different brains.

The keyword scorer is the deterministic bank from the mock boundary, ported
1:1: it gives every request a sensible in-distribution answer with zero LLM
calls; the LLM suggestion rides in when the keyword bank has no match
(tier-gated; degrades to no suggestion rather than an invented one)."""

import re

from ..commodity import commodity, commodity_view
from . import llm

FALLBACK = "009"

# Keyword bank — same rules, same order as the mock classifier, so an
# in-distribution request classifies identically over mock and live. Short
# generic tokens are word-bounded: a bare "erp" (or "tax", "ups", "books",
# "print", "event", "desk") also matches inside "Überprüfung", "taxi",
# "groups", "notebooks", "sprint", "eventuell", "desktop" — and must not
# mint a medium-confidence suggestion from unrelated vocabulary.
RULES: list[tuple[str, re.Pattern]] = [
    ("031", re.compile(r"photoshop|illustrator|indesign|adobe|licen[cs]e|software|subscription|saas|\berp\b", re.I)),
    ("029", re.compile(r"laptop|notebook|monitor|keyboard|mouse|server|printer|hardware|pc\b", re.I)),
    ("030", re.compile(r"hosting|cloud|vpn|dns|it[- ]?service|it[- ]?support|helpdesk|network", re.I)),
    ("026", re.compile(r"app development|digital product|website development", re.I)),
    ("023", re.compile(r"publishing software|cms|plugin development", re.I)),
    ("041", re.compile(r"seo|google ads|social media|online marketing|newsletter", re.I)),
    ("038", re.compile(r"marketing agency|creative agency|pr agency", re.I)),
    ("036", re.compile(r"advertis[ei]|campaign|banner design", re.I)),
    ("037", re.compile(r"billboard|outdoor ad|plakat", re.I)),
    ("042", re.compile(r"events?\b|conference|trade show|fair\b|venue", re.I)),
    ("043", re.compile(r"giveaway|promotional|merch|brochure|flyer", re.I)),
    ("039", re.compile(r"direct mail|mailing", re.I)),
    ("040", re.compile(r"customer communication|crm|support hotline", re.I)),
    ("019", re.compile(r"cleaning|janitor|disinfection", re.I)),
    ("018", re.compile(r"cafeteria|canteen|coffee|kitchenette|catering", re.I)),
    ("015", re.compile(r"office chair|\bdesks?\b|office equipment|furniture", re.I)),
    ("014", re.compile(r"renovat|repaint|painting work|remodel", re.I)),
    ("011", re.compile(r"electrical installation|wiring|electrician", re.I)),
    ("016", re.compile(r"energy|power supply|heating|solar", re.I)),
    ("013", re.compile(r"security|guards?\b|access control", re.I)),
    ("017", re.compile(r"maintenance|repair|servicing", re.I)),
    ("050", re.compile(r"maintenance and repairs|machin[e] [a-z]* repair", re.I)),
    ("008", re.compile(r"training|course|workshop|seminar|certification", re.I)),
    ("007", re.compile(r"recruit|headhunt|sourcing candidates", re.I)),
    ("004", re.compile(r"consult|advisory|audit", re.I)),
    ("005", re.compile(r"accounting|\btax(?:es)?\b|payroll|banking|financial", re.I)),
    ("010", re.compile(r"insurance", re.I)),
    ("001", re.compile(r"rental|accommodation|hotel|apartment|coworking", re.I)),
    ("002", re.compile(r"membership|annual fee|subscription fee", re.I)),
    ("003", re.compile(r"safety|workwear|\bppe\b|first aid", re.I)),
    ("006", re.compile(r"fleet|vehicle|\bleas|car pool", re.I)),
    ("022", re.compile(r"\bprint", re.I)),
    ("021", re.compile(r"\bbooks?\b|\bvideos?\b|\bcds\b|\be-books?\b", re.I)),
    ("020", re.compile(r"video production|audio|film|podcast", re.I)),
    ("028", re.compile(r"post[- ]production|editing studio", re.I)),
    ("027", re.compile(r"pre[- ]production|storyboard", re.I)),
    ("025", re.compile(r"shipping (?:for|of) production|production shipping", re.I)),
    ("032", re.compile(r"courier|express|postal|dhl|\bups\b", re.I)),
    ("034", re.compile(r"transport logistics|freight|haulage", re.I)),
    ("035", re.compile(r"delivery|shipping", re.I)),
    ("033", re.compile(r"warehous|storage space|material handling|pallet", re.I)),
    ("044", re.compile(r"operational equipment|warehouse equipment|forklift", re.I)),
    ("045", re.compile(r"machin|production equipment", re.I)),
    ("046", re.compile(r"spare part", re.I)),
    ("048", re.compile(r"raw material|production material|steel|resin", re.I)),
    ("049", re.compile(r"consumable|gloves|lubricant|toner", re.I)),
    ("047", re.compile(r"internal transport|conveyor", re.I)),
]


def _fallback_suggestion() -> dict:
    g = commodity(FALLBACK)
    return {
        "id": FALLBACK,
        "category": g["category"],
        "name": g["name"],
        "source": "heuristic",
        "confidence": "low",
        "reasoning": "No strong signal found — defaulted to a generic group.",
    }


def _keyword_suggestion(body: dict):
    """The scorer proper: title matches weigh 3, haystack matches 1; the best
    score wins. Returns (suggestion, candidates) or (None, []) when there is
    nothing to go on."""
    items = body.get("items") if isinstance(body.get("items"), list) else []
    haystack = "\n".join(
        str(part)
        for part in [body.get("title"), body.get("department"), *[
            i.get("position_description") for i in items if isinstance(i, dict)
        ]]
        if part
    )
    title = str(body.get("title")) if body.get("title") else None

    scores: dict[str, int] = {}
    reasons: dict[str, str] = {}
    for group_id, kw in RULES:
        tmatch = title and kw.search(title)
        fmatch = kw.search(haystack)
        if not fmatch:
            continue
        score = (3 if tmatch else 0) + 1
        if score <= scores.get(group_id, 0):
            continue
        scores[group_id] = score
        reasons[group_id] = (
            f"“{tmatch.group(0)}” in the title" if tmatch
            else f"“{fmatch.group(0)}” in the item descriptions"
        )

    if not scores and not haystack.strip():
        return None, []

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    if not ranked:
        # Non-empty haystack yet no rule matched (a German-domain offer outside
        # the keyword bank) — the fallback's job, not an error path.
        return _fallback_suggestion(), []

    best_id, best_score = ranked[0]
    g = commodity(best_id)
    suggestion = {
        "id": best_id,
        "category": g["category"],
        "name": g["name"],
        "source": "heuristic",
        "confidence": "high" if best_score >= 3 else "medium",
        "reasoning": f"Matched {reasons[best_id]}.",
    }
    candidates = [commodity_view(gid) for gid, _ in ranked[:3]]
    return suggestion, [c for c in candidates if c]


CLASSIFIER_PROMPT = """You classify a procurement request into one of the fixed commodity groups.
Choose exactly one group from the list. Answer with one JSON object:
{"id": "001".."050", "reasoning": "one short sentence", "confidence": "high"|"medium"|"low"}.
Never invent a group that is not on the list."""


def _llm_classified(body: dict):
    """The tier-gated LLM branch both suggestion paths share: one
    temperature-0 call with the full group listing in the prompt, the answer
    validated against the fixed list — nothing tier-off, unreachable or
    off-list ever reaches the UI. Returns the suggestion dict or None."""
    haystack = "\n".join(
        str(part)
        for part in [body.get("title"), body.get("department"), *[
            i.get("position_description") for i in (body.get("items") or [])
            if isinstance(i, dict)
        ]]
        if part
    )
    if not haystack.strip() or not llm.tier_on():
        return None
    try:
        from ..commodity import COMMODITY_GROUPS

        listing = "\n".join(f"{g['id']}: {g['category']} / {g['name']}" for g in COMMODITY_GROUPS)
        answer = llm.parse_json_message(
            llm.chat(
                [
                    {"role": "system", "content": CLASSIFIER_PROMPT},
                    {
                        "role": "user",
                        "content": f"Commodity groups:\n{listing}\n\nRequest:\n{haystack}",
                    },
                ],
                temperature=0,
            )
        )
    except llm.LlmError:
        return None
    if answer:
        g = commodity(answer.get("id"))
        if g is not None:
            return {
                "id": g["id"],
                "category": g["category"],
                "name": g["name"],
                "source": "llm",
                "confidence": answer.get("confidence") if answer.get("confidence") in ("high", "medium", "low") else "low",
                "reasoning": str(answer.get("reasoning") or "")[:200] or "Classified by the language model.",
            }
    return None


def suggest_commodity(body: dict) -> dict:
    """Auto path (fires while typing) — the keyword scorer answers whenever it
    has anything, the LLM only fills the gap. Returns {suggestion, candidates}
    with suggestion=null when there is nothing to go on."""
    kw_suggestion, candidates = _keyword_suggestion(body)
    if kw_suggestion is not None:
        return {"suggestion": kw_suggestion, "candidates": candidates}
    return {"suggestion": _llm_classified(body), "candidates": []}


CONFIDENCE_RANK = {"high": 2, "medium": 1, "low": 0}


def resuggest_commodity(body: dict) -> dict:
    """The explicit re-run policy behind the "Suggest from my entries" button
    (POST /api/commodity/resuggest; the auto path above is untouched).

      - No group assigned → the keyword scorer rules when it carries at least
        medium confidence; otherwise the LLM's validated answer — and when
        neither yields anything better, the low-confidence keyword fallback is
        still better than an empty suggestion.
      - A group already assigned → the LLM is consulted (the keyword scorer
        steps in only when the tier yields nothing). The advice wins only when
        it names the SAME group or ranks strictly higher in confidence
        (high > medium > low; a manual or saved pick carries no confidence,
        the weakest standing) — otherwise the current choice is kept and the
        runner-up comes back in `declined` so the UI can say why nothing
        changed.

    The button click is the user's consent, so nothing here is silent: what
    replaces or keeps the previous choice is always visible."""
    raw_current = body.get("current_group_id")
    current = commodity(raw_current) if isinstance(raw_current, str) else None
    current_conf = body.get("current_confidence")
    if current_conf not in CONFIDENCE_RANK:
        current_conf = None
    kw, candidates = _keyword_suggestion(body)
    ai = _llm_classified(body)

    if current is None:
        if kw and kw["confidence"] in ("medium", "high"):
            return {"suggestion": kw, "candidates": candidates, "declined": None}
        if ai is not None:
            return {"suggestion": ai, "candidates": [], "declined": None}
        return {"suggestion": kw, "candidates": candidates if kw else [], "declined": None}

    kept = {"id": current["id"], "name": current["name"], "confidence": current_conf}
    advice = ai if ai is not None else kw
    if advice is not None:
        same = advice["id"] == current["id"]
        better = CONFIDENCE_RANK.get(advice["confidence"], 0) > CONFIDENCE_RANK.get(current_conf, 0)
        if same or better:
            return {"suggestion": advice, "candidates": []}
        return {
            "suggestion": None,
            "candidates": [],
            "declined": {"kept": kept, "alternative": advice},
        }
    return {"suggestion": None, "candidates": [], "declined": {"kept": kept, "alternative": None}}