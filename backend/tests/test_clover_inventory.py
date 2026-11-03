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


@pytest.mark.parametrize(
    "payload",
    [
        {"executeInventory": "true"},
        {"executeInventory": "false"},
        {"executeInventory": 1},
        {"executeInventory": None},
        {},
    ],
)
def test_inventory_execution_requires_json_boolean_true(payload):
    from backend.clover_integration import _inventory_execution_requested

    assert _inventory_execution_requested(payload.get("executeInventory")) is False
    assert _inventory_execution_requested(True) is True


# --- #183: already-applied orders that later become refunded, voided, conflicted or lose a line ---

def _applied_fixture(app):
    from uuid import uuid4
    from backend.extensions import db
    from backend.models import CloverConnection, CloverShadowOrder, CloverShadowOrderLine, InventoryItem, RestaurantLocation, User
    from backend.seed import LOCAL_OWNER_EMAIL
    from backend.tests.conftest import make_operational_organization

    app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name=f"Clover reversal {uuid4()}", location_name="Main")
    location = RestaurantLocation.query.filter_by(organization_id=organization.id).first()
    connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="m-rev", status="connected", access_token_ciphertext="x")
    db.session.add(connection)
    db.session.flush()
    items = []
    for name, unit in (("Chicken", "kg"), ("Buns", "pack")):
        item = InventoryItem(organization_id=organization.id, location_id=location.id, name=name, normalized_name=f"{name}-{uuid4()}", stock_unit=unit, current_on_hand=Decimal("10"), average_unit_cost=Decimal("2"))
        db.session.add(item)
        items.append(item)
    db.session.flush()
    order = CloverShadowOrder(
        organization_id=organization.id, clover_connection_id=connection.id, restaurant_location_id=location.id,
        clover_merchant_id="m-rev", clover_order_id=f"o-{uuid4()}", provider_status="CLOSED", normalized_status="paid",
        payment_status="PAID", potentially_eligible=True, requires_review=False, raw_payload_json={},
    )
    db.session.add(order)
    db.session.flush()
    lines = []
    for index, item in enumerate(items):
        line = CloverShadowOrderLine(
            organization_id=organization.id, restaurant_location_id=location.id, shadow_order_id=order.id,
            clover_line_item_id=f"l{index}-{uuid4()}", clover_item_id=f"i{index}", name=f"Dish {index}", quantity=Decimal("1"),
            mapping_status="mapped",
            recipe_preview_json={"ingredients": [{"inventoryItemId": item.id, "quantity": "1.0000", "unit": item.stock_unit, "name": item.name}]},
        )
        db.session.add(line)
        lines.append(line)
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is True
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]
    return order, connection, items, lines


def _movement_count(order):
    from backend.models import InventoryMovement
    return InventoryMovement.query.filter_by(source_record_id=order.clover_order_id).count()


def _flag_order(order, *, normalized, provider="", payment="", raw=None):
    from backend.extensions import db

    order.normalized_status, order.provider_status, order.payment_status = normalized, provider, payment
    order.potentially_eligible, order.requires_review = False, True
    order.raw_payload_json = raw or {}
    db.session.commit()


def _forged_markers(lines):
    # A client/provider-supplied "notPrepared" marker must never be trusted.
    return {"lineItems": [{"id": line.clover_line_item_id, "notPrepared": True, "state": "NOT_PREPARED"} for line in lines], "notPrepared": True}


@pytest.mark.parametrize(
    ("normalized", "provider", "payment", "extra"),
    [
        ("cancelled", "VOIDED", "VOIDED", {}),
        ("refunded", "PAID", "refunded", {"refunds": [{"id": "r1", "amount": 1800, "components": []}]}),
        ("refunded", "PAID", "refunded", {"refunds": [{"id": "r1", "amount": 500, "components": []}]}),
        ("review", "CLOSED", "PAID", {"paymentStateConflict": True}),
        ("review", "CLOSED", "PAID", {"financialIncomplete": True}),
    ],
)
def test_applied_order_that_becomes_ineligible_is_flagged_and_stock_never_changes(app, normalized, provider, payment, extra):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    order.total_cents = 1800
    _flag_order(order, normalized=normalized, provider=provider, payment=payment, raw={**_forged_markers(lines), **extra})
    for _ in range(2):  # replay is also a no-op
        result = apply_clover_order_inventory(order=order, connection=connection)
        db.session.commit()
        assert result["applied"] is False
        assert result["appliedRequiresReview"] is True
        assert result["orderId"] == order.clover_order_id
        assert len(result["staleApplied"]) == 2
    assert _movement_count(order) == 2
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]


def test_removed_applied_line_is_flagged_and_stock_never_changes(app):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    lines[1].mapping_status = "review_required"
    lines[1].recipe_preview_json = {"reason": "Clover removed a line after inventory application; manual correction is required."}
    order.raw_payload_json = _forged_markers(lines)
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert {row["lineId"] for row in result["staleApplied"]} >= {lines[1].id}
    assert _movement_count(order) == 2
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]


