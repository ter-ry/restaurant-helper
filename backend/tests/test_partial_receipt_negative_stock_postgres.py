"""PostgreSQL acceptance for partial repair of POS-negative stock (#252, owner decision #249 Option A).

Real endpoints, non-owner runtime role, forced RLS. Quantities are hand-calculated.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.app import create_app
from backend.extensions import db
from backend.models import InventoryItem, Organization, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    ADMIN_POSTGRES_URL,
    POSTGRES_URL,
    World,
    _adjust,
    _invoice,
    _make_world,
    _pin_rls_context,
    _post,
    _receive,
    _waste,
    postgres_app,
    race,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def test_receipt_repairs_negative_in_steps_under_forced_rls(postgres_app):
    world = _make_world(postgres_app, on_hand="-1.8", avg_cost="7.25")
    item = world.items["Flour"]
    client = world.client()

    assert _receive(client, _invoice(world, client, [(item, 1, 2.0)])).status_code == 200
    world.assert_reconciles(item, opening="-1.8", expected_on_hand="-0.8", movements=1)
    assert _receive(client, _invoice(world, client, [(item, 1, 2.0)])).status_code == 200
    avg_cost, rows = world.assert_reconciles(item, opening="-1.8", expected_on_hand="0.2", movements=2)
    assert [row[1:] for row in rows] == [
        (Decimal("-1.8"), Decimal("1"), Decimal("-0.8")),
        (Decimal("-0.8"), Decimal("1"), Decimal("0.2")),
    ]
    assert avg_cost == Decimal("2.000000")  # receipt cost replaces the cost of the negative position


def test_duplicate_concurrent_receipt_on_negative_item_applies_once(postgres_app):
    world = _make_world(postgres_app, on_hand="-1.8")
    item = world.items["Flour"]
    invoice = _invoice(world, world.client(), [(item, 1, 2.0)])
    a, b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(a, invoice), lambda: _receive(b, invoice))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert sorted((run_a.result.status_code, run_b.result.status_code)) == [200, 409]
    world.assert_reconciles(item, opening="-1.8", expected_on_hand="-0.8", movements=1)


def test_receipt_racing_manual_waste_never_worsens_the_negative(postgres_app):
    world = _make_world(postgres_app, on_hand="-1.8")
    item = world.items["Flour"]
    invoice = _invoice(world, world.client(), [(item, 1, 2.0)])
    a, b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(a, invoice), lambda: _waste(b, item, 0.5))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200
    assert run_b.result.status_code == 400  # -0.8 or -1.8 minus 0.5 is below zero either way
    world.assert_reconciles(item, opening="-1.8", expected_on_hand="-0.8", movements=1)


def test_rejected_manual_decrease_on_negative_item_writes_nothing(postgres_app):
    world = _make_world(postgres_app, on_hand="-1.8")
    item = world.items["Flour"]
    client = world.client()

    assert _adjust(client, item, 0.1, "manual decrease").status_code == 400
    assert _waste(client, item, 0.1).status_code == 400
    world.assert_reconciles(item, opening="-1.8", expected_on_hand="-1.8", movements=0)
    assert _adjust(client, item, 1, "manual increase").status_code == 201
    world.assert_reconciles(item, opening="-1.8", expected_on_hand="-0.8", movements=1)


def test_other_tenant_cannot_receive_into_or_adjust_a_negative_item(postgres_app):
    world_a = _make_world(postgres_app, on_hand="-1.8")
    world_b = _make_world(postgres_app, on_hand="3")
    item_a, item_b = world_a.items["Flour"], world_b.items["Flour"]
    invoice_a = _invoice(world_a, world_a.client(), [(item_a, 1, 2.0)])
    client_b = world_b.client()

    assert _receive(client_b, invoice_a).status_code == 404
    assert _adjust(client_b, item_a, 1, "manual increase").status_code == 404
    world_a.assert_reconciles(item_a, opening="-1.8", expected_on_hand="-1.8", movements=0)
    world_b.assert_reconciles(item_b, opening="3", expected_on_hand="3", movements=0)


def test_receipt_racing_pos_consumption_on_negative_item_keeps_a_clean_chain(postgres_app):
    from backend.models import SquareConnection, SquareOrder
    from backend.square_integration import _apply_square_order_inventory_consumption
    from backend.tests.test_square_integration import _create_square_usage_fixture

    admin_app = create_app(
        {
            "TESTING": True, "SECRET_KEY": "test-secret", "SQLALCHEMY_DATABASE_URI": ADMIN_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False, "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://", "WTF_CSRF_ENABLED": True,
        }
    )
    with admin_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        owner_id = owner.id
        organization, _ = _create_square_usage_fixture(admin_app, owner, organization_name=f"Partial POS {uuid4().hex[:6]}")
        org_id = organization.id
        connection = SquareConnection.query.filter_by(organization_id=org_id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        beef = InventoryItem.query.filter_by(organization_id=org_id, name="Beef").one()
        beef_id = beef.id
        beef.current_on_hand = Decimal("-1")  # opening POS-negative position, no ledger history
        beef.average_unit_cost = Decimal("2")
        db.session.commit()
        db.session.remove()

    world = World(postgres_app, org_id, "Main Kitchen", f"Supplier {uuid4().hex[:6]}", {"Beef": beef_id})
    setup = world.client()
    assert _post(setup, "/api/pilot/suppliers", {"name": world.supplier, "isActive": True}).status_code == 201
    invoice = _invoice(world, setup, [(beef_id, 1, 2.0)])
    client_a = world.client()

    def pos():
        with postgres_app.test_request_context("/"):
            _pin_rls_context(access_scope="customer", organization_id=org_id, user_id=owner_id)
            organization_row = db.session.get(Organization, org_id)
            square = SquareConnection.query.filter_by(organization_id=org_id).one()
            order = SquareOrder.query.filter_by(square_connection_id=square.id, square_order_id="ORDER-1").one()
            _apply_square_order_inventory_consumption(organization_row, square, order)
            db.session.commit()
            db.session.remove()
        return "applied"

    run_a, run_b = race(lambda: _receive(client_a, invoice), pos)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200, run_a.result.get_data(as_text=True)
    # -1 + 1 (receipt) - 1.8 (POS) = -1.8 in either order, with an unbroken two-row chain.
    world.assert_reconciles(beef_id, opening="-1", expected_on_hand="-1.8", movements=2)
