"""Deterministic two-session PostgreSQL concurrency tests for inventory writers (#248).

Every scenario runs the real pilot endpoints as the non-owner runtime role (forced RLS) from two
threads, each with its own Flask client and database session. Writer A is *paused* by a SQLAlchemy
``before_flush`` hook at the exact point where it has read the item and computed its movement but has
not written anything yet (the race window in the issue). Writer B then starts and the test waits,
by polling ``pg_stat_activity`` for a lock wait (no fixed sleeps), until B is provably blocked on A's
row lock. Releasing A lets both finish, and the test asserts the final state, the full movement chain
and the weighted-average cost against hand-computed values.

Before the fix these tests fail: B is never blocked, finishes while A is paused, and A then overwrites
B's on-hand with a value computed from a stale read.
"""
from __future__ import annotations

import io
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from backend.app import create_app
from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, Organization, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_postgres_rls import (  # noqa: F401  (postgres_app is a fixture)
    ADMIN_POSTGRES_URL,
    POSTGRES_URL,
    _login_owner,
    _pin_rls_context,
    _seed_admin_fixture,
    _set_rls_context,
    postgres_app,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

BASE = "http://127.0.0.1:5001"
WAIT_SECONDS = 15.0


# --------------------------------------------------------------------------------------- harness


class Gate:
    """Pauses one thread right before its first write of an inventory item or movement."""

    def __init__(self) -> None:
        self.thread: threading.Thread | None = None
        self.reached = threading.Event()
        self.release = threading.Event()
        self.fail = False
        self.fired = False

    def __call__(self, session, flush_context, instances) -> None:  # SQLAlchemy before_flush signature
        if self.fired or threading.current_thread() is not self.thread:
            return
        writes_stock = any(isinstance(obj, InventoryItem) for obj in session.dirty) or any(isinstance(obj, InventoryMovement) for obj in session.new)
        if not writes_stock:
            return
        self.fired = True
        self.reached.set()
        assert self.release.wait(WAIT_SECONDS), "test harness: gate was never released"
        if self.fail:
            raise RuntimeError("injected failure after the item was read")


def _admin_engine():
    return create_engine(ADMIN_POSTGRES_URL, poolclass=NullPool)


def _blocked_backends(engine) -> int:
    with engine.connect() as connection:
        return connection.execute(
            text("select count(*) from pg_stat_activity where datname = current_database() and cardinality(pg_blocking_pids(pid)) > 0")
        ).scalar_one()


def _wait_until(predicate, what: str) -> None:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)  # bounded poll of observable database state, not a timing assumption
    raise AssertionError(f"timed out waiting for: {what}")


class Run:
    """Runs a callable in a thread and records its result or exception."""

    def __init__(self, fn, gate: Gate | None = None) -> None:
        self.result = None
        self.error: BaseException | None = None
        self.done = threading.Event()

        def target() -> None:
            try:
                if gate is not None:
                    gate.thread = threading.current_thread()
                self.result = fn()
            except BaseException as exc:  # noqa: BLE001 - reported to the test
                self.error = exc
            finally:
                self.done.set()

        self.thread = threading.Thread(target=target, daemon=True)

    def start(self) -> "Run":
        self.thread.start()
        return self

    def join(self) -> "Run":
        self.thread.join(WAIT_SECONDS)
        assert not self.thread.is_alive(), "thread did not finish (deadlock?)"
        return self


def race(first, second, *, fail_first: bool = False):
    """Pause ``first`` after it read the item; prove ``second`` blocks on it; release; return both runs."""
    gate = Gate()
    gate.fail = fail_first
    engine = _admin_engine()
    event.listen(Session, "before_flush", gate)
    run_a = Run(first, gate)
    run_b = Run(second)
    try:
        run_a.start()
        assert gate.reached.wait(WAIT_SECONDS), f"writer A never reached its write: {run_a.error!r}"
        run_b.start()
        _wait_until(lambda: run_b.done.is_set() or _blocked_backends(engine) > 0, "writer B to block or finish")
        assert not run_b.done.is_set(), (
            "writer B finished while writer A held an unwritten read of the same item: "
            "the item row is not locked, so A would overwrite B's on-hand (lost update)"
        )
        assert _blocked_backends(engine) > 0
    finally:
        gate.release.set()
        run_a.thread.join(WAIT_SECONDS)
        run_b.thread.join(WAIT_SECONDS)
        event.remove(Session, "before_flush", gate)  # only after both threads stopped flushing
        engine.dispose()
    assert not run_a.thread.is_alive() and not run_b.thread.is_alive(), "writers did not finish (deadlock?)"
    return run_a, run_b


