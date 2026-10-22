"""Offer extraction — the two-layer composite (CLAUDE.md architecture decision,
PROJECT_PLAN.md WS2):

    L1  PyMuPDF text extraction + deterministic label/line parsing +
        validation (line math, VAT format, required fields) — zero LLM
        calls, in-process, milliseconds.
    L2  llm_ocr_fuse (the benchmark's verified-best input mode) — one
        multimodal message (page-marked text + rendered page images),
        temperature 0, structured JSON answer, ≤2 value-level re-prompts
        on arithmetic failures, fail-soft.

The trigger is validation-based, not confidence-scored: L2 runs only when
L1's validation fails. Both layers feed the same validators — the LLM's
answer is a suggestion re-checked by the same rules; whatever still fails
stays blank for manual entry."""

import base64
import re
import time

import fitz  # PyMuPDF

from .. import config
from ..money import parse_money
from . import llm

VAT_RE = re.compile(r"^DE[0-9]{9}$")

# --- PDF reading (PyMuPDF — the text/image layer of L1) ----------------------


def pdf_to_text(data: bytes) -> str:
    """Page-marked reading-order text, like the benchmark's per-page text:
    the L1 parsers are line-based and simply skip the marker lines; the L2
    fuse reads the page structure from them."""
    doc = fitz.open(stream=data, filetype="pdf")
    parts = []
    for page in doc:
        text = page.get_text("text").rstrip()
        parts.append(f"--- page {page.number + 1} ---\n{text}")
    doc.close()
    return "\n\n".join(parts)


def pdf_page_images(data: bytes, max_width: float = 1000) -> list[str]:
    """Render each page to a PNG data URI at reading resolution — the image
    half of the llm_ocr_fuse input. Raster scale capped to bound memory;
    pages that render are returned in order. A failing rendering path just
    yields what it has (the fuse then reads text only)."""
    uris = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        for page in doc:
            base_width = page.rect.width or 1
            scale = min(max_width / base_width, 3)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            png = pix.tobytes("png")
            uris.append("data:image/png;base64," + base64.b64encode(png).decode())
        doc.close()
    except Exception:
        pass
    return uris


# --- L1: strict label parsing -------------------------------------------------

FIELD_LABELS = {
    "vendor_name": re.compile(r"vendor(?:'s)?\s*name\s*:\s*(.+)", re.I),
    "vendor_vat_id": re.compile(
        r"umsatzsteuer[- ]?identifikationsnummer(?:\s*\(vat id\))?\s*:\s*([a-z]{2}[0-9]{8,15})", re.I
    ),
    "department": re.compile(r"offered\s*to\s*:\s*(.+)", re.I),
}


def _clean(value: str) -> str:
    return re.sub(r"[.,;]+$", "", value.strip())


def _parse_field(text: str, key: str) -> str | None:
    m = FIELD_LABELS[key].search(text)
    return _clean(m.group(1)) if m else None


def _parse_lines_strict(text: str) -> list[dict]:
    # README offer shape: numbered "Product:"/labels under "Items Offered:".
    parts = re.split(r"items\s*offered\s*:|positions?\s*:", text, flags=re.I)
    scope = "\n".join(parts[1:]) if len(parts) > 1 else text
    items: list[dict] = []
    current: dict | None = None
    for raw in scope.splitlines():
        line = raw.strip()
        if not line:
            continue
        product = re.match(r"^(?:\d+[.)]\s*)?product\s*:\s*(.+)$", line, re.I)
        if product:
            current = {"fields": {"position_description": _clean(product.group(1))}}
            items.append(current)
            continue
        if current is None:
            continue
        price = re.match(r"^(?:unit\s*price|price)\s*:\s*([\d.,\s€]+)$", line, re.I)
        qty = re.match(r"^(?:quantity|amount|qty)\s*:\s*([\d.,\s]+)$", line, re.I)
        total = re.match(r"^(?:total(?:\s*price)?)\s*:\s*([\d.,\s€]+)$", line, re.I)
        if price:
            current["fields"]["unit_price"] = price.group(1).strip()
        elif qty:
            current["fields"]["amount"] = qty.group(1).strip()
        elif total:
            current["fields"]["total_price"] = total.group(1).strip()
    return [it["fields"] for it in items if it["fields"]]


def _normalize_line(raw: dict) -> dict:
    digits = re.sub(r"[^\d]", "", str(raw["amount"])) if raw.get("amount") is not None else ""
    return {
        "position_description": raw.get("position_description"),
        "unit_price": parse_money(raw["unit_price"]) if raw.get("unit_price") is not None else None,
        "amount": int(digits) if digits else None,
        "total_price": parse_money(raw["total_price"]) if raw.get("total_price") is not None else None,
    }


