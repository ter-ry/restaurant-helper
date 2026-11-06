"""Multi-ingredient POS contention against the production Square and Clover engines (#248).

Everything here calls the real ``_apply_square_order_inventory_consumption`` and
``apply_clover_order_inventory`` (Clover only under the per-test ``CLOVER_ORDER_INVENTORY_ENABLED``
fixture flag; nothing real is enabled), as the forced-RLS runtime role, racing real pilot endpoints and
other POS applications. Two orders use the same two ingredients in opposite recipe order, so unordered
locking would deadlock. Each scenario ends with the ledger invariant per item and exactly-once checks.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from backend.app import create_app
from backend.extensions import db
from backend.models import InventoryItem, Organization, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_inventory_concurrency_matrix_postgres import _make_square_world
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    ADMIN_POSTGRES_URL,
    POSTGRES_URL,
    WAIT_SECONDS,
    Gate,
    Run,
    World,
    _admin_engine,
    _blocked_backends,
    _count_session,
    _finalize,
    _invoice,
    _pin_rls_context,
    _post,
    _receive,
    _seed_admin_fixture,
    _wait_until,
    postgres_app,
    race,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

D = Decimal
OK = SimpleNamespace(status_code=200, get_data=lambda as_text=True: "applied")


# ------------------------------------------------------------------------------- Square world


def _square_world(app):
    """Square org with Beef (20 kg) and Bun mix (100 kg); ORDER-1 uses (Beef, Bun), ORDER-2 uses (Bun, Beef)."""
    from backend.models import (
        MenuItem,
        Recipe,
        RecipeIngredient,
        SquareCatalogMapping,
        SquareCatalogObject,
        SquareConnection,
        SquareOrder,
        SquareOrderLine,
    )

    world, owner_id = _make_square_world(app)

    def seed():
        org = world.org_id
        location = RestaurantLocation.query.filter_by(organization_id=org).one()
        beef = db.session.get(InventoryItem, world.items["Beef"])
        bun = InventoryItem(
            organization_id=org, location_id=location.id, name="Bun mix", normalized_name="bun mix", category="Bakery",
            stock_unit="kg", current_on_hand=D("100"), min_quantity=D("0"), par_level=D("0"), preferred_supplier_name="",
            latest_purchase_price=D("0"), last_purchase_unit="kg", last_purchase_conversion_factor=D("1"),
            average_daily_usage=D("0"), average_unit_cost=D("1"), active=True, notes="",
        )
        db.session.add(bun)
        db.session.flush()
        recipe_one = Recipe.query.filter_by(organization_id=org, name="Classic Cheeseburger").one()
        db.session.add(RecipeIngredient(organization_id=org, recipe_id=recipe_one.id, inventory_item_id=bun.id, quantity_required=D("0.1"), unit="kg", notes="", sort_order=1))
        recipe_two = Recipe(organization_id=org, location_id=location.id, name="Double Burger", normalized_name="double burger", yield_quantity=D("1"), yield_unit="servings", active=True)
        db.session.add(recipe_two)
        db.session.flush()
        db.session.add_all(
            [
                RecipeIngredient(organization_id=org, recipe_id=recipe_two.id, inventory_item_id=bun.id, quantity_required=D("0.2"), unit="kg", notes="", sort_order=0),
                RecipeIngredient(organization_id=org, recipe_id=recipe_two.id, inventory_item_id=beef.id, quantity_required=D("0.25"), unit="kg", notes="", sort_order=1),
            ]
        )
        menu_two = MenuItem(organization_id=org, location_id=location.id, recipe_id=recipe_two.id, name="Double Burger", normalized_name="double burger", category="Burgers", selling_price=D("22"), active=True, notes="")
        db.session.add(menu_two)
        db.session.flush()
        connection = SquareConnection.query.filter_by(organization_id=org).one()
        catalog = SquareCatalogObject(square_connection_id=connection.id, square_object_id="VAR-2", object_type="ITEM_VARIATION", version=1, is_deleted=False, raw_payload_json={"id": "VAR-2", "type": "ITEM_VARIATION"})
        db.session.add(catalog)
        db.session.flush()
        db.session.add(SquareCatalogMapping(square_catalog_object_id=catalog.id, mapping_type="menu_item", flowtally_entity_type="menu_item", flowtally_entity_id=str(menu_two.id), status="mapped", mapped_by_user_id=owner_id))
        first = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id="ORDER-1").one()
        second = SquareOrder(
            square_connection_id=connection.id, square_order_id="ORDER-2", square_location_id="LOC-1", restaurant_location_id=location.id,
            order_state="COMPLETED", currency="CAD", gross_amount=D("88"), discount_amount=D("0"), tax_amount=D("0"), tip_amount=D("0"),
            refund_amount=D("0"), net_amount=D("88"), item_quantity=D("4"), line_count=1,
            ordered_at=first.ordered_at, closed_at=first.closed_at, raw_payload_json={"id": "ORDER-2"},
        )
        db.session.add(second)
        db.session.flush()
        db.session.add(
            SquareOrderLine(order=second, line_uid="line-2", line_index=0, square_item_variation_id="VAR-2", name="Double Burger", quantity=D("4"),
                            gross_amount=D("88"), discount_amount=D("0"), tax_amount=D("0"), tip_amount=D("0"), net_amount=D("88"), raw_payload_json={"uid": "line-2"})
        )
        return bun.id

    world.items["Bun"] = _seed_admin_fixture("square multi-ingredient", seed)
    return world, owner_id


def _square_apply(world: World, owner_id: int, square_order_id: str):
    from backend.models import SquareConnection, SquareOrder
    from backend.square_integration import _apply_square_order_inventory_consumption

    def run():
        with world.app.test_request_context("/"):
            _pin_rls_context(access_scope="customer", organization_id=world.org_id, user_id=owner_id)
            organization = db.session.get(Organization, world.org_id)
            connection = SquareConnection.query.filter_by(organization_id=world.org_id).one()
            order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id=square_order_id).one()
            _apply_square_order_inventory_consumption(organization, connection, order)
            db.session.commit()
            db.session.remove()
        return OK

    return run


def _change_square_order(world: World, square_order_id: str, **changes):
    from backend.models import SquareConnection, SquareOrder

    def seed():
        connection = SquareConnection.query.filter_by(organization_id=world.org_id).one()
        order = SquareOrder.query.filter_by(square_connection_id=connection.id, square_order_id=square_order_id).one()
        for name, value in changes.items():
            if name == "line_quantity":
                order.lines[0].quantity = value
            else:
                setattr(order, name, value)

    _seed_admin_fixture("square order change", seed)


def _assert_items(world: World, expected: dict[str, tuple[str, str, int]]):
    """expected: item name -> (opening, on_hand, movement count). Full chain + uniqueness checked for each."""
    for name, (opening, on_hand, movements) in expected.items():
        world.assert_reconciles(world.items[name], opening=opening, expected_on_hand=on_hand, movements=movements)


# Beef 20 / Bun 100. ORDER-1 (qty 10): Beef 1.8, Bun 1.0. ORDER-2 (qty 4): Bun 0.8, Beef 1.0.


def test_square_orders_with_reversed_recipe_order_do_not_deadlock(postgres_app):
    world, owner = _square_world(postgres_app)
    run_a, run_b = race(_square_apply(world, owner, "ORDER-1"), _square_apply(world, owner, "ORDER-2"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(world, {"Beef": ("20", "17.2", 2), "Bun": ("100", "98.2", 2)})


def test_square_locks_every_item_in_ascending_order_before_any_mutation(postgres_app):
    """ORDER-2 lists Bun (high id) first. A third session holds Bun; Square must already hold Beef and have written nothing."""
    world, owner = _square_world(postgres_app)
    beef, bun = world.items["Beef"], world.items["Bun"]
    assert beef < bun
    engine = _admin_engine()
    blocker, observer = engine.connect(), engine.connect()
    try:
        blocker.execute(text("select id from inventory_items where id = :id for update"), {"id": bun})
        run = Run(_square_apply(world, owner, "ORDER-2")).start()
        _wait_until(lambda: _blocked_backends(engine) >= 1, "Square to block on the higher-id ingredient")
        free = {r[0] for r in observer.execute(text("select id from inventory_items where id = :id for update skip locked"), {"id": beef})}
        observer.rollback()
        assert free == set(), "Beef (lower id) must already be locked while Square waits for Bun: ascending, whole-operation order"
        counts = observer.execute(text("select (select count(*) from inventory_movements where organization_id = :o), (select count(*) from square_order_line_inventory_consumptions)"), {"o": world.org_id}).one()
        observer.rollback()
        assert tuple(counts) == (0, 0), "no stock mutation or consumption row may be written before all locks are held"
        assert not run.done.is_set()
        blocker.rollback()
        run.join()
    finally:
        blocker.close()
        observer.close()
        engine.dispose()
    assert run.error is None
    _assert_items(world, {"Beef": ("20", "19", 1), "Bun": ("100", "99.2", 1)})


@pytest.mark.parametrize("writer", ["receipt", "finalize"])
@pytest.mark.parametrize("square_first", [True, False], ids=["square-in-flight", "writer-in-flight"])
def test_square_multi_ingredient_vs_multi_item_pilot_writer(postgres_app, writer, square_first):
    world, owner = _square_world(postgres_app)
    beef, bun = world.items["Beef"], world.items["Bun"]
    setup = world.client()
    if writer == "receipt":
        invoice = _invoice(world, setup, [(bun, 2, 3.0), (beef, 3, 4.0)])  # request order: Bun, Beef
        client = world.client()
        pilot = lambda: _receive(client, invoice)
        expected = {"Beef": ("20", "22", 2), "Bun": ("100", "101.2", 2)}  # commutative
    else:
        session_id = _count_session(setup, {beef: 15, bun: 90})
        client = world.client()
        pilot = lambda: _finalize(client, session_id)
        expected = {"Beef": ("20", "15" if square_first else "14", 2), "Bun": ("100", "90" if square_first else "89.2", 2)}
    square = _square_apply(world, owner, "ORDER-2")  # recipe order: Bun, Beef

    run_a, run_b = race(square, pilot) if square_first else race(pilot, square)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code in {200} and run_b.result.status_code == 200
    _assert_items(world, expected)


def test_concurrent_duplicate_square_application_consumes_exactly_once(postgres_app):
    world, owner = _square_world(postgres_app)
    run_a, run_b = race(_square_apply(world, owner, "ORDER-1"), _square_apply(world, owner, "ORDER-1"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)  # no IntegrityError on the unique consumption row
    _assert_items(world, {"Beef": ("20", "18.2", 1), "Bun": ("100", "99", 1)})
    for _ in range(2):  # sequential retries are no-ops
        assert _square_apply(world, owner, "ORDER-1")().status_code == 200
    _assert_items(world, {"Beef": ("20", "18.2", 1), "Bun": ("100", "99", 1)})


def test_concurrent_retries_of_an_edited_order_write_one_compensating_movement(postgres_app):
    world, owner = _square_world(postgres_app)
    assert _square_apply(world, owner, "ORDER-1")().status_code == 200
    _change_square_order(world, "ORDER-1", line_quantity=D("5"))  # 1.8 / 1.0 becomes 0.9 / 0.5
    run_a, run_b = race(_square_apply(world, owner, "ORDER-1"), _square_apply(world, owner, "ORDER-1"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(world, {"Beef": ("20", "19.1", 2), "Bun": ("100", "99.5", 2)})


def test_concurrent_retries_of_a_cancelled_order_reverse_exactly_once(postgres_app):
    world, owner = _square_world(postgres_app)
    assert _square_apply(world, owner, "ORDER-1")().status_code == 200
    _change_square_order(world, "ORDER-1", order_state="CANCELED")
    run_a, run_b = race(_square_apply(world, owner, "ORDER-1"), _square_apply(world, owner, "ORDER-1"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(world, {"Beef": ("20", "20", 2), "Bun": ("100", "100", 2)})
    assert _square_apply(world, owner, "ORDER-1")().status_code == 200
    _assert_items(world, {"Beef": ("20", "20", 2), "Bun": ("100", "100", 2)})


# ------------------------------------------------------------------------------- Clover world


@pytest.fixture()
def clover_enabled(postgres_app):
    """Per-test fixture flag on the throwaway test app only; no real environment is touched."""
    postgres_app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = True
    yield postgres_app
    postgres_app.config["CLOVER_ORDER_INVENTORY_ENABLED"] = False


def _clover_world(app):
    """Clover org with Chicken (10 kg) and Bun mix (20 kg); order A uses (Chicken, Bun), order B uses (Bun, Chicken)."""
    from backend.models import CloverConnection, CloverShadowOrder, CloverShadowOrderLine

    def seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = make_operational_organization(owner, name=f"Clover Concurrency {uuid4().hex[:8]}", location_name="Main")
        location = RestaurantLocation.query.filter_by(organization_id=organization.id).one()
        connection = CloverConnection(organization_id=organization.id, environment="sandbox", merchant_id="merchant-concurrency", status="connected", access_token_ciphertext="ciphertext")
        db.session.add(connection)
        db.session.flush()
        items = {}
        for name, on_hand in (("Chicken", "10"), ("Bun mix", "20")):
            item = InventoryItem(organization_id=organization.id, location_id=location.id, name=name, normalized_name=f"{name.lower()}-{uuid4().hex[:6]}", stock_unit="kg", current_on_hand=D(on_hand), average_unit_cost=D("2"))
            db.session.add(item)
            db.session.flush()
            items[name] = item.id
        orders = {}
        for key, ingredients in (
            ("A", [("Chicken", "0.18"), ("Bun mix", "0.25")]),
            ("B", [("Bun mix", "0.30"), ("Chicken", "0.20")]),
        ):
            order = CloverShadowOrder(
                organization_id=organization.id, clover_connection_id=connection.id, restaurant_location_id=location.id,
                clover_merchant_id=connection.merchant_id, clover_order_id=f"paid-{key}-{uuid4().hex[:6]}", provider_status="CLOSED",
                normalized_status="paid", payment_status="paid", potentially_eligible=True, requires_review=False, total_cents=1800, raw_payload_json={},
            )
            db.session.add(order)
            db.session.flush()
            db.session.add(
                CloverShadowOrderLine(
                    organization_id=organization.id, restaurant_location_id=location.id, shadow_order_id=order.id,
                    clover_line_item_id=f"line-{key}-{uuid4().hex[:6]}", clover_item_id=f"burger-{key}", name=f"Burger {key}", quantity=D("1"), mapping_status="mapped",
                    recipe_preview_json={"ingredients": [{"inventoryItemId": items[name], "quantity": qty, "unit": "kg", "name": name} for name, qty in ingredients]},
                )
            )
            orders[key] = order.id
        return organization.id, connection.id, owner.id, items, orders

    org_id, connection_id, owner_id, items, orders = _seed_admin_fixture("clover multi-ingredient", seed)
    world = World(app, org_id, "Main", f"Supplier {uuid4().hex[:6]}", {"Chicken": items["Chicken"], "Bun": items["Bun mix"]})
    assert _post(world.client(), "/api/pilot/suppliers", {"name": world.supplier, "isActive": True}).status_code == 201
    return SimpleNamespace(world=world, owner_id=owner_id, connection_id=connection_id, orders=orders)


def _clover_apply(clover, key: str):
    from backend.clover_inventory import apply_clover_order_inventory
    from backend.models import CloverConnection, CloverShadowOrder

    def run():
        with clover.world.app.test_request_context("/"):
            _pin_rls_context(access_scope="customer", organization_id=clover.world.org_id, user_id=clover.owner_id)
            order = db.session.get(CloverShadowOrder, clover.orders[key])
            connection = db.session.get(CloverConnection, clover.connection_id)
            result = apply_clover_order_inventory(order=order, connection=connection)
            db.session.commit()
            db.session.remove()
        assert result["applied"] or result.get("alreadyApplied"), result
        return OK

    return run


def _clover_movement_total(clover) -> int:
    engine = _admin_engine()
    try:
        with engine.connect() as connection:
            return connection.execute(text("select count(*) from inventory_movements where organization_id = :o"), {"o": clover.world.org_id}).scalar_one()
    finally:
        engine.dispose()


# Chicken 10 / Bun 20. Order A: Chicken 0.18, Bun 0.25. Order B: Bun 0.30, Chicken 0.20.


def test_clover_orders_with_reversed_ingredient_order_do_not_deadlock(clover_enabled):
    clover = _clover_world(clover_enabled)
    run_a, run_b = race(_clover_apply(clover, "A"), _clover_apply(clover, "B"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(clover.world, {"Chicken": ("10", "9.62", 2), "Bun": ("20", "19.45", 2)})


@pytest.mark.parametrize("writer", ["receipt", "finalize"])
@pytest.mark.parametrize("clover_first", [True, False], ids=["clover-in-flight", "writer-in-flight"])
def test_clover_multi_ingredient_vs_multi_item_pilot_writer(clover_enabled, writer, clover_first):
    clover = _clover_world(clover_enabled)
    world = clover.world
    chicken, bun = world.items["Chicken"], world.items["Bun"]
    setup = world.client()
    if writer == "receipt":
        invoice = _invoice(world, setup, [(bun, 2, 3.0), (chicken, 3, 4.0)])  # request order: Bun, Chicken
        client = world.client()
        pilot = lambda: _receive(client, invoice)
        expected = {"Chicken": ("10", "12.8", 2), "Bun": ("20", "21.7", 2)}
    else:
        session_id = _count_session(setup, {chicken: 8, bun: 15})
        client = world.client()
        pilot = lambda: _finalize(client, session_id)
        expected = {"Chicken": ("10", "8" if clover_first else "7.8", 2), "Bun": ("20", "15" if clover_first else "14.7", 2)}
    pos = _clover_apply(clover, "B")  # ingredient order: Bun, Chicken

    run_a, run_b = race(pos, pilot) if clover_first else race(pilot, pos)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200 and run_b.result.status_code == 200
    _assert_items(world, expected)


def test_concurrent_duplicate_clover_application_consumes_exactly_once(clover_enabled):
    clover = _clover_world(clover_enabled)
    run_a, run_b = race(_clover_apply(clover, "A"), _clover_apply(clover, "A"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(clover.world, {"Chicken": ("10", "9.82", 1), "Bun": ("20", "19.75", 1)})
    for _ in range(2):
        _clover_apply(clover, "A")()
    assert _clover_movement_total(clover) == 2
    _assert_items(clover.world, {"Chicken": ("10", "9.82", 1), "Bun": ("20", "19.75", 1)})


def test_concurrent_clover_retries_after_a_recipe_change_write_one_correction(clover_enabled):
    from backend.models import CloverShadowOrderLine
    from sqlalchemy.orm.attributes import flag_modified

    clover = _clover_world(clover_enabled)
    _clover_apply(clover, "A")()

    def edit():
        line = CloverShadowOrderLine.query.filter_by(shadow_order_id=clover.orders["A"]).one()
        line.recipe_preview_json["ingredients"][0]["quantity"] = "0.20"  # chicken 0.18 -> 0.20
        flag_modified(line, "recipe_preview_json")

    _seed_admin_fixture("clover recipe change", edit)
    run_a, run_b = race(_clover_apply(clover, "A"), _clover_apply(clover, "A"))
    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    _assert_items(clover.world, {"Chicken": ("10", "9.8", 2), "Bun": ("20", "19.75", 1)})
