"""Import re-upload / rollback must never move on-hand or weighted-average cost outside the ledger (#227).

Owner-approved safe default (issue #227, 2026-11-05):
- A new item's imported quantity is its opening baseline (opening + sum(deltas) == on-hand).
- Once an item has stock history (movements, invoice lines, count lines, POS consumption, waste),
  re-importing a different quantity is a blocked row and the import writes nothing.
  Other fields still update, and the weighted-average cost is never recomputed by import.
- Rolling back an inventory import is refused once the item has stock history.

Every scenario drives the real import, receiving, adjustment and count endpoints. Expected values
are computed by hand in this file.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from backend.extensions import db
from backend.models import (
    DataImportJob,
    InventoryItem,
    InventoryMovement,
    OrganizationMembership,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_imports import csrf_headers, login, upload_import
from backend.tests.test_inventory_reconciliation import assert_ledger_reconciles

LOCATION = "Ledger Main"
SUPPLIER = "Ledger Foods"
INVENTORY_MAP = {
    "name": "Item",
    "locationName": "Location",
    "supplierName": "Supplier",
    "stockUnit": "Unit",
    "currentOnHand": "Qty",
    "parLevel": "Par",
    "latestPurchasePrice": "Price",
}
OPENING_MAP = {"itemName": "Item", "locationName": "Location", "currentOnHand": "Qty", "stockUnit": "Unit"}


def _post(client, path: str, payload: dict | None = None):
    kwargs = {"json": payload} if payload is not None else {}
    return client.post(path, headers=csrf_headers(client), **kwargs)


def _new_org(app, client, name: str) -> int:
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).one()
        organization = make_operational_organization(owner, name=name, location_name=LOCATION)
        organization_id = organization.id
    assert _post(client, "/api/organizations/select", {"organizationId": organization_id}).status_code == 200
    assert _post(client, "/api/pilot/suppliers", {"name": SUPPLIER, "isActive": True}).status_code == 201
    return organization_id


_upload_counter = {"n": 0}


def _csv(rows: list[tuple]) -> bytes:
    # A unique trailing comment column keeps each upload's hash distinct (duplicate files are rejected).
    _upload_counter["n"] += 1
    lines = ["Item,Location,Supplier,Unit,Qty,Par,Price,Ref"]
    for item, qty, par, price in rows:
        lines.append(f"{item},{LOCATION},{SUPPLIER},kg,{qty},{par},{price},u{_upload_counter['n']}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def _preview(client, organization_id: int, content: bytes, *, scope: str = "inventory_item", mapping: dict | None = None):
    upload = upload_import(client, organization_id, scope, f"inv-{_upload_counter['n']}.csv", content)
    assert upload.status_code == 201, upload.get_data(as_text=True)
    job_id = upload.get_json()["job"]["id"]
    saved = _post(client, f"/api/imports/jobs/{job_id}/mapping", {"entityScope": scope, "fieldMappings": mapping or INVENTORY_MAP, "fixedValues": {}})
    assert saved.status_code == 200, saved.get_data(as_text=True)
    preview = _post(client, f"/api/imports/jobs/{job_id}/preview")
    assert preview.status_code == 200, preview.get_data(as_text=True)
    return job_id, preview.get_json()["job"]


def _import(client, organization_id: int, content: bytes, **kwargs) -> int:
    job_id, preview = _preview(client, organization_id, content, **kwargs)
    assert preview["status"] == "READY_FOR_PREVIEW", preview
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    executed = _post(client, f"/api/imports/jobs/{job_id}/execute")
    assert executed.status_code == 200, executed.get_data(as_text=True)
    return job_id


def _item(organization_id: int, name: str) -> InventoryItem:
    return InventoryItem.query.filter_by(organization_id=organization_id, normalized_name=name.lower()).one()


def _snapshot(organization_id: int, name: str) -> tuple:
    item = _item(organization_id, name)
    movements = InventoryMovement.query.filter_by(inventory_item_id=item.id).count()
    return (Decimal(item.current_on_hand), Decimal(item.average_unit_cost), movements)


def _receive(client, item_id: int, *, quantity_kg: int, unit_price: float) -> None:
    total = round(quantity_kg * unit_price, 2)
    invoice = _post(
        client,
        "/api/pilot/purchases/invoices",
        {
            "supplierName": SUPPLIER,
            "invoiceNumber": f"LEDGER-{item_id}-{quantity_kg}-{unit_price}",
            "invoiceDate": "2026-11-05",
            "subtotal": total,
            "tax": 0,
            "totalAmount": total,
            "notes": "",
            "status": "Ready",
            "sourceFileName": "ledger.pdf",
            "sourceFileType": "application/pdf",
            "extractionStatus": "manual",
            "extractedText": "ledger",
            "lineItems": [
                {
                    "description": "Ledger flour",
                    "inventoryItemId": item_id,
                    "purchaseUnit": "kg",
                    "inventoryUnit": "kg",
                    "conversionFactor": 1,
                    "quantity": quantity_kg,
                    "unitPrice": unit_price,
                    "lineTotal": total,
                    "confidence": 0.99,
                    "needsReview": False,
                    "note": "",
                }
            ],
        },
    )
    assert invoice.status_code == 201, invoice.get_data(as_text=True)
    received = _post(client, f"/api/pilot/purchases/invoices/{invoice.get_json()['id']}/receive")
    assert received.status_code == 200, received.get_data(as_text=True)


def _finalize_count(client, item_id: int, counted: int) -> None:
    session = _post(client, "/api/pilot/inventory/count-sessions", {"countedBy": "Ledger", "notes": "", "itemIds": [item_id]}).get_json()
    line = session["lines"][0]
    patched = client.patch(
        f"/api/pilot/inventory/count-sessions/{session['id']}",
        headers=csrf_headers(client),
        json={"countedBy": "Ledger", "notes": "", "lines": [{"id": line["id"], "countedQuantity": counted, "note": ""}]},
    )
    assert patched.status_code == 200, patched.get_data(as_text=True)
    assert _post(client, f"/api/pilot/inventory/count-sessions/{session['id']}/finalize").status_code == 200


def _row_issue_codes(job: dict) -> set[str]:
    return {issue["code"] for row in job["rows"] for issue in row["issues"]}


def test_opening_import_and_reimport_before_any_history_stay_allowed(app, client):
    login(client)
    organization_id = _new_org(app, client, "Ledger Opening Org")

    _import(client, organization_id, _csv([("Flour", 10, 20, "2.00")]))
    with app.app_context():
        item = _item(organization_id, "Flour")
        assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost)) == (Decimal("10"), Decimal("2"))
        assert_ledger_reconciles(item.id, expected_on_hand="10", opening="10")

    # A corrected opening sheet before the first receipt/count/POS sale is still the opening baseline.
    _import(client, organization_id, _csv([("Flour", 12, 20, "2.50")]))
    with app.app_context():
        item = _item(organization_id, "Flour")
        assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost)) == (Decimal("12"), Decimal("2.5"))
        assert_ledger_reconciles(item.id, expected_on_hand="12", opening="12")

    # The opening_inventory scope behaves the same way for a brand-new item.
    opening_csv = f"Item,Location,Qty,Unit\nSugar,{LOCATION},7,kg\n".encode("utf-8")
    _import(client, organization_id, opening_csv, scope="opening_inventory", mapping=OPENING_MAP)
    with app.app_context():
        assert Decimal(_item(organization_id, "Sugar").current_on_hand) == Decimal("7")


def test_reimport_after_receipt_rejects_quantity_and_never_reprices(app, client):
    login(client)
    organization_id = _new_org(app, client, "Ledger Receipt Org")
    _import(client, organization_id, _csv([("Flour", 10, 20, "2.00")]))
    with app.app_context():
        item_id = _item(organization_id, "Flour").id

    # Receive 10 kg at $3.00/kg. Independent WAC: (10 * 2.00 + 10 * 3.00) / 20 = 2.50.
    _receive(client, item_id, quantity_kg=10, unit_price=3.0)
    with app.app_context():
        assert _snapshot(organization_id, "Flour") == (Decimal("20"), Decimal("2.5"), 1)
        assert_ledger_reconciles(item_id, expected_on_hand="20", opening="10")

    # Re-uploading the original opening sheet (qty 10) would silently erase the receipt: rejected.
    job_id, preview = _preview(client, organization_id, _csv([("Flour", 10, 30, "2.00")]))
    assert preview["status"] == "VALIDATION_REQUIRED"
    assert preview["blockedRowCount"] == 1
    assert "ledger_history" in _row_issue_codes(preview)
    message = next(issue["message"] for row in preview["rows"] for issue in row["issues"] if issue["code"] == "ledger_history")
    assert "stock count or adjustment" in message and "1 stock movement" in message
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 400
    assert _post(client, f"/api/imports/jobs/{job_id}/execute").status_code == 400
    with app.app_context():
        assert _snapshot(organization_id, "Flour") == (Decimal("20"), Decimal("2.5"), 1)
        assert Decimal(_item(organization_id, "Flour").par_level) == Decimal("20")
        assert_ledger_reconciles(item_id, expected_on_hand="20", opening="10")

    # Same on-hand (unchanged) or a blank quantity: other fields update; WAC is not recomputed
    # from the new latest price (it stays the ledger's 2.50, not 4.00).
    _import(client, organization_id, _csv([("Flour", 20, 30, "4.00")]))
    _import(client, organization_id, _csv([("Flour", "", 35, "4.50")]))
    with app.app_context():
        item = _item(organization_id, "Flour")
        assert _snapshot(organization_id, "Flour") == (Decimal("20"), Decimal("2.5"), 1)
        assert (Decimal(item.par_level), Decimal(item.latest_purchase_price)) == (Decimal("35"), Decimal("4.5"))
        assert_ledger_reconciles(item_id, expected_on_hand="20", opening="10")


def test_rejected_row_rolls_back_the_whole_job_and_execute_rechecks_history(app, client):
    login(client)
    organization_id = _new_org(app, client, "Ledger Atomic Org")
    _import(client, organization_id, _csv([("Flour", 10, 20, "2.00")]))
    with app.app_context():
        item_id = _item(organization_id, "Flour").id

    # Preview and approve while Flour has no history: the quantity change is still legal here.
    job_id, preview = _preview(client, organization_id, _csv([("Sugar", 5, 10, "1.00"), ("Flour", 4, 20, "2.00")]))
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200

    # A receipt posts between approval and execution.
    _receive(client, item_id, quantity_kg=10, unit_price=3.0)

    executed = _post(client, f"/api/imports/jobs/{job_id}/execute")
    assert executed.status_code == 400
    with app.app_context():
        # All-or-nothing: the valid Sugar row was not created and Flour kept its ledger state.
        assert InventoryItem.query.filter_by(organization_id=organization_id, normalized_name="sugar").count() == 0
        assert _snapshot(organization_id, "Flour") == (Decimal("20"), Decimal("2.5"), 1)
        assert_ledger_reconciles(item_id, expected_on_hand="20", opening="10")
        assert db.session.get(DataImportJob, job_id).status == "FAILED"


@pytest.mark.parametrize("history", ["receipt", "count", "adjustment", "pos_sale"])
def test_rollback_is_blocked_once_the_item_has_stock_history(app, client, history):
    login(client)
    organization_id = _new_org(app, client, f"Ledger Rollback {history}")
    create_job = _import(client, organization_id, _csv([("Flour", 10, 20, "2.00")]))
    update_job = _import(client, organization_id, _csv([("Flour", 12, 25, "2.00")]))
    with app.app_context():
        item_id = _item(organization_id, "Flour").id

    if history == "receipt":
        _receive(client, item_id, quantity_kg=8, unit_price=2.0)
        expected = "20"
    elif history == "count":
        _finalize_count(client, item_id, counted=9)
        expected = "9"
    elif history == "adjustment":
        adjusted = _post(
            client,
            f"/api/pilot/inventory/items/{item_id}/adjustments",
            {"reason": "spill", "quantityDelta": 2, "movementType": "manual decrease", "sourceRecordId": "adj", "sourceLineId": "adj"},
        )
        assert adjusted.status_code == 201, adjusted.get_data(as_text=True)
        expected = "10"
    else:
        # POS consumption is recorded as a ledger movement by the Square/Clover adapters.
        with app.app_context():
            item = db.session.get(InventoryItem, item_id)
            db.session.add(InventoryMovement(
                organization_id=organization_id, location_id=item.location_id, inventory_item_id=item_id,
                quantity_delta=Decimal("-3"), quantity_before=Decimal("12"), quantity_after=Decimal("9"),
                unit="kg", source_type="square_sale", source_record_id="order-1", source_line_id="line-1",
            ))
            item.current_on_hand = Decimal("9")
            db.session.commit()
        expected = "9"

    with app.app_context():
        before = _snapshot(organization_id, "Flour")

    for job_id in (update_job, create_job):
        response = _post(client, f"/api/imports/jobs/{job_id}/rollback")
        assert response.status_code == 409, response.get_data(as_text=True)
        assert "stock history" in response.get_json()["errors"]["blockers"]
    with app.app_context():
        assert _snapshot(organization_id, "Flour") == before
        assert_ledger_reconciles(item_id, expected_on_hand=expected, opening="12")
        assert db.session.get(DataImportJob, update_job).status == "COMPLETED"
        assert db.session.get(DataImportJob, create_job).status == "COMPLETED"


def test_rollback_without_history_still_restores_or_removes(app, client):
    login(client)
    organization_id = _new_org(app, client, "Ledger Clean Rollback Org")
    create_job = _import(client, organization_id, _csv([("Flour", 10, 20, "2.00")]))
    update_job = _import(client, organization_id, _csv([("Flour", 14, 25, "3.00")]))

    assert _post(client, f"/api/imports/jobs/{update_job}/rollback").status_code == 200
    with app.app_context():
        item = _item(organization_id, "Flour")
        assert (Decimal(item.current_on_hand), Decimal(item.average_unit_cost), Decimal(item.par_level)) == (Decimal("10"), Decimal("2"), Decimal("20"))

    assert _post(client, f"/api/imports/jobs/{create_job}/rollback").status_code == 200
    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=organization_id, normalized_name="flour").count() == 0


def test_other_tenant_history_neither_blocks_nor_leaks(app, client):
    login(client)
    org_b = _new_org(app, client, "Ledger Tenant Beta")
    _import(client, org_b, _csv([("Flour", 10, 20, "2.00")]))
    with app.app_context():
        b_item_id = _item(org_b, "Flour").id
    _receive(client, b_item_id, quantity_kg=10, unit_price=3.0)
    with app.app_context():
        b_before = _snapshot(org_b, "Flour")

    org_a = _new_org(app, client, "Ledger Tenant Alpha")
    create_job = _import(client, org_a, _csv([("Flour", 10, 20, "2.00")]))
    # Org A's same-named item has no history, so a corrected opening quantity is allowed there.
    job_id, preview = _preview(client, org_a, _csv([("Flour", 11, 20, "2.00")]))
    assert preview["status"] == "READY_FOR_PREVIEW"
    assert "ledger_history" not in _row_issue_codes(preview)
    assert _post(client, f"/api/imports/jobs/{job_id}/approve").status_code == 200
    assert _post(client, f"/api/imports/jobs/{job_id}/execute").status_code == 200
    assert _post(client, f"/api/imports/jobs/{job_id}/rollback").status_code == 200
    assert _post(client, f"/api/imports/jobs/{create_job}/rollback").status_code == 200

    with app.app_context():
        assert InventoryItem.query.filter_by(organization_id=org_a, normalized_name="flour").count() == 0
        assert _snapshot(org_b, "Flour") == b_before
        assert_ledger_reconciles(b_item_id, expected_on_hand="20", opening="10")
        # The owner is a member of both organizations; nothing was written across tenants.
        assert OrganizationMembership.query.filter_by(organization_id=org_a).count() == 1
