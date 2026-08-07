from __future__ import annotations

import io

from openpyxl import Workbook

from backend.extensions import db
from backend.models import InventoryItem, Organization, OrganizationMembership, RestaurantLocation, Supplier
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD


def login(client, email: str = LOCAL_OWNER_EMAIL, password: str = LOCAL_OWNER_PASSWORD):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def create_org(owner, name: str) -> Organization:
    organization = Organization(
        name=name,
        lifecycle_status="ONBOARDING",
        setup_status="INTAKE",
        subscription_status="NONE",
        setup_template_key="GENERIC_RESTAURANT",
        setup_fee_status="NONE",
        is_prospect=True,
    )
    db.session.add(organization)
    db.session.flush()
    db.session.add(OrganizationMembership(user=owner, organization=organization, role="owner"))
    db.session.add(
        RestaurantLocation(
            organization=organization,
            name="Main Location",
            address_line1="123 Test St",
            city="Toronto",
            region="ON",
            postal_code="M5V 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
    )
    db.session.commit()
    return organization


def build_supplier_csv() -> bytes:
    return (
        "Supplier Name,Category Focus,Contact Name,Contact Phone,Contact Email,Ordering Notes,Notes\n"
        "Northern Foods,Produce,Ada,555-0101,ada@example.com,Call before noon,Local supplier\n"
        "City Dairy,Dairy,Ben,555-0202,ben@example.com,Leave at side door,Weekly delivery\n"
    ).encode("utf-8")


def build_inventory_csv() -> bytes:
    return (
        "Item Name,Location Name,Supplier Name,Category,Stock Unit,Current On Hand,Minimum Quantity,PAR Level,Latest Purchase Price\n"
        "Romaine,Main Location,Northern Foods,Produce,each,12,4,16,2.50\n"
    ).encode("utf-8")


def build_supplier_xlsx() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Suppliers"
    sheet.append(["Supplier Name", "Category Focus", "Contact Name", "Contact Phone", "Contact Email", "Ordering Notes", "Notes"])
    sheet.append(["Bakery Co", "Bakery", "Cara", "555-0303", "cara@example.com", "Morning delivery", "XLSX import"])
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def upload_import(client, organization_id: int, entity_scope: str, filename: str, content: bytes):
    data = {
        "organizationId": str(organization_id),
        "entityScope": entity_scope,
        "file": (io.BytesIO(content), filename),
    }
    return client.post("/api/imports/jobs", headers=csrf_headers(client), data=data, content_type="multipart/form-data")


def test_supplier_import_csv_preview_execute_and_rollback(app, client):
    login(client)
    with app.app_context():
        owner = db.session.query(OrganizationMembership).first().user
        organization = create_org(owner, "Importable Prospect")
        organization_id = organization.id
        before_count = Supplier.query.filter_by(organization_id=organization.id).count()

    upload_response = upload_import(client, organization_id, "supplier", "suppliers.csv", build_supplier_csv())
    assert upload_response.status_code == 201, upload_response.get_data(as_text=True)
    job = upload_response.get_json()["job"]
    assert job["status"] == "MAPPING_REQUIRED"
    assert job["rowCount"] == 2

    mapping_response = client.post(
        f"/api/imports/jobs/{job['id']}/mapping",
        headers=csrf_headers(client),
        json={
            "entityScope": "supplier",
            "fieldMappings": {
                "name": "Supplier Name",
                "categoryFocus": "Category Focus",
                "contactName": "Contact Name",
                "contactPhone": "Contact Phone",
                "contactEmail": "Contact Email",
                "orderingNotes": "Ordering Notes",
                "notes": "Notes",
            },
            "fixedValues": {},
        },
    )
    assert mapping_response.status_code == 200

    preview_response = client.post(f"/api/imports/jobs/{job['id']}/preview", headers=csrf_headers(client))
    assert preview_response.status_code == 200
    preview_job = preview_response.get_json()["job"]
    assert preview_job["status"] == "READY_FOR_PREVIEW"
    assert preview_job["blockedRowCount"] == 0

    with app.app_context():
        assert Supplier.query.filter_by(organization_id=organization.id).count() == before_count

    approve_response = client.post(f"/api/imports/jobs/{job['id']}/approve", headers=csrf_headers(client))
    assert approve_response.status_code == 200

    execute_response = client.post(f"/api/imports/jobs/{job['id']}/execute", headers=csrf_headers(client))
    assert execute_response.status_code == 200, execute_response.get_data(as_text=True)
    execute_job = execute_response.get_json()["job"]
    assert execute_job["status"] == "COMPLETED"

    with app.app_context():
        supplier_names = {supplier.name for supplier in Supplier.query.filter_by(organization_id=organization.id).all()}
        assert {"Northern Foods", "City Dairy"}.issubset(supplier_names)

    rollback_response = client.post(f"/api/imports/jobs/{job['id']}/rollback", headers=csrf_headers(client))
    assert rollback_response.status_code == 200
    rollback_job = rollback_response.get_json()["job"]
    assert rollback_job["status"] == "ROLLED_BACK"

    with app.app_context():
        assert Supplier.query.filter_by(organization_id=organization.id).count() == before_count


def test_xlsx_duplicate_file_is_rejected(app, client):
    login(client)
    with app.app_context():
        owner = db.session.query(OrganizationMembership).first().user
        organization = create_org(owner, "XLSX Import Prospect")
        organization_id = organization.id

    content = build_supplier_xlsx()
    first = upload_import(client, organization_id, "supplier", "suppliers.xlsx", content)
    assert first.status_code == 201
    second = upload_import(client, organization_id, "supplier", "suppliers.xlsx", content)
    assert second.status_code == 409


def test_preview_does_not_modify_live_tables(app, client):
    login(client)
    with app.app_context():
        owner = db.session.query(OrganizationMembership).first().user
        organization = create_org(owner, "Preview Prospect")
        organization_id = organization.id
        baseline = InventoryItem.query.filter_by(organization_id=organization.id).count()
        supplier = Supplier(
            organization_id=organization.id,
            name="Northern Foods",
            normalized_name="northern foods",
        )
        db.session.add(supplier)
        db.session.commit()

    upload_response = upload_import(client, organization_id, "inventory_item", "inventory.csv", build_inventory_csv())
    assert upload_response.status_code == 201
    job = upload_response.get_json()["job"]
    client.post(
        f"/api/imports/jobs/{job['id']}/mapping",
        headers=csrf_headers(client),
        json={
            "entityScope": "inventory_item",
            "fieldMappings": {
                "name": "Item Name",
                "locationName": "Location Name",
                "supplierName": "Supplier Name",
                "category": "Category",
                "stockUnit": "Stock Unit",
                "currentOnHand": "Current On Hand",
                "minQuantity": "Minimum Quantity",
                "parLevel": "PAR Level",
                "latestPurchasePrice": "Latest Purchase Price",
            },
            "fixedValues": {},
        },
    )
    preview = client.post(f"/api/imports/jobs/{job['id']}/preview", headers=csrf_headers(client))
    assert preview.status_code == 200
    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=organization_id).count() == baseline


