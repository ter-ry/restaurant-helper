from __future__ import annotations

import io
import json
from urllib.error import HTTPError

import pytest

from backend.clover import CLOVER_SANDBOX_PAKMS_URL, clover_sandbox_pakms_probe
from backend.extensions import db
from backend.models import AuditEvent, CloverConnection, RestaurantLocation, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_clover_shadow_orders import _login

SECRET_KEY = "af4e-secret-pakms-key"


class _Resp:
    def __init__(self, body, status=200):
        self.body, self.status = json.dumps(body).encode(), status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.body


def test_probe_is_fixed_sandbox_get_and_drops_key():
    seen = {}

    def opener(request, timeout):
        seen["url"], seen["method"], seen["auth"] = request.full_url, request.get_method(), request.get_header("Authorization")
        return _Resp({"active": True, "apiAccessKey": SECRET_KEY, "merchantUuid": "M1", "developerAppUuid": "D1"})

    result = clover_sandbox_pakms_probe("tok", opener=opener)
    assert seen == {"url": CLOVER_SANDBOX_PAKMS_URL, "method": "GET", "auth": "Bearer tok"}
    assert result == {"httpStatus": 200, "active": True, "merchantUuid": "M1", "developerAppUuidPresent": True}
    assert SECRET_KEY not in json.dumps(result)


@pytest.mark.parametrize("code", [401, 403, 500])
def test_probe_reports_http_errors_without_raising(code):
    def opener(request, timeout):
        raise HTTPError(request.full_url, code, "x", {}, io.BytesIO(b"{}"))

    assert clover_sandbox_pakms_probe("tok", opener=opener)["httpStatus"] == code


def _setup(app, monkeypatch, *, environment="sandbox"):
    with app.app_context():
        owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
        org = make_operational_organization(owner, name="Pakms Org", location_name="Main")
        app.config.update(CLOVER_ENABLED=True, CLOVER_ENVIRONMENT="sandbox", CLOVER_ALLOWED_ORGANIZATION_IDS=[org.id], CLOVER_CLIENT_ID="c", CLOVER_CLIENT_SECRET="s")
        db.session.add(CloverConnection(organization_id=org.id, environment=environment, merchant_id="V7SXJVSGY5051", status="connected", access_token_ciphertext="enc"))
        db.session.commit()
        org_id = org.id
    monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "tok")
    return org_id


def test_endpoint_verified_never_leaks_key_and_audits(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", lambda token: {"httpStatus": 200, "active": True, "merchantUuid": "V7SXJVSGY5051", "developerAppUuidPresent": True})
    _login(client)
    response = client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}")
    assert response.status_code == 200
    body = response.get_json()
    assert body["verified"] is True and body["merchantIdMatches"] is True and body["httpStatus"] == 200
    assert "tok" not in response.get_data(as_text=True).replace("token", "")
    with app.app_context():
        assert AuditEvent.query.filter_by(event_type="clover.pakms.checked").count() == 1


def test_endpoint_403_and_merchant_mismatch_are_not_verified(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    _login(client)
    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", lambda token: {"httpStatus": 403, "active": None, "merchantUuid": None, "developerAppUuidPresent": False})
    body = client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}").get_json()
    assert body["verified"] is False and body["errorCode"] == "clover_forbidden"
    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", lambda token: {"httpStatus": 200, "active": True, "merchantUuid": "OTHER", "developerAppUuidPresent": True})
    body = client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}").get_json()
    assert body["verified"] is False and body["merchantIdMatches"] is False


def test_endpoint_requires_auth_and_sandbox_connection(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch, environment="production")
    assert client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}").status_code in {401, 403}
    _login(client)
    assert client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}").status_code == 409