def parse_offer(text: str) -> dict:
    out: dict = {}
    for key in ("vendor_name", "vendor_vat_id", "department"):
        v = _parse_field(text, key)
        if v is not None:
            out[key] = v
    m = re.search(r"total\s*(?:offer\s*)?cost\s*:\s*([\d.,\s€]+)", text, re.I)
    if m:
        out["total_cost"] = parse_money(m.group(1))
    out["order_lines"] = [_normalize_line(raw) for raw in _parse_lines_strict(text)]
    return out


# --- validation shared by both layers ----------------------------------------


def validate_extraction(fields: dict) -> set[str]:
    problems: set[str] = set()
    for key in ("vendor_name", "vendor_vat_id", "total_cost"):
        if fields.get(key) in (None, ""):
            problems.add(f"field:{key}")
    if fields.get("vendor_vat_id") and not VAT_RE.match(fields["vendor_vat_id"]):
        problems.add("format:vendor_vat_id")
    lines = fields.get("order_lines") or []
    if not lines:
        problems.add("field:order_lines")
    for i, line in enumerate(lines):
        if line.get("unit_price") is None or line.get("total_price") is None or line.get("amount") is None:
            problems.add(f"line:{i}")
        elif line["unit_price"] * line["amount"] != line["total_price"]:
            problems.add(f"line:{i}:math")
    if (
        fields.get("total_cost") is not None
        and lines
        and all(l.get("total_price") is not None for l in lines)
        and sum(l["total_price"] for l in lines) != fields["total_cost"]
    ):
        problems.add("total_cost")
    return problems


def detect_map(fields: dict) -> dict:
    ok = lambda v: v is not None and v != ""  # noqa: E731
    lines = fields.get("order_lines") or []
    return {
        "vendor_name": ok(fields.get("vendor_name")),
        "vendor_vat_id": ok(fields.get("vendor_vat_id")),
        "department": ok(fields.get("department")),
        "total_cost": fields.get("total_cost") is not None,
        "order_lines": bool(lines)
        and all(
            l.get("unit_price") is not None and l.get("amount") is not None and l.get("total_price") is not None
            for l in lines
        ),
    }


# --- L2 — llm_ocr_fuse (benchmark-verified input mode) ------------------------
# One multimodal user message carries the per-page text ('--- page N ---')
# plus, when pages could be rendered, the page images themselves; the model
# answers one JSON object (temperature 0) parsed defensively, mapped onto the
# extraction contract and re-checked by the SAME validators L1 feeds.
# Value-level (arithmetic) failures re-prompt at most twice — first attempt +
# 2 re-prompts, keeping the attempt with the fewest arithmetic errors — and
# the whole flow fails soft: an unreachable/disabled tier never crashes the
# extraction; the caller degrades to manual entry.

BELOW_THRESHOLD = 60  # self-confidence below this makes a field suspect

MAX_RETRIES = 2  # first attempt + at most 2 re-prompts (the benchmark's MAX_RETRIES)