# ----------------------------------------------------------------------------------------- world


class World:
    def __init__(self, app, org_id: int, location_name: str, supplier: str, items: dict[str, int]) -> None:
        self.app = app
        self.org_id = org_id
        self.location_name = location_name
        self.supplier = supplier
        self.items = items

    def client(self):
        client = self.app.test_client()
        _login_owner(client)
        assert _post(client, "/api/organizations/select", {"organizationId": self.org_id}).status_code == 200
        return client

    def state(self, item_id: int):
        with self.app.app_context():
            _set_rls_context(access_scope="customer", organization_id=self.org_id)
            item = db.session.get(InventoryItem, item_id)
            movements = InventoryMovement.query.filter_by(inventory_item_id=item_id).order_by(InventoryMovement.id).all()
            snapshot = (
                Decimal(item.current_on_hand),
                Decimal(item.average_unit_cost or 0),
                [(m.source_type, Decimal(m.quantity_before), Decimal(m.quantity_delta), Decimal(m.quantity_after)) for m in movements],
            )
            db.session.rollback()
            db.session.remove()
        return snapshot

    def source_keys(self, item_id: int) -> list[tuple[str, str, str]]:
        with self.app.app_context():
            _set_rls_context(access_scope="customer", organization_id=self.org_id)
            keys = [
                (m.source_type, m.source_record_id, m.source_line_id)
                for m in InventoryMovement.query.filter_by(inventory_item_id=item_id).order_by(InventoryMovement.id)
            ]
            db.session.rollback()
            db.session.remove()
        return keys

    def assert_reconciles(self, item_id: int, *, opening: str, expected_on_hand: str, movements: int | None = None):
        keys = self.source_keys(item_id)
        assert len(keys) == len(set(keys)), f"duplicate source record in the ledger: {keys}"
        on_hand, avg_cost, rows = self.state(item_id)
        running = Decimal(opening)
        for source_type, before, delta, after in rows:
            assert before == running, f"ledger chain broken at {source_type}: before {before} != running {running}"
            assert before + delta == after
            running = after
        assert Decimal(opening) + sum((delta for _, _, delta, _ in rows), Decimal("0")) == on_hand
        assert on_hand == Decimal(expected_on_hand)
        if movements is not None:
            assert len(rows) == movements, rows
        return avg_cost, rows


def _post(client, path, payload=None, **kwargs):
    headers = {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}
    if payload is not None:
        kwargs["json"] = payload
    return client.post(path, headers=headers, base_url=BASE, **kwargs)


def _patch(client, path, payload):
    headers = {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}
    return client.patch(path, headers=headers, base_url=BASE, json=payload)


def _make_world(app, item_names=("Flour",), *, on_hand="10", avg_cost="2.00") -> World:
    def seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = make_operational_organization(owner, name=f"Concurrency {uuid4().hex[:8]}", location_name="Main")
        return organization.id

    org_id = _seed_admin_fixture("inventory concurrency org", seed)
    supplier = f"Supplier {uuid4().hex[:6]}"
    world = World(app, org_id, "Main", supplier, {})
    client = world.client()
    assert _post(client, "/api/pilot/suppliers", {"name": supplier, "isActive": True}).status_code == 201
    for name in item_names:
        response = _post(
            client,
            "/api/pilot/inventory/items",
            {"name": name, "category": "Dry goods", "stockUnit": "kg", "currentOnHand": 0, "minQuantity": 1, "parLevel": 5, "preferredSupplierName": supplier},
        )
        assert response.status_code == 201, response.get_data(as_text=True)
        world.items[name] = response.get_json()["id"]

    def opening_stock():
        for item_id in world.items.values():
            item = db.session.get(InventoryItem, item_id)
            item.current_on_hand = Decimal(on_hand)
            item.average_unit_cost = Decimal(avg_cost)

    _seed_admin_fixture("inventory concurrency opening stock", opening_stock)  # opening balance with no ledger history
    return world


