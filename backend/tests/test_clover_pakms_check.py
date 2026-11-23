from __future__ import annotations

import io
import json
from urllib.error import HTTPError

import pytest

from backend.clover import CLOVER_SANDBOX_PAKMS_URL, clover_sandbox_pakms_probe
from backend.extensions import db
from backend.models import AuditEvent, CloverConnection, Organization, OrganizationMembership, User
from backend.clover import CloverRequestError
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_MANAGER_PASSWORD, LOCAL_OWNER_EMAIL
from backend.square import SquareSecurityError, decrypt_integration_secret, encrypt_integration_secret
from datetime import datetime, timedelta, timezone
from backend.tests.conftest import make_operational_organization
from backend.tests.test_clover_shadow_orders import _login

SECRET_KEY = "af4e-secret-pakms-key"
URL = "/api/integrations/clover/pakms-check?organizationId={}"
FORBIDDEN_STRINGS = ("tok-access", SECRET_KEY, "enc-ciphertext", "refresh-old", "refresh-new", "access-new")


def _assert_no_secrets(text):
    for secret in FORBIDDEN_STRINGS:
        assert secret not in text


def _login_manager(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post("/api/auth/login", json={"email": LOCAL_MANAGER_EMAIL, "password": LOCAL_MANAGER_PASSWORD}, headers={"X-CSRFToken": csrf})
    assert response.status_code == 200


def _probe_spy(monkeypatch, result=None):
    calls = []

    def probe(token):
        calls.append(token)
        return result or {"httpStatus": 200, "active": True, "merchantUuid": "V7SXJVSGY5051", "developerAppUuidPresent": True}

    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", probe)
    return calls


def _audit_count():
    return AuditEvent.query.filter(AuditEvent.event_type.like("clover.pakms.%")).count()


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
        db.session.add(CloverConnection(organization_id=org.id, environment=environment, merchant_id="V7SXJVSGY5051", status="connected", access_token_ciphertext="enc-ciphertext"))
        db.session.commit()
        org_id = org.id
    monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", lambda _: "tok-access")
    return org_id


def test_endpoint_verified_never_leaks_key_and_audits(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", lambda token: {"httpStatus": 200, "active": True, "merchantUuid": "V7SXJVSGY5051", "developerAppUuidPresent": True})
    _login(client)
    response = client.get(f"/api/integrations/clover/pakms-check?organizationId={org_id}")
    assert response.status_code == 200
    body = response.get_json()
    assert body["verified"] is True and body["merchantIdMatches"] is True and body["httpStatus"] == 200
    _assert_no_secrets(response.get_data(as_text=True))
    assert body["providerReadOnly"] is True and "readOnly" not in body
    with app.app_context():
        events = AuditEvent.query.filter_by(event_type="clover.pakms.checked").all()
        assert len(events) == 1
        _assert_no_secrets(json.dumps(events[0].metadata_json if hasattr(events[0], "metadata_json") else str(events[0].__dict__)))


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


def test_manager_denied_without_probe_or_audit(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    with app.app_context():
        manager = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        db.session.add(OrganizationMembership(user=manager, organization_id=org_id, role="manager"))
        db.session.commit()
    calls = _probe_spy(monkeypatch)
    _login_manager(client)
    assert client.get(URL.format(org_id)).status_code == 403
    with app.app_context():
        assert _audit_count() == 0
    assert calls == []


def test_non_member_staff_user_denied_without_probe_or_audit(app, client, monkeypatch):
    # The schema only allows owner/manager memberships; staff-level users have none.
    org_id = _setup(app, monkeypatch)
    with app.app_context():
        manager = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        OrganizationMembership.query.filter_by(user_id=manager.id, organization_id=org_id).delete()
        db.session.commit()
    calls = _probe_spy(monkeypatch)
    _login_manager(client)
    assert client.get(URL.format(org_id)).status_code == 403
    with app.app_context():
        assert _audit_count() == 0
    assert calls == []


def test_owner_of_other_org_cannot_check_this_org(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    with app.app_context():
        manager = User.query.filter_by(email=LOCAL_MANAGER_EMAIL).first()
        other = make_operational_organization(manager, name="Other Owner Org", location_name="Elsewhere")
        db.session.commit()
        other_id = other.id
    calls = _probe_spy(monkeypatch)
    _login_manager(client)
    # Owner of a different organization: forbidden on the target org, and a
    # non-allowlisted own org is unavailable rather than probing anything.
    assert client.get(URL.format(org_id)).status_code == 403
    assert client.get(URL.format(other_id)).status_code == 404
    with app.app_context():
        assert _audit_count() == 0
    assert calls == []


def test_non_allowlisted_org_returns_404_without_probe_or_audit(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["CLOVER_ALLOWED_ORGANIZATION_IDS"] = [org_id + 999]
    calls = _probe_spy(monkeypatch)
    _login(client)
    assert client.get(URL.format(org_id)).status_code == 404
    with app.app_context():
        assert _audit_count() == 0
    assert calls == []


def test_unknown_org_and_missing_org_id_return_404(app, client, monkeypatch):
    _setup(app, monkeypatch)
    calls = _probe_spy(monkeypatch)
    _login(client)
    assert client.get(URL.format(999999)).status_code == 404
    assert client.get("/api/integrations/clover/pakms-check").status_code == 404
    assert calls == []


def test_global_non_sandbox_environment_blocks_probe(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["CLOVER_ENVIRONMENT"] = "production"
    calls = _probe_spy(monkeypatch)
    _login(client)
    assert client.get(URL.format(org_id)).status_code == 409
    assert calls == []


def test_tenant_context_applied_for_authorized_call(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    seen = []
    monkeypatch.setattr("backend.clover_integration.apply_org_tenant_context", lambda organization, **kw: seen.append((organization.id, kw)))
    _probe_spy(monkeypatch)
    _login(client)
    assert client.get(URL.format(org_id)).status_code == 200
    assert seen and seen[0][0] == org_id


def _seed_refreshable(app, org_id, *, expired=False):
    with app.app_context():
        connection = CloverConnection.query.filter_by(organization_id=org_id).one()
        connection.access_token_ciphertext = encrypt_integration_secret("tok-access")
        connection.refresh_token_ciphertext = encrypt_integration_secret("refresh-old")
        connection.access_expires_at = datetime.now(timezone.utc) + (timedelta(minutes=-5) if expired else timedelta(hours=1))
        db.session.commit()


def _real_decrypt(monkeypatch):
    monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", decrypt_integration_secret)


def test_stale_token_refreshes_before_probe(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["INTEGRATION_ENCRYPTION_KEY"] = __import__("cryptography.fernet", fromlist=["Fernet"]).Fernet.generate_key().decode()
    _real_decrypt(monkeypatch)
    _seed_refreshable(app, org_id, expired=True)
    refreshes = []
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda method, path, **kw: refreshes.append(path) or {"access_token": "access-new", "refresh_token": "refresh-new", "access_token_expiration": 4102444800, "refresh_token_expiration": 4102444800})
    calls = _probe_spy(monkeypatch)
    _login(client)
    response = client.get(URL.format(org_id))
    assert response.status_code == 200
    assert refreshes == ["/oauth/v2/refresh"] and calls == ["access-new"]
    _assert_no_secrets(response.get_data(as_text=True))
    with app.app_context():
        assert decrypt_integration_secret(CloverConnection.query.one().refresh_token_ciphertext) == "refresh-new"


def test_pakms_401_forces_one_refresh_and_retries(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["INTEGRATION_ENCRYPTION_KEY"] = __import__("cryptography.fernet", fromlist=["Fernet"]).Fernet.generate_key().decode()
    _real_decrypt(monkeypatch)
    _seed_refreshable(app, org_id)
    refreshes = []
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda method, path, **kw: refreshes.append(path) or {"access_token": "access-new", "refresh_token": "refresh-new", "access_token_expiration": 4102444800, "refresh_token_expiration": 4102444800})
    calls = []

    def probe(token):
        calls.append(token)
        if len(calls) == 1:
            return {"httpStatus": 401, "active": None, "merchantUuid": None, "developerAppUuidPresent": False}
        return {"httpStatus": 200, "active": True, "merchantUuid": "V7SXJVSGY5051", "developerAppUuidPresent": True}

    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", probe)
    _login(client)
    response = client.get(URL.format(org_id))
    assert response.status_code == 200 and response.get_json()["verified"] is True
    assert calls == ["tok-access", "access-new"] and refreshes == ["/oauth/v2/refresh"]
    _assert_no_secrets(response.get_data(as_text=True))


def test_pakms_persistent_401_refreshes_once_and_reports_unauthorized(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["INTEGRATION_ENCRYPTION_KEY"] = __import__("cryptography.fernet", fromlist=["Fernet"]).Fernet.generate_key().decode()
    _real_decrypt(monkeypatch)
    _seed_refreshable(app, org_id)
    refreshes = []
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda method, path, **kw: refreshes.append(path) or {"access_token": "access-new", "refresh_token": "refresh-new", "access_token_expiration": 4102444800, "refresh_token_expiration": 4102444800})
    calls = _probe_spy(monkeypatch, {"httpStatus": 401, "active": None, "merchantUuid": None, "developerAppUuidPresent": False})
    _login(client)
    body = client.get(URL.format(org_id)).get_json()
    assert body["verified"] is False and body["errorCode"] == "clover_unauthorized"
    assert len(calls) == 2 and len(refreshes) == 1


def test_refresh_failure_returns_409_audits_failure_and_leaks_nothing(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)
    app.config["INTEGRATION_ENCRYPTION_KEY"] = __import__("cryptography.fernet", fromlist=["Fernet"]).Fernet.generate_key().decode()
    _real_decrypt(monkeypatch)
    _seed_refreshable(app, org_id)
    _probe_spy(monkeypatch, {"httpStatus": 401, "active": None, "merchantUuid": None, "developerAppUuidPresent": False})

    def reject(method, path, **kw):
        raise CloverRequestError("rejected", status_code=400, code="clover_request_rejected")

    monkeypatch.setattr("backend.clover_integration.clover_request", reject)
    _login(client)
    response = client.get(URL.format(org_id))
    assert response.status_code in {409, 503}
    _assert_no_secrets(response.get_data(as_text=True))
    with app.app_context():
        failed = AuditEvent.query.filter_by(event_type="clover.pakms.check_failed").all()
        assert len(failed) == 1
        assert AuditEvent.query.filter_by(event_type="clover.pakms.checked").count() == 0
        _assert_no_secrets(json.dumps(failed[0].metadata_json if hasattr(failed[0], "metadata_json") else str(failed[0].__dict__)))


def test_probe_network_failure_maps_to_503_and_is_audited(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)

    def boom(token):
        raise CloverRequestError("down", code="clover_unavailable")

    monkeypatch.setattr("backend.clover_integration.clover_sandbox_pakms_probe", boom)
    _login(client)
    response = client.get(URL.format(org_id))
    assert response.status_code == 503 and response.get_json()["code"] == "clover_unavailable"
    _assert_no_secrets(response.get_data(as_text=True))
    with app.app_context():
        assert AuditEvent.query.filter_by(event_type="clover.pakms.check_failed").count() == 1


def test_unreadable_credentials_map_to_502(app, client, monkeypatch):
    org_id = _setup(app, monkeypatch)

    def unreadable(_):
        raise SquareSecurityError("bad key")

    monkeypatch.setattr("backend.clover_integration.decrypt_integration_secret", unreadable)
    calls = _probe_spy(monkeypatch)
    _login(client)
    response = client.get(URL.format(org_id))
    assert response.status_code == 502 and calls == []
    _assert_no_secrets(response.get_data(as_text=True))


def test_probe_urlerror_is_sanitized():
    from urllib.error import URLError

    def opener(request, timeout):
        raise URLError("connection refused tok-access")

    with pytest.raises(CloverRequestError) as info:
        clover_sandbox_pakms_probe("tok-access", opener=opener)
    assert info.value.code == "clover_unavailable" and "tok-access" not in str(info.value)
