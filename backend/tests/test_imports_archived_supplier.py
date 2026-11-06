"""Archived suppliers cannot be newly assigned through CSV/XLSX import (#229).

Covers inventory-item create, inventory-item update and supplier-item-mapping import, in both
preview (blocking issue) and execute (re-check), plus restore, unchanged historical references,
archive-after-preview and tenant isolation.
"""
from __future__ import annotations

from backend.extensions import db
from backend.models import InventoryItem, Supplier, SupplierItemMapping
from backend.tests.test_imports import login
from backend.tests.test_imports_acceptance import (
    INVENTORY_MAP,
    MAPPING_MAP,
    SUPPLIER_MAP,
    execute,
    new_active_org,
    post,
    seed_supplier_and_item,
    upload_and_preview,
)

INV_HEADER = b"Item,Location,Supplier,Qty,Unit\n"
MAP_HEADER = b"Supplier,Item,Location,Supplier Item,Purchase Unit,Factor\n"


def set_active(app, organization_id: int, name: str, active: bool) -> int:
    with app.app_context():
        supplier = Supplier.query.filter_by(organization_id=organization_id, name=name).one()
        supplier.is_active = active
        db.session.commit()
        return supplier.id


def add_supplier(client, organization_id: int, name: str, tag: str) -> None:
    job_id, _ = upload_and_preview(client, organization_id, "supplier", f"s-{tag}.csv", f"Supplier Name,Contact Name\n{name},Ada\n".encode(), SUPPLIER_MAP)
    execute(client, job_id)


def codes(job: dict) -> set[str]:
    detail = job.get("rows") or []
    return {issue["code"] for row in detail for issue in row.get("issues", [])}


def blocked_by_archived(client, job_id: int, preview: dict) -> None:
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert preview["blockedRowCount"] == 1
    detail = client.get(f"/api/imports/jobs/{job_id}").get_json()["job"]
    assert "archived" in detail["rows"][0]["issueSummary"].lower()
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    assert post(client, f"/api/imports/jobs/{job_id}/execute").status_code == 400


