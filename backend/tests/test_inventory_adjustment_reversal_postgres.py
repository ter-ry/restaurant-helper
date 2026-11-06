"""PostgreSQL concurrency / RLS / rollback tests for adjustment reversal (#231).

Reuses the deterministic two-session harness of #248: writer A is paused right before it writes, writer B
is proven blocked on A's item row lock (via ``pg_stat_activity``), then both finish. All requests run the real
endpoints as the non-owner runtime role with forced RLS.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from backend.extensions import db
from backend.models import AuditEvent
from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    POSTGRES_URL,
    _adjust,
    _make_world,
    _post,
    postgres_app,
    race,
)
from backend.tests.test_postgres_rls import _set_rls_context

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _reverse(client, movement_id: int, key: str = "", reason: str = "entered in error"):
    payload = {"reason": reason}
    if key:
        payload["idempotencyKey"] = key
    return _post(client, f"/api/pilot/inventory/movements/{movement_id}/reverse", payload)


def _audit_count(world, event_type: str) -> int:
    with world.app.app_context():
        _set_rls_context(access_scope="customer", organization_id=world.org_id)
        count = AuditEvent.query.filter_by(organization_id=world.org_id, event_type=event_type).count()
        db.session.rollback()
        db.session.remove()
    return count


def test_two_concurrent_reversals_of_one_adjustment_post_exactly_one_compensating_movement(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    original = _adjust(setup, item, -4, "manual decrease").get_json()["id"]  # 10 -> 6
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _reverse(client_a, original, "key-a"), lambda: _reverse(client_b, original, "key-b"))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert (run_a.result.status_code, run_b.result.status_code) == (201, 409), (run_a.result.get_data(as_text=True), run_b.result.get_data(as_text=True))
    avg_cost, rows = world.assert_reconciles(item, opening="10", expected_on_hand="10", movements=2)
    assert [row[0] for row in rows] == ["manual decrease", "adjustment reversal"]
    assert rows[1][1:] == (Decimal("6"), Decimal("4"), Decimal("10"))
    assert avg_cost == Decimal("2.0000")  # manual adjustments and their reversals never move weighted-average cost
    assert _audit_count(world, "inventory.adjustment_reversed") == 1


def test_duplicate_request_with_same_key_replays_then_other_keys_conflict(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    client = world.client()
    original = _adjust(client, item, 3).get_json()["id"]  # 13

    first = _reverse(client, original, "same")
    replay = _reverse(client, original, "same")
    other = _reverse(client, original, "other")

    assert (first.status_code, replay.status_code, other.status_code) == (201, 200, 409)
    assert replay.get_json()["id"] == first.get_json()["id"] and replay.get_json()["replayed"] is True
    world.assert_reconciles(item, opening="10", expected_on_hand="10", movements=2)


def test_reversal_racing_a_decrease_cannot_drive_stock_negative(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    increase = _adjust(setup, item, 5).get_json()["id"]  # 15
    client_a, client_b = world.client(), world.client()

    # A: manual decrease of 12 (15 -> 3) paused before writing; B: reversing the +5 would leave 3 - 5 < 0.
    run_a, run_b = race(lambda: _adjust(client_a, item, -12, "manual decrease"), lambda: _reverse(client_b, increase))

    assert run_a.error is None and run_b.error is None
    assert (run_a.result.status_code, run_b.result.status_code) == (201, 409)
    world.assert_reconciles(item, opening="10", expected_on_hand="3", movements=2)
    assert _audit_count(world, "inventory.adjustment_reversed") == 0


def test_failed_reversal_rolls_back_atomically_and_can_be_retried(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    setup = world.client()
    original = _adjust(setup, item, -2, "manual decrease").get_json()["id"]  # 8
    client_a, client_b = world.client(), world.client()

    run_a, run_b = race(lambda: _reverse(client_a, original, "doomed"), lambda: _reverse(client_b, original, "survivor"), fail_first=True)

    assert run_a.error is not None or run_a.result.status_code >= 500
    assert run_b.error is None and run_b.result.status_code == 201, run_b.result.get_data(as_text=True)
    avg_cost, rows = world.assert_reconciles(item, opening="10", expected_on_hand="10", movements=2)
    assert rows[1][1:] == (Decimal("8"), Decimal("2"), Decimal("10"))  # only one reversal, nothing of the failed one leaked
    assert _audit_count(world, "inventory.adjustment_reversed") == 1


def test_cross_tenant_reversal_denied_and_original_row_untouched(postgres_app):
    world_a = _make_world(postgres_app)
    world_b = _make_world(postgres_app)
    item_a, item_b = world_a.items["Flour"], world_b.items["Flour"]
    original = _adjust(world_a.client(), item_a, -1, "manual decrease").get_json()["id"]  # 9
    before = world_a.state(item_a)

    client_b = world_b.client()
    assert _reverse(client_b, original).status_code == 404
    assert world_a.state(item_a) == before
    world_a.assert_reconciles(item_a, opening="10", expected_on_hand="9", movements=1)
    world_b.assert_reconciles(item_b, opening="10", expected_on_hand="10", movements=0)
    assert _audit_count(world_a, "inventory.adjustment_reversed") == 0

    # Forced RLS: tenant B's runtime session cannot even see tenant A's movement row.
    from backend.models import InventoryMovement

    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=world_b.org_id)
        assert db.session.get(InventoryMovement, original) is None
        db.session.rollback()
        db.session.remove()


def test_reversed_original_row_is_never_mutated(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    client = world.client()
    original = _adjust(client, item, -4, "manual decrease").get_json()
    assert _reverse(client, original["id"]).status_code == 201
    _, _, rows = world.state(item)
    assert rows[0] == ("manual decrease", Decimal("10"), Decimal("-4"), Decimal("6"))
