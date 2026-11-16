"""An OCR-incomplete invoice (lines far below the printed total) must not be receivable (#169)."""
from __future__ import annotations

from backend.models import InventoryItem
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, invoice_payload, login
from uuid import uuid4


def test_invoice_with_lines_far_below_printed_total_cannot_be_received(app, client):
    login(client)
    headers = csrf_headers(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    # Production defect shape: only 1 of 5 lines extracted ($15) but the document total is $106.50.
    payload = invoice_payload(
        supplier_name="Fresh Dairy Toronto",
        invoice_number=f"INC-{uuid4().hex[:8].upper()}",
        inventory_item_id=item["id"],
        inventory_unit=item["stockUnit"],
        quantity=3,
        unit_price=5,
        status="Ready",
    ) | {"totalAmount": 106.5}
    created = client.post("/api/pilot/purchases/invoices", headers=headers, json=payload)
    assert created.status_code in {200, 201}, created.get_data(as_text=True)
    invoice = created.get_json()
    with app.app_context():
        before = InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand

    received = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=headers)
    assert received.status_code == 400, received.get_data(as_text=True)
    with app.app_context():
        assert InventoryItem.query.filter_by(id=item["id"]).one().current_on_hand == before
    reopened = client.get(f"/api/pilot/purchases/invoices/{invoice['id']}").get_json()
    assert reopened["status"] != "Completed"

