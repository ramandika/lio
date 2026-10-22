"""Request-boundary tests (TESTING.md, WS1/WS4/WS3 at the API): validation
rules, role scoping, append-only status history, edit lock, document
scoping, L1 extraction and the commodity suggestion — all offline (LLM tier
off: no key in the test env)."""

import base64
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config
from app.db import connect
from app.main import app

SAMPLE_PDF = Path(__file__).resolve().parent.parent / "scripts" / "sample-offer-adobe.pdf"


def clear_tables() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM request_lines")
        conn.execute("DELETE FROM status_history")
        conn.execute("DELETE FROM requests")
        conn.execute("DELETE FROM documents")


def clear_uploads() -> None:
    shutil.rmtree(config.UPLOADS_DIR, ignore_errors=True)


@pytest.fixture()
def client():
    # Entering the client runs lifespan → schema init + account seeding (and
    # the demo-request seed) — the tables are cleared AFTER that, so every
    # test starts from an empty request set.
    with TestClient(app) as c:
        clear_tables()
        clear_uploads()
        yield c
        clear_tables()
        clear_uploads()


def login(c: TestClient, email: str, password: str = "demo"):
    return c.post("/api/auth/login", json={"email": email, "password": password})


def as_user(c: TestClient, email: str):
    res = login(c, email)
    assert res.status_code == 200, res.text


def valid_request(**overrides):
    payload = {
        "requestor_name": "Ana Weber",
        "title": "Adobe Creative Cloud Subscription",
        "vendor_name": "Adobe Systems",
        "vendor_vat_id": "DE123456789",
        "department": "Creative Marketing",
        "commodity_group_id": "031",
        "total_cost": 210000,
        "order_lines": [
            {
                "position_description": "Adobe Photoshop License",
                "unit_price": 15000,
                "amount": 10,
                "unit": "licenses",
                "total_price": 150000,
            },
            {
                "position_description": "Adobe Illustrator License",
                "unit_price": 12000,
                "amount": 5,
                "unit": "licenses",
                "total_price": 60000,
            },
        ],
    }
    payload.update(overrides)
    return payload


# --- intake validation (only valid requests persist) -------------------------


def test_create_request_persists_lines_and_history(client):
    as_user(client, "ana@example.com")
    res = client.post("/api/requests", json=valid_request())
    assert res.status_code == 200, res.text
    body = res.json()["request"]
    assert body["status"] == "Open"
    assert body["total_cost"] == 210000  # integer cents
    assert len(body["order_lines"]) == 2
    assert body["order_lines"][0]["position"] == 1
    assert body["commodity_group"]["name"] == "Software"

    got = client.get(f"/api/requests/{body['id']}").json()
    history = got["status_history"]
    assert len(history) == 1
    assert history[0]["old_status"] is None
    assert history[0]["new_status"] == "Open"
    assert history[0]["changed_by"] == "Ana Weber"


@pytest.mark.parametrize(
    "field, key",
    [
        (valid_request(vendor_vat_id="NL123456789"), "vendor_vat_id"),
        (valid_request(total_cost=999999), "total_cost"),
        (valid_request(commodity_group_id="999"), "commodity_group_id"),
        (valid_request(order_lines=[{**valid_request()["order_lines"][0], "total_price": 1}]), "order_lines.0.total_price"),
        (valid_request(order_lines=[]), "order_lines"),
        ({**valid_request(), "vendor_name": ""}, "vendor_name"),
        ({**valid_request(), "order_lines": [{**valid_request()["order_lines"][0], "amount": 2.5}]}, "order_lines.0.amount"),
    ],
)
def test_invalid_payloads_rejected_422(client, field, key):
    as_user(client, "ana@example.com")
    res = client.post("/api/requests", json=field)
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert key in errors
    assert client.get("/api/requests").json()["requests"] == []  # nothing persisted


# --- role scoping -------------------------------------------------------------


def test_requestor_scoping_and_404_disguise(client):
    as_user(client, "kim@example.com")  # procurement files one
    request_id = client.post("/api/requests", json=valid_request()).json()["request"]["id"]

    as_user(client, "ana@example.com")  # a requestor reaches only her own
    assert client.get("/api/requests").json()["requests"] == []
    response = client.get(f"/api/requests/{request_id}")
    assert response.status_code == 404  # never confirm foreign data
    assert client.put(f"/api/requests/{request_id}", json=valid_request()).status_code == 404

    as_user(client, "tom@example.com")  # procurement sees all
    assert len(client.get("/api/requests").json()["requests"]) == 1


