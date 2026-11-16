"""Dashboard month-to-date invoice spend must match Purchases' definition (#169)."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import backend.pilot_api as pilot_module
from backend.models import PurchaseInvoice
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, invoice_payload, login


def _create(client, item, invoice_date, amount, status="Draft"):
    payload = invoice_payload(
        supplier_name="Fresh Dairy Toronto",
        invoice_number=f"MTD-{uuid4().hex[:8].upper()}",
        inventory_item_id=item["id"],
        inventory_unit=item["stockUnit"],
        quantity=1,
        unit_price=amount,
        status=status,
    ) | {"invoiceDate": invoice_date}
    response = client.post("/api/pilot/purchases/invoices", headers=csrf_headers(client), json=payload)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()["id"]


def test_dashboard_month_to_date_matches_purchases(app, client, monkeypatch):
    # 2026-12-01 03:00 UTC is still Nov 30 22:00 in Toronto: November is the business month.
    frozen = datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(pilot_module, "_now", lambda: frozen)
    login(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    base_dash = client.get("/api/pilot/dashboard").get_json()["summary"]
    base_purchases = client.get("/api/pilot/purchases").get_json()["summary"]

    _create(client, item, "2026-10-31", 1000)  # previous month: excluded
    _create(client, item, "2026-11-01", 10)  # first day: included
    _create(client, item, "2026-11-30", 20)  # last day, still November locally: included
    voided_id = _create(client, item, "2026-11-15", 500)
    with app.app_context():
        from backend.models import db
        PurchaseInvoice.query.filter_by(id=voided_id).one().status = pilot_module.VOIDED_INVOICE_STATUS
        db.session.commit()

    dash = client.get("/api/pilot/dashboard").get_json()["summary"]
    purchases = client.get("/api/pilot/purchases").get_json()["summary"]
    assert round(dash["monthlyInvoiceSpend"] - base_dash["monthlyInvoiceSpend"], 2) == 30.0
    assert dash["monthlyInvoiceCount"] - base_dash["monthlyInvoiceCount"] == 2
    assert round(purchases["thisMonthSpend"] - base_purchases["thisMonthSpend"], 2) == 30.0
    assert dash["monthlyInvoiceSpend"] == purchases["thisMonthSpend"]
