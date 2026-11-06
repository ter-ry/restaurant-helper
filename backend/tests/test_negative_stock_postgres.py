"""PostgreSQL forced-RLS regression for GET /api/pilot/inventory/negative-stock (#237, review of PR #250).

Runs the real endpoint as the production runtime role (non-owner, forced RLS) against two tenants that each
have two locations, with negative inventory and movement-ledger rows in every location.  Fixtures are seeded
through the superuser admin connection, exactly like the other forced-RLS suites.

This file is collected by the backend PostgreSQL CI step (``pytest backend/tests --ignore=...``) and, in
GitHub Actions, must run: a missing PostgreSQL configuration fails instead of silently skipping.
"""
from __future__ import annotations

import os
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func

from backend.extensions import db
from backend.models import InventoryItem, InventoryMovement, OrganizationMembership, RestaurantLocation, User
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
URL = "/api/pilot/inventory/negative-stock"
B_PASSWORD = "BetaOwner123!"


def _csrf(client) -> dict:
    return {"X-CSRFToken": client.get("/api/auth/csrf", base_url=BASE).get_json()["csrfToken"]}


def _post(client, path, payload):
    return client.post(path, json=payload, headers=_csrf(client), base_url=BASE)


def _get(client):
    return client.get(URL, base_url=BASE)


def _item(org_id, location_id, name, unit, on_hand):
    item = InventoryItem(
        organization_id=org_id, location_id=location_id, name=name, normalized_name=f"{name.lower()}-{uuid4().hex[:6]}",
        stock_unit=unit, current_on_hand=Decimal(on_hand), average_unit_cost=Decimal("2"), active=True,
    )
    db.session.add(item)
    db.session.flush()
    return item


def _pos_movement(item, delta, source_type, order_id):
    before = Decimal("0")
    db.session.add(InventoryMovement(
        organization_id=item.organization_id, location_id=item.location_id, inventory_item_id=item.id,
        quantity_delta=Decimal(delta), quantity_before=before, quantity_after=before + Decimal(delta), unit=item.stock_unit,
        source_type=source_type, source_record_id=order_id, source_line_id=f"pg:{uuid4().hex[:8]}", reason="POS sale",
    ))


def _seed() -> dict:
    """Two tenants x two locations; every location has negative stock, a positive item and ledger rows."""

    def _seed_all():
        owner_a = User.query.filter_by(email="owner@flowtally.local").first() or User.query.order_by(User.id).first()
        owner_b = User(email=f"neg-beta-owner-{uuid4().hex[:8]}@example.com", is_active=True)
        owner_b.set_password(B_PASSWORD)
        db.session.add(owner_b)
        db.session.flush()
        org_a = _create_org(owner_a, f"Neg PG Alpha {uuid4().hex[:6]}")
        org_b = _create_org(owner_b, f"Neg PG Beta {uuid4().hex[:6]}")
        out = {"owner_b_email": owner_b.email, "org_a": org_a.id, "org_b": org_b.id}
        for key, org in (("a", org_a), ("b", org_b)):
            main = RestaurantLocation.query.filter_by(organization_id=org.id).one()
            annex = RestaurantLocation(
                organization_id=org.id, name=f"{org.name} Annex", address_line1="9 Annex St", city="Toronto", region="ON",
                postal_code="M5V 2B2", country="Canada", timezone="America/Toronto",
            )
            db.session.add(annex)
            db.session.flush()
            out[f"{key}_main"], out[f"{key}_annex"] = main.id, annex.id
        # Tenant A: Square beef at main, Clover cream at the annex.
        a_beef = _item(org_a.id, out["a_main"], "A Beef", "kg", "-1.8")
        _pos_movement(a_beef, "-1.8", "square sale consumption", "A-SQ-1")
        a_cream = _item(org_a.id, out["a_annex"], "A Cream", "L", "-0.5")
        _pos_movement(a_cream, "-0.5", "clover sale consumption", "A-CL-1")
        _item(org_a.id, out["a_main"], "A Flour", "kg", "5")
        # Tenant B: Square beef at main, an unexplained negative at the annex.
        b_beef = _item(org_b.id, out["b_main"], "B Beef", "kg", "-9")
        _pos_movement(b_beef, "-9", "square sale consumption", "B-SQ-1")
        _item(org_b.id, out["b_annex"], "B Milk", "L", "-4")
        _item(org_b.id, out["b_main"], "B Flour", "kg", "7")
        db.session.flush()
        out["a_beef"], out["a_cream"], out["b_beef"] = a_beef.id, a_cream.id, b_beef.id
        return out

    return _seed_admin_fixture("negative stock rls", _seed_all)


def _ledger_state() -> tuple:
    """Admin read of every item and movement, to prove the endpoint wrote nothing."""

    def _read():
        items = [(i.id, str(i.current_on_hand)) for i in InventoryItem.query.order_by(InventoryItem.id)]
        return (
            items,
            db.session.query(func.count(InventoryMovement.id)).scalar(),
            db.session.query(func.coalesce(func.sum(InventoryMovement.quantity_delta), 0)).scalar(),
        )

    return _seed_admin_fixture("negative stock rls read", _read)


