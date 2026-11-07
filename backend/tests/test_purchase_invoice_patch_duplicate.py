"""PATCH of a purchase invoice onto another invoice's supplier + number must be a structured 409 (#259)."""
from __future__ import annotations

from uuid import uuid4

from backend.extensions import db
from backend.models import AuditEvent, Supplier
from backend.tests.test_pilot_api import csrf_headers, login


def _payload(supplier: str, number: str, **overrides):
    body = {
        "supplierName": supplier,
        "invoiceNumber": number,
        "invoiceDate": "2026-11-01",
        "subtotal": 20,
        "tax": 0,
        "totalAmount": 20,
        "notes": "original",
        "status": "Draft",
        "lineItems": [{"description": f"Flour {number}", "quantity": 2, "unitPrice": 10, "lineTotal": 20, "purchaseUnit": "case", "inventoryUnit": "kg", "conversionFactor": 5}],
    }
    body.update(overrides)
    return body


def _create(client, supplier: str, number: str):
    response = client.post("/api/pilot/purchases/invoices", headers=csrf_headers(client), json=_payload(supplier, number))
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _patch(client, invoice_id: int, payload):
    return client.patch(f"/api/pilot/purchases/invoices/{invoice_id}", headers=csrf_headers(client), json=payload)


def _snapshot(client, invoice_id: int):
    body = client.get(f"/api/pilot/purchases/invoices/{invoice_id}").get_json()
    body.pop("updatedAt", None)
    return body


def _two_invoices(client):
    tag = uuid4().hex[:6]
    supplier_a, supplier_b = f"Dup Supplier A {tag}", f"Dup Supplier B {tag}"
    first = _create(client, supplier_a, f"INV-A-{tag}")
    second = _create(client, supplier_b, f"INV-B-{tag}")
    return tag, supplier_a, supplier_b, first, second


def test_patch_to_another_invoices_supplier_and_number_returns_409_and_changes_nothing(app, client):
    login(client)
    tag, supplier_a, _, first, second = _two_invoices(client)
    before_a, before_b = _snapshot(client, first["id"]), _snapshot(client, second["id"])
    with app.app_context():
        suppliers = Supplier.query.count()
        updates = AuditEvent.query.filter_by(event_type="purchases.invoice_updated").count()

    response = _patch(client, second["id"], _payload(supplier_a, first["invoiceNumber"], notes="should not stick"))

    assert response.status_code == 409
    body = response.get_json()
    assert body["errors"]["duplicateInvoiceId"] == str(first["id"])
    assert body["errors"]["duplicateStatus"] == first["status"]
    assert "already exists" in body["error"]
    assert _snapshot(client, first["id"]) == before_a
    assert _snapshot(client, second["id"]) == before_b
    with app.app_context():
        db.session.rollback()
        assert Supplier.query.count() == suppliers
        assert AuditEvent.query.filter_by(event_type="purchases.invoice_updated").count() == updates


def test_patch_that_keeps_its_own_number_or_uses_a_free_number_still_succeeds(app, client):
    login(client)
    tag, supplier_a, supplier_b, first, second = _two_invoices(client)

    same = _patch(client, second["id"], _payload(supplier_b, second["invoiceNumber"], notes="edited"))
    assert same.status_code == 200 and same.get_json()["notes"] == "edited"

    # Same number under a different supplier is not a collision.
    other_supplier = _patch(client, second["id"], _payload(supplier_a, f"FREE-{tag}"))
    assert other_supplier.status_code == 200 and other_supplier.get_json()["invoiceNumber"] == f"FREE-{tag}"


def test_concurrent_collision_after_the_precheck_is_still_a_409_and_rolls_back(app, client, monkeypatch):
    login(client)
    _, supplier_a, _, first, second = _two_invoices(client)
    before_a, before_b = _snapshot(client, first["id"]), _snapshot(client, second["id"])

    import backend.pilot_api as pilot_api

    real = pilot_api._find_duplicate_invoice
    calls = {"count": 0}

    def blind_first_call(*args, **kwargs):  # simulates the number being taken just after the pre-check
        calls["count"] += 1
        return None if calls["count"] == 1 else real(*args, **kwargs)

    monkeypatch.setattr(pilot_api, "_find_duplicate_invoice", blind_first_call)

    response = _patch(client, second["id"], _payload(supplier_a, first["invoiceNumber"], notes="should not stick"))

    assert response.status_code == 409, response.get_data(as_text=True)
    assert response.get_json()["errors"]["duplicateInvoiceId"] == str(first["id"])
    monkeypatch.undo()
    assert _snapshot(client, first["id"]) == before_a
    assert _snapshot(client, second["id"]) == before_b