SYSTEM_PROMPT = """You extract structured data from vendor offer documents into one JSON object, keyed exactly:
vendor_name, vendor_vat_id, department, order_lines (array of objects with position_description, unit_price, amount, unit, total_price), total_cost, missing_fields (array of the key names you could not find), confidences (map of extracted key → integer 0-100).

Rules:
1. Copy every value EXACTLY as it appears in the document. Never infer, compute or guess.
2. If a field is not present, set it to null AND list the key name in missing_fields. Example: no grand total in the document → "total_cost": null and "total_cost" in missing_fields. Reporting absence matters as much as extracting values — an absent field must NEVER be invented.
3. unit is the per-line unit of measure as the document states it (pieces, licenses, hours, …), or null when absent. Amounts are whole numbers.
4. Numbers are plain JSON numbers: no currency symbols (€/EUR), no thousands separators.
5. order_lines holds only the lines the document really shows, in document order — never invent one.
6. The document may use German or English labels. Common ones: Lieferant/Supplier/Vendor → vendor_name; USt.-IdNr./USt-IdNr./VAT ID/Umsatzsteuer-Identifikationsnummer → vendor_vat_id; Angeboten für/Offered to/Attention/Prepared for/Customer/Department → department; Position/Produkt/Item/Article → position_description; Menge/Anzahl/Qty/Quantity → amount; Einheit/Unit → unit; Einzelpreis/Unit price/Price → unit_price; Gesamtpreis/Line total/Amount/Total → total_price; Gesamtbetrag/Endsumme/Grand total/Total cost → total_cost.
7. Line totals are usually NET (before VAT), while a grand total may be GROSS (incl. MwSt./VAT — Gesamtsumme, Endbetrag, Grand total). total_cost is the display sum BEFORE tax — the label it names (e.g. Zwischensumme, Subtotal, Netto, Net), never a computed or gross figure, so that total_cost equals the sum of the order_lines' total_price. Pick the displayed total that makes that equality hold:
   - A before-tax sum is shown (Zwischensumme/Subtotal/Netto/…) → total_cost = that figure; never the Gesamtsumme that adds VAT or other levies (Urheberrechtsabgabe, recycling fees, …).
   - The document states only tax-inclusive prices ("Preis inkl. MwSt.", "Prices include applicable taxes", no separate before-tax sum) and its grand total equals the sum of the line totals → total_cost = that grand total.
   - Neither displayed total equals the sum of the line totals → total_cost = the before-tax figure when one is shown, else the grand total as displayed; flag the discrepancy by keeping correct arithmetic in order_lines and putting nothing extra in missing_fields.
Respond with the JSON object only."""

USER_PREAMBLE = (
    "Below is the vendor offer document as reconstructed text ('--- page N ---' markers separate pages)"
    " followed by the rendered page images, where available. Use BOTH: the text for a precise reading,"
    " the images whenever the text is ambiguous, broken or incomplete. Extract exactly what the document shows.\n\n"
)

EXTRACTION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "vendor_name": {"type": ["string", "null"]},
        "vendor_vat_id": {"type": ["string", "null"]},
        "department": {"type": ["string", "null"]},
        "order_lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "position_description": {"type": ["string", "null"]},
                    "unit_price": {"type": ["number", "null"]},
                    "amount": {"type": ["integer", "null"]},
                    "unit": {"type": ["string", "null"]},
                    "total_price": {"type": ["number", "null"]},
                },
                "required": ["position_description", "unit_price", "amount", "unit", "total_price"],
                "additionalProperties": False,
            },
        },
        "total_cost": {"type": ["number", "null"]},
        "missing_fields": {"type": "array", "items": {"type": "string"}},
        "confidences": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": {"type": "integer"},
        },
    },
    "required": ["vendor_name", "vendor_vat_id", "department", "order_lines", "total_cost", "missing_fields", "confidences"],
    "additionalProperties": False,
}

SCALAR_ALIASES = {
    "vendor_name": ["vendor_name", "vendor", "supplier", "company"],
    "vendor_vat_id": ["vendor_vat_id", "vat_id", "vat_number", "vat", "ust_id", "vatin"],
    "department": ["department", "customer", "offered_to", "attention", "client"],
    "total_cost": ["total_cost", "grand_total", "total", "total_amount"],
}

LINE_ALIASES = {
    "position_description": ["position_description", "description", "product", "item", "article"],
    "unit_price": ["unit_price", "price_per_unit", "price", "unit_cost"],
    "amount": ["amount", "quantity", "qty"],
    "unit": ["unit", "unit_of_measure", "uom"],
    "total_price": ["total_price", "line_total", "line_amount", "amount_total", "subtotal"],
}

CONFIDENCE_ALIASES = {
    "vendor_name": SCALAR_ALIASES["vendor_name"],
    "vendor_vat_id": SCALAR_ALIASES["vendor_vat_id"],
    "department": SCALAR_ALIASES["department"],
    "total_cost": SCALAR_ALIASES["total_cost"],
    "order_lines": ["order_lines", "line_items", "lines", "items"],
}


def _pick(raw: dict, aliases: list[str]):
    for key in aliases:
        v = raw.get(key)
        if v is not None and v != "":
            return v
    return None


def _to_str(v) -> str | None:
    """Scalar → string, exactly like the mirror's toStr: a whole number keeps
    its integer spelling (String(5) === "5"); booleans and everything else
    that is not text read as nothing."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s or None


def _to_money(v) -> int | None:
    """Scalar → cents: plain numbers ×100, money-ish strings via parse_money."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return round(v * 100)
    s = _to_str(v)
    if s is None:
        return None
    # Currency words/symbols ride along in some answers — strip to the figure.
    figure = re.sub(r"[a-zA-Z]", "", s).strip()
    cents = parse_money(figure)
    return cents if (cents is not None and cents > 0) else None


