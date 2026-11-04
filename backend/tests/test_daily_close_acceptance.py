"""Daily Close acceptance suite (Square baseline, issue #206).

Every expected figure below is hand-computed in the test from the fixture
data; none is derived from production formulas. The Square outputs asserted
here are the baseline that the Clover Daily Close work (#167) must keep
byte-identical.

Fixed cafe day: 2026-08-30, America/Toronto (UTC-4), i.e. 04:00Z -> 03:59:59Z.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import (
    DailyCloseSession,
    InventoryItem,
    InventoryMovement,
    InventoryWasteEvent,
    RestaurantLocation,
    SquareConnection,
    SquareDailySalesSummary,
    SquareLocation,
    SquareLocationMapping,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization

DAY = "2026-08-30"
IN_DAY = datetime(2026, 8, 30, 16, 0, tzinfo=timezone.utc)  # noon Toronto
OUT_OF_DAY = datetime(2026, 8, 29, 16, 0, tzinfo=timezone.utc)
MODULES = ("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE")


def _csrf(client) -> str:
    return client.get("/api/auth/csrf").get_json()["csrfToken"]


def _setup(app, client, *, environment="sandbox", square_location_ids=("LOC-A",)):
    """Log in as the owner and build a cafe org with a connected, mapped Square."""
    token = _csrf(client)
    assert client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": token}).status_code == 200
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name=f"Close Cafe {uuid4().hex[:8]}", location_name="Queen St Cafe", enabled_modules=MODULES)
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    connection = SquareConnection(
        organization_id=organization.id,
        environment=environment,
        square_merchant_id=f"merchant-{uuid4().hex[:6]}",
        status="connected",
        sync_status="idle",
        last_sync_at=datetime(2026, 8, 30, 23, 0, tzinfo=timezone.utc),
    )
    db.session.add(connection)
    db.session.flush()
    for sq_id in square_location_ids:
        sq = SquareLocation(square_connection_id=connection.id, square_location_id=sq_id, name=sq_id, status="ACTIVE", raw_payload_json={})
        db.session.add(sq)
        db.session.flush()
        db.session.add(SquareLocationMapping(square_location_id=sq.id, restaurant_location_id=location.id, mapped_by_user_id=owner.id))
    db.session.commit()
    selected = client.post("/api/organizations/select", headers={"X-CSRFToken": _csrf(client)}, json={"organizationId": organization.id})
    assert selected.status_code == 200
    return organization.id, location.id, connection.id


def _summary(connection_id, location_id, sq_id, sale_date=date(2026, 8, 30), **amounts):
    defaults = dict(gross_amount=0, discount_amount=0, tax_amount=0, tip_amount=0, refund_amount=0, net_amount=0, order_count=0, cancelled_order_count=0)
    defaults.update(amounts)
    db.session.add(SquareDailySalesSummary(square_connection_id=connection_id, square_location_id=sq_id, restaurant_location_id=location_id, sale_date=sale_date, raw_payload_json={}, **defaults))


def _post(client, path, body=None):
    return client.post(path, json=body or {}, headers={"X-CSRFToken": _csrf(client)})


def _patch(client, path, body):
    return client.patch(path, json=body, headers={"X-CSRFToken": _csrf(client)})


def _get(client, location_id):
    return client.get("/api/pilot/daily-close", query_string={"locationId": location_id, "businessDate": DAY})


def _seed_sales(connection_id, location_id):
    # LOC-A + LOC-B are both mapped to the cafe; LOC-OTHER is not and must be ignored.
    _summary(connection_id, location_id, "LOC-A", gross_amount=800, discount_amount=40, tax_amount=100, tip_amount=60, refund_amount=20, net_amount=740, order_count=30, cancelled_order_count=1)
    _summary(connection_id, location_id, "LOC-B", gross_amount=400, discount_amount=10, tax_amount=50, tip_amount=20, refund_amount=0, net_amount=390, order_count=15)
    _summary(connection_id, location_id, "LOC-OTHER", gross_amount=9999, net_amount=9999, order_count=99)
    _summary(connection_id, location_id, "LOC-A", sale_date=date(2026, 8, 29), gross_amount=5000, net_amount=5000, order_count=77)
    db.session.commit()


def test_sales_figures_sum_mapped_locations_for_the_business_day_only(app, client):
    _, location_id, connection_id = _setup(app, client, square_location_ids=("LOC-A", "LOC-B"))
    _seed_sales(connection_id, location_id)
    body = _get(client, location_id).get_json()
    sales = body["snapshot"]["sales"]
    # Hand sums: 800+400, 40+10, 100+50, 60+20, 20+0, 740+390, 30+15, 1+0
    assert sales["grossSales"] == 1200.0
    assert sales["discounts"] == 50.0
    assert sales["tax"] == 150.0
    assert sales["tips"] == 80.0
    assert sales["refunds"] == 20.0
    assert sales["netSales"] == 1130.0
    assert sales["orders"] == 45
    assert sales["cancelledOrders"] == 1
    assert body["snapshot"]["square"] == sales
    # Refund + cancellation must surface as an exception and an info attention item.
    assert "Refunds/cancellations present." in body["exceptions"]
    assert [i["type"] for i in body["snapshot"]["attentionItems"] if i["type"] == "sales_exceptions"] == ["sales_exceptions"]


def _closed_drawer_mock(monkeypatch, *, closed_cash):
    shift = {
        "id": "SHIFT-1",
        "state": "ENDED" if closed_cash is not None else "OPEN",
        "opened_at": "2026-08-30T11:00:00Z",
        "closed_at": "2026-08-30T22:00:00Z",
        "opened_cash_money": {"amount": 10000},
        "cash_payment_money": {"amount": 45000},
        "cash_refunds_money": {"amount": 2000},
        "cash_paid_in_money": {"amount": 0},
        "cash_paid_out_money": {"amount": 3000},
    }
    if closed_cash is not None:
        shift["closed_cash_money"] = {"amount": closed_cash}

    def fake_request(method, path, **kwargs):
        if path.startswith("/v2/cash-drawers/shifts/SHIFT-1/events"):
            return {"cash_drawer_shift_events": []}
        if path.startswith("/v2/cash-drawers/shifts/SHIFT-1"):
            return {"cash_drawer_shift": shift}
        if path.startswith("/v2/cash-drawers/shifts"):
            return {"cash_drawer_shifts": [{"id": "SHIFT-1", "opened_at": shift["opened_at"], "closed_at": shift["closed_at"]}]}
        return {"payments": []}

    monkeypatch.setattr("backend.daily_close._square_request", fake_request)
    monkeypatch.setattr("backend.daily_close._connection_token", lambda connection: "token")


def test_cash_drawer_expected_cash_and_short_variance(app, client, monkeypatch):
    _, location_id, _ = _setup(app, client, environment="production")
    # opening 100.00 + cash payments 450.00 - refunds 20.00 + paid in 0 - paid out 30.00 = 500.00
    # drawer closed at 495.00 -> 5.00 short
    _closed_drawer_mock(monkeypatch, closed_cash=49500)
    body = _get(client, location_id).get_json()
    cash = body["snapshot"]["cashReconciliation"]
    assert cash["status"] == "available" and cash["mode"] == "drawer_shift"
    assert cash["openingFloat"] == 100.0
    assert cash["cashPayments"] == 450.0
    assert cash["cashRefunds"] == 20.0
    assert cash["paidIn"] == 0.0
    assert cash["paidOut"] == 30.0
    assert cash["expectedCash"] == 500.0
    assert cash["closedCash"] == 495.0
    assert cash["overShort"] == -5.0
    assert "Cash drawer short." in body["exceptions"]
    item = next(i for i in body["snapshot"]["attentionItems"] if i["type"] == "cash_variance")
    assert item["detail"] == "$5.00 short"
    assert body["snapshot"]["healthStatus"] == "Ready with warnings"


def test_cash_drawer_exact_count_has_no_variance(app, client, monkeypatch):
    _, location_id, _ = _setup(app, client, environment="production")
    _closed_drawer_mock(monkeypatch, closed_cash=50000)
    body = _get(client, location_id).get_json()
    assert body["snapshot"]["cashReconciliation"]["overShort"] == 0.0
    assert not any("Cash drawer" in e for e in body["exceptions"])
    assert not any(i["type"] == "cash_variance" for i in body["snapshot"]["attentionItems"])


def test_inventory_variance_basis_excludes_square_consumption(app, client):
    org_id, location_id, _ = _setup(app, client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    item = InventoryItem(organization_id=org_id, location_id=location_id, name="Whole Milk", normalized_name="whole milk", stock_unit="L", current_on_hand=Decimal("10"), average_unit_cost=Decimal("2.00"), created_by_user_id=owner.id)
    db.session.add(item)
    db.session.flush()

    seq: list[int] = []

    def move(delta, source, when=IN_DAY):
        m = InventoryMovement(organization_id=org_id, location_id=location_id, inventory_item_id=item.id, quantity_delta=Decimal(str(delta)), quantity_before=Decimal("0"), quantity_after=Decimal("0"), unit="L", source_type=source, source_record_id=f"fixture-{len(seq)}", created_at=when)
        seq.append(1)
        db.session.add(m)
        db.session.flush()
        return m

    move(-3, "square sale consumption")  # POS depletion: explained by sales, NOT an adjustment
    waste_move = move(-1, "inventory waste")
    move(5, "invoice receipt")
    move(-0.5, "manual adjustment")  # the only unexplained adjustment
    move(-0.25, "stock count reconciliation")
    move(-40, "manual adjustment", when=OUT_OF_DAY)  # previous day: excluded
    db.session.add(InventoryWasteEvent(organization_id=org_id, location_id=location_id, inventory_item_id=item.id, inventory_movement_id=waste_move.id, quantity=Decimal("1"), unit="L", reason="spoiled", occurred_at=IN_DAY, unit_cost=Decimal("2.00"), total_cost=Decimal("2.00")))
    db.session.commit()

    snap = _get(client, location_id).get_json()["snapshot"]
    rec = snap["reconciliation"]
    assert rec["recordedWasteQuantity"] == 1.0
    assert rec["recordedWasteCost"] == 2.0
    assert rec["otherAdjustmentQuantity"] == -0.5  # consumption, waste, receipt, count excluded
    assert rec["physicalCountCorrectionQuantity"] == -0.25
    assert rec["unexplainedVarianceQuantity"] is None  # no opening/closing counts -> not invented
    assert snap["variance"]["value"] == 0.0
    assert snap["inventoryValue"] == 20.0  # 10 L x $2.00


def test_session_flow_open_sync_update_finalize_and_read_only_after(app, client, monkeypatch):
    org_id, location_id, connection_id = _setup(app, client, square_location_ids=("LOC-A", "LOC-B"))
    _seed_sales(connection_id, location_id)
    sync_calls = []
    monkeypatch.setattr("backend.daily_close.sync_square_orders_for_range", lambda *a, **k: sync_calls.append(k))

    opened = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY})
    assert opened.status_code == 200
    session_id = opened.get_json()["session"]["id"]
    assert opened.get_json()["session"]["status"] == "DRAFT"

    # Duplicate submit: same session, no second row.
    again = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY})
    assert again.get_json()["session"]["id"] == session_id
    assert DailyCloseSession.query.filter_by(organization_id=org_id, location_id=location_id).count() == 1

    synced = _post(client, f"/api/pilot/daily-close/{session_id}/sync-sales", {})
    assert synced.status_code == 200
    assert len(sync_calls) == 1
    assert sync_calls[0]["start_at"] == datetime(2026, 8, 30, 4, 0, tzinfo=timezone.utc)
    assert sync_calls[0]["end_at"] == datetime(2026, 8, 31, 3, 59, 59, 999999, tzinfo=timezone.utc)

    updated = _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "Short-staffed lunch", "reconciliation": {"countedCash": 495}})
    assert updated.status_code == 200
    assert updated.get_json()["session"]["notes"] == "Short-staffed lunch"
    assert updated.get_json()["snapshot"]["manualReconciliation"]["countedCash"] == 495.0
    # An update before finalize re-reads sales; figures stay identical.
    assert updated.get_json()["snapshot"]["sales"]["netSales"] == 1130.0

    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize")
    assert final.status_code == 200
    assert final.get_json()["session"]["status"] == "COMPLETED"
    frozen_sales = final.get_json()["snapshot"]["sales"]
    assert frozen_sales["netSales"] == 1130.0 and frozen_sales["orders"] == 45
    completed_at = DailyCloseSession.query.get(session_id).completed_at

    # Duplicate finalize / stale edits after finalize are rejected and change nothing.
    for resp in (
        _post(client, f"/api/pilot/daily-close/{session_id}/finalize"),
        _patch(client, f"/api/pilot/daily-close/{session_id}", {"notes": "late edit"}),
        _post(client, f"/api/pilot/daily-close/{session_id}/sync-sales", {}),
    ):
        assert resp.status_code == 409
        assert "read-only" in str(resp.get_json())
    db.session.expire_all()
    record = DailyCloseSession.query.get(session_id)
    assert record.completed_at == completed_at
    assert record.notes == "Short-staffed lunch"
    assert len(sync_calls) == 1

    # Re-opening the same date does not reopen or alter the completed session.
    reopened = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY})
    assert reopened.get_json()["session"]["status"] == "COMPLETED"

    # Late POS data after finalize must not change the stored close or its history report.
    row = SquareDailySalesSummary.query.filter_by(square_connection_id=connection_id, square_location_id="LOC-A", sale_date=date(2026, 8, 30)).one()
    row.gross_amount = 9000
    row.net_amount = 8940
    db.session.commit()
    after = _get(client, location_id).get_json()
    assert after["snapshot"]["sales"] == frozen_sales
    history_entry = next(h for h in after["history"] if h["id"] == session_id)
    assert history_entry["currentSnapshot"]["sales"] == frozen_sales


def test_unknown_session_is_not_found(app, client):
    _setup(app, client)
    assert _patch(client, "/api/pilot/daily-close/999999", {"notes": "x"}).status_code == 404
    assert _post(client, "/api/pilot/daily-close/999999/finalize").status_code == 404
    assert _post(client, "/api/pilot/daily-close/999999/sync-sales", {}).status_code == 404


def test_manual_counted_cash_has_no_variance_without_expected_cash(app, client, monkeypatch):
    """Documents current behavior: a manual counted-cash entry is stored, but a
    variance is only computed when Square supplies an expected-cash figure
    without a closed drawer, which the drawer reader never produces. See the
    follow-up issue filed from #206."""
    _, location_id, _ = _setup(app, client, environment="production")
    _closed_drawer_mock(monkeypatch, closed_cash=None)  # shift still OPEN -> no reconciled expected cash
    session_id = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY}).get_json()["session"]["id"]
    body = _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 480}}).get_json()
    assert body["snapshot"]["manualReconciliation"]["countedCash"] == 480.0
    assert body["snapshot"]["cashReconciliation"]["expectedCash"] is None
    assert "overShort" not in body["snapshot"]["cashReconciliation"]


@pytest.mark.xfail(strict=True, reason="Defect tracked in #207: finalize drops manual counted cash")
def test_finalize_keeps_manual_counted_cash_in_stored_close(app, client):
    """Finalize recomputes the snapshot; the counted cash entered before finalize must survive."""
    _, location_id, _ = _setup(app, client)
    session_id = _post(client, "/api/pilot/daily-close", {"locationId": location_id, "businessDate": DAY}).get_json()["session"]["id"]
    _patch(client, f"/api/pilot/daily-close/{session_id}", {"reconciliation": {"countedCash": 480}})
    final = _post(client, f"/api/pilot/daily-close/{session_id}/finalize").get_json()
    assert final["snapshot"]["manualReconciliation"].get("countedCash") == 480.0
