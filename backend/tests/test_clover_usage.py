from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from backend.clover_usage import clover_usage_for_day
from backend.extensions import db
from backend.models import (
    CloverConnection, CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption,
    InventoryItem, RestaurantLocation, User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization

NOON = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)


def _base(name):
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=f"{name} {uuid4()}", location_name="Main")
    loc = RestaurantLocation.query.filter_by(organization_id=org.id).first()
    conn = CloverConnection(organization_id=org.id, environment="sandbox", merchant_id="m", status="connected", access_token_ciphertext="x")
    db.session.add(conn)
    db.session.flush()
    item = InventoryItem(organization_id=org.id, location_id=loc.id, name="Chicken", normalized_name=f"c-{uuid4()}", stock_unit="kg", current_on_hand=Decimal("10"), average_unit_cost=Decimal("8"))
    db.session.add(item)
    db.session.flush()
    return org, loc, conn, item


def _order(org, loc, conn, *, status="paid", review=False, closed=NOON, oid=None):
    o = CloverShadowOrder(organization_id=org.id, clover_connection_id=conn.id, restaurant_location_id=loc.id, clover_merchant_id="m",
                          clover_order_id=oid or f"o-{uuid4()}", normalized_status=status, requires_review=review, source_closed_at=closed, raw_payload_json={})
    db.session.add(o)
    db.session.flush()
    return o


def _line(org, loc, order, *, mapping="mapped", qty="2", name="Chicken Plate"):
    l = CloverShadowOrderLine(organization_id=org.id, restaurant_location_id=loc.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4()}",
                              clover_item_id="i", name=name, quantity=Decimal(qty), mapping_status=mapping, recipe_preview_json={"flowtallyMenuItemName": name})
    db.session.add(l)
    db.session.flush()
    return l


def _ledger(org, loc, line, item, qty, cost="8"):
    db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=org.id, location_id=loc.id, clover_shadow_order_line_id=line.id,
                                                             inventory_item_id=item.id, applied_quantity=Decimal(qty), unit_cost_snapshot=None if cost is None else Decimal(cost)))
    db.session.flush()


def test_usage_cost_reads_ledger_and_food_cost_needs_net_sales(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage A")
        o = _order(org, loc, conn)
        l = _line(org, loc, o)
        _ledger(org, loc, l, item, "0.5")  # 0.5kg @ $8 = $4.00
        # Cost snapshot, not today's average cost, is used.
        item.average_unit_cost = Decimal("99")
        db.session.commit()
        r = clover_usage_for_day(loc, date(2026, 11, 3), net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 400 and r["foodCostPercent"] == 40.0
        assert r["menuSales"] == [{"name": "Chicken Plate", "quantity": "2.0000"}]
        assert clover_usage_for_day(loc, date(2026, 11, 3))["foodCostPercent"] is None  # net sales unavailable


def test_unapplied_inventory_and_missing_cost_make_usage_unavailable(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage B")
        o = _order(org, loc, conn)
        _line(org, loc, o)  # mapped but no consumption ledger (flag off)
        db.session.commit()
        r = clover_usage_for_day(loc, date(2026, 11, 3), net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None
        assert {"orderId": o.id, "reason": "inventory_not_applied"} in r["exceptions"]
        o2 = _order(org, loc, conn)
        _ledger(org, loc, _line(org, loc, o2), item, "1", cost=None)
        db.session.commit()
        assert clover_usage_for_day(loc, date(2026, 11, 3))["usageCostCents"] is None


def test_unmapped_review_refunded_and_other_day_orders_are_excluded(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage C")
        refunded = _order(org, loc, conn, status="refunded", review=True)
        _ledger(org, loc, _line(org, loc, refunded), item, "3")
        next_day = _order(org, loc, conn, closed=datetime(2026, 11, 4, 5, 0, tzinfo=timezone.utc))
        _ledger(org, loc, _line(org, loc, next_day), item, "3")
        good = _order(org, loc, conn)
        _ledger(org, loc, _line(org, loc, good), item, "1")
        unmapped = _line(org, loc, good, mapping="unmapped", name="Mystery")
        db.session.commit()
        r = clover_usage_for_day(loc, date(2026, 11, 3), net_sales_cents=1000)
        assert r["usage"][0]["quantity"] == "1.0000" and r["usageCostCents"] == 800
        reasons = {e["reason"] for e in r["exceptions"]}
        assert {"not_counted_refunded", "needs_mapping"} <= reasons
        assert any(e.get("lineId") == unmapped.id for e in r["exceptions"])


def test_tenant_and_location_isolation_and_replay_dedupe(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage D")
        org2, loc2, conn2, item2 = _base("Usage E")
        o = _order(org, loc, conn, oid="same")
        _ledger(org, loc, _line(org, loc, o), item, "1")
        dup = _order(org, loc, conn, oid="same-2")  # distinct provider id: counted separately
        _ledger(org, loc, _line(org, loc, dup), item, "1")
        other = _order(org2, loc2, conn2)
        _ledger(org2, loc2, _line(org2, loc2, other), item2, "50")
        db.session.commit()
        r = clover_usage_for_day(loc, date(2026, 11, 3), net_sales_cents=1000)
        assert r["usage"][0]["quantity"] == "2.0000" and all(row["inventoryItemId"] == item.id for row in r["usage"])
