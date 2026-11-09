"""PostgreSQL concurrency / RLS / rollback tests for inter-location transfers (#233).

Real endpoint, non-owner runtime role, forced RLS, deterministic two-session harness from #248.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import AuditEvent, InventoryItem, InventoryMovement, InventoryTransfer, RestaurantLocation
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    BASE,
    POSTGRES_URL,
    _make_world,
    _post,
    postgres_app,
    race,
)
from backend.tests.test_postgres_rls import _seed_admin_fixture, _set_rls_context

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


class TwoSites:
    def __init__(self, postgres_app):
        self.world = _make_world(postgres_app, item_names=("Flour",), on_hand="10", avg_cost="2.00")
        self.app = postgres_app
        self.org_id = self.world.org_id
        self.main_item = self.world.items["Flour"]

        def seed():
            main = RestaurantLocation.query.filter_by(organization_id=self.org_id).one()
            kiosk = RestaurantLocation(organization_id=self.org_id, name="Kiosk", city="Toronto", region="ON", country="Canada")
            db.session.add(kiosk)
            db.session.flush()
            template = db.session.get(InventoryItem, self.main_item)
            item = InventoryItem(
                organization_id=self.org_id,
                location_id=kiosk.id,
                name="Flour",
                normalized_name=template.normalized_name,
                category="Dry goods",
                stock_unit="kg",
                current_on_hand=Decimal("5"),
                average_unit_cost=Decimal("3.00"),
            )
            db.session.add(item)
            db.session.flush()
            return main.id, kiosk.id, item.id

        self.main_id, self.kiosk_id, self.kiosk_item = _seed_admin_fixture("transfer second location", seed)

    def client(self, location_id=None):
        client = self.world.client()
        with client.session_transaction(base_url=BASE) as flask_session:
            flask_session["pilot_current_location_id"] = location_id or self.main_id
        return client

    def transfer(self, client, *, source, to_location, quantity, key=None, **extra):
        return _post(
            client,
            "/api/pilot/inventory/transfers",
            {"sourceItemId": source, "destinationLocationId": to_location, "quantity": quantity, "idempotencyKey": key or uuid4().hex, **extra},
        )

    def read(self, item_id):
        with self.app.app_context():
            _set_rls_context(access_scope="customer", organization_id=self.org_id)
            item = db.session.get(InventoryItem, item_id)
            moves = InventoryMovement.query.filter_by(inventory_item_id=item_id).order_by(InventoryMovement.id).all()
            out = (
                Decimal(item.current_on_hand),
                Decimal(item.average_unit_cost),
                [(m.source_type, Decimal(m.quantity_before), Decimal(m.quantity_delta), Decimal(m.quantity_after)) for m in moves],
            )
            db.session.rollback()
            db.session.remove()
        return out

    def count(self, model, **filters):
        with self.app.app_context():
            _set_rls_context(access_scope="customer", organization_id=self.org_id)
            total = model.query.filter_by(**filters).count()
            db.session.rollback()
            db.session.remove()
        return total


def _assert_chain(rows, opening: str, on_hand: Decimal):
    running = Decimal(opening)
    for _, before, delta, after in rows:
        assert before == running and before + delta == after
        running = after
    assert running == on_hand


def test_transfer_under_forced_rls_moves_both_sides_and_carries_cost(postgres_app):
    sites = TwoSites(postgres_app)
    response = sites.transfer(sites.client(), source=sites.main_item, to_location=sites.kiosk_id, quantity=4)

    assert response.status_code == 201, response.get_data(as_text=True)
    src_on_hand, src_cost, src_rows = sites.read(sites.main_item)
    dst_on_hand, dst_cost, dst_rows = sites.read(sites.kiosk_item)
    assert (src_on_hand, src_cost) == (Decimal("6"), Decimal("2.000000"))
    assert (dst_on_hand, dst_cost) == (Decimal("9"), Decimal("2.555556"))  # (5*3 + 4*2) / 9
    assert src_rows == [("inventory transfer out", Decimal("10"), Decimal("-4"), Decimal("6"))]
    assert dst_rows == [("inventory transfer in", Decimal("5"), Decimal("4"), Decimal("9"))]
    _assert_chain(src_rows, "10", src_on_hand)
    _assert_chain(dst_rows, "5", dst_on_hand)
    assert sites.count(AuditEvent, event_type="inventory.transfer_created") == 1


def test_two_concurrent_identical_requests_transfer_exactly_once(postgres_app):
    sites = TwoSites(postgres_app)
    a, b = sites.client(), sites.client()

    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="same"),
        lambda: sites.transfer(b, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="same"),
    )

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert sorted((run_a.result.status_code, run_b.result.status_code)) == [200, 201]
    assert sites.read(sites.main_item)[0] == Decimal("6") and sites.read(sites.kiosk_item)[0] == Decimal("9")
    assert sites.count(InventoryTransfer) == 1
    assert len(sites.read(sites.main_item)[2]) == 1 and len(sites.read(sites.kiosk_item)[2]) == 1


def test_transfer_racing_manual_waste_cannot_drive_source_negative(postgres_app):
    sites = TwoSites(postgres_app)
    a, b = sites.client(), sites.client()

    def waste():
        return _post(b, "/api/pilot/inventory/waste-events", {"inventoryItemId": sites.main_item, "quantity": 8, "reason": "spoilage / expired"})

    run_a, run_b = race(lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=8), waste)

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    codes = sorted((run_a.result.status_code, run_b.result.status_code))
    assert codes[0] in (201, 409, 400) and 201 in codes and codes != [201, 201], (codes, run_b.result.get_data(as_text=True))
    on_hand, _, rows = sites.read(sites.main_item)
    assert on_hand == Decimal("2")  # exactly one of the two 8 kg decreases applied
    _assert_chain(rows, "10", on_hand)


def test_opposing_transfers_do_not_deadlock_and_reconcile(postgres_app):
    sites = TwoSites(postgres_app)
    a, b = sites.client(sites.main_id), sites.client(sites.kiosk_id)

    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=3),
        lambda: sites.transfer(b, source=sites.kiosk_item, to_location=sites.main_id, quantity=2),
    )

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (201, 201), (run_a.result.get_data(as_text=True), run_b.result.get_data(as_text=True))
    main_on_hand, _, main_rows = sites.read(sites.main_item)
    kiosk_on_hand, _, kiosk_rows = sites.read(sites.kiosk_item)
    assert (main_on_hand, kiosk_on_hand) == (Decimal("9"), Decimal("6"))  # 10 - 3 + 2, 5 + 3 - 2
    _assert_chain(main_rows, "10", main_on_hand)
    _assert_chain(kiosk_rows, "5", kiosk_on_hand)
    assert main_on_hand + kiosk_on_hand == Decimal("15")  # transfers never create or destroy stock


def test_failure_between_writes_rolls_back_transfer_and_both_movements(postgres_app):
    sites = TwoSites(postgres_app)
    a, b = sites.client(), sites.client()
    a.application.config["PROPAGATE_EXCEPTIONS"] = False

    # Writer A is failed right after reading; writer B (a different transfer) then proceeds on untouched state.
    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="doomed"),
        lambda: sites.transfer(b, source=sites.main_item, to_location=sites.kiosk_id, quantity=1, key="survivor"),
        fail_first=True,
    )

    statuses = (getattr(run_a.result, "status_code", None), getattr(run_b.result, "status_code", None))
    assert statuses[1] == 201, (statuses, run_a.error, run_b.error)
    assert sites.count(InventoryTransfer) == 1
    assert sites.read(sites.main_item)[0] == Decimal("9") and sites.read(sites.kiosk_item)[0] == Decimal("6")
    assert len(sites.read(sites.main_item)[2]) == 1 and len(sites.read(sites.kiosk_item)[2]) == 1


def test_other_organization_cannot_transfer_into_this_organizations_locations(postgres_app):
    sites = TwoSites(postgres_app)
    outsider = TwoSites(postgres_app)  # a second, unrelated organization with its own locations and items
    client = outsider.client()

    assert sites.transfer(client, source=sites.main_item, to_location=outsider.kiosk_id, quantity=1).status_code == 404  # not their item
    assert sites.transfer(client, source=outsider.main_item, to_location=sites.kiosk_id, quantity=1).status_code == 404  # not their location
    assert sites.read(sites.main_item)[0] == Decimal("10") and sites.read(sites.kiosk_item)[0] == Decimal("5")
    assert sites.count(InventoryTransfer) == 0 and outsider.count(InventoryTransfer) == 0
