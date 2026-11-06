from __future__ import annotations

import io
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.costing import stock_unit_cost_from_purchase, weighted_average_inventory_cost
from backend.models import InventoryItem, InventoryMovement
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization
from backend.tests.test_postgres_rls import POSTGRES_URL, _login_owner, _set_rls_context, postgres_app


def login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def invoice_payload(*, supplier_name, invoice_number, inventory_item_id, inventory_unit, quantity=2, unit_price=10, conversion_factor=1, status="Draft"):
    line_total = quantity * unit_price
    return {
        "supplierName": supplier_name,
        "invoiceNumber": invoice_number,
        "invoiceDate": "2026-08-20",
        "subtotal": line_total,
        "tax": 0,
        "totalAmount": line_total,
        "status": status,
        "sourceFileName": "pilot-correction.pdf",
        "sourceFileType": "application/pdf",
        "extractionStatus": "ocr",
        "extractedText": "OCR raw provenance",
        "lineItems": [{
            "description": "Chicken Breast",
            "inventoryItemId": inventory_item_id,
            "purchaseUnit": "case",
            "inventoryUnit": inventory_unit,
            "conversionFactor": conversion_factor,
            "quantity": quantity,
            "unitPrice": unit_price,
            "lineTotal": line_total,
            "confidence": 1,
            "needsReview": False,
            "note": "Reviewed after OCR",
        }],
    }


