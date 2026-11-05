from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

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


def _line(org, loc, order, items=(), *, mapping="mapped", qty="2", name="Chicken Plate"):
    """A line whose recipe preview lists ``items`` as [(InventoryItem, per-line quantity)]."""
    ingredients = [{"inventoryItemId": i.id, "quantity": q, "unit": i.stock_unit, "name": i.name} for i, q in items]
    l = CloverShadowOrderLine(organization_id=org.id, restaurant_location_id=loc.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4()}",
                              clover_item_id="i", name=name, quantity=Decimal(qty), mapping_status=mapping,
                              recipe_preview_json={"flowtallyMenuItemName": name, "ingredients": ingredients})
    db.session.add(l)
    db.session.flush()
    return l


def _ledger(org, loc, line, item, qty, cost="8"):
    db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=org.id, location_id=loc.id, clover_shadow_order_line_id=line.id,
                                                             inventory_item_id=item.id, applied_quantity=-Decimal(qty), unit_cost_snapshot=None if cost is None else Decimal(cost)))
    db.session.flush()


def _item(org, loc, name="Buns", unit="pack"):
    i = InventoryItem(organization_id=org.id, location_id=loc.id, name=name, normalized_name=f"{name}-{uuid4()}", stock_unit=unit, current_on_hand=Decimal("10"), average_unit_cost=Decimal("2"))
    db.session.add(i)
    db.session.flush()
    return i


DAY = date(2026, 11, 3)


def _covered_line(org, loc, order, item, qty="0.5000", cost="8", **kw):
    line = _line(org, loc, order, [(item, qty)], **kw)
    _ledger(org, loc, line, item, qty, cost)
    return line


