from __future__ import annotations

from datetime import datetime, timezone

from backend.clover import clover_api_base, clover_authorize_url, parse_clover_timestamp
from backend.extensions import db
from backend.models import CloverConnection
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from cryptography.fernet import Fernet


def _login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post("/api/auth/login", json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD}, headers={"X-CSRFToken": csrf})
    assert response.status_code == 200
    return {"X-CSRFToken": csrf}


def _configure(app):
    app.config.update(
        CLOVER_ENABLED=True,
        CLOVER_ENVIRONMENT="sandbox",
        CLOVER_REGION="north_america",
        CLOVER_CLIENT_ID="clover-client",
        CLOVER_CLIENT_SECRET="clover-secret",
        CLOVER_REDIRECT_URI="http://testserver/api/integrations/clover/callback",
        CLOVER_ALLOWED_ORGANIZATION_IDS=[1],
        INTEGRATION_ENCRYPTION_KEY=Fernet.generate_key().decode("utf-8"),
    )


def test_sandbox_hosts_and_authorize_parameters(app):
    with app.app_context():
        app.config.update(CLOVER_ENABLED=True, CLOVER_ENVIRONMENT="sandbox", CLOVER_REGION="north_america")
        assert clover_api_base() == "https://apisandbox.dev.clover.com"
        url = clover_authorize_url(state="safe-state", client_id="client", redirect_uri="http://test/callback")
        assert url.startswith("https://sandbox.dev.clover.com/oauth/v2/authorize?")
        assert "client_id=client" in url and "state=safe-state" in url


def test_clover_expiration_timestamps_are_safe(app):
    with app.app_context():
        assert parse_clover_timestamp(0) == datetime(1970, 1, 1, tzinfo=timezone.utc)
        assert parse_clover_timestamp("not-a-timestamp") is None
        assert parse_clover_timestamp(None) is None


def test_clover_start_binds_state_to_user_and_organization(app, client):
    _configure(app)
    _login(client)
    response = client.get("/api/integrations/clover/start?organizationId=1")
    assert response.status_code == 302
    assert response.headers["Location"].startswith("https://sandbox.dev.clover.com/oauth/v2/authorize?")
    with client.session_transaction() as stored:
        context = stored["clover_oauth_context"]
        assert context["organization_id"] == 1
        assert context["user_id"] == 1
        assert context["state"]


def test_clover_merchant_launch_requires_explicit_authenticated_resume(app, client):
    _configure(app)
    launch = client.get("/api/integrations/clover/launch?merchant_id=merchant-1&client_id=clover-client")
    assert launch.status_code == 303
    assert "/app/login?redirectTo=/app/square?cloverLaunch=1" in launch.headers["Location"]
    with client.session_transaction() as stored:
        assert stored["clover_launch_context"]["merchant_id"] == "merchant-1"
    _login(client)
    missing_org = client.get("/api/integrations/clover/launch/resume")
    assert missing_org.status_code == 404
    continued = client.get("/api/integrations/clover/launch/resume?organizationId=1")
    assert continued.status_code == 302
    assert continued.headers["Location"].startswith("https://sandbox.dev.clover.com/oauth/v2/authorize?")
    assert "redirect_uri=http%3A%2F%2Ftestserver%2Fapi%2Fintegrations%2Fclover%2Fcallback" in continued.headers["Location"]
    with client.session_transaction() as stored:
        context = stored["clover_oauth_context"]
        assert context["organization_id"] == 1
        assert context["launch_merchant_id"] == "merchant-1"
        assert "clover_launch_context" not in stored


def test_clover_launch_rejects_unknown_client_or_missing_merchant(app, client):
    _configure(app)
    assert client.get("/api/integrations/clover/launch?merchant_id=merchant-1&client_id=other").status_code == 400
    assert client.get("/api/integrations/clover/launch?client_id=clover-client").status_code == 400


