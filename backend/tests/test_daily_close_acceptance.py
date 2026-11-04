"""Daily Close acceptance tests with hand-computed expected figures (Square baseline, #206).

The expected numbers below are written out by hand from the fixture data; they are not
derived from production formulas. Clover parity (#167) must keep these Square figures
identical.
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

DAY = date(2026, 6, 10)
# Noon Toronto (EDT) on DAY, safely inside the business-day bounds.
NOON = datetime(2026, 6, 10, 16, 0, tzinfo=timezone.utc)
MODULES = ("PURCHASES", "INVENTORY", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE")


def _csrf(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


@pytest.fixture()
def cafe(app, client, monkeypatch):
    """A mapped Square cafe with one business day of fixed sales and inventory movements."""
    login = client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers=_csrf(client))
    assert login.status_code == 200
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = make_operational_organization(owner, name=f"Close Cafe {uuid4().hex[:8]}", location_name="Queen St Cafe", enabled_modules=MODULES)
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).one()
        connection = SquareConnection(
            organization_id=organization.id, environment="sandbox", square_merchant_id=f"m-{uuid4().hex[:6]}",
            status="connected", sync_status="idle", last_sync_at=NOON,
        )
        db.session.add(connection)
        db.session.flush()
        mapped = SquareLocation(square_connection_id=connection.id, square_location_id="LOC-MAPPED", name="Queen St", status="ACTIVE", raw_payload_json={})
        other = SquareLocation(square_connection_id=connection.id, square_location_id="LOC-OTHER", name="Other shop", status="ACTIVE", raw_payload_json={})
        db.session.add_all([mapped, other])
        db.session.flush()
        db.session.add(SquareLocationMapping(square_location_id=mapped.id, restaurant_location_id=location.id, mapped_by_user_id=owner.id))
        # Mapped location, the business day: the only figures that may appear.
        db.session.add(SquareDailySalesSummary(
            square_connection_id=connection.id, square_location_id="LOC-MAPPED", restaurant_location_id=location.id, sale_date=DAY,
            gross_amount=Decimal("1000.00"), discount_amount=Decimal("50.00"), tax_amount=Decimal("123.50"), tip_amount=Decimal("80.00"),
            refund_amount=Decimal("40.00"), net_amount=Decimal("910.00"), order_count=42, cancelled_order_count=2,
        ))
        # Decoys: unmapped Square location, and the mapped location on another day.
        db.session.add(SquareDailySalesSummary(
            square_connection_id=connection.id, square_location_id="LOC-OTHER", sale_date=DAY,
            gross_amount=Decimal("999.00"), net_amount=Decimal("999.00"), order_count=99,
        ))
        db.session.add(SquareDailySalesSummary(
            square_connection_id=connection.id, square_location_id="LOC-MAPPED", restaurant_location_id=location.id, sale_date=date(2026, 6, 9),
            gross_amount=Decimal("777.00"), net_amount=Decimal("777.00"), order_count=77,
        ))
        item = InventoryItem(
            organization_id=organization.id, location_id=location.id, name="Espresso Beans", normalized_name="espresso beans",
            stock_unit="kg", current_on_hand=Decimal("20"), average_unit_cost=Decimal("17.00"),
        )
        db.session.add(item)
        db.session.flush()

        def move(delta, source_type, reason=""):
            movement = InventoryMovement(
                organization_id=organization.id, location_id=location.id, inventory_item_id=item.id, quantity_delta=Decimal(str(delta)),
                quantity_before=Decimal("0"), quantity_after=Decimal("0"), unit="kg", source_type=source_type,
                source_record_id=uuid4().hex[:8], reason=reason, created_at=NOON,
            )
            db.session.add(movement)
            db.session.flush()
            return movement

        move("10", "invoice receipt")                      # received stock: never variance
        move("-3", "square sale consumption")              # POS usage: never unexplained adjustment
        move("-0.5", "manual adjustment", "spilled bag")   # the only "other adjustment"
        move("-0.2", "stock count reconciliation")         # physical count correction
        waste = move("-0.4", "inventory waste", "expired")
        db.session.add(InventoryWasteEvent(
            organization_id=organization.id, location_id=location.id, inventory_item_id=item.id, inventory_movement_id=waste.id,
            quantity=Decimal("0.4"), unit="kg", reason="expired", occurred_at=NOON, unit_cost=Decimal("17.00"), total_cost=Decimal("6.80"),
        ))
        db.session.commit()
        ids = {"organization_id": organization.id, "location_id": location.id, "item_id": item.id}

    selected = client.post("/api/organizations/select", headers=_csrf(client), json={"organizationId": ids["organization_id"]})
    assert selected.status_code == 200
    # No network: freshness is a Square API call, and the Sandbox connection has no cash-drawer access.
    monkeypatch.setattr("backend.daily_close.ensure_square_orders_fresh", lambda *a, **k: {"status": "fresh"})
    return ids


def _open(client, ids):
    response = client.post("/api/pilot/daily-close", headers=_csrf(client), json={"locationId": ids["location_id"], "businessDate": DAY.isoformat()})
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _expected_cash(monkeypatch, expected="250.00"):
    monkeypatch.setattr(
        "backend.daily_close._cash_reconciliation",
        lambda *a, **k: {"status": "available", "mode": "shift", "expectedCash": float(expected), "closedCash": None},
    )


def test_sales_summary_uses_only_the_mapped_location_and_business_day(client, cafe):
    body = _open(client, cafe)
    sales = body["snapshot"]["sales"]
    assert body["businessDate"] == "2026-06-10"
    assert sales["grossSales"] == 1000.0
    assert sales["discounts"] == 50.0
    assert sales["tax"] == 123.5
    assert sales["tips"] == 80.0
    assert sales["refunds"] == 40.0
    assert sales["netSales"] == 910.0
    assert sales["orders"] == 42
    assert sales["cancelledOrders"] == 2
    assert sales["squareLocationIds"] == ["LOC-MAPPED"] and sales["locationMapped"] is True
    assert body["snapshot"]["square"] == sales


def test_pos_consumption_is_not_an_unexplained_adjustment_and_stock_effects_are_split_correctly(client, cafe):
    reconciliation = _open(client, cafe)["snapshot"]["reconciliation"]
    # Hand-computed from the fixture: waste 0.4 kg at $17 = $6.80; manual adjustment -0.5 kg;
    # count correction -0.2 kg. The 10 kg receipt and -3 kg Square consumption appear in none of these.
    assert reconciliation["recordedWasteQuantity"] == pytest.approx(0.4)
    assert reconciliation["recordedWasteCost"] == 6.8
    assert reconciliation["otherAdjustmentQuantity"] == pytest.approx(-0.5)
    assert reconciliation["physicalCountCorrectionQuantity"] == pytest.approx(-0.2)


def test_manual_cash_count_sets_exact_variance_and_survives_repeated_updates(client, cafe, monkeypatch):
    _expected_cash(monkeypatch, "250.00")
    session_id = _open(client, cafe)["session"]["id"]
    first = client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"notes": "busy Friday", "reconciliation": {"countedCash": 237.5}})
    assert first.status_code == 200
    snap = first.get_json()["snapshot"]
    assert snap["cashReconciliation"]["countedCash"] == 237.5
    assert snap["cashReconciliation"]["overShort"] == -12.5
    assert [a["detail"] for a in snap["attentionItems"] if a["type"] == "cash_variance"] == ["$12.50 short"]
    assert snap["healthStatus"] == "Ready with warnings"
    # Duplicate submit: same payload again changes nothing and does not duplicate the warning.
    second = client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"notes": "busy Friday", "reconciliation": {"countedCash": 237.5}})
    assert second.get_json()["snapshot"]["cashReconciliation"]["overShort"] == -12.5
    assert len([a for a in second.get_json()["snapshot"]["attentionItems"] if a["type"] == "cash_variance"]) == 1
    # A later update without a reconciliation payload keeps the stored count.
    third = client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"notes": "busy Friday, tips short"})
    assert third.get_json()["snapshot"]["cashReconciliation"]["countedCash"] == 237.5
    # Correcting the count to the exact expected cash clears the variance.
    fixed = client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"reconciliation": {"countedCash": 250}})
    cash = fixed.get_json()["snapshot"]["cashReconciliation"]
    assert cash["overShort"] == 0
    assert all(a["type"] != "cash_variance" for a in fixed.get_json()["snapshot"]["attentionItems"])


def test_finalize_freezes_figures_including_the_manual_cash_count(app, client, cafe, monkeypatch):
    _expected_cash(monkeypatch, "250.00")
    session_id = _open(client, cafe)["session"]["id"]
    client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"reconciliation": {"countedCash": 237.5}})
    finalized = client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=_csrf(client))
    assert finalized.status_code == 200, finalized.get_data(as_text=True)
    body = finalized.get_json()
    assert body["session"]["status"] == "COMPLETED"
    assert body["snapshot"]["sales"]["netSales"] == 910.0
    assert body["snapshot"]["cashReconciliation"]["countedCash"] == 237.5
    assert body["snapshot"]["cashReconciliation"]["overShort"] == -12.5

    # Later sales for the same day must not change a completed close.
    with app.app_context():
        row = SquareDailySalesSummary.query.filter_by(square_location_id="LOC-MAPPED", sale_date=DAY).one()
        row.net_amount = Decimal("1234.00")
        db.session.commit()
    reread = client.post("/api/pilot/daily-close", headers=_csrf(client), json={"locationId": cafe["location_id"], "businessDate": DAY.isoformat()})
    assert reread.get_json()["snapshot"]["sales"]["netSales"] == 910.0
    assert reread.get_json()["snapshot"]["cashReconciliation"]["overShort"] == -12.5
    assert reread.get_json()["session"]["status"] == "COMPLETED"


def test_completed_close_is_read_only_and_duplicate_finalize_is_rejected(app, client, cafe):
    session_id = _open(client, cafe)["session"]["id"]
    assert client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=_csrf(client)).status_code == 200
    assert client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=_csrf(client)).status_code == 409
    assert client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"notes": "late edit"}).status_code == 409
    assert client.post(f"/api/pilot/daily-close/{session_id}/sync-sales", headers=_csrf(client), json={}).status_code == 409
    with app.app_context():
        assert DailyCloseSession.query.filter_by(id=session_id).one().notes == ""


def test_opening_the_same_day_twice_returns_the_same_session(app, client, cafe):
    first = _open(client, cafe)["session"]["id"]
    second = _open(client, cafe)["session"]["id"]
    assert first == second
    with app.app_context():
        assert DailyCloseSession.query.filter_by(location_id=cafe["location_id"], business_date=DAY).count() == 1


def test_daily_close_is_scoped_to_the_organizations_own_sessions(app, client, cafe):
    session_id = _open(client, cafe)["session"]["id"]
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        other = make_operational_organization(owner, name=f"Other Cafe {uuid4().hex[:8]}", location_name="Elsewhere", enabled_modules=MODULES)
        other_id = other.id
    selected = client.post("/api/organizations/select", headers=_csrf(client), json={"organizationId": other_id})
    assert selected.status_code == 200
    assert client.patch(f"/api/pilot/daily-close/{session_id}", headers=_csrf(client), json={"notes": "x"}).status_code == 404
    assert client.post(f"/api/pilot/daily-close/{session_id}/finalize", headers=_csrf(client)).status_code == 404
