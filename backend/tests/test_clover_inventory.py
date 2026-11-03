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


def _mark_not_prepared(order, lines, *, refunds=None, total=1800):
    order.total_cents = total
    order.raw_payload_json = {
        "refunds": refunds or [],
        "lineItems": [{"id": line.clover_line_item_id, "notPrepared": True} for line in lines],
    }


@pytest.mark.parametrize(
    ("normalized", "provider", "payment", "refunds"),
    [("cancelled", "VOIDED", "VOIDED", []), ("refunded", "PAID", "refunded", [{"id": "r1", "amount": 1800}])],
)
def test_void_or_full_refund_without_unprepared_evidence_is_flagged_not_restored(app, normalized, provider, payment, refunds):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    order.normalized_status, order.provider_status, order.payment_status = normalized, provider, payment
    order.potentially_eligible, order.requires_review, order.total_cents = False, True, 1800
    order.raw_payload_json = {"refunds": refunds}
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert len(result["staleApplied"]) == 2
    assert _movement_count(order) == 2
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]


@pytest.mark.parametrize(
    ("normalized", "provider", "payment", "refunds"),
    [("cancelled", "VOIDED", "VOIDED", []), ("refunded", "PAID", "refunded", [{"id": "r1", "amount": 1800}])],
)
def test_void_or_full_refund_with_unprepared_evidence_reverses_once(app, normalized, provider, payment, refunds):
    from backend.extensions import db
    from backend.models import InventoryMovement

    order, connection, items, lines = _applied_fixture(app)
    order.normalized_status, order.provider_status, order.payment_status = normalized, provider, payment
    order.potentially_eligible, order.requires_review = False, True
    _mark_not_prepared(order, lines, refunds=refunds)
    db.session.commit()

    preview = apply_clover_order_inventory(order=order, connection=connection, dry_run=True)
    assert preview["eligible"] is True and len(preview["corrections"]) == 2
    assert _movement_count(order) == 2

    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is True
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("10.0000"), Decimal("10.0000")]
    reversals = InventoryMovement.query.filter_by(source_record_id=order.clover_order_id, source_type="clover sale correction").all()
    assert len(reversals) == 2 and all(Decimal(str(m.quantity_delta)) == Decimal("1") for m in reversals)

    replay = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert replay["applied"] is False  # ledger already zero: nothing to review or restore
    assert _movement_count(order) == 4
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("10.0000"), Decimal("10.0000")]


def test_evidence_covering_only_some_lines_is_not_enough(app):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    order.normalized_status, order.provider_status, order.potentially_eligible = "cancelled", "VOIDED", False
    _mark_not_prepared(order, lines[:1])
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert _movement_count(order) == 2


def test_partial_refund_is_review_required_even_with_unprepared_marker(app):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    # Status text says REFUNDED, but the numeric amounts prove the refund is partial.
    order.normalized_status, order.provider_status, order.payment_status, order.potentially_eligible = "refunded", "REFUNDED", "refunded", False
    _mark_not_prepared(order, lines, refunds=[{"id": "r1", "amount": 500}])
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert result["refundKind"] == "partial"
    assert _movement_count(order) == 2


def test_reversal_is_blocked_when_flag_off(app):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    order.normalized_status, order.provider_status, order.potentially_eligible = "cancelled", "VOIDED", False
    _mark_not_prepared(order, lines)
    db.session.commit()
    app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = False
    result = apply_clover_order_inventory(order=order, connection=connection)
    assert result["applied"] is False and _movement_count(order) == 2
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]


@pytest.mark.parametrize(
    ("normalized", "provider", "payment", "raw"),
    [
        ("review", "CLOSED", "PAID", {"paymentStateConflict": True}),
        ("review", "CLOSED", "PAID", {"financialIncomplete": True}),
    ],
)
def test_applied_order_with_payment_conflict_is_flagged_not_changed(app, normalized, provider, payment, raw):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    order.normalized_status, order.provider_status, order.payment_status = normalized, provider, payment
    order.potentially_eligible, order.requires_review = False, True
    order.raw_payload_json = {**raw, "lineItems": [{"id": line.clover_line_item_id, "notPrepared": True} for line in lines]}
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert _movement_count(order) == 2
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("9.0000")]


def test_removed_line_requires_review_unless_unprepared_is_established(app):
    from backend.extensions import db

    order, connection, items, lines = _applied_fixture(app)
    lines[1].mapping_status = "review_required"
    lines[1].recipe_preview_json = {"reason": "removed", "removed": True}
    db.session.commit()
    flagged = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert flagged["applied"] is False and flagged["appliedRequiresReview"] is True
    assert _movement_count(order) == 2

    order.raw_payload_json = {"lineItems": [{"id": lines[1].clover_line_item_id, "notPrepared": True}]}
    db.session.commit()
    result = apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert result["applied"] is True
    assert [Decimal(str(i.current_on_hand)) for i in items] == [Decimal("9.0000"), Decimal("10.0000")]
    apply_clover_order_inventory(order=order, connection=connection)
    db.session.commit()
    assert _movement_count(order) == 3
