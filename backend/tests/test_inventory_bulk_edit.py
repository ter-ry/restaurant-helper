"""Inventory bulk edit (#234, owner decision #198 Option B): atomic, tenant-scoped, stale-safe, audited."""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from backend.extensions import db
from backend.models import AuditEvent, InventoryItem, InventoryMovement, Organization, RestaurantLocation, Supplier, User
from backend.policy import PERMISSION_ROLES
from backend.seed import LOCAL_ORGANIZATION_NAME, LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_pilot_api import csrf_headers, login, login_manager, select_org

URL = "/api/pilot/inventory/bulk-edit"


def _items(app, count=3):
    with app.app_context():
        organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).one()
        rows = InventoryItem.query.filter_by(organization_id=organization.id).order_by(InventoryItem.id).limit(count).all()
        return organization.id, [row.id for row in rows]


def _state(app, item_id):
    with app.app_context():
        item = db.session.get(InventoryItem, item_id)
        return {
            "min": Decimal(item.min_quantity), "par": Decimal(item.par_level), "supplier": item.supplier_id,
            "name": item.preferred_supplier_name, "active": item.active, "on_hand": Decimal(item.current_on_hand),
            "cost": Decimal(item.average_unit_cost),
        }


def _expected(app, ids, fields):
    out = {}
    for item_id in ids:
        s = _state(app, item_id)
        values = {"minQuantity": float(s["min"]), "parLevel": float(s["par"]), "supplierId": s["supplier"], "active": s["active"]}
        out[str(item_id)] = {field: values[field] for field in fields}
    return out


def _post(client, payload):
    return client.post(URL, json=payload, headers=csrf_headers(client))


def _movement_count(app):
    with app.app_context():
        return InventoryMovement.query.count()


def test_apply_par_and_threshold_updates_all_selected_and_audits(app, client):
    login(client)
    _, ids = _items(app)
    before = {i: _state(app, i) for i in ids}
    movements = _movement_count(app)
    changes = {"minQuantity": 2, "parLevel": 9.5}
    response = _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes)})
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    assert body["applied"] is True and body["summary"]["selected"] == 3
    assert {entry["id"] for entry in body["items"]} == set(ids)
    assert {item["id"]: item["parLevel"] for item in body["refreshedItems"]} == {i: 9.5 for i in ids}
    for item_id in ids:
        after = _state(app, item_id)
        assert after["min"] == Decimal("2") and after["par"] == Decimal("9.5")
        # Ledger-owned and cost fields are never touched.
        assert after["on_hand"] == before[item_id]["on_hand"] and after["cost"] == before[item_id]["cost"]
    assert _movement_count(app) == movements
    with app.app_context():
        per_item = AuditEvent.query.filter_by(event_type="inventory.item_bulk_updated").all()
        batch = AuditEvent.query.filter_by(event_type="inventory.bulk_edit_applied").all()
        assert {int(event.entity_id) for event in per_item} == set(ids)
        assert len(batch) == 1 and batch[0].entity_id == body["batchId"]
        assert all(event.metadata_json["batchId"] == body["batchId"] and event.actor_user_id for event in per_item)


def test_supplier_assignment_and_clear_and_active_toggle(app, client):
    login(client)
    org_id, ids = _items(app, 2)
    with app.app_context():
        supplier = Supplier.query.filter_by(organization_id=org_id, is_active=True).first()
        supplier_id, supplier_name = supplier.id, supplier.name
    changes = {"supplierId": supplier_id, "active": False}
    assert _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes)}).status_code == 200
    for item_id in ids:
        state = _state(app, item_id)
        assert state["supplier"] == supplier_id and state["name"] == supplier_name and state["active"] is False
    cleared = {"supplierId": None}
    assert _post(client, {"itemIds": ids, "changes": cleared, "expected": _expected(app, ids, cleared)}).status_code == 200
    for item_id in ids:
        state = _state(app, item_id)
        assert state["supplier"] is None and state["name"] == ""


def test_dry_run_reports_without_writing(app, client):
    login(client)
    _, ids = _items(app)
    before = {i: _state(app, i) for i in ids}
    changes = {"parLevel": 77}
    response = _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes), "dryRun": True})
    assert response.status_code == 200
    body = response.get_json()
    assert body["applied"] is False and body["summary"]["changed"] == 3
    assert all(entry["after"]["parLevel"] == 77 for entry in body["items"])
    assert {i: _state(app, i) for i in ids} == before
    with app.app_context():
        assert AuditEvent.query.filter_by(event_type="inventory.item_bulk_updated").count() == 0


