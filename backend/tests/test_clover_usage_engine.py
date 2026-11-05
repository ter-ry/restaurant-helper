"""#240: Clover usage/food cost must reconcile with what the real inventory engine records.

These tests never hand-seed ledger rows: they run ``apply_clover_order_inventory`` (flag on, in a test
app only) and read the result through ``clover_usage_for_day``. The engine stores the signed stock
delta in ``applied_quantity`` (negative for consumption).
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from backend.clover_inventory import apply_clover_order_inventory
from backend.clover_usage import clover_usage_for_day
from backend.extensions import db
from backend.models import (
    CloverConnection, CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption,
    InventoryItem, InventoryMovement, RestaurantLocation, User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization

DAY = date(2026, 11, 3)
NOON = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)


def _scenario(app, label):
    app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=f"Usage engine {label} {uuid4()}", location_name="Main")
    loc = RestaurantLocation.query.filter_by(organization_id=org.id).first()
    conn = CloverConnection(organization_id=org.id, environment="sandbox", merchant_id=f"m-{label}", status="connected", access_token_ciphertext="x")
    db.session.add(conn)
    db.session.flush()
    chicken = InventoryItem(organization_id=org.id, location_id=loc.id, name="Chicken", normalized_name=f"chicken-{uuid4()}", stock_unit="kg",
                            current_on_hand=Decimal("10"), average_unit_cost=Decimal("12.50"))
    buns = InventoryItem(organization_id=org.id, location_id=loc.id, name="Buns", normalized_name=f"buns-{uuid4()}", stock_unit="pack",
                         current_on_hand=Decimal("20"), average_unit_cost=Decimal("2.00"))
    db.session.add_all([chicken, buns])
    db.session.flush()
    order = CloverShadowOrder(organization_id=org.id, clover_connection_id=conn.id, restaurant_location_id=loc.id, clover_merchant_id=f"m-{label}",
                              clover_order_id=f"o-{uuid4()}", provider_status="CLOSED", normalized_status="paid", payment_status="PAID",
                              potentially_eligible=True, requires_review=False, raw_payload_json={}, source_closed_at=NOON)
    db.session.add(order)
    db.session.flush()
    line = CloverShadowOrderLine(
        organization_id=org.id, restaurant_location_id=loc.id, shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4()}", clover_item_id="i",
        name="Chicken Burger", quantity=Decimal("1"), mapping_status="mapped",
        recipe_preview_json={"flowtallyMenuItemName": "Chicken Burger", "ingredients": [
            {"inventoryItemId": chicken.id, "quantity": "0.1800", "unit": "kg", "name": "Chicken"},
            {"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"},
        ]})
    db.session.add(line)
    db.session.commit()
    return org, loc, conn, order, line, chicken, buns


def _apply(order, conn):
    result = apply_clover_order_inventory(order=order, connection=conn)
    db.session.commit()
    return result


def _set_recipe(line, chicken, buns, chicken_qty, with_buns=True, extra=None):
    ingredients = [{"inventoryItemId": chicken.id, "quantity": chicken_qty, "unit": "kg", "name": "Chicken"}]
    if with_buns:
        ingredients.append({"inventoryItemId": buns.id, "quantity": "0.2500", "unit": "pack", "name": "Buns"})
    ingredients.extend(extra or [])
    line.recipe_preview_json = {"flowtallyMenuItemName": "Chicken Burger", "ingredients": ingredients}
    db.session.commit()


def _movements(org):
    return InventoryMovement.query.filter_by(organization_id=org.id).count()


def test_real_engine_output_gives_usage_cost_equal_to_stock_movement(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "a")
        assert _apply(order, conn)["applied"] is True
        # The engine stores the signed delta, with the cost snapshot taken at apply time.
        ledgers = {l.inventory_item_id: l for l in CloverShadowOrderLineInventoryConsumption.query.filter_by(organization_id=org.id).all()}
        assert ledgers[chicken.id].applied_quantity == Decimal("-0.1800") and ledgers[chicken.id].unit_cost_snapshot == Decimal("12.50")
        assert ledgers[buns.id].applied_quantity == Decimal("-0.2500") and ledgers[buns.id].unit_cost_snapshot == Decimal("2.00")
        assert (Decimal(chicken.current_on_hand), Decimal(buns.current_on_hand)) == (Decimal("9.8200"), Decimal("19.7500"))

        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["exceptions"] == []
        assert r["usageCostCents"] == 275 and r["foodCostPercent"] == 27.5
        by_name = {row["name"]: row for row in r["usage"]}
        assert by_name["Chicken"]["quantity"] == "0.1800" and by_name["Chicken"]["costCents"] == 225
        assert by_name["Buns"]["quantity"] == "0.2500" and by_name["Buns"]["costCents"] == 50
        assert r["menuSales"] == [{"name": "Chicken Burger", "quantity": "1.0000"}]
        # Reconciles with the movement ledger: -(sum of movement x snapshot cost) == usage cost.
        moved = sum(-m.quantity_delta * ledgers[m.inventory_item_id].unit_cost_snapshot for m in InventoryMovement.query.filter_by(organization_id=org.id))
        assert int(moved * 100) == r["usageCostCents"]


def test_replay_is_idempotent_and_cost_snapshot_survives_later_cost_changes(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "b")
        _apply(order, conn)
        before = _movements(org)
        replay = _apply(order, conn)
        assert replay["applied"] is True and _movements(org) == before == 2
        chicken.average_unit_cost = Decimal("99")  # a later cost change must not rewrite history
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageCostCents"] == 275 and r["foodCostPercent"] == 27.5
        assert Decimal(chicken.current_on_hand) == Decimal("9.8200")


def test_recipe_correction_updates_usage_and_replay_changes_nothing(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "c")
        _apply(order, conn)
        _set_recipe(line, chicken, buns, "0.2000")
        corrected = _apply(order, conn)
        assert [m["state"] for m in corrected["movements"] if m["inventoryItemId"] == chicken.id] == ["correction"]
        assert Decimal(chicken.current_on_hand) == Decimal("9.8000") and Decimal(buns.current_on_hand) == Decimal("19.7500")
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 300 and r["foodCostPercent"] == 30.0
        before = _movements(org)
        _apply(order, conn)
        assert _movements(org) == before
        assert clover_usage_for_day(loc, DAY, net_sales_cents=1000)["usageCostCents"] == 300


def test_correction_that_lowers_the_recipe_also_reconciles(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "d")
        _apply(order, conn)
        _set_recipe(line, chicken, buns, "0.1000")
        _apply(order, conn)
        assert Decimal(chicken.current_on_hand) == Decimal("9.9000")
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 175 and r["foodCostPercent"] == 17.5


def test_unapplied_order_and_recipe_edited_after_apply_without_reapply_fail_closed(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "e")
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)  # nothing applied yet
        assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None
        _apply(order, conn)
        _set_recipe(line, chicken, buns, "0.2000")  # recipe changed, correction not yet applied
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None


def test_ingredient_removed_after_apply_is_stale_and_fails_closed(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "f")
        _apply(order, conn)
        _set_recipe(line, chicken, buns, "0.1800", with_buns=False)
        stale = _apply(order, conn)
        assert stale["applied"] is False and stale["reason"] == "stale_applied_ingredient_requires_review"
        assert Decimal(buns.current_on_hand) == Decimal("19.7500")  # engine never silently restores stock
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None
        assert any(e.get("lineId") == line.id and e["reason"] == "inventory_not_applied" for e in r["exceptions"])


def test_repeated_ingredient_in_one_recipe_is_summed_like_the_engine(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "g")
        _set_recipe(line, chicken, buns, "0.1000", extra=[{"inventoryItemId": chicken.id, "quantity": "0.0800", "unit": "kg", "name": "Chicken"}])
        _apply(order, conn)
        assert Decimal(chicken.current_on_hand) == Decimal("9.8200")
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert r["usageAvailable"] and r["usageCostCents"] == 275


def test_malformed_recipe_after_apply_never_yields_a_figure(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "h")
        _apply(order, conn)
        for bad in ("0", "-0.1800", "NaN", "sNaN", "Infinity", "-Infinity", "1E+40", "bad"):
            _set_recipe(line, chicken, buns, bad)
            r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
            assert not r["usageAvailable"] and r["usageCostCents"] is None and r["foodCostPercent"] is None, bad
            before = _movements(org)
            result = _apply(order, conn)  # must return an ineligible plan, never raise
            assert result["applied"] is False and result["eligible"] is False and _movements(org) == before, bad
            assert result["reason"] in {"invalid_recipe_quantity", "invalid_recipe_ingredient"}, bad


def test_positive_or_legacy_signed_ledger_rows_fail_closed(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "i")
        _apply(order, conn)
        for ledger in CloverShadowOrderLineInventoryConsumption.query.filter_by(organization_id=org.id):
            ledger.applied_quantity = -ledger.applied_quantity  # a positive "applied" quantity is not consumption
        db.session.commit()
        r = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        assert not r["usageAvailable"] and r["usageCostCents"] is None


def test_other_tenant_orders_never_change_this_tenants_figures(app):
    with app.app_context():
        org, loc, conn, order, line, chicken, buns = _scenario(app, "j1")
        org2, loc2, conn2, order2, line2, chicken2, buns2 = _scenario(app, "j2")
        _set_recipe(line2, chicken2, buns2, "1.5000")
        _apply(order, conn)
        _apply(order2, conn2)
        mine = clover_usage_for_day(loc, DAY, net_sales_cents=1000)
        theirs = clover_usage_for_day(loc2, DAY, net_sales_cents=1000)
        assert mine["usageCostCents"] == 275 and [row["inventoryItemId"] for row in mine["usage"]] == sorted([chicken.id, buns.id])
        assert theirs["usageCostCents"] == 1875 + 50 and chicken.id not in {row["inventoryItemId"] for row in theirs["usage"]}
