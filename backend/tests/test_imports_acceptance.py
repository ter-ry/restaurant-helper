"""Acceptance tests for the existing supplier / inventory-item / supplier-item-mapping import paths (#224).

Scope is verification of behavior that already exists. Cases that need an owner decision
(see #198) are documented in docs/import-capability-matrix.md, not pinned here.
"""

from __future__ import annotations

import io

from openpyxl import Workbook

from backend.extensions import db
from backend.models import (
    InventoryItem,
    Organization,
    OrganizationMembership,
    RestaurantLocation,
    Supplier,
    SupplierItemMapping,
    User,
)
from backend.tests.test_imports import create_org, csrf_headers, login, upload_import


def activate(app, organization_id: int) -> None:
    with app.app_context():
        organization = db.session.get(Organization, organization_id)
        organization.lifecycle_status = "ACTIVE"
        organization.setup_status = "COMPLETE"
        organization.subscription_status = "ACTIVE"
        db.session.commit()


def new_active_org(app, name: str) -> int:
    with app.app_context():
        owner = db.session.query(OrganizationMembership).first().user
        organization_id = create_org(owner, name).id
    activate(app, organization_id)
    return organization_id


def post(client, path: str, payload: dict | None = None):
    kwargs = {"json": payload} if payload is not None else {}
    return client.post(path, headers=csrf_headers(client), **kwargs)