def _to_amount(v) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = round(v)
        return n if n > 0 else None
    s = _to_str(v)
    if s is None:
        return None
    cleaned = re.sub(r"[^\d.,-]", "", s).replace(",", ".")
    try:
        n = round(float(cleaned))
    except ValueError:
        return None
    return n if n > 0 else None


def _to_vat_id(v) -> str | None:
    """VAT ids tolerate spacing/punctuation in the answer; the format gate
    in validate_extraction still applies."""
    s = _to_str(v)
    return re.sub(r"[\s.:/-]", "", s.upper()) if s else None


def _map_line(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    line = {
        "position_description": _to_str(_pick(raw, LINE_ALIASES["position_description"])),
        "unit_price": _to_money(_pick(raw, LINE_ALIASES["unit_price"])),
        "amount": _to_amount(_pick(raw, LINE_ALIASES["amount"])),
        "unit": _to_str(_pick(raw, LINE_ALIASES["unit"])),
        "total_price": _to_money(_pick(raw, LINE_ALIASES["total_price"])),
    }
    # A line with nothing but a name is still a finding the validators grade.
    if line["position_description"] or line["unit_price"] is not None or line["total_price"] is not None:
        return line
    return None


def _map_payload(parsed: dict) -> dict:
    fields = {
        "vendor_name": _to_str(_pick(parsed, SCALAR_ALIASES["vendor_name"])),
        "vendor_vat_id": _to_vat_id(_pick(parsed, SCALAR_ALIASES["vendor_vat_id"])),
        "department": _to_str(_pick(parsed, SCALAR_ALIASES["department"])),
        "total_cost": _to_money(_pick(parsed, SCALAR_ALIASES["total_cost"])),
    }
    lines = parsed.get("order_lines") if isinstance(parsed.get("order_lines"), list) else (
        parsed.get("line_items") if isinstance(parsed.get("line_items"), list) else []
    )
    fields["order_lines"] = [line for l in lines if (line := _map_line(l)) is not None]
    return fields


def _map_confidences(parsed: dict) -> dict:
    """The model's per-field self-confidence (0–100, top-level fields only).
    Only keys the model actually scored come through — an unscored field is
    not treated as low, so the UI never invents uncertainty."""
    raw = None
    for key in ("confidences", "confidence", "confidence_scores", "field_confidences"):
        v = parsed.get(key)
        if isinstance(v, dict):
            raw = v
            break
    out: dict[str, int] = {}
    if not raw:
        return out
    for key, aliases in CONFIDENCE_ALIASES.items():
        v = _pick(raw, aliases)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[key] = max(0, min(100, round(v)))
    return out


def _arithmetic_problems(fields: dict) -> list[str]:
    """Value-level problems ONLY (the re-prompt decision): a line's total must
    equal unit_price × amount and the grand total must equal the sum of the
    line totals. Everything else (missing fields etc.) is honest absence —
    graded by validate_extraction, never re-asked."""
    problems: list[str] = []
    lines = fields.get("order_lines") or []
    for i, line in enumerate(lines):
        if line.get("unit_price") is None or line.get("amount") is None:
            continue
        if line.get("total_price") is not None and line["total_price"] != line["unit_price"] * line["amount"]:
            problems.append(
                f"- line {i + 1}: total_price ({line['total_price']}) does not equal unit_price × amount"
            )
    with_totals = [l for l in lines if l.get("total_price") is not None]
    if fields.get("total_cost") is not None and with_totals and len(with_totals) == len(lines):
        total = sum(l["total_price"] for l in with_totals)
        if total != fields["total_cost"]:
            problems.append(
                f"- total_cost ({fields['total_cost']}) does not equal the sum of the line totals ({total})"
            )
    return problems


def _build_messages(text: str, images: list[str], feedback: str | None) -> list:
    user_text = USER_PREAMBLE + text
    if feedback:
        user_text += "\n\n[Validation feedback on your previous answer]\n" + feedback
    parts: list[dict] = [{"type": "text", "text": user_text}]
    for uri in images:
        if isinstance(uri, str) and uri:
            parts.append({"type": "image_url", "image_url": {"url": uri}})
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": parts},
    ]