# --- edit lock + status trail ---------------------------------------------------


def test_edit_only_while_open(client):
    as_user(client, "ana@example.com")
    request_id = client.post("/api/requests", json=valid_request()).json()["request"]["id"]
    edited = valid_request(title="Adobe CC Renewal 2027")
    res = client.put(f"/api/requests/{request_id}", json=edited)
    assert res.status_code == 200
    assert res.json()["request"]["title"] == "Adobe CC Renewal 2027"

    as_user(client, "kim@example.com")
    res = client.post(
        f"/api/requests/{request_id}/status",
        json={"new_status": "In Progress", "comment": "ok"},
    )
    assert res.status_code == 200

    as_user(client, "ana@example.com")
    res = client.put(f"/api/requests/{request_id}", json=edited)
    assert res.status_code == 409
    assert "Open" in res.json()["detail"]


def test_status_chain_and_history_append_only(client):
    as_user(client, "ana@example.com")
    request_id = client.post("/api/requests", json=valid_request()).json()["request"]["id"]

    as_user(client, "ana@example.com")  # requestors cannot move status
    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "In Progress"})
    assert res.status_code == 403

    as_user(client, "kim@example.com")
    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "Closed"})
    assert res.status_code == 422
    detail = res.json()["detail"]  # the refusal shape is a flattened string
    assert 'a request in "open"' not in detail.lower()
    assert "In Progress" in detail  # the actionable refusal names the allowed step

    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "In Progress"})
    assert res.status_code == 200
    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "Closed", "comment": "done"})
    assert res.status_code == 200
    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "In Progress"})
    assert res.status_code == 422  # Closed is terminal

    history = client.get(f"/api/requests/{request_id}").json()["status_history"]
    assert [(h["old_status"], h["new_status"]) for h in history] == [
        (None, "Open"),
        ("Open", "In Progress"),
        ("In Progress", "Closed"),
    ]
    assert history[-1]["changed_by"] == "Kim Schneider"
    assert history[-1]["comment"] == "done"


def test_unknown_status_rejected(client):
    as_user(client, "kim@example.com")
    res = client.post(f"/api/requests/{'00000000-0000-4000-8000-000000000000'}/status", json={"new_status": "Approved"})
    assert res.status_code == 404  # unknown id reads as not found, not 500
    as_user(client, "ana@example.com")
    request_id = client.post("/api/requests", json=valid_request()).json()["request"]["id"]
    as_user(client, "kim@example.com")
    res = client.post(f"/api/requests/{request_id}/status", json={"new_status": "Approved"})
    assert res.status_code == 422
    assert res.json()["detail"].startswith("Unknown status")


# --- documents: uploads-volume boundary ----------------------------------------


def test_document_scoping_and_request_attachment(client):
    as_user(client, "tom@example.com")  # procurement uploads
    doc = client.post(
        "/api/extraction",
        files={"file": ("offer.txt", valid_request_text().encode(), "text/plain")},
    ).json()
    assert doc["ok"] is True and doc["layer"] == "L1"
    document_id = doc["document_id"]
    assert document_id

    as_user(client, "ana@example.com")  # another user's upload is invisible
    assert client.get(f"/api/documents/{document_id}").status_code == 404
    source = {"filename": "offer.txt", "layer": "L1", "document_id": document_id, "detected": {}}
    res = client.post("/api/requests", json=valid_request(source=source))
    assert res.status_code == 403  # a request cannot carry a foreign upload

    # Tom's own upload: readable, attachable, and procurement can read it.
    as_user(client, "tom@example.com")
    res = client.post("/api/requests", json=valid_request(source=source))
    assert res.status_code == 200
    got = res.json()["request"]
    assert got["document"]["id"] == document_id
    assert got["source"]["document_id"] == document_id
    assert client.get(f"/api/documents/{document_id}").status_code == 200

    as_user(client, "kim@example.com")
    assert client.get(f"/api/documents/{document_id}").status_code == 200