def upload_and_preview(client, organization_id: int, scope: str, filename: str, content: bytes, mapping: dict, fixed: dict | None = None):
    upload = upload_import(client, organization_id, scope, filename, content)
    assert upload.status_code == 201, upload.get_data(as_text=True)
    job_id = upload.get_json()["job"]["id"]
    saved = post(client, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": scope, "fieldMappings": mapping, "fixedValues": fixed or {}})
    assert saved.status_code == 200, saved.get_data(as_text=True)
    preview = post(client, f"/api/imports/jobs/{job_id}/preview")
    assert preview.status_code == 200, preview.get_data(as_text=True)
    return job_id, preview.get_json()["job"]


def execute(client, job_id: int):
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    response = post(client, f"/api/imports/jobs/{job_id}/execute")
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()["job"]


SUPPLIER_MAP = {"name": "Supplier Name", "contactName": "Contact Name"}
INVENTORY_MAP = {"name": "Item", "locationName": "Location", "supplierName": "Supplier", "currentOnHand": "Qty", "stockUnit": "Unit"}
MAPPING_MAP = {
    "supplierName": "Supplier",
    "inventoryItemName": "Item",
    "locationName": "Location",
    "supplierItemName": "Supplier Item",
    "purchaseUnit": "Purchase Unit",
    "conversionFactor": "Factor",
}


def seed_supplier_and_item(client, organization_id: int) -> None:
    job_id, _ = upload_and_preview(client, organization_id, "supplier", "s.csv", b"Supplier Name,Contact Name\nAcme Foods,Ada\n", SUPPLIER_MAP)
    execute(client, job_id)
    csv = b"Item,Location,Supplier,Qty,Unit\nFlour,Main Location,Acme Foods,10,kg\n"
    job_id, _ = upload_and_preview(client, organization_id, "inventory_item", "i.csv", csv, INVENTORY_MAP)
    execute(client, job_id)


def test_supplier_item_mapping_import_creates_updates_and_rolls_back(app, client):
    login(client)
    organization_id = new_active_org(app, "Mapping Import Org")
    seed_supplier_and_item(client, organization_id)

    csv = b"Supplier,Item,Location,Supplier Item,Purchase Unit,Factor\nAcme Foods,Flour,Main Location,Acme Flour 25kg,bag,25\n"
    job_id, preview = upload_and_preview(client, organization_id, "supplier_item_mapping", "m.csv", csv, MAPPING_MAP)
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (1, 0)
    with app.app_context():
        assert SupplierItemMapping.query.filter_by(organization_id=organization_id).count() == 0

    job = execute(client, job_id)
    assert (job["status"], job["appliedRowCount"]) == ("COMPLETED", 1)
    with app.app_context():
        mapping = SupplierItemMapping.query.filter_by(organization_id=organization_id).one()
        assert mapping.supplier_item_name == "Acme Flour 25kg"
        assert mapping.purchase_unit == "bag"
        assert float(mapping.conversion_factor) == 25.0

    # Re-importing the same mapping (different file bytes) updates instead of duplicating.
    csv = b"Supplier,Item,Location,Supplier Item,Purchase Unit,Factor\nacme foods,flour,main location, ACME FLOUR 25KG ,bag,20\n"
    job_id, _ = upload_and_preview(client, organization_id, "supplier_item_mapping", "m2.csv", csv, MAPPING_MAP)
    execute(client, job_id)
    with app.app_context():
        mapping = SupplierItemMapping.query.filter_by(organization_id=organization_id).one()
        assert float(mapping.conversion_factor) == 20.0

    rollback = post(client, f"/api/imports/jobs/{job_id}/rollback")
    assert rollback.status_code == 200, rollback.get_data(as_text=True)
    with app.app_context():
        assert float(SupplierItemMapping.query.filter_by(organization_id=organization_id).one().conversion_factor) == 25.0


def test_mapping_import_blocks_bad_references_and_factor(app, client):
    login(client)
    organization_id = new_active_org(app, "Mapping Blocking Org")
    seed_supplier_and_item(client, organization_id)

    csv = (
        b"Supplier,Item,Location,Supplier Item,Purchase Unit,Factor\n"
        b"Nobody Ltd,Flour,Main Location,X,bag,1\n"
        b"Acme Foods,Ghost Item,Main Location,X,bag,1\n"
        b"Acme Foods,Flour,Nowhere,X,bag,1\n"
        b"Acme Foods,Flour,Main Location,,bag,1\n"
        b"Acme Foods,Flour,Main Location,Y,bag,0\n"
        b"Acme Foods,Flour,Main Location,Z,bag,abc\n"
    )
    job_id, preview = upload_and_preview(client, organization_id, "supplier_item_mapping", "bad.csv", csv, MAPPING_MAP)
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (0, 6)
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    with app.app_context():
        assert SupplierItemMapping.query.filter_by(organization_id=organization_id).count() == 0


def test_preview_status_reflects_blocked_rows(app, client):
    login(client)
    organization_id = new_active_org(app, "Preview Status Org")
    csv = b"Supplier Name,Contact Name\nGood Supplier,Ada\n,Nameless\n"
    job_id, preview = upload_and_preview(client, organization_id, "supplier", "mixed.csv", csv, SUPPLIER_MAP)
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (1, 1)
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    assert post(client, f"/api/imports/jobs/{job_id}/execute").status_code == 400
    with app.app_context():
        assert Supplier.query.filter_by(organization_id=organization_id).count() == 0


def test_corrupt_or_unreadable_uploads_are_client_errors(app, client):
    login(client)
    organization_id = new_active_org(app, "Malformed Upload Org")
    cases = [
        ("corrupt.xlsx", b"this is not a zip archive"),
        ("truncated.xlsx", _xlsx_bytes([["Supplier Name"], ["A"]])[:40]),
        ("empty.csv", b""),
        ("header-only.csv", b"Supplier Name,Contact Name\n"),
        ("latin1.csv", b"Supplier Name\nCaf\xe9\n"),
        ("notes.txt", b"Supplier Name\nA\n"),
    ]
    for filename, content in cases:
        response = upload_import(client, organization_id, "supplier", filename, content)
        assert response.status_code == 400, (filename, response.status_code)
        assert response.get_json()["error"]
    with app.app_context():
        assert Supplier.query.filter_by(organization_id=organization_id).count() == 0


def _xlsx_bytes(rows: list[list]) -> bytes:
    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def test_inventory_import_reports_per_row_blockers_and_accurate_counts(app, client):
    login(client)
    organization_id = new_active_org(app, "Inventory Counts Org")
    seed_supplier_and_item(client, organization_id)
    csv = (
        b"Item,Location,Supplier,Qty,Unit\n"
        b"Flour,main location,Acme Foods,25,kg\n"        # update, case-insensitive match
        b"Sugar,Main Location,Acme Foods,8,kg\n"          # create
        b"Salt,Other Place,Acme Foods,1,kg\n"             # unknown location
        b"Pepper,Main Location,Unknown Co,1,kg\n"         # unknown supplier
        b"Rice,Main Location,Acme Foods,-3,kg\n"          # negative
        b"Oats,Main Location,Acme Foods,abc,kg\n"         # not a number
    )
    job_id, preview = upload_and_preview(client, organization_id, "inventory_item", "inv.csv", csv, INVENTORY_MAP)
    assert (preview["rowCount"], preview["previewRowCount"], preview["blockedRowCount"]) == (6, 2, 4)
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=organization_id).count() == 1
        assert float(InventoryItem.query.filter_by(organization_id=organization_id).one().current_on_hand) == 10.0

    detail = client.get(f"/api/imports/jobs/{job_id}").get_json()["job"]
    summaries = {row["rowNumber"]: row["status"] for row in detail["rows"]}
    assert summaries == {1: "ready", 2: "ready", 3: "blocked", 4: "blocked", 5: "blocked", 6: "blocked"}

    # Valid subset applies exactly the counted rows and nothing else.
    valid = b"Item,Location,Supplier,Qty,Unit\nFlour,main location,Acme Foods,25,kg\nSugar,Main Location,Acme Foods,8,kg\n"
    job_id, preview = upload_and_preview(client, organization_id, "inventory_item", "inv-valid.csv", valid, INVENTORY_MAP)
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (2, 0)
    job = execute(client, job_id)
    assert (job["status"], job["appliedRowCount"]) == ("COMPLETED", 2)
    with app.app_context():
        quantities = {i.name: float(i.current_on_hand) for i in InventoryItem.query.filter_by(organization_id=organization_id)}
        assert quantities == {"Flour": 25.0, "Sugar": 8.0}