def extract_offer_fuse(text: str, images: list[str] | None = None) -> dict:
    """The fused L2 pass. Returns {ok: True, fields, confidences, meta} on a
    usable answer — fields mapped onto the extraction contract (money in
    cents), meta the attempt statistics — or {ok: False, reason}. Never
    raises: an unreachable endpoint keeps the best attempt if one exists and
    otherwise degrades with its reason."""
    started = time.monotonic()
    images = images or []
    meta: dict = {"model": config.LLM_MODEL, "attempts": 0, "n_retries": 0, "tokens": None}

    best: dict | None = None  # {"arith": int, "fields": …, "confidences": …}
    feedback: str | None = None
    unreachable: str | None = None

    for attempt in range(MAX_RETRIES + 1):
        meta["attempts"] = attempt + 1
        try:
            body = llm.chat(
                _build_messages(text, images, feedback),
                temperature=0,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "offer_extraction",
                        "strict": True,
                        "schema": EXTRACTION_JSON_SCHEMA,
                    },
                },
            )
            parsed = llm.parse_json_message(body)
        except llm.LlmError as err:
            unreachable = err.reason
            break
        if not parsed:
            feedback = "Your previous response was not usable JSON. Respond with the JSON object only."
            continue
        meta["tokens"] = (body.get("usage") or {}).get("total_tokens", meta["tokens"])

        fields = _map_payload(parsed)
        confidences = _map_confidences(parsed)
        arith = _arithmetic_problems(fields)
        if best is None or len(arith) < best["arith"]:
            best = {"arith": len(arith), "fields": fields, "confidences": confidences}
        if not arith:
            break
        feedback = (
            "These checks against the extracted data failed:\n"
            + "\n".join(arith)
            + "\nRe-read the document, fix ONLY these problems (do not change anything else),"
            " and respond with the full corrected JSON object."
        )

    if best is None:
        if unreachable is not None:
            return {"ok": False, "reason": unreachable}
        return {"ok": False, "reason": "the model returned no usable JSON in any attempt"}

    meta["n_retries"] = max(0, meta["attempts"] - 1)
    meta["wall_time"] = round((time.monotonic() - started) / 0.1) / 10.0
    return {"ok": True, "fields": best["fields"], "confidences": best["confidences"], "meta": meta}


# --- entry point ----------------------------------------------------------------


def extract_offer(content: str, images: list[str] | None = None) -> dict:
    """Two-layer composite over document text — the shape the POST
    /extraction contract documents: {layer, fields, detected, problems,
    confidences, low_confidence, llm}, prices/totals integer cents.
    `layer: None` means the document was not readable, or the LLM tier was
    off/unreachable for a document L1 cannot parse; `detail` then carries
    the manual-entry degradation message the UI shows."""
    raw_text = str(content or "")
    if "\x00" in raw_text or re.search(r"%PDF-\d", raw_text):
        # Binary content reaching the text path: the document could not be
        # read as text (the router reads PDFs with PyMuPDF before this runs).
        return {
            "layer": None,
            "unreadable": True,
            "fields": None,
            "detected": {},
            "problems": ["unreadable"],
            "detail": "The document could not be read as text. Please enter the details manually.",
        }

    l1 = parse_offer(raw_text)
    l1_problems = validate_extraction(l1)
    if not l1_problems:
        # Deterministic parse: no self-confidence attached — the yellow
        # low-confidence mark is an LLM-extraction-only concept.
        return {"layer": "L1", "fields": l1, "detected": detect_map(l1), "problems": [], "low_confidence": []}

    # L2 — triggered only when L1 validation fails (validation-based gate).
    # The LLM tier decides between the fuse and the documented
    # manual-entry degradation.
    if not llm.tier_on():
        return {
            "layer": None,
            "unavailable": True,
            "fields": None,
            "detected": {},
            "problems": sorted(l1_problems),
            "detail": "AI extraction is switched off in this environment — enter the details manually.",
        }

    fused = extract_offer_fuse(raw_text, images)
    if not fused["ok"]:
        return {
            "layer": None,
            "unavailable": True,
            "fields": None,
            "detected": {},
            "problems": sorted(l1_problems),
            "detail": f"The LLM extraction failed ({fused['reason']}) — enter the details manually.",
        }

    l2 = fused["fields"]
    # LLM output is a suggestion re-checked by the same validators; whatever
    # still fails is reported as "not detected" for manual entry.
    confidences = fused["confidences"] or {}
    present = detect_map(l2)
    low = [key for key, score in confidences.items() if present.get(key) and score < BELOW_THRESHOLD]
    return {
        "layer": "L2",
        "fields": l2,
        "detected": present,
        "problems": sorted(validate_extraction(l2)),
        "confidences": confidences,
        "low_confidence": low,
        "llm": fused["meta"],
    }