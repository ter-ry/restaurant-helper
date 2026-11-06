"""Acceptance tests for the append-only adjustment reversal workflow (#231, owner decision #196 A).

Quantities are hand-calculated. A manual adjustment may be reversed exactly once by a linked
compensating movement; the original row is never modified; stock cannot go negative.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import AuditEvent, InventoryItem, InventoryMovement, User
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles
from backend.tests.test_pilot_api import csrf_headers, login, select_org


def _new_item(app, *, on_hand="10", avg_cost="2.50", name=None):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        org = make_operational_organization(owner, name=f"Reversal {uuid4().hex[:8]}", location_name="Main")
        from backend.models import RestaurantLocation

        location = RestaurantLocation.query.filter_by(organization_id=org.id).one()
        item = InventoryItem(
            organization_id=org.id,
            location_id=location.id,
            name=name or f"Flour {uuid4().hex[:5]}",
            normalized_name=(name or "flour").lower() + uuid4().hex[:5],
            category="Dry goods",
            stock_unit="kg",
            current_on_hand=Decimal(on_hand),
            average_unit_cost=Decimal(avg_cost),
        )
        db.session.add(item)
        db.session.commit()
        return org.id, item.id


def _adjust(client, item_id, delta, kind="manual increase"):
    response = client.post(
        f"/api/pilot/inventory/items/{item_id}/adjustments",
        headers=csrf_headers(client),
        json={"reason": "count fix", "quantityDelta": delta, "movementType": kind, "sourceRecordId": uuid4().hex[:8], "sourceLineId": "1"},
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _reverse(client, movement_id, **payload):
    payload.setdefault("reason", "entered by mistake")
    return client.post(f"/api/pilot/inventory/movements/{movement_id}/reverse", headers=csrf_headers(client), json=payload)


def _snapshot(item_id):
    item = db.session.get(InventoryItem, item_id)
    return Decimal(item.current_on_hand), Decimal(item.average_unit_cost), InventoryMovement.query.filter_by(inventory_item_id=item_id).count()


def test_reverse_decrease_appends_linked_movement_and_keeps_original_immutable(app, client):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    original = _adjust(client, item_id, -4, "manual decrease")  # 10 -> 6

    response = _reverse(client, original["id"], idempotencyKey="k1")

    assert response.status_code == 201, response.get_data(as_text=True)
    body = response.get_json()
    assert (body["quantityBefore"], body["quantityDelta"], body["quantityAfter"]) == (6, 4, 10)
    assert body["sourceType"] == "adjustment reversal" and body["sourceRecordId"] == str(original["id"]) and body["replayed"] is False
    with app.app_context():
        on_hand, avg, count = _snapshot(item_id)
        assert (on_hand, avg, count) == (Decimal("10"), Decimal("2.50"), 2)  # weighted-average cost untouched
        row = db.session.get(InventoryMovement, original["id"])
        assert (row.quantity_before, row.quantity_delta, row.quantity_after, row.reason, row.source_type) == (
            Decimal("10"), Decimal("-4"), Decimal("6"), "count fix", "manual decrease"
        )
        assert_ledger_reconciles(item_id, opening="10", expected_on_hand="10")
        audit = AuditEvent.query.filter_by(event_type="inventory.adjustment_reversed", entity_id=str(body["id"])).one()
        assert audit.metadata_json["originalMovementId"] == original["id"]
        assert audit.metadata_json["reason"] == "entered by mistake" and audit.actor_user_id is not None

    detail = client.get(f"/api/pilot/inventory/items/{item_id}").get_json()["movementHistory"]
    by_id = {m["id"]: m for m in detail}
    assert by_id[original["id"]]["reversedByMovementId"] == body["id"] and by_id[original["id"]]["reversible"] is False
    assert by_id[body["id"]]["reversalOfMovementId"] == original["id"] and by_id[body["id"]]["reversible"] is False


def test_second_reversal_rejected_and_same_key_replays_without_new_movement(app, client):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    original = _adjust(client, item_id, 3)  # 10 -> 13
    first = _reverse(client, original["id"], idempotencyKey="abc")
    assert first.status_code == 201

    replay = _reverse(client, original["id"], idempotencyKey="abc")
    other = _reverse(client, original["id"], idempotencyKey="different")
    nokey = _reverse(client, original["id"])

    assert replay.status_code == 200 and replay.get_json()["id"] == first.get_json()["id"] and replay.get_json()["replayed"] is True
    assert other.status_code == 409 and nokey.status_code == 409
    with app.app_context():
        assert _snapshot(item_id) == (Decimal("10"), Decimal("2.50"), 2)


def test_reversal_of_increase_rejected_when_it_would_go_negative(app, client):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    increase = _adjust(client, item_id, 5)  # 15
    _adjust(client, item_id, -13, "manual decrease")  # 2
    with app.app_context():
        before = _snapshot(item_id)

    response = _reverse(client, increase["id"])  # 2 - 5 = -3

    assert response.status_code == 409 and "negative" in str(response.get_json()["errors"]["movement"]).lower() + response.get_data(as_text=True).lower()
    with app.app_context():
        assert _snapshot(item_id) == before
        assert AuditEvent.query.filter_by(event_type="inventory.adjustment_reversed").count() == 0


@pytest.mark.parametrize("make_source", ["receipt", "reversal", "missing"])
def test_non_adjustment_movements_and_unknown_ids_fail_closed(app, client, make_source):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    if make_source == "missing":
        target = 999999
        expected = 404
    else:
        if make_source == "receipt":
            with app.app_context():
                item = db.session.get(InventoryItem, item_id)
                movement = InventoryMovement(
                    organization_id=org_id, location_id=item.location_id, inventory_item_id=item_id, quantity_delta=Decimal("1"),
                    quantity_before=Decimal("10"), quantity_after=Decimal("11"), unit="kg", source_type="invoice receipt",
                    source_record_id="inv-1", source_line_id="1", reason="",
                )
                item.current_on_hand = Decimal("11")
                db.session.add(movement)
                db.session.commit()
                target = movement.id
        else:
            original = _adjust(client, item_id, 2)
            target = _reverse(client, original["id"]).get_json()["id"]
        expected = 400
    with app.app_context():
        before = _snapshot(item_id)

    response = _reverse(client, target)

    assert response.status_code == expected
    with app.app_context():
        assert _snapshot(item_id) == before


def test_reason_required_and_validation_does_not_write(app, client):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    original = _adjust(client, item_id, 1)
    response = _reverse(client, original["id"], reason="  ")
    assert response.status_code == 400 and "reason" in response.get_json()["errors"]
    with app.app_context():
        assert _snapshot(item_id)[2] == 1


def test_cross_tenant_and_role_denied(app, client):
    login(client)
    org_a, item_a = _new_item(app)
    org_b, item_b = _new_item(app)
    select_org(client, org_a)
    movement_a = _adjust(client, item_a, 2)
    select_org(client, org_b)
    with app.app_context():
        before = _snapshot(item_a)

    cross = _reverse(client, movement_a["id"])  # org B context, org A movement

    assert cross.status_code == 404
    with app.app_context():
        assert _snapshot(item_a) == before

    # A user with no membership in org A cannot reach its movement at all (only owner/manager roles exist).
    from backend.tests.test_pilot_api import login_manager

    client.post("/api/auth/logout", headers=csrf_headers(client))
    outsider = client
    login_manager(outsider)
    selected = outsider.post("/api/organizations/select", headers=csrf_headers(outsider), json={"organizationId": org_a})
    assert selected.status_code in {403, 404}
    assert _reverse(outsider, movement_a["id"]).status_code in {403, 404}
    with app.app_context():
        assert _snapshot(item_a) == before


def test_unauthenticated_request_rejected(client):
    response = client.post("/api/pilot/inventory/movements/1/reverse", headers=csrf_headers(client), json={"reason": "x"})
    assert response.status_code == 401


def test_rollback_when_audit_write_fails_leaves_no_partial_state(app, client, monkeypatch):
    login(client)
    org_id, item_id = _new_item(app)
    select_org(client, org_id)
    original = _adjust(client, item_id, -2, "manual decrease")
    with app.app_context():
        before = _snapshot(item_id)

    import backend.pilot_api as pilot_api

    def boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(pilot_api, "record_audit_event", boom)
    app.config["PROPAGATE_EXCEPTIONS"] = False
    response = _reverse(client, original["id"])
    assert response.status_code == 500
    db.session.rollback()
    with app.app_context():
        assert _snapshot(item_id) == before
    monkeypatch.undo()
    db.session.rollback()  # the test app fixture shares one session; production teardown rolls the failed request back
    retry_client = client
    select_org(retry_client, org_id)
    assert _reverse(retry_client, original["id"]).status_code == 201  # nothing was committed by the failed attempt