def test_xlsx_supplier_import_ignores_blank_rows_without_creating_records(app, client):
    login(client)
    organization_id = new_active_org(app, "Xlsx Blank Rows Org")
    content = _xlsx_bytes([["Supplier Name", "Contact Name"], ["Bakery Co", "Cara"], [None, None]])
    job_id, preview = upload_and_preview(client, organization_id, "supplier", "s.xlsx", content, SUPPLIER_MAP)
    assert preview["blockedRowCount"] == 1  # the empty row is reported, not silently applied
    assert post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    with app.app_context():
        assert Supplier.query.filter_by(organization_id=organization_id).count() == 0


def _second_org_with_owner(app) -> tuple[int, str]:
    with app.app_context():
        user = User(email="other-owner@example.com", is_active=True)
        user.set_password("OtherOwner!234")
        db.session.add(user)
        db.session.flush()
        organization = create_org(user, "Other Tenant")
        organization_id = organization.id
        db.session.commit()
    activate(app, organization_id)
    return organization_id, "OtherOwner!234"


def test_imports_never_resolve_other_tenant_records(app, client):
    login(client)
    org_a = new_active_org(app, "Tenant A")
    seed_supplier_and_item(client, org_a)  # "Acme Foods" and "Flour" exist only in A
    org_b = new_active_org(app, "Tenant B")  # same owner, also has a "Main Location"

    csv = b"Item,Location,Supplier,Qty,Unit\nFlour,Main Location,Acme Foods,5,kg\n"
    job_id, preview = upload_and_preview(client, org_b, "inventory_item", "b-inv.csv", csv, INVENTORY_MAP)
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (0, 1)
    detail = client.get(f"/api/imports/jobs/{job_id}").get_json()["job"]
    assert "supplier" in detail["rows"][0]["issueSummary"]

    csv = b"Supplier,Item,Location,Supplier Item,Purchase Unit,Factor\nAcme Foods,Flour,Main Location,Acme Flour,bag,25\n"
    _, preview = upload_and_preview(client, org_b, "supplier_item_mapping", "b-map.csv", csv, MAPPING_MAP)
    assert (preview["previewRowCount"], preview["blockedRowCount"]) == (0, 1)

    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=org_b).count() == 0
        assert SupplierItemMapping.query.filter_by(organization_id=org_b).count() == 0
        assert float(InventoryItem.query.filter_by(organization_id=org_a).one().current_on_hand) == 10.0


def test_other_tenant_owner_cannot_read_or_run_a_job(app, client):
    login(client)
    org_a = new_active_org(app, "Job Owner Tenant")
    job_id, _ = upload_and_preview(client, org_a, "supplier", "s.csv", b"Supplier Name,Contact Name\nAcme Foods,Ada\n", SUPPLIER_MAP)
    _, password = _second_org_with_owner(app)

    assert post(client, "/api/auth/logout").status_code == 200
    login(client, "other-owner@example.com", password)
    headers = csrf_headers(client)
    assert client.get(f"/api/imports/jobs/{job_id}").status_code == 403
    for action in ("preview", "approve", "execute", "rollback"):
        assert client.post(f"/api/imports/jobs/{job_id}/{action}", headers=headers).status_code == 403, action
    assert client.get(f"/api/imports/organizations/{org_a}/jobs").status_code == 403
    with app.app_context():
        assert Supplier.query.filter_by(organization_id=org_a).count() == 0
