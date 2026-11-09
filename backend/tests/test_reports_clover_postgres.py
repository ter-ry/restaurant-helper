"""PostgreSQL forced-RLS regression for Clover Owner Reports (#262).

Runs GET /api/pilot/reports as the production runtime role (non-owner, forced RLS) against two tenants that each
have two locations.  Clover orders and ledger rows are seeded through the superuser admin connection, exactly like
the other forced-RLS suites, and every figure is hand-computed (see test_reports_clover.py for the day's fixture).
In GitHub Actions a missing PostgreSQL configuration fails instead of silently skipping.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func

from backend.extensions import db
from backend.models import (
    CloverConnection,
    CloverLocationMapping,
    CloverShadowOrder,
    CloverShadowOrderLine,
    CloverShadowOrderLineInventoryConsumption,
    InventoryItem,
    OrganizationModule,
    RestaurantLocation,
    User,
)
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
DAY = "2026-08-30"
NOON = datetime(2026, 8, 30, 16, 0, tzinfo=timezone.utc)
NEXT_DAY = datetime(2026, 8, 31, 4, 0, tzinfo=timezone.utc)
B_PASSWORD = "BetaOwner123!"
MODULES = ("INVENTORY", "REPORTING", "MENU_COSTING", "STOCK_COUNTS", "REORDER_PLANS", "SQUARE_INTEGRATION", "DAILY_CLOSE")


def _csrf(client) -> dict:
    return {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}


def _post(client, path, payload):
    return client.post(path, json=payload, headers=_csrf(client), base_url=BASE)


def _report(client, **extra):
    return client.get("/api/pilot/reports", query_string={"view": "daily", "date": DAY, **extra}, base_url=BASE)


def _pay(amount, tax, tip=None):
    return {"id": f"p-{uuid4().hex[:6]}", "amount": amount, "result": "SUCCESS", "taxAmount": tax, "tipAmount": tip, "tender": "com.clover.tender.credit_card"}


def _order(org_id, location_id, connection, payments, closed=NOON):
    order = CloverShadowOrder(
        organization_id=org_id, clover_connection_id=connection.id, restaurant_location_id=location_id, clover_merchant_id=connection.merchant_id,
        clover_order_id=f"o-{uuid4().hex[:8]}", normalized_status="paid", requires_review=False, source_closed_at=closed, raw_payload_json={"payments": payments},
    )
    db.session.add(order)
    db.session.flush()
    return order


def _seed() -> dict:
    """Two tenants x two locations; only each tenant's main location is mapped to Clover."""

    def _seed_all():
        owner_a = User.query.filter_by(email="owner@flowtally.local").first() or User.query.order_by(User.id).first()
        owner_b = User(email=f"rep-beta-owner-{uuid4().hex[:8]}@example.com", is_active=True)
        owner_b.set_password(B_PASSWORD)
        db.session.add(owner_b)
        db.session.flush()
        org_a = _create_org(owner_a, f"Rep PG Alpha {uuid4().hex[:6]}")
        org_b = _create_org(owner_b, f"Rep PG Beta {uuid4().hex[:6]}")
        out = {"owner_b_email": owner_b.email, "org_a": org_a.id, "org_b": org_b.id}
        for key, org in (("a", org_a), ("b", org_b)):
            for module in MODULES:
                db.session.add(OrganizationModule(organization_id=org.id, module_key=module, status="ENABLED"))
            main = RestaurantLocation.query.filter_by(organization_id=org.id).one()
            annex = RestaurantLocation(organization_id=org.id, name=f"{org.name} Annex", address_line1="9 Annex St", city="Toronto", region="ON", postal_code="M5V 2B2", country="Canada", timezone="America/Toronto")
            db.session.add(annex)
            connection = CloverConnection(organization_id=org.id, environment="sandbox", merchant_id=f"m-{uuid4().hex[:6]}", status="connected", access_token_ciphertext="x")
            db.session.add(connection)
            db.session.flush()
            db.session.add(CloverLocationMapping(clover_connection_id=connection.id, organization_id=org.id, restaurant_location_id=main.id, clover_merchant_id=connection.merchant_id))
            out[f"{key}_main"], out[f"{key}_annex"], out[f"{key}_conn"] = main.id, annex.id, connection
        conn_a, conn_b = out.pop("a_conn"), out.pop("b_conn")
        # Tenant A main: 1130 (tax 130, tip 150) + 2260 (tax 260) = net 3000, tax 390, tips 150 -> collected 35.40 ... plus the next-day order.
        order = _order(org_a.id, out["a_main"], conn_a, [_pay(1130, 130, 150)])
        _order(org_a.id, out["a_main"], conn_a, [_pay(2260, 260)])
        _order(org_a.id, out["a_main"], conn_a, [_pay(9999, 999)], closed=NEXT_DAY)
        # A's unmapped annex has a large Clover-looking order: it must never appear for the annex or the main site.
        _order(org_a.id, out["a_annex"], conn_a, [_pay(88000, 8000)])
        # Ledger-applied usage on the main site: 0.5 kg x $8 = $4.00.
        chicken = InventoryItem(organization_id=org_a.id, location_id=out["a_main"], name="A Chicken", normalized_name=f"chicken-{uuid4().hex[:6]}", stock_unit="kg", current_on_hand=Decimal("10"), average_unit_cost=Decimal("8"), active=True)
        db.session.add(chicken)
        db.session.flush()
        line = CloverShadowOrderLine(organization_id=org_a.id, restaurant_location_id=out["a_main"], shadow_order_id=order.id, clover_line_item_id=f"l-{uuid4().hex[:6]}", clover_item_id="i", name="Chicken Plate", quantity=Decimal("2"), mapping_status="mapped",
                                     recipe_preview_json={"flowtallyMenuItemName": "Chicken Plate", "ingredients": [{"inventoryItemId": chicken.id, "quantity": "0.5000", "unit": "kg", "name": "A Chicken"}]})
        db.session.add(line)
        db.session.flush()
        db.session.add(CloverShadowOrderLineInventoryConsumption(organization_id=org_a.id, location_id=out["a_main"], clover_shadow_order_line_id=line.id, inventory_item_id=chicken.id, applied_quantity=Decimal("-0.5000"), unit_cost_snapshot=Decimal("8")))
        # Tenant B main: one big order.
        _order(org_b.id, out["b_main"], conn_b, [_pay(500000, 50000, 0)])
        db.session.flush()
        return out

    return _seed_admin_fixture("clover reports rls", _seed_all)


