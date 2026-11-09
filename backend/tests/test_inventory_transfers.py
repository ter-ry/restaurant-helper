"""Acceptance tests for atomic inter-location inventory transfers (#233, owner decision #197 A).

Quantities and costs are hand-calculated. Source weighted-average cost is carried to the destination.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import AuditEvent, InventoryItem, InventoryMovement, InventoryTransfer, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles
from backend.tests.test_pilot_api import csrf_headers, login, select_org


def _item(org_id, location_id, name, on_hand, cost, unit="kg"):
    item = InventoryItem(
        organization_id=org_id,
        location_id=location_id,
        name=name,
        normalized_name=name.lower(),
        category="Dry goods",
        stock_unit=unit,
        current_on_hand=Decimal(on_hand),
        average_unit_cost=Decimal(cost),
    )
    db.session.add(item)
    db.session.flush()
    return item.id


@pytest.fixture()
def world(app, client):
    login(client)
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        org = make_operational_organization(owner, name=f"Transfer {uuid4().hex[:8]}", location_name="Main")
        main = RestaurantLocation.query.filter_by(organization_id=org.id).one()
        second = RestaurantLocation(organization_id=org.id, name="Kiosk", city="Toronto", region="ON", country="Canada")
        db.session.add(second)
        db.session.flush()
        other_org = make_operational_organization(owner, name=f"Other {uuid4().hex[:8]}", location_name="Elsewhere")
        elsewhere = RestaurantLocation.query.filter_by(organization_id=other_org.id).one()
        data = {
            "org": org.id,
            "main": main.id,
            "kiosk": second.id,
            "elsewhere": elsewhere.id,
            "flour_main": _item(org.id, main.id, "Flour", "10", "2.00"),
            "flour_kiosk": _item(org.id, second.id, "Flour", "5", "3.00"),
            "sugar_main": _item(org.id, main.id, "Sugar", "4", "1.00"),
            "milk_kiosk_l": _item(org.id, second.id, "Sugar ", "1", "1.00", unit="l"),
            "foreign": _item(other_org.id, elsewhere.id, "Flour", "9", "1.00"),
        }
        db.session.commit()
    select_org(client, data["org"])
    with client.session_transaction() as flask_session:
        flask_session["pilot_current_location_id"] = data["main"]
    return data


def _transfer(client, world, **overrides):
    payload = {"sourceItemId": world["flour_main"], "destinationLocationId": world["kiosk"], "quantity": 4, "idempotencyKey": uuid4().hex, "reason": "kiosk restock"}
    payload.update(overrides)
    return client.post("/api/pilot/inventory/transfers", headers=csrf_headers(client), json=payload)


def _state(app, *ids):
    with app.app_context():
        out = []
        for item_id in ids:
            item = db.session.get(InventoryItem, item_id)
            out.append((Decimal(item.current_on_hand), Decimal(item.average_unit_cost)))
        return out, InventoryMovement.query.count(), InventoryTransfer.query.count()


def test_transfer_moves_stock_in_paired_movements_and_carries_source_cost(app, client, world):
    response = _transfer(client, world)

    assert response.status_code == 201, response.get_data(as_text=True)
    body = response.get_json()
    assert body["replayed"] is False and body["unitCost"] == 2.0
    assert (body["outMovement"]["quantityBefore"], body["outMovement"]["quantityDelta"], body["outMovement"]["quantityAfter"]) == (10, -4, 6)
    assert (body["inMovement"]["quantityBefore"], body["inMovement"]["quantityDelta"], body["inMovement"]["quantityAfter"]) == (5, 4, 9)
    assert body["outMovement"]["sourceType"] == "inventory transfer out" and body["inMovement"]["sourceType"] == "inventory transfer in"
    assert body["outMovement"]["sourceRecordId"] == body["inMovement"]["sourceRecordId"] == str(body["id"])
    with app.app_context():
        source, target = db.session.get(InventoryItem, world["flour_main"]), db.session.get(InventoryItem, world["flour_kiosk"])
        assert (source.current_on_hand, source.average_unit_cost) == (Decimal("6"), Decimal("2.00"))  # send never moves source cost
        # (5 * 3.00 + 4 * 2.00) / 9 = 23 / 9 = 2.555556
        assert (target.current_on_hand, target.average_unit_cost) == (Decimal("9"), Decimal("2.555556"))
        assert_ledger_reconciles(world["flour_main"], expected_on_hand="6", opening="10")
        assert_ledger_reconciles(world["flour_kiosk"], expected_on_hand="9", opening="5")
        event = AuditEvent.query.filter_by(event_type="inventory.transfer_created").one()
        assert event.metadata_json["quantity"] == 4.0 and event.metadata_json["unitCost"] == 2.0


def test_same_key_replays_without_new_movements_and_different_payload_conflicts(app, client, world):
    first = _transfer(client, world, idempotencyKey="k1")
    before = _state(app, world["flour_main"], world["flour_kiosk"])

    replay = _transfer(client, world, idempotencyKey="k1")
    other_quantity = _transfer(client, world, idempotencyKey="k1", quantity=1)

    assert (first.status_code, replay.status_code, other_quantity.status_code) == (201, 200, 409)
    assert replay.get_json()["id"] == first.get_json()["id"] and replay.get_json()["replayed"] is True
    assert _state(app, world["flour_main"], world["flour_kiosk"]) == before


def test_replay_still_succeeds_after_source_stock_was_consumed(app, client, world):
    assert _transfer(client, world, idempotencyKey="k2", quantity=10).status_code == 201  # source now 0
    assert _transfer(client, world, idempotencyKey="k2", quantity=10).status_code == 200


def test_transfer_exceeding_source_stock_is_refused_and_writes_nothing(app, client, world):
    before = _state(app, world["flour_main"], world["flour_kiosk"])

    response = _transfer(client, world, quantity=10.5)

    assert response.status_code == 409 and "quantity" in response.get_json()["errors"]
    assert _state(app, world["flour_main"], world["flour_kiosk"]) == before


def test_exact_remaining_stock_can_be_sent_leaving_zero(app, client, world):
    assert _transfer(client, world, quantity=10).status_code == 201
    state, _, _ = _state(app, world["flour_main"], world["flour_kiosk"])
    assert state[0][0] == Decimal("0") and state[1][0] == Decimal("15")


def test_destination_with_negative_pos_stock_takes_source_cost(app, client, world):
    with app.app_context():
        db.session.get(InventoryItem, world["flour_kiosk"]).current_on_hand = Decimal("-1.5")
        db.session.commit()
    assert _transfer(client, world, quantity=4).status_code == 201
    state, _, _ = _state(app, world["flour_kiosk"])
    assert state[0] == (Decimal("2.5"), Decimal("2.000000"))  # no positive stock to blend with, so source cost


@pytest.mark.parametrize(
    "overrides,status",
    [
        ({"quantity": 0}, 400),
        ({"quantity": -1}, 400),
        ({"quantity": "abc"}, 400),
        ({"idempotencyKey": ""}, 400),
        ({"destinationLocationId": None}, 400),
        ({"sourceItemId": None}, 400),
    ],
)
def test_validation_failures_write_nothing(app, client, world, overrides, status):
    before = _state(app, world["flour_main"], world["flour_kiosk"])
    response = _transfer(client, world, **overrides)
    assert response.status_code == status, response.get_data(as_text=True)
    assert _state(app, world["flour_main"], world["flour_kiosk"]) == before


def test_same_location_cross_organization_and_foreign_items_are_rejected(app, client, world):
    before = _state(app, world["flour_main"], world["flour_kiosk"], world["foreign"])
    assert _transfer(client, world, destinationLocationId=world["main"]).status_code == 400
    assert _transfer(client, world, destinationLocationId=world["elsewhere"]).status_code == 404
    assert _transfer(client, world, sourceItemId=world["foreign"]).status_code == 404
    assert _transfer(client, world, destinationItemId=world["foreign"]).status_code == 404
    assert _transfer(client, world, destinationItemId=world["sugar_main"]).status_code == 404  # wrong location
    assert _state(app, world["flour_main"], world["flour_kiosk"], world["foreign"]) == before


def test_missing_destination_item_and_unit_mismatch_are_explained(app, client, world):
    missing = _transfer(client, world, sourceItemId=world["sugar_main"])  # kiosk has "Sugar " (different normalized name)
    assert missing.status_code == 404 and "destinationItemId" in missing.get_json()["errors"]
    mismatch = _transfer(client, world, sourceItemId=world["sugar_main"], destinationItemId=world["milk_kiosk_l"])
    assert mismatch.status_code == 400 and "kg" in mismatch.get_json()["errors"]["destinationItemId"]


def test_inactive_item_is_refused(app, client, world):
    with app.app_context():
        db.session.get(InventoryItem, world["flour_kiosk"]).active = False
        db.session.commit()
    assert _transfer(client, world).status_code == 409


def test_unauthenticated_and_missing_csrf_are_rejected(app, client, world):
    payload = {"sourceItemId": world["flour_main"], "destinationLocationId": world["kiosk"], "quantity": 1, "idempotencyKey": "x"}
    assert client.post("/api/pilot/inventory/transfers", json=payload).status_code in (400, 403)
    fresh = app.test_client()
    assert fresh.post("/api/pilot/inventory/transfers", json=payload).status_code in (400, 401, 403)


def test_failure_after_first_write_rolls_back_both_sides(app, client, world, monkeypatch):
    import backend.pilot_api as pilot_api

    def boom(**kwargs):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(pilot_api, "record_audit_event", boom)
    before = _state(app, world["flour_main"], world["flour_kiosk"])
    client.application.config["PROPAGATE_EXCEPTIONS"] = False
    response = _transfer(client, world)
    assert response.status_code == 500
    assert _state(app, world["flour_main"], world["flour_kiosk"]) == before