def _names(response):
    assert response.status_code == 200, response.get_data(as_text=True)
    return [item["inventoryItemName"] for item in response.get_json()["items"]]


def test_postgres_runtime_role_is_configured_in_github_actions():
    # In CI this must be a real PostgreSQL run, never a skip.
    if IN_GITHUB_ACTIONS:
        assert POSTGRES_URL.startswith("postgres"), "FLOWTALLY_TEST_POSTGRES_URL must be set in GitHub Actions"
        assert "flowtally_runtime" in POSTGRES_URL, "the endpoint must be tested as the non-owner runtime role"


def test_negative_stock_is_tenant_and_location_isolated_under_forced_rls(postgres_app):
    seeded = _seed()
    before = _ledger_state()

    # ---- Tenant A (runtime role, forced RLS) ------------------------------------------------------
    client_a = postgres_app.test_client()
    _login_owner(client_a)
    assert _post(client_a, "/api/organizations/select", {"organizationId": seeded["org_a"]}).status_code == 200
    assert _get(client_a).status_code == 404  # two locations and none chosen: nothing is returned or guessed

    assert _post(client_a, "/api/locations/select", {"locationId": seeded["a_main"]}).status_code == 200
    response = _get(client_a)
    assert _names(response) == ["A Beef"]  # not A Cream (other location), A Flour (positive), nor any B row
    beef = response.get_json()["items"][0]
    assert (beef["inventoryItemId"], beef["onHand"], beef["shortfall"], beef["unit"]) == (seeded["a_beef"], -1.8, 1.8, "kg")
    assert (beef["cause"], beef["provider"], beef["orderCount"], beef["posConsumedQuantity"], beef["reviewOrderCount"]) == ("pos_sale", "Square", 1, 1.8, 0)
    assert beef["explanation"] == "1 Square order used 1.8 kg before enough stock was received; on hand is -1.8 kg. Record the delivery or count the item to reconcile."
    assert response.get_json()["count"] == 1 and response.get_json()["posCausedCount"] == 1

    assert _post(client_a, "/api/locations/select", {"locationId": seeded["a_annex"]}).status_code == 200
    annex = _get(client_a).get_json()
    assert [i["inventoryItemName"] for i in annex["items"]] == ["A Cream"]
    assert (annex["items"][0]["provider"], annex["items"][0]["onHand"], annex["items"][0]["posConsumedQuantity"]) == ("Clover", -0.5, 0.5)

    # Location mismatch: tenant A cannot select tenant B's location or organization, and nothing of B leaks.
    assert _post(client_a, "/api/locations/select", {"locationId": seeded["b_main"]}).status_code == 403
    assert _post(client_a, "/api/locations/select", {"locationId": seeded["b_annex"]}).status_code == 403
    assert _post(client_a, "/api/organizations/select", {"organizationId": seeded["org_b"]}).status_code == 403
    still_a = _get(client_a)
    assert _names(still_a) == ["A Cream"]  # still the annex of A, unchanged by the rejected attempts
    assert not any("B " in name for name in _names(still_a)) and "B-SQ-1" not in still_a.get_data(as_text=True)

    # ---- Tenant B, authenticated as its own owner --------------------------------------------------
    client_b = postgres_app.test_client()
    _login_user(client_b, seeded["owner_b_email"], B_PASSWORD)
    assert _post(client_b, "/api/organizations/select", {"organizationId": seeded["org_b"]}).status_code == 200
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["b_main"]}).status_code == 200
    b_main = _get(client_b).get_json()
    assert [i["inventoryItemName"] for i in b_main["items"]] == ["B Beef"]
    assert (b_main["items"][0]["inventoryItemId"], b_main["items"][0]["onHand"], b_main["items"][0]["provider"]) == (seeded["b_beef"], -9.0, "Square")
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["b_annex"]}).status_code == 200
    b_annex = _get(client_b).get_json()
    assert [(i["inventoryItemName"], i["cause"], i["provider"], i["orderCount"]) for i in b_annex["items"]] == [("B Milk", "unverified", None, 0)]
    assert b_annex["posCausedCount"] == 0 and b_annex["items"][0]["explanation"] == "On hand is -4 L but no verified POS sale caused it. Count the item to correct it."

    # B cannot reach A's organization or locations, and A's rows never appear in any B response.
    assert _post(client_b, "/api/organizations/select", {"organizationId": seeded["org_a"]}).status_code == 403
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["a_main"]}).status_code == 403
    assert _post(client_b, "/api/locations/select", {"locationId": seeded["a_annex"]}).status_code == 403
    leaked = _get(client_b)
    assert _names(leaked) == ["B Milk"]
    assert "A Beef" not in leaked.get_data(as_text=True) and "A-SQ-1" not in leaked.get_data(as_text=True)

    # An unauthenticated caller gets nothing at all.
    assert _get(postgres_app.test_client()).status_code == 401

    # ---- Read-only: no item or ledger row changed, none was added ---------------------------------
    assert _ledger_state() == before
