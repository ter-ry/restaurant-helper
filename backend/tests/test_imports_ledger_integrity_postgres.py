"""PostgreSQL forced-RLS check for the import ledger-integrity guard (#227).

Runs the real import endpoints as the non-owner runtime role (forced RLS, row locks) and proves
that stock history in one tenant neither leaks into nor blocks another tenant, and that rollback
is refused once the ledger depends on the imported baseline.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from backend.extensions import db
from backend.models import DataImportJob, InventoryItem, InventoryMovement, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.test_imports import csrf_headers, upload_import
from backend.tests.test_postgres_rls import (  # noqa: F401  (postgres_app is a fixture)
    POSTGRES_URL,
    _create_org,
    _login_owner,
    _seed_admin_fixture,
    postgres_app,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")

MAP = {"name": "Item", "locationName": "Location", "stockUnit": "Unit", "currentOnHand": "Qty", "parLevel": "Par"}
BASE = "http://127.0.0.1:5001"


def _post(client, path, payload=None):
    kwargs = {"json": payload} if payload is not None else {}
    headers = {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}
    return client.post(path, headers=headers, base_url=BASE, **kwargs)


def _run_import(client, org_id: int, location: str, item: str, qty: int, par: int, ref: str):
    csv = f"Item,Location,Unit,Qty,Par,Ref\n{item},{location},kg,{qty},{par},{ref}\n".encode()
    data = {"organizationId": str(org_id), "entityScope": "inventory_item", "file": (__import__("io").BytesIO(csv), f"{ref}.csv")}
    upload = client.post("/api/imports/jobs", headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}, data=data, content_type="multipart/form-data", base_url=BASE)
    assert upload.status_code == 201, upload.get_data(as_text=True)
    job_id = upload.get_json()["job"]["id"]
    assert _post(client, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": "inventory_item", "fieldMappings": MAP, "fixedValues": {}}).status_code == 200
    preview = _post(client, f"/api/imports/jobs/{job_id}/preview")
    assert preview.status_code == 200, preview.get_data(as_text=True)
    return job_id, preview.get_json()["job"]


def _execute(client, job_id: int):
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    return _post(client, f"/api/imports/jobs/{job_id}/execute")


def _seed_orgs() -> dict:
    def _seed():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        a = _create_org(owner, "Ledger PG Alpha")
        b = _create_org(owner, "Ledger PG Beta")
        return {"a": a.id, "b": b.id, "a_loc": f"{a.name} Main", "b_loc": f"{b.name} Main"}

    return _seed_admin_fixture("ledger pg orgs", _seed)


def _add_movement(org_id: int, item_id: int, before: str, delta: str) -> None:
    def _seed():
        item = db.session.get(InventoryItem, item_id)
        after = Decimal(before) + Decimal(delta)
        db.session.add(InventoryMovement(
            organization_id=org_id, location_id=item.location_id, inventory_item_id=item_id,
            quantity_delta=Decimal(delta), quantity_before=Decimal(before), quantity_after=after,
            unit="kg", source_type="manual", source_record_id="pg-ledger", source_line_id="1",
        ))
        item.current_on_hand = after

    _seed_admin_fixture("ledger pg movement", _seed)


def _item_state(app, org_id: int, name: str):
    from backend.tests.test_postgres_rls import _set_rls_context

    with app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        item = InventoryItem.query.filter_by(organization_id=org_id, normalized_name=name.lower()).one()
        total = sum((Decimal(m.quantity_delta) for m in InventoryMovement.query.filter_by(inventory_item_id=item.id)), Decimal("0"))
        return item.id, Decimal(item.current_on_hand), total


def test_postgres_import_ledger_guard_under_forced_rls(postgres_app):
    seeded = _seed_orgs()
    client = postgres_app.test_client()
    _login_owner(client)

    # Tenant B: opening import, then a ledger movement posts (+5).
    assert _post(client, "/api/organizations/select", {"organizationId": seeded["b"]}).status_code == 200
    b_create, _ = _run_import(client, seeded["b"], seeded["b_loc"], "Flour", 10, 20, "b1")
    assert _execute(client, b_create).status_code == 200
    b_item_id, on_hand, _ = _item_state(postgres_app, seeded["b"], "Flour")
    assert on_hand == Decimal("10")
    _add_movement(seeded["b"], b_item_id, "10", "5")

    # Re-import with a different quantity is blocked and writes nothing; execute is refused.
    job_id, preview = _run_import(client, seeded["b"], seeded["b_loc"], "Flour", 10, 30, "b2")
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert {i["code"] for r in preview["rows"] for i in r["issues"]} == {"ledger_history"}
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    _, on_hand, ledger_sum = _item_state(postgres_app, seeded["b"], "Flour")
    assert (on_hand, ledger_sum) == (Decimal("15"), Decimal("5"))  # opening 10 + sum(deltas) 5

    # Rollback of the creating import is refused with the item locked under RLS.
    rollback = _post(client, f"/api/imports/jobs/{b_create}/rollback")
    assert rollback.status_code == 409, rollback.get_data(as_text=True)
    assert "stock history" in rollback.get_json()["errors"]["blockers"]
    _, on_hand, _ = _item_state(postgres_app, seeded["b"], "Flour")
    assert on_hand == Decimal("15")

    # Tenant A: same item name, no history. B's ledger neither blocks nor leaks; clean rollback works.
    assert _post(client, "/api/organizations/select", {"organizationId": seeded["a"]}).status_code == 200
    a_create, _ = _run_import(client, seeded["a"], seeded["a_loc"], "Flour", 10, 20, "a1")
    assert _execute(client, a_create).status_code == 200
    a_fix, preview = _run_import(client, seeded["a"], seeded["a_loc"], "Flour", 12, 20, "a2")
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert _execute(client, a_fix).status_code == 200
    assert _item_state(postgres_app, seeded["a"], "Flour")[1] == Decimal("12")
    assert _post(client, f"/api/imports/jobs/{a_fix}/rollback").status_code == 200
    assert _item_state(postgres_app, seeded["a"], "Flour")[1] == Decimal("10")
    assert _post(client, f"/api/imports/jobs/{a_create}/rollback").status_code == 200

    # Tenant B is untouched by everything done in tenant A.
    assert _item_state(postgres_app, seeded["b"], "Flour")[1:] == (Decimal("15"), Decimal("5"))


def test_postgres_execute_is_all_or_nothing_when_history_appears_after_approval(postgres_app):
    seeded = _seed_orgs()
    client = postgres_app.test_client()
    _login_owner(client)
    assert _post(client, "/api/organizations/select", {"organizationId": seeded["a"]}).status_code == 200
    create_job, _ = _run_import(client, seeded["a"], seeded["a_loc"], "Flour", 10, 20, "x1")
    assert _execute(client, create_job).status_code == 200
    item_id, _, _ = _item_state(postgres_app, seeded["a"], "Flour")

    # Approved while still legal: two rows, a new item plus a quantity change on Flour.
    csv = f"Item,Location,Unit,Qty,Par,Ref\nSugar,{seeded['a_loc']},kg,5,10,x2\nFlour,{seeded['a_loc']},kg,4,20,x2\n".encode()
    upload = client.post("/api/imports/jobs", headers={"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}, data={"organizationId": str(seeded["a"]), "entityScope": "inventory_item", "file": (__import__("io").BytesIO(csv), "x2.csv")}, content_type="multipart/form-data", base_url=BASE)
    job_id = upload.get_json()["job"]["id"]
    assert _post(client, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": "inventory_item", "fieldMappings": MAP, "fixedValues": {}}).status_code == 200
    assert _post(client, f"/api/imports/jobs/{job_id}/preview").get_json()["job"]["status"] == "READY_FOR_PREVIEW"
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200

    _add_movement(seeded["a"], item_id, "10", "5")  # a receipt posts before execute

    assert _post(client, f"/api/imports/jobs/{job_id}/execute").status_code == 400
    _, on_hand, ledger_sum = _item_state(postgres_app, seeded["a"], "Flour")
    assert (on_hand, ledger_sum) == (Decimal("15"), Decimal("5"))
    from backend.tests.test_postgres_rls import _set_rls_context

    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=seeded["a"])
        assert InventoryItem.query.filter_by(organization_id=seeded["a"], normalized_name="sugar").count() == 0
        assert db.session.get(DataImportJob, job_id).status == "FAILED"


def _add_pos_consumption(org_id: int, item_id: int, kind: str) -> None:
    from backend.tests.test_imports_ledger_integrity import add_real_pos_consumption

    def _seed():
        add_real_pos_consumption(org_id, item_id, kind, tag=f"pg{org_id}")
        assert InventoryMovement.query.filter_by(inventory_item_id=item_id).count() == 0

    _seed_admin_fixture(f"ledger pg {kind} consumption", _seed)


def test_postgres_real_square_and_clover_consumption_rows_under_forced_rls(postgres_app):
    seeded = _seed_orgs()
    client = postgres_app.test_client()
    _login_owner(client)

    # Tenant B: Flour has a real Square consumption row, Rice a real Clover shadow consumption row.
    assert _post(client, "/api/organizations/select", {"organizationId": seeded["b"]}).status_code == 200
    created = {}
    for name in ("Flour", "Rice"):
        created[name], _ = _run_import(client, seeded["b"], seeded["b_loc"], name, 10, 20, f"b-{name}")
        assert _execute(client, created[name]).status_code == 200
    ids = {name: _item_state(postgres_app, seeded["b"], name)[0] for name in ("Flour", "Rice")}
    _add_pos_consumption(seeded["b"], ids["Flour"], "square")
    _add_pos_consumption(seeded["b"], ids["Rice"], "clover")

    for name in ("Flour", "Rice"):
        # Preview (read through the runtime role) sees the consumption row and blocks the quantity change.
        job_id, preview = _run_import(client, seeded["b"], seeded["b_loc"], name, 99, 30, f"b2-{name}")
        assert preview["status"] == "VALIDATION_REQUIRED", name
        assert {i["code"] for r in preview["rows"] for i in r["issues"]} == {"ledger_history"}
        assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
        # Rollback is refused under the row lock.
        rollback = _post(client, f"/api/imports/jobs/{created[name]}/rollback")
        assert rollback.status_code == 409, rollback.get_data(as_text=True)
        assert "POS sale" in rollback.get_json()["errors"]["blockers"]
        assert _item_state(postgres_app, seeded["b"], name)[1:] == (Decimal("10"), Decimal("0"))

    # Tenant A: same item names, no history. B's POS rows neither block nor leak; clean rollback works.
    assert _post(client, "/api/organizations/select", {"organizationId": seeded["a"]}).status_code == 200
    for name in ("Flour", "Rice"):
        create_job, _ = _run_import(client, seeded["a"], seeded["a_loc"], name, 10, 20, f"a-{name}")
        assert _execute(client, create_job).status_code == 200
        fix_job, preview = _run_import(client, seeded["a"], seeded["a_loc"], name, 12, 20, f"a2-{name}")
        assert preview["status"] == "READY_FOR_PREVIEW", name
        assert _execute(client, fix_job).status_code == 200
        assert _post(client, f"/api/imports/jobs/{fix_job}/rollback").status_code == 200
        assert _post(client, f"/api/imports/jobs/{create_job}/rollback").status_code == 200