def test_authenticated_ocr_correction_reopen_and_receive_once(app, client, monkeypatch):
    """The pilot's persisted review values, not the OCR snapshot, drive receipt."""
    import backend.pilot_api as pilot_module

    monkeypatch.setattr(
        pilot_module,
        "extract_invoice_document",
        lambda *_args: {
            "provider": "stub",
            "fileName": "pilot-correction.pdf",
            "contentType": "application/pdf",
            "rawText": "OCR raw provenance",
            "fields": {
                "supplier": {"value": "Fresh Dairy Toronto", "confidence": 0.9, "needsReview": True},
                "invoiceDate": {"value": "2026-08-20", "confidence": 0.9, "needsReview": False},
                "invoiceNumber": {"value": "OCR-CORRECT-ME", "confidence": 0.9, "needsReview": True},
                "subtotal": {"value": 20, "confidence": 0.9, "needsReview": True},
                "tax": {"value": 0, "confidence": 0.9, "needsReview": False},
                "total": {"value": 20, "confidence": 0.9, "needsReview": True},
            },
            "lineItems": [{
                "itemName": "Chicken Breast",
                "quantity": 2,
                "unit": "case",
                "unitPrice": 10,
                "lineTotal": 20,
                "confidence": 0.7,
                "needsReview": True,
            }],
            "warnings": [],
            "overallConfidence": 0.75,
            "needsReview": True,
        },
    )

    login(client)
    headers = csrf_headers(client)
    ocr = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b"%PDF-1.4\n"), "pilot-correction.pdf")},
        content_type="multipart/form-data",
        headers=headers,
    )
    assert ocr.status_code == 200
    extracted = ocr.get_json()
    assert extracted["rawText"] == "OCR raw provenance"
    inventory_items = client.get("/api/pilot/inventory").get_json()["items"]
    item = next(entry for entry in inventory_items if entry["name"] == "Chicken Breast")
    mapped_item = next(entry for entry in inventory_items if entry["name"] == "Cream")
    corrected_supplier = client.post(
        "/api/pilot/suppliers",
        headers=headers,
        json={"name": f"Corrected Supplier {uuid4().hex[:8]}", "isActive": True},
    )
    assert corrected_supplier.status_code == 201
    supplier_name = corrected_supplier.get_json()["name"]
    invoice_number = f"OCR-CORRECT-ME-{uuid4().hex[:8].upper()}"

    created = client.post(
        "/api/pilot/purchases/invoices",
        headers=headers,
        json=invoice_payload(
            supplier_name="Fresh Dairy Toronto",
            invoice_number=invoice_number,
            inventory_item_id=item["id"],
            inventory_unit=item["stockUnit"],
            quantity=2,
            unit_price=10,
            conversion_factor=1,
        ) | {"sourceFileName": extracted["fileName"], "sourceFileType": extracted["contentType"]},
    )
    assert created.status_code == 201
    invoice = created.get_json()

    duplicate = client.post(
        "/api/pilot/purchases/invoices",
        headers=headers,
        json=invoice_payload(supplier_name="Fresh Dairy Toronto", invoice_number=invoice_number, inventory_item_id=item["id"], inventory_unit=item["stockUnit"]),
    )
    assert duplicate.status_code == 409
    assert duplicate.get_json()["errors"]["duplicateInvoiceId"] == str(invoice["id"])
    invalid = invoice_payload(
        supplier_name="Fresh Dairy Toronto",
        invoice_number=invoice_number,
        inventory_item_id=item["id"],
        inventory_unit=item["stockUnit"],
        conversion_factor=0,
    )
    invalid_response = client.patch(f"/api/pilot/purchases/invoices/{invoice['id']}", headers=headers, json=invalid)
    assert invalid_response.status_code == 400
    unchanged = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}").get_json()
    assert unchanged["lineItems"][0]["quantity"] == 2
    assert unchanged["lineItems"][0]["inventoryItemId"] == item["id"]

    corrected_number = f"OCR-CORRECTED-{uuid4().hex[:8].upper()}"
    corrected_payload = invoice_payload(
        supplier_name=supplier_name,
        invoice_number=corrected_number,
        inventory_item_id=mapped_item["id"],
        inventory_unit=mapped_item["stockUnit"],
        quantity=3,
        unit_price=12,
        conversion_factor=4,
        status="Ready",
    ) | {"invoiceDate": "2026-08-21", "sourceFileName": extracted["fileName"], "sourceFileType": extracted["contentType"]}
    updated = client.patch(f"/api/pilot/purchases/invoices/{invoice['id']}", headers=headers, json=corrected_payload)
    assert updated.status_code == 200

    reopened = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}")
    assert reopened.status_code == 200
    reopened_body = reopened.get_json()
    assert reopened_body["supplier"]["name"] == supplier_name
    assert reopened_body["invoiceDate"] == "2026-08-21"
    assert reopened_body["invoiceNumber"] == corrected_number
    reopened_line = reopened_body["lineItems"][0]
    assert reopened_line["quantity"] == 3
    assert reopened_line["unitPrice"] == 12
    assert reopened_line["lineTotal"] == 36
    assert reopened_line["conversionFactor"] == 4
    assert reopened_line["inventoryItemId"] == mapped_item["id"]
    assert reopened_body["extractedText"] == "OCR raw provenance"

    with app.app_context():
        before_a = Decimal(str(InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand))
        before_b = Decimal(str(InventoryItem.query.filter_by(id=mapped_item["id"]).one().current_on_hand))
        before_b_average = Decimal(str(InventoryItem.query.filter_by(id=mapped_item["id"]).one().average_unit_cost))

    with app.app_context():
        from backend.models import User
        owner_user = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        other_org = make_operational_organization(owner_user, name=f"Invoice isolation {uuid4().hex[:8]}", location_name="Other Location")
        other_membership_id = other_org.memberships[0].id
    with client.session_transaction() as session:
        original_membership_id = session["pilot_current_membership_id"]
        session["pilot_current_membership_id"] = other_membership_id
    assert client.patch(f"/api/pilot/purchases/invoices/{invoice['id']}", headers=headers, json=corrected_payload).status_code == 404
    assert client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers).status_code == 404
    with client.session_transaction() as session:
        session["pilot_current_membership_id"] = original_membership_id

    received = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert received.status_code == 200
    assert received.get_json()["status"] == "Completed"
    with app.app_context():
        item_a = InventoryItem.query.filter_by(id=item["id"]).one()
        item_b = InventoryItem.query.filter_by(id=mapped_item["id"]).one()
        movements = InventoryMovement.query.filter_by(
            source_record_id=str(invoice["id"]), source_type="invoice receipt"
        ).all()
        assert item_a.current_on_hand == before_a
        assert item_b.current_on_hand == before_b + Decimal("12.0000")
        assert item_b.latest_purchase_price == Decimal("12.00")
        assert item_b.average_unit_cost == weighted_average_inventory_cost(before_b, before_b_average, Decimal("12"), stock_unit_cost_from_purchase(Decimal("12"), Decimal("4")))
        assert len(movements) == 1
        movement = movements[0]
        assert movement.inventory_item_id == mapped_item["id"]
        assert movement.quantity_delta == Decimal("12.0000")
        assert movement.quantity_before == before_b
        assert movement.quantity_after == before_b + Decimal("12.0000")
        assert movement.unit == mapped_item["stockUnit"]
        assert movement.reason == f"Invoice {corrected_number} received"
        assert movement.quantity_delta != Decimal("2")
    duplicate = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert duplicate.status_code == 409
    after_duplicate = client.get("/api/pilot/inventory").get_json()["items"]
    assert Decimal(str(next(entry for entry in after_duplicate if entry["id"] == mapped_item["id"])["currentOnHand"])) == before_b + Decimal("12")
    purchases = client.get("/api/pilot/purchases").get_json()
    assert next(entry for entry in purchases["invoices"] if entry["id"] == invoice["id"])["status"] == "Completed"
    assert purchases["exportReadiness"]["readyForCsv"] >= 1


@pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")
def test_postgres_authenticated_correction_uses_rls_and_receives_once(postgres_app):
    client = postgres_app.test_client()
    _login_owner(client)
    headers = {"X-CSRFToken": client.get("/api/auth/csrf", base_url="http://127.0.0.1:5001").get_json()["csrfToken"]}
    inventory = client.get("/api/pilot/inventory", base_url="http://127.0.0.1:5001").get_json()["items"]
    item_a = next(entry for entry in inventory if entry["name"] == "Chicken Breast")
    item_b = next(entry for entry in inventory if entry["name"] == "Cream")
    suppliers = client.get("/api/pilot/suppliers", base_url="http://127.0.0.1:5001").get_json()["suppliers"]
    supplier_name = suppliers[0]["name"]
    number = f"RLS-OCR-{uuid4().hex[:8].upper()}"
    created = client.post("/api/pilot/purchases/invoices", base_url="http://127.0.0.1:5001", headers=headers, json=invoice_payload(supplier_name=supplier_name, invoice_number=number, inventory_item_id=item_a["id"], inventory_unit=item_a["stockUnit"]))
    assert created.status_code == 201
    invoice_id = created.get_json()["id"]
    corrected = invoice_payload(supplier_name=supplier_name, invoice_number=f"{number}-EDITED", inventory_item_id=item_b["id"], inventory_unit=item_b["stockUnit"], quantity=3, unit_price=12, conversion_factor=4, status="Ready")
    updated = client.patch(f"/api/pilot/purchases/invoices/{invoice_id}", base_url="http://127.0.0.1:5001", headers=headers, json=corrected)
    assert updated.status_code == 200
    received = client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", base_url="http://127.0.0.1:5001", headers=headers)
    assert received.status_code == 200
    assert client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", base_url="http://127.0.0.1:5001", headers=headers).status_code == 409
    with postgres_app.app_context():
        _set_rls_context(access_scope="organization", organization_id=updated.get_json()["organizationId"], user_id=updated.get_json()["createdByUserId"])
        movements = InventoryMovement.query.filter_by(source_record_id=str(invoice_id), source_type="invoice receipt").all()
        assert len(movements) == 1
        assert movements[0].inventory_item_id == item_b["id"]
        assert movements[0].quantity_delta == Decimal("12.0000")
