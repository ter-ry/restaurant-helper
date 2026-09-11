from __future__ import annotations

import io

from PIL import Image

from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.test_auth import login


def _png_bytes() -> bytes:
    image = Image.new("RGB", (64, 64), color="white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_backend_invoice_ocr_route_is_active(client, monkeypatch):
    import backend.ocr as ocr_module

    monkeypatch.setattr(
        ocr_module,
        "extract_invoice_document",
        lambda filename, content, content_type: {
            "provider": "stub",
            "fileName": filename,
            "contentType": content_type,
            "rawText": "invoice text",
            "fields": {"invoiceNumber": {"value": "INV-1"}},
            "lineItems": [],
        },
    )

    response = client.post(
        "/api/invoices/ocr",
        data={"file": (io.BytesIO(_png_bytes()), "invoice.png")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["fields"]["invoiceNumber"]["value"] == "INV-1"


def test_pilot_invoice_ocr_requires_purchase_permission_and_preserves_response_contract(client, monkeypatch):
    import backend.pilot_api as pilot_module

    monkeypatch.setattr(
        pilot_module,
        "extract_invoice_document",
        lambda filename, content, content_type: {
            "provider": "stub",
            "fileName": filename,
            "contentType": content_type,
            "rawText": "Supplier: Fresh Foods\nInvoice No: FF-1\nMilk 2 24.00 48.00",
            "fields": {
                "supplier": {"value": "Fresh Foods", "confidence": 0.97, "needsReview": False},
                "invoiceDate": {"value": "2026-08-20", "confidence": 0.96, "needsReview": False},
                "invoiceNumber": {"value": "FF-1", "confidence": 0.95, "needsReview": False},
                "subtotal": {"value": 48, "confidence": 0.95, "needsReview": False},
                "tax": {"value": 6, "confidence": 0.95, "needsReview": False},
                "total": {"value": 54, "confidence": 0.95, "needsReview": False},
            },
            "lineItems": [{"itemName": "Milk 2L", "quantity": 2, "unit": "case", "unitPrice": 24, "lineTotal": 48, "confidence": 0.8, "needsReview": True}],
            "warnings": [],
            "overallConfidence": 0.86,
            "needsReview": True,
        },
    )

    assert login(client, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD).status_code == 200
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(_png_bytes()), "invoice.png")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200
    assert response.get_json()["lineItems"][0]["needsReview"] is True

    pdf_response = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b"%PDF-1.4\n"), "invoice.pdf")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert pdf_response.status_code == 200


def test_pilot_invoice_ocr_rejects_anonymous_invalid_and_provider_failure(client, monkeypatch):
    anonymous = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(_png_bytes()), "invoice.png")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]},
    )
    assert anonymous.status_code == 401

    assert login(client, LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD).status_code == 200
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    invalid = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b"not-an-invoice"), "invoice.txt")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert invalid.status_code == 422

    empty = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b""), "empty.pdf")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert empty.status_code == 422

    import backend.pilot_api as pilot_module

    monkeypatch.setattr(pilot_module, "extract_invoice_document", lambda *_args: (_ for _ in ()).throw(pilot_module.InvoiceOCRFailure("provider unavailable")))
    failed = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b"%PDF-1.4\n"), "invoice.pdf")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert failed.status_code == 422
    assert "provider unavailable" in failed.get_json()["error"]

    monkeypatch.setattr(pilot_module, "extract_invoice_document", lambda *_args: (_ for _ in ()).throw(pilot_module.InvoiceOCRTemporaryFailure("temporary")))
    temporary = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(b"%PDF-1.4\n"), "invoice.pdf")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert temporary.status_code == 503
    assert temporary.get_json()["error"] == "temporary"


def test_pilot_invoice_ocr_rejects_user_without_purchase_permission(client, monkeypatch):
    import backend.policy as policy_module

    monkeypatch.setattr(policy_module, "membership_has_permission", lambda *_args: False)
    assert login(client, LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD).status_code == 200
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/pilot/purchases/ocr",
        data={"file": (io.BytesIO(_png_bytes()), "invoice.png")},
        content_type="multipart/form-data",
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 403


def test_backend_reconciliation_ocr_route_accepts_csv(client):
    csv_data = "Business Date,Orders,Gross Sales,Net Sales,Payout\n2026-06-14,18,245.50,227.15,220.25\n".encode("utf-8")

    response = client.post(
        "/api/reconciliation/extract",
        data={"file": (io.BytesIO(csv_data), "ubereats.csv"), "source": "uber_eats"},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["fields"]["businessDate"]["value"] == "2026-06-14"