def test_cross_tenant_and_unsafe_rollback_denied(app, client):
    login(client)
    with app.app_context():
        owner = db.session.query(OrganizationMembership).first().user
        allowed_org = create_org(owner, "Rollback Prospect")
        allowed_org_id = allowed_org.id
        forbidden_org = Organization(
            name="Other Org",
            lifecycle_status="ONBOARDING",
            setup_status="INTAKE",
            subscription_status="NONE",
            setup_template_key="GENERIC_RESTAURANT",
            setup_fee_status="NONE",
            is_prospect=True,
        )
        db.session.add(forbidden_org)
        db.session.commit()
        forbidden_org_id = forbidden_org.id

    forbidden_upload = upload_import(client, forbidden_org_id, "supplier", "forbidden.csv", build_supplier_csv())
    assert forbidden_upload.status_code == 403

    supplier_upload = upload_import(client, allowed_org_id, "supplier", "allowed-suppliers.csv", build_supplier_csv())
    assert supplier_upload.status_code == 201
    supplier_job = supplier_upload.get_json()["job"]
    client.post(
        f"/api/imports/jobs/{supplier_job['id']}/mapping",
        headers=csrf_headers(client),
        json={
            "entityScope": "supplier",
            "fieldMappings": {
                "name": "Supplier Name",
                "categoryFocus": "Category Focus",
                "contactName": "Contact Name",
                "contactPhone": "Contact Phone",
                "contactEmail": "Contact Email",
                "orderingNotes": "Ordering Notes",
                "notes": "Notes",
            },
            "fixedValues": {},
        },
    )
    client.post(f"/api/imports/jobs/{supplier_job['id']}/preview", headers=csrf_headers(client))
    client.post(f"/api/imports/jobs/{supplier_job['id']}/approve", headers=csrf_headers(client))
    execute = client.post(f"/api/imports/jobs/{supplier_job['id']}/execute", headers=csrf_headers(client))
    assert execute.status_code == 200

    inventory_upload = upload_import(client, allowed_org_id, "inventory_item", "inventory.csv", build_inventory_csv())
    assert inventory_upload.status_code == 201
    inventory_job = inventory_upload.get_json()["job"]
    client.post(
        f"/api/imports/jobs/{inventory_job['id']}/mapping",
        headers=csrf_headers(client),
        json={
            "entityScope": "inventory_item",
            "fieldMappings": {
                "name": "Item Name",
                "locationName": "Location Name",
                "supplierName": "Supplier Name",
                "category": "Category",
                "stockUnit": "Stock Unit",
                "currentOnHand": "Current On Hand",
                "minQuantity": "Minimum Quantity",
                "parLevel": "PAR Level",
                "latestPurchasePrice": "Latest Purchase Price",
            },
            "fixedValues": {},
        },
    )
    client.post(f"/api/imports/jobs/{inventory_job['id']}/preview", headers=csrf_headers(client))
    client.post(f"/api/imports/jobs/{inventory_job['id']}/approve", headers=csrf_headers(client))
    inventory_execute = client.post(f"/api/imports/jobs/{inventory_job['id']}/execute", headers=csrf_headers(client))
    assert inventory_execute.status_code == 200

    rollback_response = client.post(f"/api/imports/jobs/{supplier_job['id']}/rollback", headers=csrf_headers(client))
    assert rollback_response.status_code == 409
