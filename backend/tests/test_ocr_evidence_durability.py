"""#169: printed OCR amounts are stored server-side and gate receipt after save / reload / reopen."""
from __future__ import annotations

import io
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.models import AuditEvent, InventoryItem, InventoryMovement, PurchaseInvoice, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, login

RAW_TEXT = "Catering invoice raw text"


def _png_bytes() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def _stub_ocr(monkeypatch, *, subtotal=106.5, total=106.5, tax=0.0, raw_text=RAW_TEXT, read_amounts=True):
    import backend.pilot_api as pilot_module

    def field(value):
        return {"value": value, "confidence": 0.95 if read_amounts else 0.0, "needsReview": not read_amounts}

    monkeypatch.setattr(
        pilot_module,
        "extract_invoice_document",
        lambda *_a: {
            "provider": "stub",
            "fileName": "catering.png",
            "contentType": "image/png",
            "rawText": raw_text,
            "fields": {"subtotal": field(subtotal), "tax": field(tax), "total": field(total)},
            "lineItems": [],
            "warnings": [],
            "needsReview": True,
        },
    )


def _extract(client, headers):
    response = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(_png_bytes()), "catering.png")},
        content_type="multipart/form-data",
        headers=headers,
    )
    assert response.status_code == 200, response.get_json()
    return response.get_json()


def _payload(client, extracted, *, line_total=15, subtotal=None, total=None, token="__use__", text=RAW_TEXT):
    item = next(entry for entry in client.get("/api/pilot/inventory").get_json()["items"] if entry["name"] == "Cream")
    subtotal = line_total if subtotal is None else subtotal
    return {
        "supplierName": "Evidence Caterer",
        "invoiceNumber": f"EV-{uuid4().hex[:8].upper()}",
        "invoiceDate": "2026-08-20",
        "subtotal": subtotal,
        "tax": 0,
        "totalAmount": subtotal if total is None else total,
        "status": "Ready",
        "extractionStatus": "ocr",
        "extractedText": text,
        "sourceFileName": "catering.png",
        "sourceFileType": "image/png",
        **({"ocrEvidenceToken": extracted["evidenceToken"]} if token == "__use__" else ({"ocrEvidenceToken": token} if token else {})),
        "lineItems": [{
            "description": "Veggie Soup",
            "inventoryItemId": item["id"],
            "purchaseUnit": item["stockUnit"],
            "inventoryUnit": item["stockUnit"],
            "conversionFactor": 1,
            "quantity": 3,
            "unitPrice": line_total / 3,
            "lineTotal": line_total,
            "confidence": 1,
            "needsReview": False,
        }],
    }


def _on_hand(app, item_id):
    with app.app_context():
        return Decimal(str(InventoryItem.query.filter_by(id=item_id).one().current_on_hand))


def test_incomplete_ocr_invoice_stays_blocked_after_save_reload_and_total_edits(app, client, monkeypatch):
    _stub_ocr(monkeypatch)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    payload = _payload(client, extracted, line_total=15)  # editable totals made to agree with the 1 captured line
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=payload)
    assert created.status_code == 201, created.get_json()
    invoice_id = created.get_json()["id"]
    item_id = payload["lineItems"][0]["inventoryItemId"]
    before = _on_hand(app, item_id)

    for _ in range(2):  # reload + reopen: evidence comes from the server, not from React state
        reopened = client.get(f"/api/pilot/purchases/invoices/{invoice_id}").get_json()
        assert reopened["ocrEvidence"]["status"] == "incomplete"
        assert reopened["ocrEvidence"]["expectedAmount"] == 106.5
        assert reopened["ocrEvidence"]["difference"] == 91.5
        assert reopened["reviewSummary"]["readyToReceive"] is False
        assert any("printed invoice amount" in blocker for blocker in reopened["reviewSummary"]["blockers"])

    # Manipulating the editable subtotal/total cannot clear it.
    edited = _payload(client, extracted, line_total=15, subtotal=106.5, total=106.5, text=RAW_TEXT) | {"invoiceNumber": created.get_json()["invoiceNumber"]}
    assert client.patch(f"/api/pilot/purchases/invoices/{invoice_id}", headers=headers, json=edited | {"ocrEvidenceToken": None}).status_code == 200
    forged = client.patch(f"/api/pilot/purchases/invoices/{invoice_id}", headers=headers, json=edited | {"ocrPrintedTotal": 15, "ocrPrintedSubtotal": 15})
    assert forged.status_code == 200
    assert client.get(f"/api/pilot/purchases/invoices/{invoice_id}").get_json()["ocrEvidence"]["printedTotal"] == 106.5

    received = client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", headers=headers)
    assert received.status_code == 400
    assert _on_hand(app, item_id) == before
    with app.app_context():
        assert InventoryMovement.query.filter_by(source_type="invoice receipt", source_record_id=str(invoice_id)).count() == 0


