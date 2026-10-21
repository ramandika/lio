#!/usr/bin/env python3
"""
Generate scripts/sample-offer-adobe.pdf — the README sample vendor offer as a
real PDF — and print it as a base64 data URL for frontend/src/api/mock/samplePdf.js
(seed document for the demo workbench). Hand-rolled PDF 1.4: one page,
Helvetica/WinAnsiEncoding, xref offsets computed as we go.
"""
import base64

LINES = [
    ("Vendor Offer — Adobe Creative Cloud Subscription", "bold"),
    ("", None),
    ("Vendor Name: Adobe Systems", None),
    ("Umsatzsteuer-Identifikationsnummer (VAT ID): DE123456789", None),
    ("Offer Date: February 10, 2026", None),
    ("", None),
    ("Offered to: Creative Marketing Department", None),
    ("", None),
    ("Items Offered:", "bold"),
    ("", None),
    ("1. Product: Adobe Photoshop License", None),
    ("   Unit Price: €150", None),
    ("   Quantity: 10", None),
    ("   Total: €1500", None),
    ("", None),
    ("2. Product: Adobe Illustrator License", None),
    ("   Unit Price: €120", None),
    ("   Quantity: 5", None),
    ("   Total: €600", None),
    ("", None),
    ("Total Offer Cost: €2100", "bold"),
    ("", None),
    ("Terms and Conditions: Payment due within 30 days of invoice.", None),
]
# € is 0x80 in WinAnsiEncoding; — (em dash) is 0x97.
SUB = {"€": b"\x80", "—": b"\x97"}


def esc(text: str) -> bytes:
    out = bytearray()
    for ch in text:
        if ch in SUB:
            out += SUB[ch]
        elif ch in "()\\":
            out += b"\\" + ch.encode("ascii")
        elif ch.isascii():
            out += ch.encode("ascii")
        else:
            raise ValueError(f"unmapped char {ch!r}")
    return bytes(out)


def content_stream() -> bytes:
    parts = []
    for i, (text, style) in enumerate(LINES):
        y = 800 - i * 24
        font = "/F2" if style == "bold" else "/F1"
        size = "14" if style == "bold" else "11"
        parts.append(f"BT {font} {size} Tf 64 {y} Td ({esc(text).decode('latin-1')}) Tj ET\n")
    return "".join(parts).encode("latin-1")


def build() -> bytes:
    buf = bytearray(b"%PDF-1.4\n")
    offsets = {}

    def obj(num: int, body: bytes):
        offsets[num] = len(buf)
        buf.extend(f"{num} 0 obj\n".encode("ascii"))
        buf.extend(body)
        buf.extend(b"\nendobj\n")

    stream = content_stream()
    obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    obj(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    obj(
        3,
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    )
    obj(
        4,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    )
    obj(
        5,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    )
    offsets[6] = len(buf)
    buf.extend(b"6 0 obj\n")
    buf.extend(f"<< /Length {len(stream)} >>\nstream\n".encode("ascii"))
    buf.extend(stream)
    buf.extend(b"endstream\nendobj\n")

    xref_at = len(buf)
    buf.extend(f"xref\n0 7\n".encode("ascii"))
    buf.extend(b"0000000000 65535 f \n")
    for n in range(1, 7):
        buf.extend(f"{offsets[n]:010d} 00000 n \n".encode("ascii"))
    buf.extend(
        b"trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n"
        + f"{xref_at}\n%%EOF\n".encode("ascii")
    )
    return bytes(buf)


if __name__ == "__main__":
    pdf = build()
    with open(__file__.replace("make_sample_offer_pdf.py", "sample-offer-adobe.pdf"), "wb") as f:
        f.write(pdf)
    b64 = base64.b64encode(pdf).decode("ascii")
    print(f"pdf bytes: {len(pdf)}, base64: {len(b64)}")
    print("data URL head:", f"data:application/pdf;base64,{b64[:60]}…")