def test_clover_launch_resume_rejects_unrelated_organization(app, client):
    _configure(app)
    client.get("/api/integrations/clover/launch?merchant_id=merchant-1")
    _login(client)
    assert client.get("/api/integrations/clover/launch/resume?organizationId=999999").status_code == 404
    with client.session_transaction() as stored:
        assert stored["clover_launch_context"]["merchant_id"] == "merchant-1"


def test_clover_launch_callback_rejects_forged_merchant(app, client):
    _configure(app)
    _login(client)
    client.get("/api/integrations/clover/launch?merchant_id=merchant-1")
    client.get("/api/integrations/clover/launch/resume?organizationId=1")
    with client.session_transaction() as stored:
        state = stored["clover_oauth_context"]["state"]
    response = client.get(f"/api/integrations/clover/callback?state={state}&code=auth-code&merchant_id=forged&client_id=clover-client")
    assert response.status_code == 400


def test_clover_state_expires_and_cannot_be_replayed(app, client):
    _configure(app)
    _login(client)
    client.get("/api/integrations/clover/start?organizationId=1")
    with client.session_transaction() as stored:
        context = dict(stored["clover_oauth_context"])
        state = context["state"]
        context["expires_at"] = "2000-01-01T00:00:00+00:00"
        stored["clover_oauth_context"] = context
    expired = client.get(f"/api/integrations/clover/callback?state={state}&code=code&merchant_id=m&client_id=clover-client")
    assert expired.status_code == 400
    client.get("/api/integrations/clover/start?organizationId=1")
    with client.session_transaction() as stored:
        state = stored["clover_oauth_context"]["state"]
    with app.app_context():
        from backend.clover_integration import CloverConnection
        assert CloverConnection.query.count() == 0
    with client.session_transaction() as stored:
        stored.pop("clover_oauth_context", None)
    replay = client.get(f"/api/integrations/clover/callback?state={state}&code=code&merchant_id=m&client_id=clover-client")
    assert replay.status_code == 400


def test_clover_status_rejects_non_member_org(app, client):
    _configure(app)
    _login(client)
    response = client.get("/api/integrations/clover/status?organizationId=999999")
    assert response.status_code == 404


def test_clover_status_authorizes_before_allowlist_and_hides_nonallowlisted_state(app, client, monkeypatch):
    _configure(app)
    _login(client)

    # A caller without organization-management access gets the same denial
    # regardless of whether the organization is allowlisted.
    monkeypatch.setattr("backend.clover_integration._can_manage", lambda organization: False)
    app.config["CLOVER_ALLOWED_ORGANIZATION_IDS"] = [1]
    assert client.get("/api/integrations/clover/status?organizationId=1").status_code == 403
    app.config["CLOVER_ALLOWED_ORGANIZATION_IDS"] = []
    assert client.get("/api/integrations/clover/status?organizationId=1").status_code == 403

    # An authorized owner receives the frontend-safe disabled shape when the
    # organization is not allowlisted.
    monkeypatch.setattr("backend.clover_integration._can_manage", lambda organization: True)
    response = client.get("/api/integrations/clover/status?organizationId=1")
    assert response.status_code == 200
    assert response.get_json() == {"enabled": False, "connection": None}


def test_clover_callback_verifies_authoritative_merchant_and_encrypts_tokens(app, client, monkeypatch):
    _configure(app)
    _login(client)
    client.get("/api/integrations/clover/start?organizationId=1")
    with client.session_transaction() as stored:
        state = stored["clover_oauth_context"]["state"]
    calls = []
    def fake_request(method, path, **kwargs):
        calls.append((method, path))
        return {"access_token": "access", "refresh_token": "refresh", "access_token_expiration": 1999999999, "refresh_token_expiration": 2000000000} if path.endswith("/token") else {"id": "merchant-1", "name": "Sandbox Cafe"}
    monkeypatch.setattr("backend.clover_integration.clover_request", fake_request)
    response = client.get(f"/api/integrations/clover/callback?state={state}&code=auth-code&merchant_id=merchant-1&client_id=clover-client")
    assert response.status_code == 302
    with app.app_context():
        connection = CloverConnection.query.one()
        assert connection.status == "connected"
        assert connection.access_token_ciphertext != "access"
        assert connection.refresh_token_ciphertext != "refresh"
        assert connection.merchant_id == "merchant-1"
    assert calls == [("POST", "/oauth/v2/token"), ("GET", "/v3/merchants/merchant-1")]


