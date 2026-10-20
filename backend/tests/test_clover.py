from __future__ import annotations

from datetime import datetime, timezone

from backend.clover import clover_api_base, clover_authorize_url, parse_clover_timestamp


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
