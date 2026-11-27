"""Owner decision 2026-11-27: POS access is provider-neutral.

A Clover-only organization must reach its Clover endpoints without the
Square module, and enabling Square must not widen Clover access. Each
provider keeps its own tenant / role / allowlist enforcement.
"""
from __future__ import annotations

from cryptography.fernet import Fernet

from backend.extensions import db
from backend.models import CloverConnection, OrganizationModule, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def _login(client):
    token = client.get("/api/auth/csrf").get_json()["csrfToken"]
    assert client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": token}).status_code == 200


def _configure(app, allowed):
    app.config.update({
        "CLOVER_ENABLED": True, "CLOVER_ENVIRONMENT": "sandbox", "CLOVER_ALLOWED_ORGANIZATION_IDS": allowed,
        "CLOVER_CLIENT_ID": "c", "CLOVER_CLIENT_SECRET": "s", "CLOVER_REDIRECT_URI": "http://testserver/cb",
        "CLOVER_MAPPING_ENABLED": True, "INTEGRATION_ENCRYPTION_KEY": Fernet.generate_key().decode(),
    })


def test_clover_only_org_does_not_require_square_module(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        org = make_operational_organization(owner, name="Clover Only", location_name="Main")
        OrganizationModule.query.filter_by(organization_id=org.id, module_key="SQUARE_INTEGRATION").delete()
        db.session.add(CloverConnection(organization_id=org.id, environment="sandbox", merchant_id="m1", status="connected", access_token_ciphertext="x"))
        db.session.commit()
        _configure(app, [org.id])
        location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
        org_id, loc_id = org.id, location.id
    _login(client)
    status = client.get(f"/api/integrations/clover/status?organizationId={org_id}")
    assert status.status_code == 200 and status.get_json()["enabled"] is True
    assert client.get(f"/api/integrations/clover/mappings?organizationId={org_id}&locationId={loc_id}").status_code == 200


def test_square_module_does_not_widen_clover_access(app, client):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        org = make_operational_organization(owner, name="Square Only", location_name="Main")
        db.session.add(OrganizationModule(organization_id=org.id, module_key="SQUARE_INTEGRATION", status="ENABLED")) if not OrganizationModule.query.filter_by(organization_id=org.id, module_key="SQUARE_INTEGRATION").first() else None
        db.session.commit()
        _configure(app, [])  # not on the Clover allowlist
        location = RestaurantLocation.query.filter_by(organization_id=org.id).first()
        org_id, loc_id = org.id, location.id
    _login(client)
    assert client.get(f"/api/integrations/clover/status?organizationId={org_id}").get_json()["enabled"] is False
    assert client.get(f"/api/integrations/clover/mappings?organizationId={org_id}&locationId={loc_id}").status_code == 404
