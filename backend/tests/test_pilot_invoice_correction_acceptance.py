from __future__ import annotations

import io
from uuid import uuid4

from backend.models import InventoryItem, InventoryMovement
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


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
    item = next(entry for entry in client.get("/api/pilot/inventory").get_json()["items"] if entry["name"] == "Chicken Breast")
    corrected_supplier = client.post(
        "/api/pilot/suppliers",
        headers=headers,
        json={"name": f"Corrected Supplier {uuid4().hex[:8]}", "isActive": True},
    )
    assert corrected_supplier.status_code == 201
    supplier_name = corrected_supplier.get_json()["name"]
    invoice_number = f"OCR-CORRECTED-{uuid4().hex[:8].upper()}"

    created = client.post(
        "/api/pilot/purchases/invoices",
        headers=headers,
        json={
            "supplierName": "Fresh Dairy Toronto",
            "invoiceNumber": invoice_number,
            "invoiceDate": "2026-08-20",
            "subtotal": 20,
            "tax": 0,
            "totalAmount": 20,
            "status": "Draft",
            "sourceFileName": extracted["fileName"],
            "sourceFileType": extracted["contentType"],
            "extractionStatus": "ocr",
            "extractedText": extracted["rawText"],
            "lineItems": [{
                "description": "Chicken Breast",
                "inventoryItemId": item["id"],
                "purchaseUnit": "case",
                "inventoryUnit": item["stockUnit"],
                "conversionFactor": 1,
                "quantity": 2,
                "unitPrice": 10,
                "lineTotal": 20,
                "confidence": 0.7,
                "needsReview": True,
                "note": "OCR raw line",
            }],
        },
    )
    assert created.status_code == 201
    invoice = created.get_json()

    corrected_payload = {
        "supplierName": supplier_name,
        "invoiceNumber": invoice_number,
        "invoiceDate": "2026-08-21",
        "subtotal": 36,
        "tax": 0,
        "totalAmount": 36,
        "status": "Ready",
        "sourceFileName": extracted["fileName"],
        "sourceFileType": extracted["contentType"],
        "extractionStatus": "ocr",
        "extractedText": extracted["rawText"],
        "lineItems": [{
            "description": "Chicken Breast",
            "inventoryItemId": item["id"],
            "purchaseUnit": "case",
            "inventoryUnit": item["stockUnit"],
            "conversionFactor": 4,
            "quantity": 3,
            "unitPrice": 12,
            "lineTotal": 36,
            "confidence": 1,
            "needsReview": False,
            "note": "Corrected after OCR review",
        }],
    }
    updated = client.patch(f"/api/pilot/purchases/invoices/{invoice['id']}", headers=headers, json=corrected_payload)
    assert updated.status_code == 200

    reopened = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}")
    assert reopened.status_code == 200
    reopened_body = reopened.get_json()
    assert reopened_body["supplier"]["name"] == supplier_name
    assert reopened_body["invoiceDate"] == "2026-08-21"
    reopened_line = reopened_body["lineItems"][0]
    assert reopened_line["quantity"] == 3
    assert reopened_line["unitPrice"] == 12
    assert reopened_line["lineTotal"] == 36
    assert reopened_line["conversionFactor"] == 4
    assert reopened_line["inventoryItemId"] == item["id"]
    assert reopened_body["extractedText"] == "OCR raw provenance"

    with app.app_context():
        before = float(InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand)
    received = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert received.status_code == 200
    assert received.get_json()["status"] == "Completed"
    duplicate = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert duplicate.status_code == 409
    with app.app_context():
        after = float(InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand)
        receipt_count = InventoryMovement.query.filter_by(
            source_record_id=str(invoice["id"]), source_type="invoice receipt"
        ).count()
    assert after == before + 12
    assert receipt_count == 1
