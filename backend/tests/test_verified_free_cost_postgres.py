"""PostgreSQL forced-RLS / trigger tests for verified-free provenance (#279 Phase A). Non-owner runtime role, no endpoints."""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from backend.extensions import db
from backend.models import InventoryCostVerification, InventoryItem, RestaurantLocation
from backend.tests.test_inventory_concurrency_postgres import POSTGRES_URL, _make_world, postgres_app  # noqa: F401
from backend.tests.test_postgres_rls import _seed_admin_fixture, _set_rls_context

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _row(org_id, location_id, item_id, key, **over):
    data = dict(organization_id=org_id, location_id=location_id, inventory_item_id=item_id, quantity=Decimal("4"),
                evidence_type="donation", evidence_note="signed donation slip", idempotency_key=key)
    data.update(over)
    return InventoryCostVerification(**data)


def _location_id(org_id):
    return _seed_admin_fixture("verification location", lambda: RestaurantLocation.query.filter_by(organization_id=org_id).one().id)


def _insert(app, org_id, row_fn):
    with app.app_context():
        _set_rls_context(access_scope="customer", organization_id=org_id)
        try:
            row = row_fn()
            db.session.add(row)
            db.session.flush()
            row_id = row.id
            db.session.commit()
            return row_id
        finally:
            db.session.rollback()
            db.session.remove()


def test_verification_rows_are_tenant_isolated_and_scope_checked(postgres_app):
    a = _make_world(postgres_app, on_hand="10", avg_cost="0")
    b = _make_world(postgres_app, on_hand="10", avg_cost="0")
    loc_a, loc_b = _location_id(a.org_id), _location_id(b.org_id)
    item_a, item_b = a.items["Flour"], b.items["Flour"]

    # Valid insert by the owning tenant works and does not change the item's legacy zero cost.
    row_id = _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_a, item_a, "ok-1"))
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=a.org_id)
        assert Decimal(db.session.get(InventoryItem, item_a).average_unit_cost) == 0
        assert InventoryCostVerification.query.count() == 1
        db.session.rollback(); db.session.remove()

    # Tenant B cannot see A's evidence.
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=b.org_id)
        assert InventoryCostVerification.query.count() == 0
        assert db.session.get(InventoryCostVerification, row_id) is None
        db.session.rollback(); db.session.remove()

    # Tenant B cannot write evidence under A's organization (RLS WITH CHECK) ...
    with pytest.raises(DBAPIError):
        _insert(postgres_app, b.org_id, lambda: _row(a.org_id, loc_a, item_a, "x-org"))
    # ... nor attach evidence to A's item under its own organization (scope trigger; item invisible under RLS).
    with pytest.raises(DBAPIError):
        _insert(postgres_app, b.org_id, lambda: _row(b.org_id, loc_b, item_a, "x-item"))
    # Same org, but item/location mismatch is rejected.
    with pytest.raises(DBAPIError):
        _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_b, item_a, "x-loc"))
    # Corrections cannot point at another tenant's evidence row.
    with pytest.raises(DBAPIError):
        _insert(postgres_app, b.org_id, lambda: _row(b.org_id, loc_b, item_b, "x-corr", correction_of_id=row_id))

    # Duplicate idempotency key and bad values are rejected by constraints.
    with pytest.raises(IntegrityError):
        _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_a, item_a, "ok-1"))
    with pytest.raises(IntegrityError):
        _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_a, item_a, "bad-note", evidence_note=" "))


def test_correction_chain_and_revocation_round_trip(postgres_app):
    a = _make_world(postgres_app, on_hand="10", avg_cost="0")
    loc_a, item_a = _location_id(a.org_id), a.items["Flour"]
    first = _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_a, item_a, "c-1"))
    second = _insert(postgres_app, a.org_id, lambda: _row(a.org_id, loc_a, item_a, "c-2", quantity=Decimal("3"), correction_of_id=first))
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=a.org_id)
        original = db.session.get(InventoryCostVerification, first)
        from backend.models import utc_now
        original.revoked_at = utc_now()
        original.revoked_reason = "quantity was 3, not 4"
        db.session.commit()
        db.session.remove()
    with postgres_app.app_context():
        _set_rls_context(access_scope="customer", organization_id=a.org_id)
        assert db.session.get(InventoryCostVerification, first).revoked_reason
        assert db.session.get(InventoryCostVerification, second).correction_of_id == first
        db.session.rollback(); db.session.remove()
