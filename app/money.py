"""Exact money arithmetic — the Python twin of frontend/src/utils/money.js
(NUMERIC at the API boundary, never floats here). Amounts are handled as
integer cents end to end; `parse_money` ports the frontend parser 1:1 so the
two layers grade a document identically."""

import re

EUR_CHARS_RE = re.compile(r"[€\s]")
SIGN_OK_RE = re.compile(r"^[+-]?[\d.,]+$")
PLAIN_RE = re.compile(r"^\d*$")


def parse_money(input_) -> int | None:
    """Parse a money string ("€1,500.50", "1500,5", "1.500") into integer
    cents, or None. The separator heuristics are the frontend mirror's:
    mixed separators → the right-most one is the decimal point; a repeated
    separator or a 3-digit tail → thousands grouping; exactly one separator
    with a 1–2 digit tail → decimal."""
    if input_ is None or input_ == "":
        return None
    s = EUR_CHARS_RE.sub("", str(input_))
    if not SIGN_OK_RE.match(s):
        return None
    neg = s.startswith("-")
    s = s.replace("+", "").replace("-", "")
    dot_count = s.count(".")
    comma_count = s.count(",")

    if dot_count and comma_count:
        # Mixed: the right-most separator is decimal, the other groups thousands.
        dec = "." if s.rfind(".") > s.rfind(",") else ","
        th = "," if dec == "." else "."
        dec_e, th_e = re.escape(dec), re.escape(th)
        if not re.match(rf"^\d{{1,3}}(?:{th_e}\d{{3}})*{dec_e}\d{{1,2}}$", s):
            return None
        last = s.rfind(dec)
        int_part = s[:last].replace(th, "")
        frac = "" if last == len(s) - 1 else s[last + 1 :]
    elif dot_count or comma_count:
        sep = "." if dot_count else ","
        parts = s.split(sep)
        if len(parts) == 1:
            int_part, frac = parts[0], ""
        elif len(parts) > 2 or len(parts[-1]) == 3:
            # Repeated separators or a 3-digit tail → thousands grouping.
            int_part, frac = s.replace(sep, ""), ""
        else:
            # Exactly one separator with a 1–2 digit tail → decimal.
            int_part, frac = parts[0], parts[1]
    else:
        int_part, frac = s, ""

    if not PLAIN_RE.match(int_part) or not PLAIN_RE.match(frac):
        return None
    cents = int(int_part) * 100 + int(frac.ljust(2, "0")[:2])
    return -cents if neg else cents


def cents_to_decimal(cents: int) -> str:
    """Integer cents → decimal string "1500.00" (the NUMERIC storage unit)."""
    sign = "-" if cents < 0 else ""
    abs_ = abs(cents)
    return f"{sign}{abs_ // 100}.{abs_ % 100:02d}"


def decimal_to_cents(value) -> int:
    """NUMERIC currency amount → integer cents (exact — the storage format
    was written from cents in the first place)."""
    from decimal import Decimal

    return int((Decimal(str(value)) * 100).to_integral_value())