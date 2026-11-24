"""Milestone D (#315/#351): one purchase-status vocabulary across Dashboard, Purchases and Reports.

Documented definitions (not new policy; see #365/#366/#319):
- Dashboard month-to-date and Purchases ``thisMonthSpend``: every non-voided invoice dated in the business month
  (Draft + Completed). Voided ("Corrected") invoices are never spend.
- Reports ``purchasing.spend`` / ``supplierSpend``: Completed (received) invoices only; ``invoiceCount`` is all
  non-voided invoices in the window, with ``completedInvoiceCount`` and ``draftInvoiceCount`` split out.
- A voided invoice is excluded everywhere and its stock reversal is a ledger concern (see the lifecycle suite).
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import backend.pilot_api as pilot_module
from backend.tests.test_dashboard_month_to_date import _create
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, login


def test_draft_completed_and_voided_invoices_agree_across_surfaces(client, monkeypatch):
    monkeypatch.setattr(pilot_module, "_now", lambda: datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc))
    login(client)
    headers = csrf_headers(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")

    def snapshot():
        dash = client.get("/api/pilot/dashboard").get_json()["summary"]
        purchases = client.get("/api/pilot/purchases").get_json()["summary"]
        report = client.get("/api/pilot/reports?view=weekly&startDate=2026-11-01&endDate=2026-11-30")
        assert report.status_code == 200
        return dash, purchases, report.get_json()["purchasing"]

    base_dash, base_purchases, base_report = snapshot()

    draft_id = _create(client, item, "2026-11-10", 10)  # saved, never received
    completed_id = _create(client, item, "2026-11-12", 20)
    voided_id = _create(client, item, "2026-11-15", 500)
    for invoice_id in (completed_id, voided_id):
        assert client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", headers=headers).status_code == 200
    void = client.post(
        f"/api/pilot/purchases/invoices/{voided_id}/void",
        headers=headers,
        json={"reason": "supplier credit note", "idempotencyKey": f"void-{uuid4().hex}"},
    )
    assert void.status_code == 200, void.get_data(as_text=True)
    assert void.get_json()["status"] == "Corrected"

    dash, purchases, report = snapshot()

    # Dashboard and Purchases: draft + completed, voided excluded, same number.
    assert round(dash["monthlyInvoiceSpend"] - base_dash["monthlyInvoiceSpend"], 2) == 30.0
    assert dash["monthlyInvoiceCount"] - base_dash["monthlyInvoiceCount"] == 2
    assert round(purchases["thisMonthSpend"] - base_purchases["thisMonthSpend"], 2) == 30.0
    assert dash["monthlyInvoiceSpend"] == purchases["thisMonthSpend"]
    assert purchases["receivedThisMonth"] - base_purchases["receivedThisMonth"] == 1
    assert purchases["exportReady"] - base_purchases["exportReady"] == 1
    assert purchases["uploadsNeedingReview"] - base_purchases["uploadsNeedingReview"] == 1
    assert dash["invoiceReviewQueueCount"] - base_dash["invoiceReviewQueueCount"] == 1

    # Reports: spend is received invoices only; counts split by status; voided never appears.
    assert round(report["spend"] - base_report["spend"], 2) == 20.0
    assert report["invoiceCount"] - base_report["invoiceCount"] == 2
    assert report["completedInvoiceCount"] - base_report["completedInvoiceCount"] == 1
    assert report["draftInvoiceCount"] - base_report["draftInvoiceCount"] == 1
    assert round(sum(row["spend"] for row in report["supplierSpend"]) - sum(row["spend"] for row in base_report["supplierSpend"]), 2) == 20.0

    # Reopening the invoices through the purchasing API reports the same statuses the aggregates used.
    statuses = {i["id"]: i["status"] for i in client.get("/api/pilot/purchases").get_json()["invoices"]}
    assert (statuses[draft_id], statuses[completed_id], statuses[voided_id]) == ("Draft", "Completed", "Corrected")