def _invoice(world: World, client, lines: list[tuple[int, int, float]]) -> int:
    """lines: (item_id, kg received, price per kg). One 1-case line per entry; conversion factor = kg."""
    payload_lines = []
    subtotal = 0.0
    for item_id, kg, price_per_kg in lines:
        total = round(kg * price_per_kg, 2)
        subtotal += total
        payload_lines.append(
            {
                "description": f"Bag {item_id}-{uuid4().hex[:4]}",
                "inventoryItemId": item_id,
                "purchaseUnit": "case",
                "inventoryUnit": "kg",
                "conversionFactor": kg,
                "quantity": 1,
                "unitPrice": total,
                "lineTotal": total,
                "confidence": 0.99,
                "needsReview": False,
                "note": "",
            }
        )
    response = _post(
        client,
        "/api/pilot/purchases/invoices",
        {
            "supplierName": world.supplier,
            "invoiceNumber": f"CC-{uuid4().hex[:8].upper()}",
            "invoiceDate": "2026-07-16",
            "subtotal": round(subtotal, 2),
            "tax": 0,
            "totalAmount": round(subtotal, 2),
            "notes": "concurrency",
            "status": "Ready",
            "sourceFileName": "cc.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "cc",
            "lineItems": payload_lines,
        },
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()["id"]


def _receive(client, invoice_id: int):
    return _post(client, f"/api/pilot/purchases/invoices/{invoice_id}/receive")


def _correct(client, invoice_id: int):
    return _post(client, f"/api/pilot/purchases/invoices/{invoice_id}/correct", {"reason": "supplier credit"})


def _adjust(client, item_id: int, delta: float, kind: str = "manual increase"):
    return _post(
        client,
        f"/api/pilot/inventory/items/{item_id}/adjustments",
        {"reason": "concurrency", "quantityDelta": delta, "movementType": kind, "sourceRecordId": uuid4().hex[:8], "sourceLineId": "1"},
    )


def _waste(client, item_id: int, quantity: float):
    return _post(client, "/api/pilot/inventory/waste-events", {"inventoryItemId": item_id, "quantity": quantity, "unit": "kg", "reason": "spoilage / expired"})


def _count_session(client, counts: dict[int, float]) -> int:
    created = _post(client, "/api/pilot/inventory/count-sessions", {"countedBy": "Concurrency", "notes": "", "itemIds": list(counts)})
    assert created.status_code in {200, 201}, created.get_data(as_text=True)
    session = created.get_json()
    lines = [{"id": line["id"], "countedQuantity": counts[line["inventoryItemId"]], "note": ""} for line in session["lines"]]
    assert _patch(client, f"/api/pilot/inventory/count-sessions/{session['id']}", {"countedBy": "Concurrency", "notes": "", "lines": lines}).status_code == 200
    return session["id"]


def _finalize(client, session_id: int):
    # confirmConcurrency: the competing writer's movement is committed after the count began.
    return _post(client, f"/api/pilot/inventory/count-sessions/{session_id}/finalize", {"confirmConcurrency": True})


# ------------------------------------------------------------------------------------------ tests


def test_receipt_vs_receipt_same_item_serializes_and_weights_cost(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    first = _invoice(world, setup, [(item, 5, 4.0)])
    second = _invoice(world, setup, [(item, 5, 6.0)])
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(client_a, first), lambda: _receive(client_b, second))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 200)
    avg_cost, rows = world.assert_reconciles(item, opening="10", expected_on_hand="20", movements=2)
    assert [row[1:] for row in rows] == [(Decimal("10"), Decimal("5"), Decimal("15")), (Decimal("15"), Decimal("5"), Decimal("20"))]
    # (10 kg * 2.00 + 5 kg * 4.00 + 5 kg * 6.00) / 20 kg = 3.50, independent of arrival order.
    assert avg_cost == pytest.approx(Decimal("3.5"), abs=Decimal("0.0001"))


