"""PostgreSQL concurrency / forced-RLS / rollback tests for verified-free evidence endpoints and $0 transfers (#279 Phase B).

Real endpoints, non-owner runtime role, the deterministic two-session harness from #248.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from backend.extensions import db
from backend.models import InventoryCostVerification, InventoryItem, InventoryTransfer
from backend.tests.test_inventory_concurrency_postgres import BASE, POSTGRES_URL, _post, postgres_app, race  # noqa: F401
from backend.tests.test_inventory_transfers_postgres import TwoSites
from backend.tests.test_postgres_rls import _seed_admin_fixture, _set_rls_context

pytestmark = pytest.mark.skipif(not POSTGRES_URL.startswith("postgres"), reason="PostgreSQL test database is not configured.")


def _free_sites(postgres_app) -> TwoSites:
    sites = TwoSites(postgres_app)

    def zero():
        db.session.get(InventoryItem, sites.main_item).average_unit_cost = Decimal("0")
        return True

    _seed_admin_fixture("zero cost source", zero)
    return sites


def _verify(sites, client, quantity, key=None):
    return _post(
        client,
        f"/api/pilot/inventory/items/{sites.main_item}/cost-verifications",
        {"quantity": quantity, "evidenceType": "supplier_free_goods", "evidenceNote": "Credit memo 88", "idempotencyKey": key or uuid4().hex},
    )


def _evidence(sites, item_id):
    with sites.app.app_context():
        _set_rls_context(access_scope="customer", organization_id=sites.org_id)
        rows = [(Decimal(r.quantity), Decimal(r.consumed_quantity), r.revoked_at is not None) for r in InventoryCostVerification.query.filter_by(inventory_item_id=item_id).order_by(InventoryCostVerification.id)]
        db.session.rollback()
        db.session.remove()
    return rows


def test_verified_free_transfer_under_forced_rls_moves_evidence_and_value(postgres_app):
    sites = _free_sites(postgres_app)
    client = sites.client()
    assert sites.transfer(client, source=sites.main_item, to_location=sites.kiosk_id, quantity=1).status_code == 409  # unverified zero
    assert _verify(sites, client, 6).status_code == 201
    response = sites.transfer(client, source=sites.main_item, to_location=sites.kiosk_id, quantity=4)
    assert response.status_code == 201, response.get_data(as_text=True)
    assert sites.read(sites.kiosk_item)[:2] == (Decimal("9"), Decimal("1.666667"))  # (5*3 + 4*0) / 9
    assert _evidence(sites, sites.main_item) == [(Decimal("6"), Decimal("4"), False)]
    assert _evidence(sites, sites.kiosk_item) == [(Decimal("4"), Decimal("0"), False)]


def test_two_transfers_cannot_spend_the_same_evidence_twice(postgres_app):
    sites = _free_sites(postgres_app)
    a, b = sites.client(), sites.client()
    assert _verify(sites, a, 4).status_code == 201

    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=3),
        lambda: sites.transfer(b, source=sites.main_item, to_location=sites.kiosk_id, quantity=3),
    )

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert sorted((run_a.result.status_code, run_b.result.status_code)) == [201, 409]
    assert _evidence(sites, sites.main_item) == [(Decimal("4"), Decimal("3"), False)]
    assert _evidence(sites, sites.kiosk_item) == [(Decimal("3"), Decimal("0"), False)]
    assert sites.read(sites.main_item)[0] == Decimal("7") and sites.count(InventoryTransfer) == 1


def test_identical_concurrent_transfer_retry_consumes_evidence_once(postgres_app):
    sites = _free_sites(postgres_app)
    a, b = sites.client(), sites.client()
    assert _verify(sites, a, 6).status_code == 201

    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="same"),
        lambda: sites.transfer(b, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="same"),
    )

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert sorted((run_a.result.status_code, run_b.result.status_code)) == [200, 201]
    assert _evidence(sites, sites.main_item) == [(Decimal("6"), Decimal("4"), False)]
    assert _evidence(sites, sites.kiosk_item) == [(Decimal("4"), Decimal("0"), False)]


def test_concurrent_verifications_cannot_exceed_on_hand_stock(postgres_app):
    sites = _free_sites(postgres_app)
    a, b = sites.client(), sites.client()

    run_a, run_b = race(lambda: _verify(sites, a, 6), lambda: _verify(sites, b, 6))

    assert run_a.error is None and run_b.error is None, (run_a.error, run_b.error)
    assert sorted((run_a.result.status_code, run_b.result.status_code)) == [201, 409]
    assert _evidence(sites, sites.main_item) == [(Decimal("6"), Decimal("0"), False)]


def test_failure_rolls_back_evidence_consumption(postgres_app):
    sites = _free_sites(postgres_app)
    a, b = sites.client(), sites.client()
    a.application.config["PROPAGATE_EXCEPTIONS"] = False
    assert _verify(sites, a, 6).status_code == 201

    run_a, run_b = race(
        lambda: sites.transfer(a, source=sites.main_item, to_location=sites.kiosk_id, quantity=4, key="doomed"),
        lambda: sites.transfer(b, source=sites.main_item, to_location=sites.kiosk_id, quantity=1, key="survivor"),
        fail_first=True,
    )

    assert getattr(run_b.result, "status_code", None) == 201, (run_a.error, run_b.error)
    assert _evidence(sites, sites.main_item) == [(Decimal("6"), Decimal("1"), False)]
    assert _evidence(sites, sites.kiosk_item) == [(Decimal("1"), Decimal("0"), False)]
    assert sites.count(InventoryTransfer) == 1


def test_other_organization_cannot_read_write_revoke_or_correct_evidence(postgres_app):
    sites = _free_sites(postgres_app)
    outsider = TwoSites(postgres_app)
    owner_client, other_client = sites.client(), outsider.client()
    batch = _verify(sites, owner_client, 6).get_json()["id"]

    assert _verify(sites, other_client, 2).status_code == 404  # not their item
    assert _post(other_client, f"/api/pilot/inventory/cost-verifications/{batch}/revoke", {"reason": "hostile"}).status_code == 404
    body = {"quantity": 1, "evidenceType": "donation", "evidenceNote": "x", "reason": "hostile", "idempotencyKey": uuid4().hex}
    assert _post(other_client, f"/api/pilot/inventory/cost-verifications/{batch}/correct", body).status_code == 404
    assert other_client.get(f"/api/pilot/inventory/items/{sites.main_item}/cost-verifications", base_url=BASE).status_code == 404
    assert _evidence(sites, sites.main_item) == [(Decimal("6"), Decimal("0"), False)]
    assert _evidence(outsider, outsider.main_item) == []
