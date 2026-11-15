"""Endpoint acceptance tests for verified-free ($0) inventory (#279 Phase B). Hand-calculated values."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import AuditEvent, InventoryCostVerification, InventoryItem, InventoryMovement, InventoryTransfer
from backend.tests.test_inventory_transfers import world  # noqa: F401  (fixture)
from backend.tests.test_pilot_api import csrf_headers


def _zero(app, *item_ids):
    with app.app_context():
        for item_id in item_ids:
            db.session.get(InventoryItem, item_id).average_unit_cost = Decimal("0")
        db.session.commit()


def _verify(client, item_id, quantity=6, **overrides):
    payload = {"quantity": quantity, "evidenceType": "supplier_free_goods", "evidenceNote": "Supplier credit memo #88: free case", "idempotencyKey": uuid4().hex}
    payload.update(overrides)
    return client.post(f"/api/pilot/inventory/items/{item_id}/cost-verifications", headers=csrf_headers(client), json=payload)


def _transfer(client, world, **overrides):
    payload = {"sourceItemId": world["flour_main"], "destinationLocationId": world["kiosk"], "quantity": 4, "idempotencyKey": uuid4().hex}
    payload.update(overrides)
    return client.post("/api/pilot/inventory/transfers", headers=csrf_headers(client), json=payload)


def _rows(app, item_id):
    with app.app_context():
        return [(r.quantity, r.consumed_quantity, r.revoked_at is not None) for r in InventoryCostVerification.query.filter_by(inventory_item_id=item_id).order_by(InventoryCostVerification.id)]


def test_unverified_zero_is_refused_and_verified_free_moves_at_zero_with_evidence(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"])
    assert _transfer(client, world).status_code == 409
    created = _verify(client, world["flour_main"], 6)
    assert created.status_code == 201, created.get_data(as_text=True)
    assert created.get_json()["remainingQuantity"] == 6

    response = _transfer(client, world, quantity=4)
    assert response.status_code == 201, response.get_data(as_text=True)
    assert response.get_json()["unitCost"] == 0
    with app.app_context():
        kiosk = db.session.get(InventoryItem, world["flour_kiosk"])
        # value conserved: (5 * 3.00 + 4 * 0) / 9 = 1.666667
        assert (Decimal(kiosk.current_on_hand), Decimal(kiosk.average_unit_cost)) == (Decimal("9"), Decimal("1.666667"))
        assert AuditEvent.query.filter_by(event_type="inventory.transfer_created").count() == 1
    assert _rows(app, world["flour_main"]) == [(Decimal("6"), Decimal("4"), False)]
    assert _rows(app, world["flour_kiosk"]) == [(Decimal("4"), Decimal("0"), False)]
    # 2 verified units remain; 3 is refused and nothing changes.
    before = _rows(app, world["flour_main"])
    assert _transfer(client, world, quantity=3).status_code == 409
    assert _rows(app, world["flour_main"]) == before
    assert _transfer(client, world, quantity=2).status_code == 201


def test_replay_of_verified_free_transfer_does_not_consume_evidence_twice(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"])
    _verify(client, world["flour_main"], 6)
    key = uuid4().hex
    assert _transfer(client, world, idempotencyKey=key).status_code == 201
    replay = _transfer(client, world, idempotencyKey=key)
    assert replay.status_code == 200 and replay.get_json()["replayed"] is True
    assert _rows(app, world["flour_main"]) == [(Decimal("6"), Decimal("4"), False)]
    assert _rows(app, world["flour_kiosk"]) == [(Decimal("4"), Decimal("0"), False)]
    with app.app_context():
        assert InventoryTransfer.query.count() == 1


def test_priced_stock_never_consumes_evidence_and_carries_average_cost(app, client, world):  # noqa: F811
    response = _transfer(client, world)
    assert response.status_code == 201 and response.get_json()["unitCost"] == 2.0
    assert _rows(app, world["flour_main"]) == []


def test_verifying_priced_stock_is_refused(app, client, world):  # noqa: F811
    assert _verify(client, world["flour_main"], 2).status_code == 409


def test_verification_validation_and_idempotency(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"])
    assert _verify(client, world["flour_main"], 11).status_code == 409  # more than the 10 on hand
    assert _verify(client, world["flour_main"], 2, evidenceNote="  ").status_code == 400
    assert _verify(client, world["flour_main"], 2, evidenceType="guess").status_code == 400
    assert _verify(client, world["flour_main"], 2, idempotencyKey="").status_code == 400
    assert _verify(client, world["foreign"], 2).status_code == 404  # another organization's item
    key = uuid4().hex
    first = _verify(client, world["flour_main"], 6, idempotencyKey=key)
    replay = _verify(client, world["flour_main"], 6, idempotencyKey=key)
    assert first.status_code == 201 and replay.status_code == 200 and replay.get_json()["replayed"] is True
    assert replay.get_json()["id"] == first.get_json()["id"]
    assert _verify(client, world["flour_main"], 5, idempotencyKey=key).status_code == 409
    assert _verify(client, world["flour_main"], 6, idempotencyKey=key, evidenceNote="different note").status_code == 409
    assert _verify(client, world["flour_main"], 5).status_code == 409  # only 4 unverified left
    assert len(_rows(app, world["flour_main"])) == 1


def test_revoke_correct_and_audit(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"])
    batch = _verify(client, world["flour_main"], 6).get_json()["id"]
    headers = csrf_headers(client)
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch}/revoke", headers=headers, json={"reason": ""}).status_code == 400
    revoked = client.post(f"/api/pilot/inventory/cost-verifications/{batch}/revoke", headers=headers, json={"reason": "Credit memo was for a different item"})
    assert revoked.status_code == 200 and revoked.get_json()["remainingQuantity"] == 0
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch}/revoke", headers=headers, json={"reason": "Credit memo was for a different item"}).get_json()["replayed"] is True
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch}/revoke", headers=headers, json={"reason": "other"}).status_code == 409
    assert _transfer(client, world).status_code == 409  # revoked evidence no longer covers a $0 transfer

    batch2 = _verify(client, world["flour_main"], 6).get_json()["id"]
    assert _transfer(client, world, quantity=4).status_code == 201
    # consumed evidence cannot be revoked, and a correction cannot go below the 4 already moved
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch2}/revoke", headers=headers, json={"reason": "oops"}).status_code == 409
    body = {"quantity": 3, "evidenceType": "donation", "evidenceNote": "x", "reason": "recount", "idempotencyKey": uuid4().hex}
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch2}/correct", headers=headers, json=body).status_code == 409
    body.update(quantity=5, idempotencyKey=uuid4().hex)
    fixed = client.post(f"/api/pilot/inventory/cost-verifications/{batch2}/correct", headers=headers, json=body)
    assert fixed.status_code == 201, fixed.get_data(as_text=True)
    assert fixed.get_json()["correctionOfId"] == batch2 and fixed.get_json()["consumedQuantity"] == 4 and fixed.get_json()["remainingQuantity"] == 1
    replayed = client.post(f"/api/pilot/inventory/cost-verifications/{batch2}/correct", headers=headers, json=body)
    assert replayed.status_code == 200 and replayed.get_json()["replayed"] is True and replayed.get_json()["id"] == fixed.get_json()["id"]
    body["idempotencyKey"] = uuid4().hex
    assert client.post(f"/api/pilot/inventory/cost-verifications/{batch2}/correct", headers=headers, json=body).status_code == 409  # original already revoked
    listing = client.get(f"/api/pilot/inventory/items/{world['flour_main']}/cost-verifications").get_json()["verifications"]
    assert [row["revokedAt"] is not None for row in listing] == [True, True, False]
    with app.app_context():
        events = {e.event_type for e in AuditEvent.query.all()}
        assert {"inventory.cost_verification_created", "inventory.cost_verification_revoked", "inventory.cost_verification_corrected"} <= events


def test_mixed_destination_stays_partially_unknown(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"], world["flour_kiosk"])
    _verify(client, world["flour_main"], 4)
    assert _transfer(client, world, quantity=4).status_code == 201
    # Kiosk now holds 9 at $0: 5 unverified legacy + 4 verified free; the legacy 5 can still not move at $0 elsewhere.
    assert _rows(app, world["flour_kiosk"]) == [(Decimal("4"), Decimal("0"), False)]
    with app.app_context():
        movements = InventoryMovement.query.filter(InventoryMovement.source_type.like("inventory transfer%")).count()
        assert movements == 2


def test_verified_item_cannot_change_base_unit_and_foreign_unit_evidence_never_covers(app, client, world):  # noqa: F811
    _zero(app, world["flour_main"])
    assert _verify(client, world["flour_main"], 6).status_code == 201
    patch = client.patch(f"/api/pilot/inventory/items/{world['flour_main']}", headers=csrf_headers(client), json={"stockUnit": "case"})
    assert patch.status_code == 409 and "stockUnit" in patch.get_json()["errors"]
    with app.app_context():
        assert db.session.get(InventoryItem, world["flour_main"]).stock_unit == "kg"
    # Defense in depth: evidence recorded in another unit (e.g. legacy data) does not cover a transfer.
    with app.app_context():
        InventoryCostVerification.query.filter_by(inventory_item_id=world["flour_main"]).update({"unit": "g"})
        db.session.commit()
    assert _transfer(client, world, quantity=2).status_code == 409