def test_import_vs_receipt_does_not_lose_either_write(postgres_app):
    """#248 repro: an import has locked and read the item (10) while a receipt for it arrives.

    The receipt must wait for the import's commit (12) and then post 12 + 5 = 17, not read a stale 10
    and overwrite the import with 15. (A receipt invoice line that already exists makes the import
    refuse up front via the #227 history guard, so the invoice is created inside the receipt writer.
    The invoice insert's foreign-key share lock already queues behind the import's FOR UPDATE, so this
    ordering passes before the fix too; it is kept as a regression guard.)
    """
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()

    csv = f"Item,Location,Unit,Qty,Par\nFlour,{world.location_name},kg,12,5\n".encode()
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
    assert preview.status_code == 200 and preview.get_json()["job"]["status"] == "READY_FOR_PREVIEW", preview.get_data(as_text=True)
    assert _post(setup, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    client_a, client_b = world.client(), world.client()

    def receipt():
        invoice_id = _invoice(world, client_b, [(item, 5, 4.0)])
        return _receive(client_b, invoice_id)

    run_a, run_b = race(lambda: _post(client_a, f"/api/imports/jobs/{job_id}/execute"), receipt)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200, run_a.result.get_data(as_text=True)
    assert run_b.result.status_code == 200, run_b.result.get_data(as_text=True)
    # Import set the baseline to 12 outside the ledger; the receipt chains from it: 12 + 5 = 17.
    world.assert_reconciles(item, opening="12", expected_on_hand="17", movements=1)


def test_receipt_in_flight_then_import_is_refused_not_overwritten(postgres_app):
    """Reverse order of the repro: the receipt has read 10 and is mid-flight; the import must not overwrite.

    With an invoice line already on the item, the #227 history guard refuses the import immediately
    (it never needs to wait), so B finishes while A is paused. Locking is what keeps A's own write
    correct; the final state must be 10 + 5 with an intact chain. Passes before and after the fix (the
    guard protects this ordering); kept as a regression test for the ordering named in the issue.
    """
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    invoice = _invoice(world, setup, [(item, 5, 4.0)])
    csv = f"Item,Location,Unit,Qty,Par\nFlour,{world.location_name},kg,12,5\n".encode()
    upload = setup.post(
        "/api/imports/jobs",
        headers={"X-CSRFToken": setup.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]},
        data={"organizationId": str(world.org_id), "entityScope": "inventory_item", "file": (io.BytesIO(csv), "cc.csv")},
        content_type="multipart/form-data",
        base_url=BASE,
    )
    job_id = upload.get_json()["job"]["id"]
    mapping = {"name": "Item", "locationName": "Location", "stockUnit": "Unit", "currentOnHand": "Qty", "parLevel": "Par"}
    assert _post(setup, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": "inventory_item", "fieldMappings": mapping, "fixedValues": {}}).status_code == 200
    # The preview already reports the blocking ledger_history issue, so the job cannot be approved/executed.
    assert _post(setup, f"/api/imports/jobs/{job_id}/preview").get_json()["job"]["status"] == "VALIDATION_REQUIRED"
    client_a, client_b = world.client(), world.client()

    gate = Gate()
    event.listen(Session, "before_flush", gate)
    run_a = Run(lambda: _receive(client_a, invoice), gate)
    run_b = Run(lambda: _post(client_b, f"/api/imports/jobs/{job_id}/execute"))
    try:
        run_a.start()
        assert gate.reached.wait(WAIT_SECONDS)
        run_b.start().join()
        assert run_b.result.status_code in {400, 409}, run_b.result.get_data(as_text=True)
    finally:
        gate.release.set()
        run_a.join()
        event.remove(Session, "before_flush", gate)
    assert run_a.error is None and run_a.result.status_code == 200
    world.assert_reconciles(item, opening="10", expected_on_hand="15", movements=1)


def test_adjustment_vs_count_finalize_chain_stays_consistent(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    session_id = _count_session(setup, {item: 20})
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _adjust(client_a, item, 2), lambda: _finalize(client_b, session_id))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (201, 200), (run_a.result.get_data(as_text=True), run_b.result.get_data(as_text=True))
    _, rows = world.assert_reconciles(item, opening="10", expected_on_hand="20", movements=2)
    # The count was computed from the on-hand the adjustment left (12), so its delta is +8, not +10.
    assert [row[1:] for row in rows] == [(Decimal("10"), Decimal("2"), Decimal("12")), (Decimal("12"), Decimal("8"), Decimal("20"))]


def test_waste_vs_receipt_serializes(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    invoice = _invoice(world, setup, [(item, 5, 4.0)])
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _waste(client_a, item, 3), lambda: _receive(client_b, invoice))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (201, 200)
    avg_cost, rows = world.assert_reconciles(item, opening="10", expected_on_hand="12", movements=2)
    assert [row[1:] for row in rows] == [(Decimal("10"), Decimal("-3"), Decimal("7")), (Decimal("7"), Decimal("5"), Decimal("12"))]
    # Waste never reprices; the receipt blends 7 kg at 2.00 with 5 kg at 4.00 => 34 / 12.
    assert avg_cost == pytest.approx(Decimal("34") / Decimal("12"), abs=Decimal("0.0001"))


def test_correction_vs_pos_consumption_serializes(postgres_app):
    """Invoice correction (pilot_api) racing a Square sale consumption (square_integration) on one item."""
    from backend.models import SquareConnection, SquareOrder
    from backend.square_integration import _apply_square_order_inventory_consumption
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
        beef.average_unit_cost = Decimal("2")
        db.session.commit()
        db.session.remove()

    world = World(postgres_app, org_id, "Main Kitchen", f"Supplier {uuid4().hex[:6]}", {"Beef": beef_id})
    setup = world.client()
    assert _post(setup, "/api/pilot/suppliers", {"name": world.supplier, "isActive": True}).status_code == 201
    invoice = _invoice(world, setup, [(beef_id, 5, 2.0)])
    assert _receive(setup, invoice).status_code == 200  # Beef 20 -> 25, still $2.00/kg
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

    run_a, run_b = race(lambda: _correct(client_a, invoice), pos)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert run_a.result.status_code == 200, run_a.result.get_data(as_text=True)
    avg_cost, rows = world.assert_reconciles(beef_id, opening="20", expected_on_hand="18.2", movements=3)
    assert [row[1:] for row in rows] == [
        (Decimal("20"), Decimal("5"), Decimal("25")),
        (Decimal("25"), Decimal("-5"), Decimal("20")),  # correction first (it held the lock)
        (Decimal("20"), Decimal("-1.8"), Decimal("18.2")),  # POS consumption saw the corrected on-hand
    ]
    assert avg_cost == pytest.approx(Decimal("2"), abs=Decimal("0.0001"))  # receipt and correction at $2.00 leave cost unchanged; POS never reprices


def test_duplicate_concurrent_receipt_is_idempotent(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    invoice = _invoice(world, setup, [(item, 5, 4.0)])
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(client_a, invoice), lambda: _receive(client_b, invoice))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 409)
    world.assert_reconciles(item, opening="10", expected_on_hand="15", movements=1)