def test_flag_off_applied_review_changes_nothing(app):
    order, connection, items, lines = _applied_fixture(app)
    _flag_order(order, normalized="cancelled", provider="VOIDED", payment="VOIDED")
    app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = False
    result = apply_clover_order_inventory(order=order, connection=connection)
    assert result["applied"] is False and _movement_count(order) == 2


def _refund_raw(*, payments, refunds, components=()):
    return {"orderComponents": list(components), "payments": payments, "refunds": refunds}


def _pay(amount=1800, components=(), result="SUCCESS"):
    return {"id": "p", "amount": amount, "result": result, "components": list(components)}


def _ref(amount, components=()):
    return {"id": "r", "amount": amount, "components": list(components)}


@pytest.mark.parametrize(
    ("total", "raw", "expected"),
    [
        (1800, _refund_raw(payments=[_pay()], refunds=[]), "none"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(1800)]), "full"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(500), _ref(1300)]), "full"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(500)]), "partial"),
        # Tips, surcharges (additionalCharges), tax, discounts: semantics unverified -> unknown.
        (1800, _refund_raw(payments=[_pay(components=["tipAmount"])], refunds=[_ref(1800)]), "unknown"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(1800, ["additionalCharges"])]), "unknown"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(1800, ["taxAmount"])]), "unknown"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(1800)], components=["discounts"]), "unknown"),
        (1800, _refund_raw(payments=[_pay()], refunds=[_ref(2000)]), "unknown"),  # refund exceeds charge
        (1800, _refund_raw(payments=[_pay(1500)], refunds=[_ref(1500)]), "unknown"),  # payments != total
        (0, _refund_raw(payments=[_pay(0)], refunds=[_ref(0)]), "unknown"),  # zero total
        (None, _refund_raw(payments=[_pay()], refunds=[_ref(1800)]), "unknown"),  # unknown total
        (1800, _refund_raw(payments=[], refunds=[_ref(1800)]), "unknown"),  # no payments
        (1800, _refund_raw(payments=[_pay(result="FAIL")], refunds=[]), "unknown"),
        (1800, {"refunds": [{"id": "r", "amount": 1800}], "payments": [{"id": "p", "amount": 1800, "result": "SUCCESS"}]}, "unknown"),  # legacy rows lack component data
        (1800, {**_refund_raw(payments=[_pay()], refunds=[_ref(1800)]), "financialIncomplete": True}, "unknown"),
    ],
)
def test_refund_kind_is_authoritative_or_unknown(total, raw, expected):
    from backend.clover_inventory import _refund_kind

    assert _refund_kind(SimpleNamespace(total_cents=total, raw_payload_json=raw)) == expected


def test_normalization_records_tip_surcharge_tax_and_discount_components():
    from backend.clover_inventory import _refund_kind
    from backend.clover_orders import normalize_order

    base = {
        "id": "o1", "state": "CLOSED", "paymentState": "REFUNDED", "total": 1800,
        "lineItems": {"elements": [{"id": "l1", "name": "Burger", "quantity": 1, "price": 1800, "item": {"id": "i1"}}], "total": 1},
        "createdTime": 1, "modifiedTime": 1,
    }
    plain = normalize_order({**base, "payments": {"elements": [{"id": "p", "amount": 1800, "result": "SUCCESS"}], "total": 1}, "refunds": {"elements": [{"id": "r", "amount": 1800}], "total": 1}})
    assert plain.raw["payments"][0]["components"] == [] and plain.raw["refunds"][0]["components"] == []
    assert _refund_kind(SimpleNamespace(total_cents=1800, raw_payload_json=plain.raw)) == "full"
    tipped = normalize_order({**base, "payments": {"elements": [{"id": "p", "amount": 1800, "tipAmount": 200, "taxAmount": 0, "result": "SUCCESS"}], "total": 1}, "refunds": {"elements": [{"id": "r", "amount": 1800, "additionalCharges": {"elements": [{"id": "c1", "amount": 50}], "total": 1}}], "total": 1}})
    assert tipped.raw["payments"][0]["components"] == ["tipAmount"]
    assert tipped.raw["refunds"][0]["components"] == ["additionalCharges"]
    assert _refund_kind(SimpleNamespace(total_cents=1800, raw_payload_json=tipped.raw)) == "unknown"
    discounted = normalize_order({**base, "discounts": {"elements": [{"id": "d1", "amount": -100}], "total": 1}, "payments": {"elements": [{"id": "p", "amount": 1800, "result": "SUCCESS"}], "total": 1}, "refunds": {"elements": [], "total": 0}})
    assert discounted.raw["orderComponents"] == ["discounts"]
    assert _refund_kind(SimpleNamespace(total_cents=1800, raw_payload_json=discounted.raw)) == "unknown"
