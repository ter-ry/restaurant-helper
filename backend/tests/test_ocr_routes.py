from __future__ import annotations

import io

from PIL import Image


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