def test_duplicate_concurrent_correction_writes_one_compensating_movement(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    invoice = _invoice(world, setup, [(item, 5, 4.0)])
    assert _receive(setup, invoice).status_code == 200
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _correct(client_a, invoice), lambda: _correct(client_b, invoice))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 409)
    avg_cost, _ = world.assert_reconciles(item, opening="10", expected_on_hand="10", movements=2)
    assert avg_cost == pytest.approx(Decimal("2"), abs=Decimal("0.0001"))


def test_duplicate_concurrent_count_finalize_applies_once(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    session_id = _count_session(setup, {item: 7})
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _finalize(client_a, session_id), lambda: _finalize(client_b, session_id))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (200, 409)
    world.assert_reconciles(item, opening="10", expected_on_hand="7", movements=1)


def test_failed_writer_rolls_back_and_releases_the_lock(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    doomed = _invoice(world, setup, [(item, 9, 100.0)])
    survivor = _invoice(world, setup, [(item, 5, 4.0)])
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _receive(client_a, doomed), lambda: _receive(client_b, survivor), fail_first=True)

    # A failed after reading (injected); depending on error handling the client raises or returns a 500.
    assert run_a.error is not None or run_a.result.status_code >= 500
    assert run_b.error is None and run_b.result.status_code == 200
    avg_cost, rows = world.assert_reconciles(item, opening="10", expected_on_hand="15", movements=1)
    assert rows[0][1:] == (Decimal("10"), Decimal("5"), Decimal("15"))  # nothing of the rolled-back receipt leaked
    assert avg_cost == pytest.approx(Decimal("2.6667"), abs=Decimal("0.0001"))  # (10*2 + 5*4) / 15


