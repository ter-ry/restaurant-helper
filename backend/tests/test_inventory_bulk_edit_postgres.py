"""PostgreSQL forced-RLS regression for POST /api/pilot/inventory/bulk-edit (#234).

Runs the real endpoint as the production runtime role (non-owner, forced RLS) against two tenants.  Proves
atomic apply, stale/replay behaviour, tenant isolation (items, suppliers, audit) and that on-hand, cost and the
movement ledger are untouched.  Fixtures are seeded through the superuser admin connection.
"""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import AuditEvent, InventoryItem, InventoryMovement, OrganizationModule, RestaurantLocation, Supplier, User
from backend.tests.test_postgres_rls import (  # noqa: F401  (postgres_app is a fixture)
    POSTGRES_URL,
    _create_org,
    _login_owner,
    _login_user,
    _seed_admin_fixture,
    postgres_app,
)

IN_GITHUB_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"
pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres") and not IN_GITHUB_ACTIONS,
    reason="PostgreSQL test database is not configured.",
)

BASE = "http://127.0.0.1:5001"
URL = "/api/pilot/inventory/bulk-edit"
B_PASSWORD = "BetaOwner123!"


def _post(client, payload, path=URL):
    token = client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]
    return client.post(path, json=payload, headers={"X-CSRFToken": token}, base_url=BASE)


def _seed() -> dict:
    def _seed_all():
        owner_a = User.query.filter_by(email="owner@flowtally.local").first() or User.query.order_by(User.id).first()
        owner_b = User(email=f"bulk-beta-owner-{uuid4().hex[:8]}@example.com", is_active=True)
        owner_b.set_password(B_PASSWORD)
        db.session.add(owner_b)
        db.session.flush()
        out = {"owner_b_email": owner_b.email}
        for key, owner in (("a", owner_a), ("b", owner_b)):
            org = _create_org(owner, f"Bulk PG {key.upper()} {uuid4().hex[:6]}")
            db.session.add(OrganizationModule(organization_id=org.id, module_key="INVENTORY", status="ENABLED"))
            location = RestaurantLocation.query.filter_by(organization_id=org.id).one()
            supplier = Supplier(organization_id=org.id, name=f"{key.upper()} Supplier", normalized_name=f"{key} supplier {uuid4().hex[:4]}")
            db.session.add(supplier)
            db.session.flush()
            ids = []
            for index in range(3):
                item = InventoryItem(
                    organization_id=org.id, location_id=location.id, name=f"{key.upper()} Item {index}", normalized_name=f"{key}-item-{index}-{uuid4().hex[:4]}",
                    stock_unit="kg", current_on_hand=Decimal("7.5"), average_unit_cost=Decimal("2.25"), min_quantity=Decimal("1"), par_level=Decimal("4"), active=True,
                )
                db.session.add(item)
                db.session.flush()
                ids.append(item.id)
            out[key] = {"org": org.id, "supplier": supplier.id, "items": ids}
        db.session.flush()
        return out

    return _seed_admin_fixture("bulk edit rls", _seed_all)


def _admin_state(ids):
    def _read():
        rows = InventoryItem.query.filter(InventoryItem.id.in_(ids)).order_by(InventoryItem.id).all()
        return [(r.id, str(r.current_on_hand), str(r.average_unit_cost), str(r.min_quantity), str(r.par_level), r.supplier_id, r.preferred_supplier_name, r.active) for r in rows], InventoryMovement.query.count()

    return _seed_admin_fixture("bulk edit read", _read)


def _admin_audit(org_id):
    return _seed_admin_fixture("bulk edit audit", lambda: sorted(e.event_type for e in AuditEvent.query.filter_by(organization_id=org_id).all() if e.event_type.startswith("inventory.")))


def _expected(ids, **seen):
    return {str(i): dict(seen) for i in ids}


def test_runtime_role_is_configured_in_github_actions():
    if IN_GITHUB_ACTIONS:
        assert POSTGRES_URL.startswith("postgres")
        assert "flowtally_runtime" in POSTGRES_URL, "the endpoint must be tested as the non-owner runtime role"