def test_matching_ocr_invoice_receives_once_and_manual_invoice_is_unaffected(app, client, monkeypatch):
    _stub_ocr(monkeypatch, subtotal=15, total=15)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, line_total=15))
    assert created.status_code == 201
    invoice = created.get_json()
    assert invoice["ocrEvidence"]["status"] == "matched"
    first = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert first.status_code == 200
    assert client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers).status_code == 409

    manual = _payload(client, extracted, line_total=40, token=None) | {"extractionStatus": "manual", "extractedText": ""}
    manual_created = client.post("/api/pilot/purchases/invoices", headers=headers, json=manual)
    assert manual_created.status_code == 201
    assert manual_created.get_json()["ocrEvidence"] is None
    assert client.post(f"/api/pilot/purchases/invoices/{manual_created.get_json()['id']}/receive", headers=headers).status_code == 200


def test_ocr_invoice_without_valid_evidence_is_refused(client, monkeypatch):
    _stub_ocr(monkeypatch)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    missing = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, token=None))
    assert missing.status_code == 400 and "ocrEvidenceToken" in missing.get_json()["errors"]
    tampered = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, token=extracted["evidenceToken"][:-3] + "abc"))
    assert tampered.status_code == 400
    other_text = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, text="different text"))
    assert other_text.status_code == 400


def test_unreadable_printed_amounts_do_not_invent_a_target(client, monkeypatch):
    _stub_ocr(monkeypatch, read_amounts=False)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, line_total=15))
    assert created.status_code == 201
    evidence = created.get_json()["ocrEvidence"]
    assert evidence["status"] == "unverified" and evidence["expectedAmount"] is None and evidence["printedTotal"] is None


def test_audited_override_is_bound_to_line_total_idempotent_and_reversible_by_edit(app, client, monkeypatch):
    _stub_ocr(monkeypatch)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, line_total=15)).get_json()
    url = f"/api/pilot/purchases/invoices/{created['id']}/ocr-override"

    assert client.post(url, headers=headers, json={"reason": "short", "acknowledgedLineTotal": 15}).status_code == 400
    stale = client.post(url, headers=headers, json={"reason": "Supplier confirmed only soup was delivered", "acknowledgedLineTotal": 99})
    assert stale.status_code == 409

    ok = client.post(url, headers=headers, json={"reason": "Supplier confirmed only soup was delivered", "acknowledgedLineTotal": 15})
    assert ok.status_code == 200
    assert ok.get_json()["ocrEvidence"]["status"] == "overridden"
    replay = client.post(url, headers=headers, json={"reason": "Supplier confirmed only soup was delivered", "acknowledgedLineTotal": 15})
    assert replay.status_code == 200
    with app.app_context():
        events = AuditEvent.query.filter_by(event_type="purchases.ocr_discrepancy_override").all()
        assert len(events) == 1
        assert events[0].metadata_json["difference"] == "91.50"
        invoice = PurchaseInvoice.query.filter_by(id=created["id"]).one()
        assert invoice.ocr_override_by_user_id is not None and invoice.ocr_printed_total == Decimal("106.50")

    # Editing the lines invalidates the acknowledgement; the printed amounts are untouched.
    changed = _payload(client, extracted, line_total=30) | {"invoiceNumber": created["invoiceNumber"]}
    assert client.patch(f"/api/pilot/purchases/invoices/{created['id']}", headers=headers, json=changed).status_code == 200
    reopened = client.get(f"/api/pilot/purchases/invoices/{created['id']}").get_json()
    assert reopened["ocrEvidence"]["status"] == "incomplete"
    assert reopened["ocrEvidence"]["override"]["validForCurrentLines"] is False
    assert client.post(f"/api/pilot/purchases/invoices/{created['id']}/receive", headers=headers).status_code == 400

    again = client.post(url, headers=headers, json={"reason": "Re-confirmed with supplier by phone", "acknowledgedLineTotal": 30})
    assert again.status_code == 200
    assert client.post(f"/api/pilot/purchases/invoices/{created['id']}/receive", headers=headers).status_code == 200


def test_override_is_tenant_isolated_and_rejected_for_manual_or_received_invoices(app, client, monkeypatch):
    _stub_ocr(monkeypatch)
    login(client)
    headers = csrf_headers(client)
    extracted = _extract(client, headers)
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=_payload(client, extracted, line_total=15)).get_json()
    url = f"/api/pilot/purchases/invoices/{created['id']}/ocr-override"
    body = {"reason": "Supplier confirmed only soup was delivered", "acknowledgedLineTotal": 15}

    manual = _payload(client, extracted, token=None) | {"extractionStatus": "manual", "extractedText": ""}
    manual_created = client.post("/api/pilot/purchases/invoices", headers=headers, json=manual).get_json()
    assert client.post(f"/api/pilot/purchases/invoices/{manual_created['id']}/ocr-override", headers=headers, json=body).status_code == 409

    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        other = make_operational_organization(owner, name=f"Evidence isolation {uuid4().hex[:8]}", location_name="Other")
        other_membership_id = other.memberships[0].id
    with client.session_transaction() as session:
        original = session["pilot_current_membership_id"]
        session["pilot_current_membership_id"] = other_membership_id
    assert client.post(url, headers=headers, json=body).status_code == 404
    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = original
    assert client.get(f"/api/pilot/purchases/invoices/{created['id']}").get_json()["ocrEvidence"]["status"] == "incomplete"