def test_inventory_create_import_rejects_archived_supplier_and_allows_after_restore(app, client):
    login(client)
    org = new_active_org(app, "Archive Import Create Org")
    seed_supplier_and_item(client, org)
    set_active(app, org, "Acme Foods", False)

    csv = INV_HEADER + b"Sugar,Main Location,Acme Foods,4,kg\n"
    job_id, preview = upload_and_preview(client, org, "inventory_item", "c1.csv", csv, INVENTORY_MAP)
    blocked_by_archived(client, job_id, preview)
    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=org, normalized_name="sugar").count() == 0

    set_active(app, org, "Acme Foods", True)  # restore
    job_id, preview = upload_and_preview(client, org, "inventory_item", "c2.csv", csv + b"\n", INVENTORY_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    execute(client, job_id)
    with app.app_context():
        sugar = InventoryItem.query.filter_by(organization_id=org, normalized_name="sugar").one()
        assert sugar.supplier_id == Supplier.query.filter_by(organization_id=org, name="Acme Foods").one().id


def test_inventory_update_import_blocks_changed_supplier_but_keeps_unchanged_reference(app, client):
    login(client)
    org = new_active_org(app, "Archive Import Update Org")
    seed_supplier_and_item(client, org)  # Flour -> Acme Foods
    add_supplier(client, org, "Beta Provisions", "beta")
    set_active(app, org, "Beta Provisions", False)
    set_active(app, org, "Acme Foods", False)

    # Changing Flour to an archived supplier is rejected.
    csv = INV_HEADER + b"Flour,Main Location,Beta Provisions,10,kg\n"
    job_id, preview = upload_and_preview(client, org, "inventory_item", "u1.csv", csv, INVENTORY_MAP)
    blocked_by_archived(client, job_id, preview)
    with app.app_context():
        acme = Supplier.query.filter_by(organization_id=org, name="Acme Foods").one()
        assert InventoryItem.query.filter_by(organization_id=org, normalized_name="flour").one().supplier_id == acme.id

    # Re-importing Flour against the supplier it already references (archived since) still works.
    csv = INV_HEADER + b"Flour,Main Location,Acme Foods,12,kg\n"
    job_id, preview = upload_and_preview(client, org, "inventory_item", "u2.csv", csv, INVENTORY_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW", preview
    execute(client, job_id)
    with app.app_context():
        flour = InventoryItem.query.filter_by(organization_id=org, normalized_name="flour").one()
        assert flour.supplier_id == acme.id and float(flour.current_on_hand) == 12.0

    # Restoring Beta allows the move.
    set_active(app, org, "Beta Provisions", True)
    csv = INV_HEADER + b"Flour,Main Location,Beta Provisions,12,kg\n"
    job_id, preview = upload_and_preview(client, org, "inventory_item", "u3.csv", csv, INVENTORY_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    execute(client, job_id)
    with app.app_context():
        beta = Supplier.query.filter_by(organization_id=org, name="Beta Provisions").one()
        assert InventoryItem.query.filter_by(organization_id=org, normalized_name="flour").one().supplier_id == beta.id


def test_mapping_import_blocks_new_mapping_for_archived_supplier_but_keeps_existing(app, client):
    login(client)
    org = new_active_org(app, "Archive Import Mapping Org")
    seed_supplier_and_item(client, org)
    first = MAP_HEADER + b"Acme Foods,Flour,Main Location,Acme Flour 25kg,bag,25\n"
    job_id, _ = upload_and_preview(client, org, "supplier_item_mapping", "m1.csv", first, MAPPING_MAP)
    execute(client, job_id)
    set_active(app, org, "Acme Foods", False)

    # A new mapping row for the archived supplier is rejected.
    new_row = MAP_HEADER + b"Acme Foods,Flour,Main Location,Acme Flour 10kg,bag,10\n"
    job_id, preview = upload_and_preview(client, org, "supplier_item_mapping", "m2.csv", new_row, MAPPING_MAP)
    blocked_by_archived(client, job_id, preview)
    with app.app_context():
        assert SupplierItemMapping.query.filter_by(organization_id=org).count() == 1

    # Updating the mapping that already exists is an unchanged historical reference and is allowed.
    update_row = MAP_HEADER + b"Acme Foods,Flour,Main Location,Acme Flour 25kg,bag,20\n"
    job_id, preview = upload_and_preview(client, org, "supplier_item_mapping", "m3.csv", update_row, MAPPING_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW", preview
    execute(client, job_id)
    with app.app_context():
        assert float(SupplierItemMapping.query.filter_by(organization_id=org).one().conversion_factor) == 20.0

    set_active(app, org, "Acme Foods", True)  # restore allows new mappings again
    job_id, preview = upload_and_preview(client, org, "supplier_item_mapping", "m4.csv", new_row + b"\n", MAPPING_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    execute(client, job_id)
    with app.app_context():
        assert SupplierItemMapping.query.filter_by(organization_id=org).count() == 2


def test_supplier_archived_after_preview_fails_execute_with_nothing_written(app, client):
    login(client)
    org = new_active_org(app, "Archive After Preview Org")
    seed_supplier_and_item(client, org)

    inv = INV_HEADER + b"Sugar,Main Location,Acme Foods,4,kg\nSalt,Main Location,Acme Foods,2,kg\n"
    inv_job, preview = upload_and_preview(client, org, "inventory_item", "p1.csv", inv, INVENTORY_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert post(client, f"/api/imports/jobs/{inv_job}/approve").status_code == 200

    mapping = MAP_HEADER + b"Acme Foods,Flour,Main Location,Acme Flour 25kg,bag,25\n"
    map_job, preview = upload_and_preview(client, org, "supplier_item_mapping", "p2.csv", mapping, MAPPING_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert post(client, f"/api/imports/jobs/{map_job}/approve").status_code == 200

    set_active(app, org, "Acme Foods", False)  # archived between approval and execute

    assert post(client, f"/api/imports/jobs/{inv_job}/execute").status_code == 400
    assert post(client, f"/api/imports/jobs/{map_job}/execute").status_code == 400
    with app.app_context():
        names = {i.normalized_name for i in InventoryItem.query.filter_by(organization_id=org)}
        assert names == {"flour"}
        assert SupplierItemMapping.query.filter_by(organization_id=org).count() == 0


def test_archived_supplier_in_another_tenant_is_not_consulted(app, client):
    login(client)
    org_a = new_active_org(app, "Archive Tenant A")
    seed_supplier_and_item(client, org_a)
    set_active(app, org_a, "Acme Foods", False)
    org_b = new_active_org(app, "Archive Tenant B")

    # B has no supplier of that name: the row is blocked as missing, never as archived (no cross-tenant signal).
    csv = INV_HEADER + b"Sugar,Main Location,Acme Foods,4,kg\n"
    job_id, preview = upload_and_preview(client, org_b, "inventory_item", "x1.csv", csv, INVENTORY_MAP)
    assert preview["blockedRowCount"] == 1
    detail = client.get(f"/api/imports/jobs/{job_id}").get_json()["job"]
    assert "archived" not in detail["rows"][0]["issueSummary"].lower()

    # B's own active supplier with the same name is unaffected by A's archived one.
    add_supplier(client, org_b, "Acme Foods", "b")
    job_id, preview = upload_and_preview(client, org_b, "inventory_item", "x2.csv", csv + b"\n", INVENTORY_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    execute(client, job_id)
    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=org_b, normalized_name="sugar").count() == 1
        assert Supplier.query.filter_by(organization_id=org_a, name="Acme Foods").one().is_active is False