def test_validation_rejects_everything_atomically(app, client):
    login(client)
    _, ids = _items(app)
    before = {i: _state(app, i) for i in ids}
    cases = [
        ({"itemIds": [], "changes": {"parLevel": 1}}, "itemIds"),
        ({"itemIds": ids, "changes": {}}, "changes"),
        ({"itemIds": ids, "changes": {"currentOnHand": 5}}, "changes"),
        ({"itemIds": ids, "changes": {"parLevel": -1}}, "parLevel"),
        ({"itemIds": ids, "changes": {"parLevel": "abc"}}, "parLevel"),
        ({"itemIds": ids, "changes": {"parLevel": "NaN"}}, "parLevel"),
        ({"itemIds": ids, "changes": {"parLevel": 10**9}}, "parLevel"),
        ({"itemIds": ids, "changes": {"active": "yes"}}, "active"),
        ({"itemIds": list(range(1, 202)), "changes": {"parLevel": 1}}, "itemIds"),
        ({"itemIds": ids, "changes": {"supplierId": 99999999}}, "supplierId"),
    ]
    for payload, field in cases:
        response = _post(client, {**payload, "expected": {}})
        assert response.status_code == 400, (payload, response.get_data(as_text=True))
        assert field in response.get_json()["errors"], payload
    # PAR below reorder threshold (resulting values) rejects the whole batch.
    changes = {"minQuantity": 50, "parLevel": 10}
    response = _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes)})
    assert response.status_code == 400 and any(key.startswith("item-") for key in response.get_json()["errors"])
    assert {i: _state(app, i) for i in ids} == before


def test_missing_expected_values_are_rejected(app, client):
    login(client)
    _, ids = _items(app, 2)
    response = _post(client, {"itemIds": ids, "changes": {"parLevel": 3}})
    assert response.status_code == 400 and "expected" in response.get_json()["errors"]


def test_stale_item_rejects_whole_batch_and_retry_after_success_is_idempotent(app, client):
    login(client)
    _, ids = _items(app, 3)
    changes = {"parLevel": 40}
    expected = _expected(app, ids, changes)
    # Someone else edits one item's PAR after the user reviewed it.
    with app.app_context():
        db.session.get(InventoryItem, ids[1]).par_level = Decimal("33")
        db.session.commit()
    before = {i: _state(app, i) for i in ids}
    stale = _post(client, {"itemIds": ids, "changes": changes, "expected": expected})
    assert stale.status_code == 409
    assert list(stale.get_json()["errors"]) == [f"item-{ids[1]}"]
    assert {i: _state(app, i) for i in ids} == before  # nothing partially applied

    fresh = _expected(app, ids, changes)
    assert _post(client, {"itemIds": ids, "changes": changes, "expected": fresh}).status_code == 200
    events = _audit_count(app)
    # Replay of the same request (lost response / double submit): all items already at target -> no-op.
    replay = _post(client, {"itemIds": ids, "changes": changes, "expected": fresh})
    assert replay.status_code == 200
    assert replay.get_json()["summary"] == {"selected": 3, "changed": 0, "unchanged": 3}
    assert _audit_count(app) == events


def _audit_count(app):
    with app.app_context():
        return AuditEvent.query.count()


def test_archived_supplier_cannot_be_assigned(app, client):
    login(client)
    org_id, ids = _items(app, 2)
    with app.app_context():
        supplier = Supplier.query.filter_by(organization_id=org_id).first()
        supplier.is_active = False
        db.session.commit()
        supplier_id = supplier.id
    changes = {"supplierId": supplier_id}
    response = _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes)})
    assert response.status_code == 400 and "archived" in response.get_json()["errors"]["supplierId"]


def test_cross_tenant_items_and_suppliers_are_not_reachable(app, client):
    login(client)
    org_id, ids = _items(app, 2)
    before = {i: _state(app, i) for i in ids}
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        other = make_operational_organization(owner, name=f"Other {uuid4().hex[:6]}", location_name="Other Kitchen")
        other_id = other.id
        other_item = InventoryItem(
            organization_id=other_id, location_id=RestaurantLocation.query.filter_by(organization_id=other_id).one().id,
            name="Foreign Flour", normalized_name="foreign flour", par_level=Decimal("5"),
        )
        foreign_supplier = Supplier(organization_id=other_id, name="Foreign Supplier", normalized_name="foreign supplier")
        db.session.add_all([other_item, foreign_supplier])
        db.session.commit()
        foreign_item_id, foreign_supplier_id = other_item.id, foreign_supplier.id
    # A foreign item id mixed into a selection: whole request rejected, nothing written, same error as a missing id.
    mixed = [*ids, foreign_item_id]
    response = _post(client, {"itemIds": mixed, "changes": {"parLevel": 8}, "expected": {str(i): {"parLevel": 0} for i in mixed}})
    assert response.status_code == 404
    assert list(response.get_json()["errors"]) == [f"item-{foreign_item_id}"]
    assert _post(client, {"itemIds": [99999999], "changes": {"parLevel": 8}, "expected": {}}).get_json()["errors"] == {"item-99999999": response.get_json()["errors"][f"item-{foreign_item_id}"]}
    # A foreign supplier id cannot be assigned.
    response = _post(client, {"itemIds": ids, "changes": {"supplierId": foreign_supplier_id}, "expected": _expected(app, ids, ["supplierId"])})
    assert response.status_code == 400 and "supplierId" in response.get_json()["errors"]
    with app.app_context():
        assert db.session.get(InventoryItem, foreign_item_id).par_level == Decimal("5")
    assert {i: _state(app, i) for i in ids} == before
    # Operating in the other organization cannot reach the first organization's items either.
    select_org(client, other_id)
    response = _post(client, {"itemIds": ids, "changes": {"parLevel": 8}, "expected": {str(i): {"parLevel": 0} for i in ids}})
    assert response.status_code == 404
    assert {i: _state(app, i) for i in ids} == before