def test_locks_are_taken_in_ascending_item_id_order_without_deadlock(postgres_app):
    """A receipt whose lines list item 2 before item 1 still locks item 1 first; a count over both items queues behind it."""
    world = _make_world(postgres_app, item_names=("Flour", "Sugar"))
    low, high = sorted(world.items.values())
    setup = world.client()
    reverse_invoice = _invoice(world, setup, [(high, 3, 4.0), (low, 2, 4.0)])  # line order: high id first
    session_id = _count_session(setup, {low: 20, high: 30})
    engine = _admin_engine()
    blocker = engine.connect()
    observer = engine.connect()
    client_w, client_c = world.client(), world.client()
    try:
        blocker.execute(text("select id from inventory_items where id = :id for update"), {"id": high})  # held by a third session

        writer = Run(lambda: _receive(client_w, reverse_invoice)).start()
        _wait_until(lambda: _blocked_backends(engine) >= 1, "receipt to block on the high-id item")
        # It is blocked on `high` *while already holding `low`*: ascending order, regardless of line order.
        free = {row[0] for row in observer.execute(text("select id from inventory_items where id = any(:ids) order by id for update skip locked"), {"ids": [low, high]})}
        observer.rollback()
        assert free == set(), f"expected both rows locked/held, but {free} were free"  # high by blocker, low by the receipt
        assert not writer.done.is_set()

        counter = Run(lambda: _finalize(client_c, session_id)).start()
        _wait_until(lambda: _blocked_backends(engine) >= 2, "count finalize to queue behind the receipt")
        assert not counter.done.is_set()

        blocker.rollback()  # release: receipt finishes, then the count, with no deadlock
        writer.join()
        counter.join()
    finally:
        blocker.close()
        observer.close()
        engine.dispose()

    assert writer.error is None and counter.error is None, (writer.error, counter.error)
    assert (writer.result.status_code, counter.result.status_code) == (200, 200)
    world.assert_reconciles(low, opening="10", expected_on_hand="20", movements=2)
    world.assert_reconciles(high, opening="10", expected_on_hand="30", movements=2)
    assert [row[1:] for row in world.state(low)[2]] == [(Decimal("10"), Decimal("2"), Decimal("12")), (Decimal("12"), Decimal("8"), Decimal("20"))]
    assert [row[1:] for row in world.state(high)[2]] == [(Decimal("10"), Decimal("3"), Decimal("13")), (Decimal("13"), Decimal("17"), Decimal("30"))]


def test_row_lock_respects_tenant_isolation_under_forced_rls(postgres_app):
    """A lock held in tenant A neither blocks tenant B nor lets tenant B reach tenant A's item."""
    world_a = _make_world(postgres_app)
    world_b = _make_world(postgres_app)
    item_a, item_b = world_a.items["Flour"], world_b.items["Flour"]
    setup_a = world_a.client()
    invoice_a = _invoice(world_a, setup_a, [(item_a, 5, 4.0)])
    client_a, client_b = world_a.client(), world_b.client()

    gate = Gate()
    event.listen(Session, "before_flush", gate)
    run_a = Run(lambda: _receive(client_a, invoice_a), gate)
    try:
        run_a.start()
        assert gate.reached.wait(WAIT_SECONDS)
        # Tenant B writes its own item to completion while tenant A's row lock is held.
        assert _adjust(client_b, item_b, 4).status_code == 201
        # Tenant B cannot address tenant A's item at all (not found), so it never queues on A's lock.
        assert _adjust(client_b, item_a, 1).status_code == 404
        assert not run_a.done.is_set()
    finally:
        gate.release.set()
        run_a.join()
        event.remove(Session, "before_flush", gate)
    assert run_a.error is None and run_a.result.status_code == 200
    world_a.assert_reconciles(item_a, opening="10", expected_on_hand="15", movements=1)
    world_b.assert_reconciles(item_b, opening="10", expected_on_hand="14", movements=1)
