"""PostgreSQL / forced-RLS acceptance for #259: a PATCH that collides with another invoice's supplier + number.

Runs the real endpoints as the non-owner runtime role. The rejected PATCH must be a structured 409 with
``duplicateInvoiceId`` and leave both invoices (rows, lines, supplier list, audit) exactly as they were.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from backend.tests.test_inventory_concurrency_postgres import (  # noqa: F401  (postgres_app is a fixture)
    BASE,
    POSTGRES_URL,
    _admin_engine,
    _invoice,
    _make_world,
    _patch,
    _post,
    postgres_app,
)

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _db_state(engine, org_id: int):
    queries = {
        "invoices": "select id, supplier_id, invoice_number, invoice_date, subtotal, tax, total_amount, notes, status, updated_by_user_id from purchase_invoices where organization_id = :o order by id",
        "lines": "select l.invoice_id, l.line_index, l.description, l.quantity, l.line_total from purchase_invoice_lines l join purchase_invoices i on i.id = l.invoice_id where i.organization_id = :o order by l.invoice_id, l.line_index",
        "suppliers": "select id, name from suppliers where organization_id = :o order by id",
        "invoice_updates": "select count(*) from audit_events where organization_id = :o and event_type = 'purchases.invoice_updated'",
        "movements": "select count(*) from inventory_movements where organization_id = :o",
    }
    with engine.connect() as connection:
        return {name: [tuple(row) for row in connection.execute(text(sql), {"o": org_id})] for name, sql in queries.items()}


def _get(client, invoice_id: int) -> dict:
    response = client.get(f"/api/pilot/purchases/invoices/{invoice_id}", base_url=BASE)
    assert response.status_code == 200
    return response.get_json()


def _edit_payload(invoice: dict, **overrides) -> dict:
    keys = ("invoiceNumber", "invoiceDate", "subtotal", "tax", "totalAmount", "notes", "status", "lineItems")
    return {**{key: invoice[key] for key in keys}, "supplierName": invoice["supplier"]["name"], **overrides}


def test_patch_duplicate_number_is_409_and_leaves_both_invoices_unchanged(postgres_app):
    world = _make_world(postgres_app)
    item = world.items["Flour"]
    client = world.client()
    invoice_a = _get(client, _invoice(world, client, [(item, 5, 4.0)]))
    invoice_b = _get(client, _invoice(world, client, [(item, 3, 6.0)]))
    assert invoice_a["invoiceNumber"] != invoice_b["invoiceNumber"] and invoice_a["supplierId"] == invoice_b["supplierId"]
    engine = _admin_engine()
    before = _db_state(engine, world.org_id)

    response = _patch(client, f"/api/pilot/purchases/invoices/{invoice_b['id']}", _edit_payload(invoice_b, invoiceNumber=invoice_a["invoiceNumber"], notes="should not stick"))

    assert response.status_code == 409, response.get_data(as_text=True)
    body = response.get_json()
    assert body["errors"]["duplicateInvoiceId"] == str(invoice_a["id"])
    assert body["errors"]["duplicateStatus"] == invoice_a["status"]
    assert _db_state(engine, world.org_id) == before
    assert _get(client, invoice_b["id"])["invoiceNumber"] == invoice_b["invoiceNumber"]

    # The same request with a free number still works (the rejection left no half-applied state behind).
    ok = _patch(client, f"/api/pilot/purchases/invoices/{invoice_b['id']}", _edit_payload(invoice_b, notes="edited"))
    assert ok.status_code == 200 and ok.get_json()["notes"] == "edited"
    engine.dispose()


def test_same_number_in_another_organization_is_not_a_collision_and_never_leaks_ids(postgres_app):
    world_a = _make_world(postgres_app)
    world_b = _make_world(postgres_app)
    client_a, client_b = world_a.client(), world_b.client()
    a1 = _get(client_a, _invoice(world_a, client_a, [(world_a.items["Flour"], 5, 4.0)]))
    b1 = _get(client_b, _invoice(world_b, client_b, [(world_b.items["Flour"], 5, 4.0)]))
    engine = _admin_engine()
    before_a = _db_state(engine, world_a.org_id)

    # Tenant B reusing tenant A's number under its own supplier is fine, and gives no signal about A's invoices.
    reuse = _patch(client_b, f"/api/pilot/purchases/invoices/{b1['id']}", _edit_payload(b1, invoiceNumber=a1["invoiceNumber"]))
    assert reuse.status_code == 200
    # Tenant B cannot PATCH tenant A's invoice at all (404, no duplicate id disclosed).
    foreign = _patch(client_b, f"/api/pilot/purchases/invoices/{a1['id']}", _edit_payload(a1, invoiceNumber=b1["invoiceNumber"]))
    assert foreign.status_code == 404 and "duplicateInvoiceId" not in (foreign.get_json().get("errors") or {})
    assert _db_state(engine, world_a.org_id) == before_a
    engine.dispose()
