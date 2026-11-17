"""Dashboard 'This week' is the business calendar week Mon-Sun; reorder counts are non-overlapping (#351)."""
from __future__ import annotations

from datetime import datetime, timezone

import backend.pilot_api as pilot_module
from backend.tests.test_dashboard_month_to_date import _create
from backend.tests.test_pilot_invoice_correction_acceptance import login


def test_weekly_window_is_business_calendar_week(client, monkeypatch):
    # Mon 2026-11-23 02:00 UTC is still Sunday Nov 22 21:00 in Toronto: week is Nov 16-22.
    monkeypatch.setattr(pilot_module, "_now", lambda: datetime(2026, 11, 23, 2, 0, tzinfo=timezone.utc))
    login(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    base = client.get("/api/pilot/dashboard").get_json()["summary"]
    _create(client, item, "2026-11-15", 1000)  # previous Sunday: excluded
    _create(client, item, "2026-11-16", 10)  # Monday: included
    _create(client, item, "2026-11-22", 20)  # Sunday: included
    _create(client, item, "2026-11-23", 500)  # next Monday: excluded (future-dated)
    summary = client.get("/api/pilot/dashboard").get_json()["summary"]
    assert summary["weeklyWindow"] == {"label": "This week", "startDate": "2026-11-16", "endDate": "2026-11-22"}
    assert round(summary["weeklyInvoiceSpend"] - base["weeklyInvoiceSpend"], 2) == 30.0
    assert summary["weeklyInvoiceCount"] - base["weeklyInvoiceCount"] == 2


def test_reorder_counts_are_non_overlapping_and_match_attention(client):
    login(client)
    body = client.get("/api/pilot/dashboard").get_json()
    summary = body["summary"]
    assert summary["inventoryUrgentReorderCount"] == summary["inventoryReorderNowCount"] + summary["inventoryOutOfStockCount"]
    assert summary["inventoryRunningLowCount"] == summary["inventoryLowStockCount"]
    assert summary["inventoryUrgentReorderCount"] + summary["inventoryRunningLowCount"] == summary["inventoryRecommendationCount"]
    attention = client.get("/api/pilot/attention").get_json()
    assert attention["reorder"]["count"] == summary["inventoryUrgentReorderCount"]
    assert body["operationalAttention"]["reorder"]["count"] == summary["inventoryUrgentReorderCount"]
