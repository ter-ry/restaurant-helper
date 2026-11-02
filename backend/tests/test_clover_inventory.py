from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from backend.clover_inventory import apply_clover_order_inventory, plan_clover_order_inventory


def _order(*, eligible=True, review=False, raw=None):
    ingredient = {"inventoryItemId": 7, "quantity": "0.1800", "unit": "kg", "name": "Chicken Breast"}
    line = SimpleNamespace(
        id=11,
        mapping_status="mapped",
        recipe_preview_json={"ingredients": [ingredient]},
    )
    return SimpleNamespace(
        id=3,
        clover_order_id="order-1",
        organization_id=1,
        restaurant_location_id=2,
        potentially_eligible=eligible,
        requires_review=review,
        normalized_status="paid",
        raw_payload_json=raw or {},
        lines=[line],
    )


def test_verified_clover_order_plans_recipe_consumption_without_writes():
    plan = plan_clover_order_inventory(_order())
    assert plan["eligible"] is True
    movement = plan["movements"][0]
    assert movement["lineId"] == 11
    assert movement["inventoryItemId"] == 7
    assert movement["quantity"] == "-0.1800"
    assert movement["correction"] == "-0.1800"
    assert movement["state"] == "new"


def test_financially_incomplete_or_conflicted_orders_are_never_eligible():
    for raw in (
        {"financialIncomplete": True},
        {"refundsUnverified": True},
        {"paymentStateConflict": True},
        {"lineItemsIncomplete": True},
    ):
        plan = plan_clover_order_inventory(_order(raw=raw))
        assert plan["eligible"] is False
        assert plan["movements"] == []


def test_open_or_unmapped_orders_do_not_consume_inventory():
    assert plan_clover_order_inventory(_order(eligible=False))["eligible"] is False
    assert plan_clover_order_inventory(_order(review=True))["eligible"] is False
    order = _order()
    order.lines[0].mapping_status = "review_required"
    assert plan_clover_order_inventory(order)["eligible"] is False


def test_dry_run_and_disabled_flag_are_non_mutating(app):
    with app.app_context():
        app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = False
        result = apply_clover_order_inventory(order=_order(), connection=SimpleNamespace(organization_id=1, id=99, status="connected", environment="sandbox", merchant_id=""), dry_run=True)
        assert result["dryRun"] is True
        assert result["applied"] is False
        assert result["enabled"] is False


@pytest.mark.parametrize("value", ["true", "false", 1, None, object()])
def test_inventory_execution_requires_json_boolean_true(value):
    from backend.clover_integration import _inventory_execution_requested

    assert _inventory_execution_requested(value) is False
    assert _inventory_execution_requested(True) is True
