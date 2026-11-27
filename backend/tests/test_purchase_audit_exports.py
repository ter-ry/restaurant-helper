"""Bookkeeping / purchase-history / audit export contract (#315, owner decisions 2026-11-27)."""
from __future__ import annotations

import csv
import io
from uuid import uuid4

from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD
from backend.tests.test_pilot_invoice_correction_acceptance import csrf_headers, invoice_payload, login

RANGE = "from=2026-08-01&to=2026-08-31"


def _rows(response):
    assert response.status_code == 200, response.get_data(as_text=True)
    return list(csv.DictReader(io.StringIO(response.get_data(as_text=True))))


def _create(client, supplier, number, item, status="Draft"):
    payload = invoice_payload(supplier_name=supplier, invoice_number=number, inventory_item_id=item["id"], inventory_unit=item["stockUnit"], status=status)
    response = client.post("/api/pilot/purchases/invoices", headers=csrf_headers(client), json=payload)
    assert response.status_code in {200, 201}, response.get_data(as_text=True)
    return response.get_json()["id"]


def _receive(client, invoice_id):
    response = client.post(f"/api/pilot/purchases/invoices/{invoice_id}/receive", headers=csrf_headers(client))
    assert response.status_code == 200, response.get_data(as_text=True)


def test_bookkeeping_excludes_drafts_and_voided_originals_and_history_keeps_the_trail(app, client):
    login(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    supplier = "=HYPERLINK(\"http://evil\")"
    tag = uuid4().hex[:6].upper()
    original = _create(client, supplier, f"EXP-{tag}", item)
    _receive(client, original)
    draft = _create(client, supplier, f"DRAFT-{tag}", item)

    voided = client.post(
        f"/api/pilot/purchases/invoices/{original}/void",
        headers=csrf_headers(client),
        json={"reason": "+wrong quantity", "createCorrectionDraft": True, "idempotencyKey": f"k-{tag}"},
    )
    assert voided.status_code == 200, voided.get_data(as_text=True)
    corrected = voided.get_json()["correctedByInvoiceId"]
    _receive(client, corrected)

    book = _rows(client.get(f"/api/pilot/exports/purchases-bookkeeping?{RANGE}"))
    numbers = {r["invoice_number"] for r in book if tag in r["invoice_number"]}
    assert numbers == {f"EXP-{tag}-C1"}, numbers  # corrected copy only: no draft, no voided original, no double count
    row = next(r for r in book if tag in r["invoice_number"])
    assert row["status"] == "Completed" and row["corrects_invoice_number"] == f"EXP-{tag}"
    assert row["total"] == row["line_total_sum"] == "20.00"
    assert row["supplier"].startswith("'=")  # formula-injection safe

    history = {r["invoice_number"]: r for r in _rows(client.get(f"/api/pilot/exports/purchase-history?{RANGE}")) if tag in r["invoice_number"]}
    assert set(history) == {f"EXP-{tag}", f"EXP-{tag}-C1", f"DRAFT-{tag}"}
    assert history[f"EXP-{tag}"]["status"] == "Corrected"
    assert history[f"EXP-{tag}"]["void_reason"] == "'+wrong quantity"
    assert history[f"EXP-{tag}"]["corrected_by_invoice_number"] == f"EXP-{tag}-C1"
    assert history[f"DRAFT-{tag}"]["status"] == "Draft"

    # Out-of-range window excludes everything.
    assert not [r for r in _rows(client.get("/api/pilot/exports/purchases-bookkeeping?from=2025-01-01&to=2025-01-31")) if tag in r["invoice_number"]]
    assert draft


def test_export_requires_explicit_valid_range(client):
    login(client)
    for path in ("purchases-bookkeeping", "purchase-history"):
        assert client.get(f"/api/pilot/exports/{path}").status_code == 400
        assert client.get(f"/api/pilot/exports/{path}?from=2026-09-01&to=2026-08-01").status_code == 400
        assert client.get(f"/api/pilot/exports/{path}?from=nope&to=2026-08-01").status_code == 400
        assert client.get(f"/api/pilot/exports/{path}?from=2020-01-01&to=2026-08-01").status_code == 400


def test_audit_export_is_complete_across_pages_and_owner_only(app, client):
    login(client)
    item = next(i for i in client.get("/api/pilot/inventory").get_json()["items"] if i["name"] == "Chicken Breast")
    tag = uuid4().hex[:6].upper()
    for n in range(3):
        _receive(client, _create(client, "Fresh Dairy Toronto", f"AUD-{tag}-{n}", item))

    from datetime import date, timedelta
    today = date.today()
    window = f"from={today - timedelta(days=1)}&to={today + timedelta(days=1)}"
    seen, cursor, pages = [], None, 0
    while True:
        url = f"/api/pilot/audit-events/export?{window}&limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = client.get(url).get_json()
        pages += 1
        assert body["scope"]["from"] and body["scope"]["organizationId"]
        seen += [e["id"] for e in body["events"]]
        if body["complete"]:
            assert body["nextCursor"] is None
            break
        assert body["count"] == 2 and body["nextCursor"] == body["events"][-1]["id"]
        cursor = body["nextCursor"]
    assert pages >= 2 and seen == sorted(set(seen))  # strictly ordered, no duplicates, no gaps from truncation
    assert sum(1 for _ in seen) >= 3

    csv_response = client.get(f"/api/pilot/audit-events/export?{window}&format=csv&limit=1")
    assert csv_response.headers["X-Export-Complete"] == "false" and csv_response.headers["X-Next-Cursor"]
    assert client.get(f"/api/pilot/audit-events/export?{window}&limit=0").status_code == 400
    assert client.get(f"/api/pilot/audit-events/export?{window}&limit=5000").status_code == 400
    assert client.get("/api/pilot/audit-events/export").status_code == 400


def test_manager_cannot_export_audit_but_can_export_purchases(app):
    anonymous = app.test_client()
    assert anonymous.get(f"/api/pilot/exports/purchase-history?{RANGE}").status_code == 401
    assert anonymous.get(f"/api/pilot/audit-events/export?{RANGE}").status_code == 401
    manager = app.test_client()
    csrf = manager.get("/api/auth/csrf").get_json()["csrfToken"]
    assert manager.post("/api/auth/login", json={"email": LOCAL_MANAGER_EMAIL, "password": LOCAL_MANAGER_PASSWORD}, headers={"X-CSRFToken": csrf}).status_code == 200
    assert manager.get(f"/api/pilot/audit-events/export?{RANGE}").status_code == 403
    assert manager.get(f"/api/pilot/exports/purchases-bookkeeping?{RANGE}").status_code == 200


def test_audit_export_never_includes_another_organizations_events(app, client):
    from datetime import date, timedelta
    from backend.audit import record_audit_event
    from backend.extensions import db
    from backend.models import Organization

    login(client)
    with app.app_context():
        other = Organization(name="Other Tenant", lifecycle_status="ACTIVE", setup_status="COMPLETE", subscription_status="ACTIVE")
        db.session.add(other)
        db.session.flush()
        record_audit_event(event_type="other.secret", entity_type="x", entity_id="1", organization_id=other.id, request_id="r1", source_ip="127.0.0.1", user_agent="test")
        db.session.commit()
    today = date.today()
    body = client.get(f"/api/pilot/audit-events/export?from={today - timedelta(days=1)}&to={today + timedelta(days=1)}&limit=1000").get_json()
    assert all(e["eventType"] != "other.secret" for e in body["events"])