def test_fully_covered_day_reports_cost_from_snapshot_and_food_cost(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage A")
        _covered_line(org, loc, _order(org, loc, conn), item)  # 0.5kg @ $8 = $4.00
        item.average_unit_cost = Decimal("99")  # later cost change must not matter
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 400 and r["foodCostPercent"] == 40.0
        assert r["menuSales"] == [{"name": "Chicken Plate", "quantity": "2.0000"}] and r["exceptions"] == []
        assert clover_usage_for_day(loc, DAY)["foodCostPercent"] is None  # net sales unavailable -> no %


def test_two_lines_with_only_one_ledger_row_is_never_complete(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage B")
        buns = _item(org, loc)
        o = _order(org, loc, conn)
        _covered_line(org, loc, o, item)
        uncovered = _line(org, loc, o, [(buns, "2.0000")], name="Burger")  # same order, no ledger for this line
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None
        assert {"orderId": o.id, "lineId": uncovered.id, "name": "Burger", "reason": "inventory_not_applied"} in r["exceptions"]
        assert r["menuSales"] == [{"name": "Chicken Plate", "quantity": "2.0000"}]  # only the covered line


def test_missing_ingredient_ledger_wrong_quantity_or_missing_cost_is_incomplete(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage C")
        buns = _item(org, loc)
        # recipe needs chicken AND buns, only chicken has a ledger row
        line = _line(org, loc, _order(org, loc, conn), [(item, "0.5000"), (buns, "1.0000")])
        _ledger(org, loc, line, item, "0.5000")
        db.session.commit()
        assert not clover_usage_for_day(loc, DAY, net_sales_cents=1000)["usageAvailable"]
    with app.app_context():
        org, loc, conn, item = _base("Usage C2")
        line = _line(org, loc, _order(org, loc, conn), [(item, "0.5000")])
        _ledger(org, loc, line, item, "0.2000")  # applied differs from the recipe (partial application)
        db.session.commit()
        assert not clover_usage_for_day(loc, DAY, net_sales_cents=1000)["usageAvailable"]
    with app.app_context():
        org, loc, conn, item = _base("Usage C3")
        _covered_line(org, loc, _order(org, loc, conn), item, cost=None)
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None


def test_mapped_line_without_recipe_and_unmapped_or_review_lines_block_completeness(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage D")
        o = _order(org, loc, conn)
        _covered_line(org, loc, o, item)
        db.session.commit()
        assert clover_usage_for_day(loc, DAY, net_sales_cents=1000)["usageAvailable"]
        mystery = _line(org, loc, o, mapping="unmapped", name="Mystery")
        review = _line(org, loc, o, mapping="review_required", name="Modded")
        empty = _line(org, loc, o, [], name="NoRecipe")
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        reasons = {(e["lineId"], e["reason"]) for e in r["exceptions"] if "lineId" in e}
        assert {(mystery.id, "needs_mapping"), (review.id, "line_needs_review"), (empty.id, "recipe_missing")} <= reasons
        assert not r["usageAvailable"] and r["usageCostCents"] is None


@pytest.mark.parametrize("raw", [{"incomplete": True}, {"lineItemsIncomplete": True}, {"financialIncomplete": True}, {"refundsUnverified": True},
                                 {"paymentStateConflict": True}, {"refunds": [{"id": "r", "amount": 100, "components": []}]}])
def test_orders_with_uncertainty_markers_are_excluded_and_block_completeness(app, raw):
    with app.app_context():
        org, loc, conn, item = _base("Usage E")
        _covered_line(org, loc, _order(org, loc, conn), item)
        flagged = _order(org, loc, conn)
        flagged.raw_payload_json = raw
        _covered_line(org, loc, flagged, item, qty="3.0000")  # stock moved, but evidence is not trustworthy
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["exceptions"][0]["orderId"] == flagged.id and r["exceptions"][0]["reason"] in {"incomplete_evidence", "refund_present"}
        assert not r["usageAvailable"] and r["usageCostCents"] is None
        assert r["usage"][0]["quantity"] == "0.5000"  # flagged order's consumption is not summed


def test_refunded_and_review_orders_block_but_cancelled_and_other_day_do_not(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage F")
        _covered_line(org, loc, _order(org, loc, conn), item)
        _order(org, loc, conn, status="cancelled")
        next_day = _order(org, loc, conn, closed=datetime(2026, 11, 4, 5, 0, tzinfo=timezone.utc))
        _covered_line(org, loc, next_day, item, qty="3.0000")
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 400
        refunded = _order(org, loc, conn, status="refunded", review=True)
        _covered_line(org, loc, refunded, item, qty="3.0000")
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and any(e["reason"] == "not_counted_refunded" for e in r["exceptions"])
        assert r["usage"][0]["quantity"] == "0.5000"


def test_tenant_and_location_isolation(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage G")
        org2, loc2, conn2, item2 = _base("Usage H")
        _covered_line(org, loc, _order(org, loc, conn), item)
        _covered_line(org2, loc2, _order(org2, loc2, conn2), item2, qty="50.0000")
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and [row["inventoryItemId"] for row in r["usage"]] == [item.id] and r["usage"][0]["quantity"] == "0.5000"


def test_empty_day_and_malformed_recipe_payloads_never_look_complete(app):
    with app.app_context():
        org, loc, conn, item = _base("Usage I")
        empty = clover_usage_for_day(loc, DAY, net_sales_cents=0)
        assert empty["usage"] == [] and empty["usageCostCents"] == 0 and empty["foodCostPercent"] is None  # no sales -> no %
        o = _order(org, loc, conn)
        for payload in ({}, {"ingredients": None}, {"ingredients": "x"}, {"ingredients": [{}]}, {"ingredients": [{"inventoryItemId": None, "quantity": "1"}]},
                        {"ingredients": [{"inventoryItemId": item.id, "quantity": "bad"}]},
                        {"ingredients": [None]}, {"ingredients": [7]}, {"ingredients": ["x"]}, {"ingredients": [[1]]},
                        {"ingredients": [None, {"inventoryItemId": item.id, "quantity": "1"}]}, ["not", "a", "dict"], "scalar"):
            line = CloverShadowOrderLine(organization_id=org.id, restaurant_location_id=loc.id, shadow_order_id=o.id, clover_line_item_id=f"l-{uuid4()}",
                                         clover_item_id="i", name="Odd", quantity=Decimal("1"), mapping_status="mapped", recipe_preview_json=payload)
            db.session.add(line)
            db.session.commit()
            r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
            assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None, payload
            assert any(e.get("lineId") == line.id for e in r["exceptions"]), payload
            db.session.delete(line)
            db.session.commit()