def valid_request_text():
    return "\n".join(
        [
            "Vendor's name: Adobe Systems",
            "Umsatzsteuer-Identifikationsnummer (VAT ID): DE123456789",
            "Offered to: Creative Marketing",
            "Items offered:",
            "1) Product: Adobe Photoshop License",
            "   Unit price: 150.00",
            "   Quantity: 10",
            "   Total: 1500.00",
            "2) Product: Adobe Illustrator License",
            "   Unit price: 120.00",
            "   Quantity: 5",
            "   Total: 600.00",
            "Total offer cost: 2,100.00",
        ]
    )


# --- extraction: L1 with zero LLM calls (tier off in tests) ---------------------


def test_extraction_l1_readme_shape(client):
    as_user(client, "ana@example.com")
    res = client.post(
        "/api/extraction",
        files={"file": ("offer.txt", valid_request_text().encode(), "text/plain")},
    )
    body = res.json()
    assert res.status_code == 200
    assert body["ok"] is True
    assert body["layer"] == "L1"
    assert body["fields"]["vendor_name"] == "Adobe Systems"
    assert body["fields"]["vendor_vat_id"] == "DE123456789"
    assert body["fields"]["department"] == "Creative Marketing"
    assert body["fields"]["total_cost"] == 210000
    assert [l["position_description"] for l in body["fields"]["order_lines"]] == [
        "Adobe Photoshop License",
        "Adobe Illustrator License",
    ]
    assert body["detected"] == {
        "vendor_name": True,
        "vendor_vat_id": True,
        "department": True,
        "order_lines": True,
        "total_cost": True,
    }
    assert body["low_confidence"] == []
    # suggestion rides in (WS3: zero manual steps)
    assert body["commodity_suggestion"]["id"] == "031"


def test_extraction_upload_pdf_fixture(client):
    if not SAMPLE_PDF.is_file():
        pytest.skip("scripts/sample-offer-adobe.pdf missing")
    as_user(client, "ana@example.com")
    data = SAMPLE_PDF.read_bytes()
    res = client.post(
        "/api/extraction",
        files={"file": ("sample-offer-adobe.pdf", data, "application/pdf")},
    )
    body = res.json()
    assert res.status_code == 200
    assert body["ok"] is True
    assert body["layer"] == "L1"
    # The stored document is retrievable with its bytes (a data URL).
    document_id = body["document_id"]
    got = client.get(f"/api/documents/{document_id}").json()["document"]
    assert base64.b64decode(got["data"].split(",", 1)[1]) == data


def test_extraction_unreadable_degrades_and_keeps_upload(client):
    as_user(client, "ana@example.com")
    payload = b"GIF89a-not-a-pdf-not-text\x00\x01\x02"
    res = client.post(
        "/api/extraction",
        files={"file": ("broken.bin", payload, "application/octet-stream")},
    )
    body = res.json()
    # Binary text reaching the extraction layer: the document is kept (it
    # stays attached to the draft) and the panel gets a manual-entry detail.
    assert res.status_code == 200
    assert body["ok"] is False
    assert "manually" in body["detail"]
    assert body["document_id"]
    assert client.get(f"/api/documents/{body['document_id']}").status_code == 200


def test_extraction_pasted_text_no_document(client):
    as_user(client, "ana@example.com")
    res = client.post("/api/extraction", data={"content": valid_request_text()})
    body = res.json()
    assert body["ok"] is True and body["layer"] == "L1"
    assert body["document_id"] is None


# --- commodity suggestion --------------------------------------------------------


def test_commodity_suggest(client):
    assert client.post("/api/auth/login", json={"email": "kim@example.com", "password": "demo"}).status_code == 200
    res = client.post(
        "/api/commodity/suggest",
        json={
            "title": None,
            "department": "Creative Marketing",
            "items": [{"position_description": "Adobe Photoshop Licenses"}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["suggestion"]["id"] == "031"
    assert body["suggestion"]["confidence"] in ("high", "medium")
    assert isinstance(body["candidates"], list)


def test_history_visible_to_later_reader(client):
    """WS4's persistence claim: the trail lives in Postgres, not in the
    client's memory — a different session must read the same entries."""
    as_user(client, "ana@example.com")
    request_id = client.post("/api/requests", json=valid_request()).json()["request"]["id"]

    other = TestClient(app)
    as_user(other, "kim@example.com")
    history = other.get(f"/api/requests/{request_id}").json()["status_history"]
    assert len(history) == 1 and history[0]["new_status"] == "Open"