def _row_counts() -> tuple:
    def _read():
        return tuple(db.session.query(func.count(model.id)).scalar() for model in (CloverShadowOrder, CloverShadowOrderLine, CloverShadowOrderLineInventoryConsumption, InventoryItem))

    return _seed_admin_fixture("clover reports rls read", _read)


def test_postgres_runtime_role_is_configured_in_github_actions():
    if IN_GITHUB_ACTIONS:
        assert POSTGRES_URL.startswith("postgres"), "FLOWTALLY_TEST_POSTGRES_URL must be set in GitHub Actions"
        assert "flowtally_runtime" in POSTGRES_URL, "the endpoint must be tested as the non-owner runtime role"


def test_clover_reports_are_tenant_and_location_isolated_under_forced_rls(postgres_app):
    seeded = _seed()
    before = _row_counts()

    client_a = postgres_app.test_client()
    _login_owner(client_a)
    assert _post(client_a, "/api/organizations/select", {"organizationId": seeded["org_a"]}).status_code == 200
    assert _post(client_a, "/api/locations/select", {"locationId": seeded["a_main"]}).status_code == 200
    main = _report(client_a)
    assert main.status_code == 200, main.get_data(as_text=True)
    body = main.get_json()
    sales = body["sales"]
    # 1130 + 2260 = 3390 paid, tax 390 -> net 30.00; tip 1.50; collected 31.50 + 3.90 tax = 35.40.  Next-day and annex orders excluded.
    assert (body["provider"], sales["source"], sales["status"]) == ("clover", "clover_orders", "available")
    assert (sales["orderCount"], sales["netItemSales"], sales["tax"], sales["tips"], sales["totalCollected"]) == (2, 30.0, 3.9, 1.5, 35.4)
    assert (body["costing"]["usageAvailable"], body["costing"]["usageCost"], body["costing"]["estimatedFoodCostPercent"]) == (True, 4.0, 13.33)
    assert [(r["name"], r["quantity"]) for r in sales["byMenuItem"]] == [("Chicken Plate", 2.0)]

    # The same tenant's annex is not mapped to Clover: it must not borrow the main site's (or its own stray) Clover orders.
    assert _post(client_a, "/api/locations/select", {"locationId": seeded["a_annex"]}).status_code == 200
    annex = _report(client_a).get_json()
    assert annex["scope"]["locationId"] == seeded["a_annex"] and annex["sales"]["source"] == "square_orders" and annex["sales"]["totalCollected"] == 0.0

    # Cross-tenant selection is rejected, and the rejected attempts change nothing.
    assert _post(client_a, "/api/organizations/select", {"organizationId": seeded["org_b"]}).status_code == 403
    assert _post(client_a, "/api/locations/select", {"locationId": seeded["b_main"]}).status_code == 403
    after_attempts = _report(client_a)
    assert after_attempts.get_json()["scope"]["locationId"] == seeded["a_annex"]
    assert "5000.0" not in after_attempts.get_data(as_text=True)

    client_b = postgres_app.test_client()
    _login_user(client_b, seeded["owner_b_email"], B_PASSWORD)
    assert _post(client_b, "/api/organizations/select", {"organizationId": seeded["org_b"]}).status_code == 200
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["b_main"]}).status_code == 200
    b_sales = _report(client_b).get_json()["sales"]
    assert (b_sales["orderCount"], b_sales["netItemSales"], b_sales["totalCollected"], b_sales["byMenuItem"]) == (1, 4500.0, 5000.0, [])
    assert _post(client_b, "/api/organizations/select", {"organizationId": seeded["org_a"]}).status_code == 403
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["a_main"]}).status_code == 403
    assert "Chicken" not in _report(client_b).get_data(as_text=True)

    assert _report(postgres_app.test_client()).status_code == 401
    assert _row_counts() == before  # read-only
