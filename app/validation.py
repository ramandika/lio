"""Validation at the API boundary (CLAUDE.md architecture decision): only
valid requests persist. This is the inline-UX mirror in
frontend/src/validation.js — the same rules, same messages, same error-shape
(`{errors: {field: message}}` → 422) so the swap needs no view changes. The
backend copy is the truth; the frontend copy only produces the same inline
errors faster."""

import math
import re

from .commodity import commodity

VAT_RE = re.compile(r"^DE[0-9]{9}$")

VAT_MESSAGE = "VAT ID must match the DE123456789 format."


def _is_finite(v) -> bool:
    """The frontend mirror's Number.isFinite: real numbers only — nulls,
    strings and NaN are out (bools are ints in Python; JSON never sends
    one here, but a `true` must not count as 1)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return math.isfinite(v)


def _is_integer(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) or (
        isinstance(v, float) and v.is_integer()
    )


def validate_request_payload(p: dict) -> dict[str, str]:
    errors: dict[str, str] = {}

    def err(field: str, msg: str) -> None:
        errors.setdefault(field, msg)

    def req(field: str, msg: str = "Required.") -> None:
        v = p.get(field)
        if v is None or str(v).strip() == "":
            err(field, msg)

    req("requestor_name")
    req("title")
    req("vendor_name")
    req("department")
    req("vendor_vat_id", VAT_MESSAGE)
    if p.get("vendor_vat_id") is not None and str(p["vendor_vat_id"]).strip():
        if not VAT_RE.match(str(p["vendor_vat_id"]).strip()):
            err("vendor_vat_id", VAT_MESSAGE)

    lines = p.get("order_lines") if isinstance(p.get("order_lines"), list) else []
    if not lines:
        err("order_lines", "At least one order line is required.")
    sum_ = 0
    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            line = {}
        desc = line.get("position_description")
        if desc is None or not str(desc).strip():
            err(f"order_lines.{i}.position_description", "Description required.")
        unit = line.get("unit")
        if unit is None or not str(unit).strip():
            err(f"order_lines.{i}.unit", "Unit required.")
        if not _is_finite(line.get("unit_price")) or line["unit_price"] <= 0:
            err(f"order_lines.{i}.unit_price", "Unit price must be greater than 0.")
        if not _is_integer(line.get("amount")) or line["amount"] <= 0:
            err(f"order_lines.{i}.amount", "Amount must be a whole number greater than 0.")
        if not _is_finite(line.get("total_price")):
            err(f"order_lines.{i}.total_price", "Line total required.")
        elif (
            _is_finite(line.get("unit_price"))
            and _is_integer(line.get("amount"))
            and line["unit_price"] > 0
            and line["amount"] > 0
            and line["total_price"] != line["unit_price"] * line["amount"]
        ):
            err(f"order_lines.{i}.total_price", "Line total must equal unit price × amount.")
        if _is_finite(line.get("total_price")):
            sum_ += line["total_price"]

    if not _is_finite(p.get("total_cost")):
        err("total_cost", "Total cost required.")
    else:
        lines = p.get("order_lines") if isinstance(p.get("order_lines"), list) else []
        if lines and all(_is_finite(l.get("total_price")) for l in lines):
            if p["total_cost"] != sum_:
                err("total_cost", "Total cost must equal the sum of the line totals.")

    if p.get("commodity_group_id") is not None and commodity(p["commodity_group_id"]) is None:
        err("commodity_group_id", "Unknown commodity group.")

    return errors


# The documented chain (CLAUDE.md): Open → In Progress → Closed.
STATUS_TRANSITIONS = {"Open": ["In Progress"], "In Progress": ["Closed"], "Closed": []}


def transition_problem(old_status: str, new_status: str) -> str | None:
    """None when allowed; otherwise the actionable refusal — which statuses
    the request may still reach (none from Closed, where the chain ends)."""
    if new_status not in STATUS_TRANSITIONS:
        return f"Unknown status “{new_status}”."
    allowed = STATUS_TRANSITIONS.get(old_status, [])
    if new_status in allowed:
        return None
    may = (
        "it may only move to " + ", ".join(f"“{s}”" for s in allowed)
        if allowed
        else "it has reached the end of the chain and can no longer move"
    )
    return (
        f"A request in “{old_status}” cannot move to “{new_status}” — {may}"
        " (requests follow Open → In Progress → Closed)."
    )