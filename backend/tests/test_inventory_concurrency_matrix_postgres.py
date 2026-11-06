"""Acceptance matrix for the inventory row-lock fix (#248), from the independent Codex review.

Builds on the deterministic two-session harness in ``test_inventory_concurrency_postgres.py``:
writer A is paused after reading the item, writer B is proven blocked via ``pg_blocking_pids``, and every
scenario ends with the ledger invariant (opening + ordered deltas == on-hand, before/after chain, no
duplicate source record). Covers every stock writer against every other writer, against the import and
against the Square POS consumption path; stale ORM identities; opposite-order multi-item lock
acquisition; rollback atomicity after writes were issued; and forced-RLS tenant/location isolation.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from backend.app import create_app
from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, Organization, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    ADMIN_POSTGRES_URL,
    BASE,
    POSTGRES_URL,
    WAIT_SECONDS,
    Gate,
    Run,
    World,
    _admin_engine,
    _adjust,
    _blocked_backends,
    _correct,
    _count_session,
    _finalize,
    _invoice,
    _make_world,
    _pin_rls_context,
    _post,
    _receive,
    _seed_admin_fixture,
    _set_rls_context,
    _wait_until,
    _waste,
    postgres_app,
    race,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

PILOT_KINDS = ["receipt", "correction", "adjust", "waste", "finalize"]
D = Decimal


# ------------------------------------------------------------------------------------ writer specs


def _prepare(kind: str, world: World, setup, item: int):
    """Do the committed setup a writer needs, then return (callable(client), apply(on_hand), ok statuses)."""
    if kind == "receipt":
        invoice = _invoice(world, setup, [(item, 5, 4.0)])
        return (lambda c: _receive(c, invoice)), (lambda x: x + 5), {200}
    if kind == "correction":
        invoice = _invoice(world, setup, [(item, 5, 4.0)])
        assert _receive(setup, invoice).status_code == 200
        return (lambda c: _correct(c, invoice)), (lambda x: x - 5), {200}
    if kind == "adjust":
        return (lambda c: _adjust(c, item, 2)), (lambda x: x + 2), {201}
    if kind == "waste":
        return (lambda c: _waste(c, item, 3)), (lambda x: x - 3), {201}
    if kind == "finalize":
        session_id = _count_session(setup, {item: 20})
        return (lambda c: _finalize(c, session_id)), (lambda x: D(20)), {200}
    raise AssertionError(kind)


def _pair_params():
    return [pytest.param(a, b, id=f"{a}-then-{b}") for a in PILOT_KINDS for b in PILOT_KINDS]


@pytest.mark.parametrize("kind_a,kind_b", _pair_params())
def test_every_writer_pair_serializes_and_reconciles(postgres_app, kind_a, kind_b):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    run_a_fn, apply_a, ok_a = _prepare(kind_a, world, setup, item)
    run_b_fn, apply_b, ok_b = _prepare(kind_b, world, setup, item)
    start = world.state(item)[0]
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: run_a_fn(client_a), lambda: run_b_fn(client_b))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code in ok_a, run_a.result.get_data(as_text=True)
    assert run_b.result.status_code in ok_b, run_b.result.get_data(as_text=True)
    world.assert_reconciles(item, opening="10", expected_on_hand=str(apply_b(apply_a(start))))


# ---------------------------------------------------------------------------------- import writers


def _prepare_import(world: World, setup, quantity: int = 12) -> int:
    csv = f"Item,Location,Unit,Qty,Par\nFlour,{world.location_name},kg,{quantity},5\n".encode()
    import io

    upload = setup.post(
        "/api/imports/jobs",
        headers={"X-CSRFToken": setup.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]},
        data={"organizationId": str(world.org_id), "entityScope": "inventory_item", "file": (io.BytesIO(csv), "cc.csv")},
        content_type="multipart/form-data",
        base_url=BASE,
    )
    assert upload.status_code == 201, upload.get_data(as_text=True)
    job_id = upload.get_json()["job"]["id"]
    mapping = {"name": "Item", "locationName": "Location", "stockUnit": "Unit", "currentOnHand": "Qty", "parLevel": "Par"}
    assert _post(setup, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": "inventory_item", "fieldMappings": mapping, "fixedValues": {}}).status_code == 200
    preview = _post(setup, f"/api/imports/jobs/{job_id}/preview")
    assert preview.get_json()["job"]["status"] == "READY_FOR_PREVIEW", preview.get_data(as_text=True)
    assert _post(setup, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    return job_id


def _execute_import(client, job_id: int):
    return _post(client, f"/api/imports/jobs/{job_id}/execute")


@pytest.mark.parametrize("kind", ["adjust", "waste"])
def test_inflight_adjustment_or_waste_blocks_import_which_is_then_refused(postgres_app, kind):
    """The #248 lost update: the writer has read 10 and is about to write when an import arrives.

    Before the fix the import locked, saw no history, wrote 12 and committed while the writer was still
    paused; the writer then overwrote it. Now the import queues behind the writer and, once the movement
    commits, the #227 history guard refuses it.
    """
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    job = _prepare_import(world, setup, quantity=13)  # differs from every possible post-writer balance (12 / 7)
    run_fn, apply_fn, ok = _prepare(kind, world, setup, item)
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: run_fn(client_a), lambda: _execute_import(client_b, job))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code in ok
    assert run_b.result.status_code in {400, 409}, run_b.result.get_data(as_text=True)
    world.assert_reconciles(item, opening="10", expected_on_hand=str(apply_fn(D(10))), movements=1)


@pytest.mark.parametrize("kind", ["receipt", "correction", "finalize"])
def test_inflight_history_writers_make_import_refuse_without_overwriting(postgres_app, kind):
    """Receipt, correction and count lines are stock history as soon as they exist, so the import refuses."""
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    job = _prepare_import(world, setup)  # approved while the item still has no history
    run_fn, apply_fn, ok = _prepare(kind, world, setup, item)
    start = world.state(item)[0]
    client_a, client_b = world.client(), world.client()

    gate = Gate()
    event.listen(Session, "before_flush", gate)
    run_a = Run(lambda: run_fn(client_a), gate)
    run_b = Run(lambda: _execute_import(client_b, job))
    try:
        run_a.start()
        assert gate.reached.wait(WAIT_SECONDS)
        run_b.start().join()
        assert run_b.result.status_code in {400, 409}, run_b.result.get_data(as_text=True)
    finally:
        gate.release.set()
        run_a.join()
        event.remove(Session, "before_flush", gate)
    assert run_a.error is None and run_a.result.status_code in ok
    world.assert_reconciles(item, opening="10", expected_on_hand=str(apply_fn(start)))


@pytest.mark.parametrize("kind", ["receipt", "adjust", "waste", "finalize"])
def test_inflight_import_blocks_every_writer_which_then_chains_from_the_import(postgres_app, kind):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    job = _prepare_import(world, setup)  # 10 -> 12, outside the ledger
    client_a, client_b = world.client(), world.client()
    # Prerequisites that would count as stock history are created inside the competing writer.
    def writer():
        run_fn, _, ok = _prepare(kind, world, client_b, item)
        response = run_fn(client_b)
        assert response.status_code in ok, response.get_data(as_text=True)
        return response

    expected_apply = {"receipt": lambda x: x + 5, "adjust": lambda x: x + 2, "waste": lambda x: x - 3, "finalize": lambda x: D(20)}[kind]
    run_a, run_b = race(lambda: _execute_import(client_a, job), writer)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200, run_a.result.get_data(as_text=True)
    world.assert_reconciles(item, opening="12", expected_on_hand=str(expected_apply(D(12))), movements=1)


# ------------------------------------------------------------------------------------ POS writers


def _make_square_world(app):
    from backend.models import SquareConnection
    from backend.tests.test_square_integration import _create_square_usage_fixture

    admin_app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": ADMIN_POSTGRES_URL,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )
    with admin_app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        owner_id = owner.id
        organization, _ = _create_square_usage_fixture(admin_app, owner, organization_name=f"Concurrency Square {uuid4().hex[:6]}")
        org_id = organization.id
        connection = SquareConnection.query.filter_by(organization_id=org_id).one()
        connection.inventory_depletion_activated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
        beef = InventoryItem.query.filter_by(organization_id=org_id, name="Beef").one()
        beef_id = beef.id
        beef.average_unit_cost = D("2")
        db.session.commit()
        db.session.remove()
    world = World(app, org_id, "Main Kitchen", f"Supplier {uuid4().hex[:6]}", {"Beef": beef_id})
    assert _post(world.client(), "/api/pilot/suppliers", {"name": world.supplier, "isActive": True}).status_code == 201
    return world, owner_id


def _pos_writer(world: World, owner_id: int):
    from backend.models import SquareConnection, SquareOrder
    from backend.square_integration import _apply_square_order_inventory_consumption

    def apply_pos(_client=None):
        with world.app.test_request_context("/"):
            _pin_rls_context(access_scope="customer", organization_id=world.org_id, user_id=owner_id)
            organization = db.session.get(Organization, world.org_id)
            square = SquareConnection.query.filter_by(organization_id=world.org_id).one()
            order = SquareOrder.query.filter_by(square_connection_id=square.id, square_order_id="ORDER-1").one()
            _apply_square_order_inventory_consumption(organization, square, order)
            db.session.commit()
            db.session.remove()
        return SimpleNamespace(status_code=200, get_data=lambda as_text=True: "pos applied")

    return apply_pos, (lambda x: x - D("1.8"))


@pytest.mark.parametrize("kind", PILOT_KINDS)
def test_pilot_writer_in_flight_blocks_pos_consumption(postgres_app, kind):
    world, owner_id = _make_square_world(postgres_app)
    item = world.items["Beef"]
    setup = world.client()
    run_fn, apply_fn, ok = _prepare(kind, world, setup, item)
    pos, apply_pos = _pos_writer(world, owner_id)
    start = world.state(item)[0]
    client_a = world.client()

    run_a, run_b = race(lambda: run_fn(client_a), pos)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code in ok and run_b.result.status_code == 200
    world.assert_reconciles(item, opening="20", expected_on_hand=str(apply_pos(apply_fn(start))))


@pytest.mark.parametrize("kind", PILOT_KINDS)
def test_pos_consumption_in_flight_blocks_pilot_writer(postgres_app, kind):
    world, owner_id = _make_square_world(postgres_app)
    item = world.items["Beef"]
    setup = world.client()
    run_fn, apply_fn, ok = _prepare(kind, world, setup, item)
    pos, apply_pos = _pos_writer(world, owner_id)
    start = world.state(item)[0]
    client_b = world.client()

    run_a, run_b = race(pos, lambda: run_fn(client_b))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200 and run_b.result.status_code in ok, run_b.result.get_data(as_text=True)
    world.assert_reconciles(item, opening="20", expected_on_hand=str(apply_fn(apply_pos(start))))


# --------------------------------------------------------------------------------- stale identity


def test_lock_refreshes_a_preloaded_item_instead_of_using_the_stale_orm_value(postgres_app):
    from backend.pilot_api import lock_inventory_items

    world = _make_world(postgres_app)
    item_id = world.items["Flour"]
    other = world.client()
    with postgres_app.test_request_context("/"):
        _pin_rls_context(access_scope="customer", organization_id=world.org_id)
        loader = SimpleNamespace(location_id=None)
        preloaded = db.session.get(InventoryItem, item_id)
        loader.location_id = preloaded.location_id
        assert Decimal(preloaded.current_on_hand) == D(10)

        # Another transaction (its own thread, so its own app context and session) commits 10 -> 12.
        other_write = Run(lambda: _adjust(other, item_id, 2)).start().join()
        assert other_write.error is None and other_write.result.status_code == 201
        assert Decimal(preloaded.current_on_hand) == D(10), "precondition: the preloaded object is stale"

        # Control: a plain FOR UPDATE re-query returns the stale identity-map value (the hazard).
        plain = InventoryItem.query.filter_by(id=item_id).with_for_update().first()
        assert plain is preloaded and Decimal(plain.current_on_hand) == D(10)

        locked = lock_inventory_items(world.org_id, loader.location_id, [item_id])[item_id]
        assert locked is preloaded, "the same identity is refreshed in place"
        assert Decimal(locked.current_on_hand) == D(12)
        db.session.rollback()
        db.session.remove()


# --------------------------------------------------------------- opposite-order multi-item locking


def test_receipt_and_count_over_overlapping_items_in_opposite_order_complete(postgres_app):
    world = _make_world(postgres_app, item_names=("Flour", "Sugar"))
    low, high = sorted(world.items.values())
    setup = world.client()
    receipt_invoice = _invoice(world, setup, [(high, 3, 4.0), (low, 2, 4.0)])  # request order: high, low
    session_id = _count_session(setup, {low: 20, high: 30})  # request order: low, high
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(client_a, receipt_invoice), lambda: _finalize(client_b, session_id))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 200)
    world.assert_reconciles(low, opening="10", expected_on_hand="20", movements=2)
    world.assert_reconciles(high, opening="10", expected_on_hand="30", movements=2)


def test_count_and_adjustments_on_overlapping_items_complete_without_deadlock(postgres_app):
    """Adjustment holds `high`; the count (low, high) takes `low` then queues; an adjustment of `low` queues behind the count."""
    world = _make_world(postgres_app, item_names=("Flour", "Sugar"))
    low, high = sorted(world.items.values())
    setup = world.client()
    session_id = _count_session(setup, {low: 20, high: 30})
    client_a, client_b, client_c = world.client(), world.client(), world.client()
    engine = _admin_engine()
    observer = engine.connect()

    gate = Gate()
    event.listen(Session, "before_flush", gate)
    adjust_high = Run(lambda: _adjust(client_a, high, 2), gate)
    count = Run(lambda: _finalize(client_b, session_id))
    adjust_low = Run(lambda: _adjust(client_c, low, 1))
    try:
        adjust_high.start()
        assert gate.reached.wait(WAIT_SECONDS)
        count.start()
        _wait_until(lambda: _blocked_backends(engine) >= 1, "count to block on the high-id item")
        held = {row[0] for row in observer.execute(text("select id from inventory_items where id = any(:ids) order by id for update skip locked"), {"ids": [low]})}
        observer.rollback()
        assert held == set(), "the count must already hold the low-id row (ascending acquisition) while queued on the high-id row"
        adjust_low.start()
        _wait_until(lambda: _blocked_backends(engine) >= 2, "adjustment of the low-id item to queue behind the count")
        assert not count.done.is_set() and not adjust_low.done.is_set()
    finally:
        gate.release.set()
        for run in (adjust_high, count, adjust_low):
            run.thread.join(WAIT_SECONDS)
        event.remove(Session, "before_flush", gate)
        observer.close()
        engine.dispose()

    for run in (adjust_high, count, adjust_low):
        assert run.error is None, run.error
    assert (adjust_high.result.status_code, count.result.status_code, adjust_low.result.status_code) == (201, 200, 201)
    world.assert_reconciles(high, opening="10", expected_on_hand="30", movements=2)  # +2 then count to 30
    world.assert_reconciles(low, opening="10", expected_on_hand="21", movements=2)  # count to 20 then +1


# ------------------------------------------------------------------------------ rollback atomicity


class FailAfterStockFlush:
    """Raises right after the first flush that wrote an item or movement, i.e. after the rows were sent to the database."""

    def __init__(self) -> None:
        self.armed = False
        self.fired = False
        self.thread = threading.current_thread()

    def before_flush(self, session, flush_context, instances) -> None:
        if self.armed and not self.fired and threading.current_thread() is self.thread:
            if any(isinstance(o, InventoryItem) for o in session.dirty) or any(isinstance(o, InventoryMovement) for o in session.new):
                session.info["fail_after_flush"] = True

    def after_flush(self, session, flush_context) -> None:
        if session.info.pop("fail_after_flush", None):
            self.fired = True
            raise RuntimeError("injected failure after stock rows were written")


def _snapshot(engine, org_id: int):
    queries = {
        "items": "select id, current_on_hand, average_unit_cost, latest_purchase_price from inventory_items where organization_id = :o order by id",
        "movements": "select count(*) from inventory_movements where organization_id = :o",
        "waste": "select count(*) from inventory_waste_events where organization_id = :o",
        "invoices": "select id, status from purchase_invoices where organization_id = :o order by id",
        "counts": "select id, status from stock_count_sessions where organization_id = :o order by id",
        "mappings": "select count(*) from supplier_item_mappings where organization_id = :o",
    }
    with engine.connect() as connection:
        return {name: [tuple(row) for row in connection.execute(text(sql), {"o": org_id})] for name, sql in queries.items()}


@pytest.mark.parametrize("kind", PILOT_KINDS)
def test_failure_after_writes_rolls_back_every_row_and_releases_the_lock(postgres_app, kind):
    world = _make_world(postgres_app, item_names=("Flour", "Sugar"))
    low, high = sorted(world.items.values())
    setup = world.client()
    if kind == "receipt":
        invoice = _invoice(world, setup, [(high, 3, 4.0), (low, 2, 4.0)])
        action = lambda c: _receive(c, invoice)
    elif kind == "correction":
        invoice = _invoice(world, setup, [(high, 3, 4.0), (low, 2, 4.0)])
        assert _receive(setup, invoice).status_code == 200
        action = lambda c: _correct(c, invoice)
    elif kind == "adjust":
        action = lambda c: _adjust(c, low, 2)
    elif kind == "waste":
        action = lambda c: _waste(c, low, 3)
    else:
        session_id = _count_session(setup, {low: 20, high: 30})
        action = lambda c: _finalize(c, session_id)
    engine = _admin_engine()
    before = _snapshot(engine, world.org_id)
    client = world.client()

    injector = FailAfterStockFlush()
    event.listen(Session, "before_flush", injector.before_flush)
    event.listen(Session, "after_flush", injector.after_flush)
    injector.armed = True
    try:
        try:
            response = action(client)
            assert response.status_code >= 500 or kind == "finalize", response.get_data(as_text=True)
        except RuntimeError as exc:
            assert "injected failure" in str(exc)
    finally:
        injector.armed = False
        event.remove(Session, "before_flush", injector.before_flush)
        event.remove(Session, "after_flush", injector.after_flush)
    assert injector.fired, "the failure must be injected after stock rows were flushed to the database"

    after = _snapshot(engine, world.org_id)
    assert after == before, "a failed writer must leave no item balance change and no partial movement/waste/mapping/status rows"
    # The lock is gone: a follow-up writer is not blocked and reconciles from the untouched balance.
    assert _blocked_backends(engine) == 0
    assert _adjust(world.client(), low, 1).status_code == 201
    expected_low = before["items"][0][1] + D(1) if before["items"][0][0] == low else None
    engine.dispose()
    low_state = world.state(low)
    assert low_state[0] == D(expected_low)
    assert low_state[2][-1][1:] == (D(expected_low) - 1, D(1), D(expected_low))


# ------------------------------------------------------------------------ forced RLS isolation


def test_foreign_tenant_and_location_rows_cannot_be_locked_or_mutated(postgres_app):
    from backend.pilot_api import lock_inventory_items

    world_a = _make_world(postgres_app)
    world_b = _make_world(postgres_app)
    item_a, item_b = world_a.items["Flour"], world_b.items["Flour"]

    # Endpoint level: tenant B cannot receive, correct, adjust, waste on, or finalize a count for tenant A's rows.
    setup_a = world_a.client()
    invoice_a = _invoice(world_a, setup_a, [(item_a, 5, 4.0)])
    assert _receive(setup_a, invoice_a).status_code == 200
    count_a = _count_session(setup_a, {item_a: 20})
    engine = _admin_engine()
    before = _snapshot(engine, world_a.org_id)
    client_b = world_b.client()
    assert _receive(client_b, invoice_a).status_code == 404
    assert _correct(client_b, invoice_a).status_code == 404
    assert _adjust(client_b, item_a, 1).status_code == 404
    assert _waste(client_b, item_a, 1).status_code == 404
    assert _finalize(client_b, count_a).status_code == 404
    assert _snapshot(engine, world_a.org_id) == before
    engine.dispose()
    world_a.assert_reconciles(item_a, opening="10", expected_on_hand="15", movements=1)
    world_b.assert_reconciles(item_b, opening="10", expected_on_hand="10", movements=0)

    def add_second_location():
        organization = db.session.get(Organization, world_a.org_id)
        location = RestaurantLocation(
            organization=organization, name="Second", address_line1="1 Test St", address_line2="", city="Toronto",
            region="ON", postal_code="M5V 1A1", country="Canada", timezone="America/Toronto",
        )
        db.session.add(location)
        db.session.flush()
        return location.id

    second_location_a = _seed_admin_fixture("second location", add_second_location)
    with postgres_app.test_request_context("/"):
        _pin_rls_context(access_scope="customer", organization_id=world_a.org_id)
        real_location_a = db.session.get(InventoryItem, item_a).location_id
        # Same organization, wrong location: never returned, so never locked or written.
        assert lock_inventory_items(world_a.org_id, second_location_a, [item_a]) == {}
        assert set(lock_inventory_items(world_a.org_id, real_location_a, [item_a])) == {item_a}
        db.session.rollback()
        _pin_rls_context(access_scope="customer", organization_id=world_b.org_id)
        real_location_b = db.session.get(InventoryItem, item_b).location_id
        # Tenant B's runtime session cannot see tenant A's row even when the caller names A's ids (forced RLS).
        assert db.session.get(InventoryItem, item_a) is None
        assert lock_inventory_items(world_a.org_id, real_location_a, [item_a]) == {}
        assert lock_inventory_items(world_b.org_id, real_location_b, [item_a]) == {}
        db.session.rollback()
        db.session.remove()
