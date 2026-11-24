"""Milestone C (#315): inventory ledger journey, sequential and end to end on PostgreSQL under forced RLS.

One continuous journey through real endpoints / the real Clover application service as the non-owner runtime role:

    opening 10 kg @ $2.00 (no ledger history)
    -> purchase receipt (weighted-average cost)
    -> verified Clover paid order consumes recipe ingredients (flag on, throwaway test app only)
    -> duplicate/replayed Clover application consumes nothing more
    -> OPEN / unverified Clover order fails closed (no movement)
    -> physical count variance finalized once, replay refused
    -> waste, manual adjustment, adjustment reversal (exactly once)
    -> the Clover order later becomes refunded: flagged for review, stock NEVER auto-changes
    -> ledger chain, unique source keys, on-hand and weighted-average cost reconcile.

Chicken: 10 kg @ 2.00. Bun mix: 20 kg @ 2.00. Order A recipe: Chicken 0.18 kg, Bun mix 0.25 kg.
Cross-tenant: a second organization can neither see nor mutate any of it.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import CloverConnection, CloverShadowOrder, CloverShadowOrderLine, RestaurantLocation
from backend.tests.test_inventory_concurrency_pos_postgres import (  # noqa: F401  (fixtures)
    D,
    _clover_apply,
    _clover_movement_total,
    _clover_world,
    clover_enabled,
)
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401
    POSTGRES_URL,
    _adjust,
    _count_session,
    _finalize,
    _invoice,
    _make_world,
    _post,
    _receive,
    _seed_admin_fixture,
    _waste,
    postgres_app,
)
from backend.tests.test_inventory_adjustment_reversal_postgres import _reverse

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _open_order(clover) -> int:
    """An OPEN (unpaid) Clover order with a mapped recipe. It must never be eligible for consumption."""

    def seed():
        connection = db.session.get(CloverConnection, clover.connection_id)
        location = RestaurantLocation.query.filter_by(organization_id=clover.world.org_id).one()
        order = CloverShadowOrder(
            organization_id=clover.world.org_id, clover_connection_id=connection.id, restaurant_location_id=location.id,
            clover_merchant_id=connection.merchant_id, clover_order_id=f"open-{uuid4().hex[:6]}", provider_status="OPEN",
            normalized_status="open", payment_status="open", potentially_eligible=False, requires_review=True, total_cents=1800, raw_payload_json={},
        )
        db.session.add(order)
        db.session.flush()
        db.session.add(
            CloverShadowOrderLine(
                organization_id=clover.world.org_id, restaurant_location_id=location.id, shadow_order_id=order.id,
                clover_line_item_id=f"line-open-{uuid4().hex[:6]}", clover_item_id="burger-open", name="Burger open", quantity=D("1"), mapping_status="mapped",
                recipe_preview_json={"ingredients": [{"inventoryItemId": clover.world.items["Chicken"], "quantity": "5", "unit": "kg", "name": "Chicken"}]},
            )
        )
        return order.id

    clover.orders["OPEN"] = _seed_admin_fixture("clover open order", seed)
    return clover.orders["OPEN"]


def _refund_order(clover, key: str) -> None:
    def seed():
        order = db.session.get(CloverShadowOrder, clover.orders[key])
        order.normalized_status, order.provider_status, order.payment_status = "refunded", "PAID", "refunded"
        order.potentially_eligible, order.requires_review = False, True
        order.raw_payload_json = {"refunds": [{"id": "r1", "amount": 1800, "components": []}]}

    _seed_admin_fixture("clover refund", seed)


def _count_audit(org_id: int, event_type: str) -> int:
    from sqlalchemy import text

    from backend.tests.test_inventory_concurrency_postgres import _admin_engine

    engine = _admin_engine()
    try:
        with engine.connect() as connection:
            return connection.execute(text("select count(*) from audit_events where organization_id = :o and event_type = :t"), {"o": org_id, "t": event_type}).scalar_one()
    finally:
        engine.dispose()


def test_inventory_ledger_journey_reconciles_across_purchase_pos_count_waste_adjustment_and_refund(clover_enabled):
    clover = _clover_world(clover_enabled)
    world = clover.world
    chicken, bun = world.items["Chicken"], world.items["Bun"]
    client = world.client()

    # --- 1. Purchase receipt: 5 kg @ $4.00 -> on hand 15, WAC (10*2 + 5*4) / 15 = 2.666667. Replay refused.
    invoice = _invoice(world, client, [(chicken, 5, 4.0)])
    assert _receive(client, invoice).status_code == 200
    assert _receive(client, invoice).status_code == 409
    avg, _rows = world.assert_reconciles(chicken, opening="10", expected_on_hand="15", movements=1)
    assert avg == Decimal("2.666667")

    # --- 2. Verified paid Clover order A: Chicken -0.18, Bun mix -0.25. Cost is untouched by consumption.
    _clover_apply(clover, "A")()
    assert world.assert_reconciles(chicken, opening="10", expected_on_hand="14.82", movements=2)[0] == Decimal("2.666667")
    world.assert_reconciles(bun, opening="20", expected_on_hand="19.75", movements=1)
    movements_after_sale = _clover_movement_total(clover)

    # --- 3. Duplicate / replayed provider event: nothing more is consumed.
    for _ in range(2):
        _clover_apply(clover, "A")()
    assert _clover_movement_total(clover) == movements_after_sale

    # --- 4. OPEN order fails closed: not applied, no movement, stock unchanged.
    open_id = _open_order(clover)
    from backend.clover_inventory import apply_clover_order_inventory

    def apply_open():
        with world.app.test_request_context("/"):
            from backend.tests.test_inventory_concurrency_postgres import _pin_rls_context

            _pin_rls_context(access_scope="customer", organization_id=world.org_id, user_id=clover.owner_id)
            result = apply_clover_order_inventory(order=db.session.get(CloverShadowOrder, open_id), connection=db.session.get(CloverConnection, clover.connection_id))
            db.session.commit()
            db.session.remove()
            return result

    for _ in range(2):
        result = apply_open()
        assert result["applied"] is False and result["eligible"] is False
    assert _clover_movement_total(clover) == movements_after_sale
    world.assert_reconciles(chicken, opening="10", expected_on_hand="14.82", movements=2)

    # --- 5. Count: physical 14.00 vs system 14.82 -> one variance movement of -0.82; replay refused.
    session_id = _count_session(client, {chicken: 14})
    assert _finalize(client, session_id).status_code == 200
    assert _finalize(client, session_id).status_code == 409
    world.assert_reconciles(chicken, opening="10", expected_on_hand="14", movements=3)

    # --- 6. Waste 0.5 and manual +1 adjustment; reverse the adjustment exactly once.
    assert _waste(client, chicken, 0.5).status_code in {200, 201}
    adjustment = _adjust(client, chicken, 1)
    assert adjustment.status_code in {200, 201}, adjustment.get_data(as_text=True)
    movement_id = adjustment.get_json()["id"]
    world.assert_reconciles(chicken, opening="10", expected_on_hand="14.5", movements=5)
    assert _reverse(client, movement_id, "rev-1").status_code == 201
    assert _reverse(client, movement_id, "rev-2").status_code == 409  # a different key cannot reverse it again
    world.assert_reconciles(chicken, opening="10", expected_on_hand="13.5", movements=6)

    # --- 7. Order A is later refunded: flagged for manual review; stock and cost never change automatically.
    _refund_order(clover, "A")
    before = _clover_movement_total(clover)
    from backend.tests.test_inventory_concurrency_postgres import _pin_rls_context

    def apply_a():
        with world.app.test_request_context("/"):
            _pin_rls_context(access_scope="customer", organization_id=world.org_id, user_id=clover.owner_id)
            result = apply_clover_order_inventory(order=db.session.get(CloverShadowOrder, clover.orders["A"]), connection=db.session.get(CloverConnection, clover.connection_id))
            db.session.commit()
            db.session.remove()
            return result

    for _ in range(2):
        result = apply_a()
        assert result["applied"] is False and result["appliedRequiresReview"] is True
    assert _clover_movement_total(clover) == before

    # --- 8. Final reconciliation: chain intact, unique source keys, on hand and valuation agree.
    avg_cost, rows = world.assert_reconciles(chicken, opening="10", expected_on_hand="13.5", movements=6)
    assert [row[0] for row in rows] == ["invoice receipt", "clover sale consumption", "stock count reconciliation", "inventory waste", "manual increase", "adjustment reversal"]
    assert avg_cost == Decimal("2.666667")  # only the purchase moved cost; count/waste/adjustment/reversal never do
    world.assert_reconciles(bun, opening="20", expected_on_hand="19.75", movements=1)
    assert _count_audit(world.org_id, "inventory.adjustment_reversed") == 1


def test_inventory_journey_is_invisible_and_immutable_across_tenants(postgres_app):
    owner_world = _make_world(postgres_app)
    other_world = _make_world(postgres_app)
    item = owner_world.items["Flour"]
    client = owner_world.client()
    session_id = _count_session(client, {item: 7})
    adjustment = _adjust(client, item, -2, "manual decrease")
    movement_id = adjustment.get_json()["id"]
    state = owner_world.state(item)

    intruder = other_world.client()
    assert _finalize(intruder, session_id).status_code == 404
    assert _adjust(intruder, item, 5).status_code == 404
    assert _waste(intruder, item, 1).status_code in {404, 400, 422}
    assert _reverse(intruder, movement_id, "x").status_code == 404

    assert owner_world.state(item) == state  # nothing moved
    assert other_world.state(other_world.items["Flour"])[2] == []