def test_clover_callback_fails_closed_when_merchant_identity_is_missing(app, client, monkeypatch):
    _configure(app)
    _login(client)
    client.get("/api/integrations/clover/start?organizationId=1")
    with client.session_transaction() as stored:
        state = stored["clover_oauth_context"]["state"]
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda method, path, **kwargs: {"access_token": "access", "refresh_token": "refresh"} if path.endswith("/token") else {"name": "No id"})
    response = client.get(f"/api/integrations/clover/callback?state={state}&code=auth-code&merchant_id=merchant-1&client_id=clover-client")
    assert response.status_code == 502
    with app.app_context():
        assert CloverConnection.query.count() == 0


def test_clover_refresh_preserves_credentials_on_transient_failure_and_disconnects_safely(app, client, monkeypatch):
    _configure(app)
    _login(client)
    with app.app_context():
        connection = CloverConnection(organization_id=1, environment="sandbox", region="north_america", merchant_id="merchant-1", status="connected")
        from backend.square import encrypt_integration_secret
        connection.access_token_ciphertext = encrypt_integration_secret("old-access")
        connection.refresh_token_ciphertext = encrypt_integration_secret("old-refresh")
        db.session.add(connection)
        db.session.commit()
        old_ciphertext = connection.refresh_token_ciphertext
    from backend.clover import CloverRequestError
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda *args, **kwargs: (_ for _ in ()).throw(CloverRequestError("timeout", status_code=503, code="clover_unavailable")))
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post("/api/integrations/clover/refresh", json={"organizationId": 1}, headers={"X-CSRFToken": csrf})
    assert response.status_code == 503
    with app.app_context():
        assert CloverConnection.query.one().refresh_token_ciphertext == old_ciphertext
    monkeypatch.setattr("backend.clover_integration.clover_request", lambda *args, **kwargs: {"access_token": "new-access", "refresh_token": "new-refresh"})
    response = client.post("/api/integrations/clover/disconnect", json={"organizationId": 1}, headers={"X-CSRFToken": csrf})
    assert response.status_code == 200
    assert response.get_json()["remoteRevocation"] == "not_supported"


def test_clover_allowlist_blocks_other_organizations_and_does_not_disclose_connections(app, client):
    _configure(app)
    _login(client)
    app.config["CLOVER_ALLOWED_ORGANIZATION_IDS"] = []
    assert client.get("/api/integrations/clover/start?organizationId=1").status_code == 404
    assert client.get("/api/integrations/clover/status?organizationId=1").get_json() == {"enabled": False, "connection": None}

    app.config["CLOVER_ALLOWED_ORGANIZATION_IDS"] = [999]
    assert client.get("/api/integrations/clover/start?organizationId=1").status_code == 404
    assert client.get("/api/integrations/clover/status?organizationId=1").get_json() == {"enabled": False, "connection": None}


def test_clover_merchant_launch_is_closed_when_production_allowlist_is_empty(app, client):
    _configure(app)
    app.config.update(FLOWTALLY_ENV="production", CLOVER_ALLOWED_ORGANIZATION_IDS=[])
    response = client.get("/api/integrations/clover/launch?merchant_id=merchant-1&client_id=clover-client")
    assert response.status_code == 404


def test_clover_production_configuration_keeps_sandbox_api_host(app):
    _configure(app)
    app.config.update(FLOWTALLY_ENV="production", CLOVER_ALLOWED_ORGANIZATION_IDS=[1])
    with app.app_context():
        assert clover_api_base() == "https://apisandbox.dev.clover.com"
