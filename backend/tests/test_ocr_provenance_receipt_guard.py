"""Incomplete OCR invoices stay unreceivable after save, reload, edit and status tampering (#169)."""
from __future__ import annotations

import io
from uuid import uuid4

from backend.models import InventoryItem
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, invoice_payload, login


def _ocr(client, headers, monkeypatch, *, subtotal=106.5):
    import backend.pilot_api as api

    monkeypatch.setattr(
        api,
        "extract_invoice_document",
        lambda filename, content, content_type: {
            "provider": "stub", "fileName": filename, "contentType": content_type, "rawText": "x",
            "fields": {
                "subtotal": {"value": subtotal, "confidence": 0.95, "needsReview": False},
                "tax": {"value": 0, "confidence": 0.95, "needsReview": False},
                "total": {"value": subtotal, "confidence": 0.95, "needsReview": False},
            },
            "lineItems": [], "warnings": [], "overallConfidence": 0.9, "needsReview": False,
        },
    )
    res = client.post("/api/pilot/purchases/ocr", data={"file": (io.BytesIO(b"%PDF-1.4\n"), "c.pdf")}, content_type="multipart/form-data", headers=headers)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()["provenance"]


def _setup(client, monkeypatch):
    login(client)
    headers = csrf_headers(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    token = _ocr(client, headers, monkeypatch)
    payload = invoice_payload(
        supplier_name="Fresh Dairy Toronto", invoice_number=f"PRV-{uuid4().hex[:8].upper()}",
        inventory_item_id=item["id"], inventory_unit=item["stockUnit"], quantity=3, unit_price=5, status="Ready",
    ) | {"ocrProvenance": token}
    return headers, item, payload


def test_incomplete_ocr_invoice_with_edited_totals_cannot_be_received_after_reload(app, client, monkeypatch):
    headers, item, payload = _setup(client, monkeypatch)
    # Editor made invoice totals match the single extracted line ($15) while the document printed $106.50.
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=payload)
    assert created.status_code == 201, created.get_data(as_text=True)
    invoice = created.get_json()
    assert invoice["ocrProvenance"]["printedSubtotal"] == 106.5
    assert any(b for b in invoice["reviewSummary"]["blockers"] if "106.50" in b)

    reopened = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}").get_json()
    assert reopened["ocrProvenance"]["recorded"] is True

    # Tamper: downgrade status to manual and omit the token on PATCH; provenance must persist.
    patch = client.patch(f"/api/pilot/purchases/invoices/{invoice['id']}", headers=headers, json={**payload, "extractionStatus": "manual", "ocrProvenance": ""})
    assert patch.status_code == 200, patch.get_data(as_text=True)
    assert patch.get_json()["extractionStatus"] == "ocr"
    with app.app_context():
        before = InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand
    received = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert received.status_code == 400, received.get_data(as_text=True)
    with app.app_context():
        assert InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand == before


def test_ocr_invoice_receivable_once_lines_match_printed_total(client, monkeypatch):
    headers, item, payload = _setup(client, monkeypatch)
    payload["lineItems"][0].update(quantity=21.3, unitPrice=5, lineTotal=106.5)
    payload.update(subtotal=106.5, totalAmount=106.5)
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=payload)
    assert created.status_code == 201, created.get_data(as_text=True)
    received = client.post(f"/api/pilot/purchases/invoices/{created.get_json()['id']}/receive", headers=headers)
    assert received.status_code == 200, received.get_data(as_text=True)
    again = client.post(f"/api/pilot/purchases/invoices/{created.get_json()['id']}/receive", headers=headers)
    assert again.status_code == 409


def test_forged_or_foreign_provenance_token_is_rejected(client, monkeypatch):
    headers, _, payload = _setup(client, monkeypatch)
    res = client.post("/api/pilot/purchases/invoices", headers=headers, json={**payload, "ocrProvenance": payload["ocrProvenance"][:-3] + "abc"})
    assert res.status_code == 400


def test_manual_invoice_without_provenance_is_unaffected(client):
    login(client)
    headers = csrf_headers(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    payload = invoice_payload(supplier_name="Fresh Dairy Toronto", invoice_number=f"MAN-{uuid4().hex[:8].upper()}", inventory_item_id=item["id"], inventory_unit=item["stockUnit"], status="Ready")
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=payload)
    assert created.status_code == 201
    assert client.post(f"/api/pilot/purchases/invoices/{created.get_json()['id']}/receive", headers=headers).status_code == 200