def test_requires_auth_csrf_and_permission(app, client):
    assert client.post(URL, json={}).status_code in {400, 401}
    login(client)
    assert client.post(URL, json={"itemIds": [1], "changes": {"parLevel": 1}}).status_code == 400  # no CSRF token
    client.post("/api/auth/logout", headers=csrf_headers(client))
    login_manager(client)
    _, ids = _items(app, 1)
    changes = {"parLevel": 4}
    assert _post(client, {"itemIds": ids, "changes": changes, "expected": _expected(app, ids, changes)}).status_code == 200  # managers may manage inventory


def test_permission_is_enforced_server_side(app, client, monkeypatch):
    # Only owner/manager memberships exist, so narrow the permission to prove the endpoint checks it.
    monkeypatch.setitem(PERMISSION_ROLES, "inventory.manage", {"owner"})
    login_manager(client)
    _, ids = _items(app, 1)
    before = _state(app, ids[0])
    response = _post(client, {"itemIds": ids, "changes": {"parLevel": 4}, "expected": _expected(app, ids, ["parLevel"])})
    assert response.status_code == 403
    assert _state(app, ids[0]) == before


def test_module_dependencies_are_enforced_like_other_inventory_endpoints(app, client):
    """INVENTORY depends on PURCHASES (backend/modules.py); the bulk endpoint must not bypass that."""
    login(client)
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        org = make_operational_organization(owner, name=f"No Purchases {uuid4().hex[:6]}", location_name="Kitchen", enabled_modules=("INVENTORY",))
        org_id = org.id
        location_id = RestaurantLocation.query.filter_by(organization_id=org_id).one().id
        item = InventoryItem(organization_id=org_id, location_id=location_id, name="Rice", normalized_name="rice", par_level=Decimal("4"))
        db.session.add(item)
        db.session.commit()
        item_id = item.id
    select_org(client, org_id)
    payload = {"itemIds": [item_id], "changes": {"parLevel": 9}, "expected": {str(item_id): {"parLevel": 4}}}
    # The existing endpoint rejects this configuration; so must bulk edit, for both dry run and apply.
    assert client.patch(f"/api/pilot/inventory/items/{item_id}", json={"parLevel": 9}, headers=csrf_headers(client)).status_code == 403
    for dry in (True, False):
        response = _post(client, {**payload, "dryRun": dry})
        assert response.status_code == 403 and "PURCHASES" in response.get_json()["errors"]["dependencies"]
    with app.app_context():
        assert db.session.get(InventoryItem, item_id).par_level == Decimal("4")


def test_supplier_name_without_supplier_id_can_be_cleared_and_is_reported_as_a_change(app, client):
    """Receipts set preferred_supplier_name but not supplier_id (pilot_api receipt path); clearing must still work."""
    login(client)
    org_id, ids = _items(app, 2)
    with app.app_context():
        for item_id in ids:
            item = db.session.get(InventoryItem, item_id)
            item.supplier_id = None
            item.preferred_supplier_name = "Acme Foods"
        db.session.commit()
    clear = {"supplierId": None}
    review = _post(client, {"itemIds": ids, "changes": clear, "expected": _expected(app, ids, ["supplierId"]), "dryRun": True})
    assert review.status_code == 200
    body = review.get_json()
    assert body["summary"] == {"selected": 2, "changed": 2, "unchanged": 0}
    assert all(entry["beforeSupplierName"] == "Acme Foods" and entry["afterSupplierName"] == "" and entry["changedFields"] == ["supplierId"] for entry in body["items"])
    applied = _post(client, {"itemIds": ids, "changes": clear, "expected": _expected(app, ids, ["supplierId"])})
    assert applied.status_code == 200 and applied.get_json()["summary"]["changed"] == 2
    for item_id in ids:
        state = _state(app, item_id)
        assert state["supplier"] is None and state["name"] == ""
    replay = _post(client, {"itemIds": ids, "changes": clear, "expected": _expected(app, ids, ["supplierId"])})
    assert replay.get_json()["summary"] == {"selected": 2, "changed": 0, "unchanged": 2}
    # Assigning a supplier whose id already matches but whose stored name drifted is also a real change.
    with app.app_context():
        supplier = Supplier.query.filter_by(organization_id=org_id, is_active=True).first()
        supplier_id, supplier_name = supplier.id, supplier.name
        item = db.session.get(InventoryItem, ids[0])
        item.supplier_id, item.preferred_supplier_name = supplier_id, "Old Name"
        db.session.commit()
    assign = {"supplierId": supplier_id}
    response = _post(client, {"itemIds": [ids[0]], "changes": assign, "expected": _expected(app, [ids[0]], ["supplierId"])})
    assert response.status_code == 200 and response.get_json()["summary"]["changed"] == 1
    assert _state(app, ids[0])["name"] == supplier_name