def test_bulk_edit_is_atomic_stale_safe_and_tenant_isolated_under_forced_rls(postgres_app):
    seeded = _seed()
    a, b = seeded["a"], seeded["b"]
    all_ids = a["items"] + b["items"]
    initial_a, movements = _admin_state(a["items"])
    initial_b, _ = _admin_state(b["items"])

    client_a = postgres_app.test_client()
    _login_owner(client_a)
    assert _post(client_a, {"organizationId": a["org"]}, "/api/organizations/select").status_code == 200

    # Apply PAR + supplier + inactive to A's three items.
    changes = {"parLevel": 9, "supplierId": a["supplier"], "active": False}
    expected = _expected(a["items"], parLevel=4, supplierId=None, active=True)
    response = _post(client_a, {"itemIds": a["items"], "changes": changes, "expected": expected})
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["summary"] == {"selected": 3, "changed": 3, "unchanged": 0}
    after_a, movements_after = _admin_state(a["items"])
    assert all(row[4] == "9.0000" and row[5] == a["supplier"] and row[6] == "A Supplier" and row[7] is False for row in after_a)
    # On-hand, average cost and the ledger are untouched.
    assert [(r[0], r[1], r[2]) for r in after_a] == [(r[0], r[1], r[2]) for r in initial_a]
    assert movements_after == movements
    assert _admin_audit(a["org"]) == ["inventory.bulk_edit_applied"] + ["inventory.item_bulk_updated"] * 3

    # Replay of the same request is an idempotent no-op with no new audit rows.
    replay = _post(client_a, {"itemIds": a["items"], "changes": changes, "expected": expected})
    assert replay.status_code == 200 and replay.get_json()["summary"]["changed"] == 0
    assert _admin_audit(a["org"]) == ["inventory.bulk_edit_applied"] + ["inventory.item_bulk_updated"] * 3

    # Stale: expected PAR no longer matches for every item -> 409, nothing written.
    state_before_stale, _ = _admin_state(a["items"])
    stale = _post(client_a, {"itemIds": a["items"], "changes": {"parLevel": 20}, "expected": _expected(a["items"], parLevel=4)})
    assert stale.status_code == 409
    assert sorted(stale.get_json()["errors"]) == sorted(f"item-{i}" for i in a["items"])
    assert _admin_state(a["items"])[0] == state_before_stale

    # Cross-tenant: B's item ids and supplier are unreachable from A's session, and B is untouched.
    cross_item = _post(client_a, {"itemIds": [a["items"][0], b["items"][0]], "changes": {"parLevel": 1}, "expected": _expected([a["items"][0], b["items"][0]], parLevel=9)})
    assert cross_item.status_code == 404 and list(cross_item.get_json()["errors"]) == [f"item-{b['items'][0]}"]
    cross_supplier = _post(client_a, {"itemIds": a["items"], "changes": {"supplierId": b["supplier"]}, "expected": _expected(a["items"], supplierId=a["supplier"])})
    assert cross_supplier.status_code == 400
    assert _post(client_a, {"organizationId": b["org"]}, "/api/organizations/select").status_code == 403
    assert _admin_state(b["items"])[0] == initial_b
    assert _admin_audit(b["org"]) == []

    # Tenant B edits its own items; A's committed values are unaffected.
    client_b = postgres_app.test_client()
    _login_user(client_b, seeded["owner_b_email"], B_PASSWORD)
    assert _post(client_b, {"organizationId": b["org"]}, "/api/organizations/select").status_code == 200
    ok = _post(client_b, {"itemIds": b["items"], "changes": {"minQuantity": 2}, "expected": _expected(b["items"], minQuantity=1)})
    assert ok.status_code == 200
    assert _post(client_b, {"itemIds": a["items"], "changes": {"minQuantity": 2}, "expected": _expected(a["items"], minQuantity=1)}).status_code == 404
    assert all(row[3] == "2.0000" for row in _admin_state(b["items"])[0])
    assert _admin_state(a["items"])[0] == state_before_stale
    assert _post(postgres_app.test_client(), {"itemIds": all_ids, "changes": {"parLevel": 1}}).status_code in {400, 401}


def test_bulk_edit_waits_for_a_concurrent_writer_then_reports_it_as_stale(postgres_app):
    """A concurrent writer holds the item row lock and changes PAR; the bulk edit blocks, then sees the new value."""
    import threading
    import time

    from sqlalchemy import create_engine, text

    from backend.tests.test_postgres_rls import ADMIN_POSTGRES_URL

    seeded = _seed()
    a = seeded["a"]
    target = a["items"][0]
    client = postgres_app.test_client()
    _login_owner(client)
    assert _post(client, {"organizationId": a["org"]}, "/api/organizations/select").status_code == 200

    engine = create_engine(ADMIN_POSTGRES_URL)
    result: dict = {}
    with engine.connect() as writer, engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
        writer.execute(text("select id from inventory_items where id = :id for update"), {"id": target})

        def _bulk():
            result["response"] = _post(client, {"itemIds": [target], "changes": {"parLevel": 12}, "expected": _expected([target], parLevel=4)})

        thread = threading.Thread(target=_bulk)
        thread.start()
        deadline = time.time() + 15
        blocked = False
        # pg_stat_activity is snapshotted per transaction, so poll from a separate autocommit connection.
        while time.time() < deadline and not blocked:  # no fixed sleep
            blocked = observer.execute(text("select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%inventory_items%'")).scalar() > 0
            time.sleep(0.05)
        assert blocked, "bulk edit did not wait on the item row lock"
        writer.execute(text("update inventory_items set par_level = 6 where id = :id"), {"id": target})
        writer.commit()
        thread.join(15)
    engine.dispose()
    response = result["response"]
    assert response.status_code == 409, response.get_data(as_text=True)
    assert list(response.get_json()["errors"]) == [f"item-{target}"]
    state, _ = _admin_state([target])
    assert state[0][4] == "6.0000"  # the concurrent writer's value survived; nothing was overwritten
