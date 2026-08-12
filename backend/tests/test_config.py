from __future__ import annotations

import pytest

from backend.app import create_app
from backend.config import ConfigurationError, choose_config, validate_runtime_config


def _clear_config_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in [
        "FLOWTALLY_ENV",
        "FLASK_ENV",
        "SECRET_KEY",
        "DATABASE_URL",
        "FLOWTALLY_ALLOWED_ORIGINS",
        "FLOWTALLY_FRONTEND_ORIGIN",
        "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF",
        "SESSION_COOKIE_SECURE",
        "FLOWTALLY_RATE_LIMIT_STORAGE_URI",
        "FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL",
        "SESSION_COOKIE_NAME",
        "SESSION_COOKIE_SAMESITE",
        "MAX_CONTENT_LENGTH",
        "WTF_CSRF_TIME_LIMIT",
        "GOOGLE_OIDC_ENABLED",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REDIRECT_URI",
        "SQUARE_ENABLED",
        "SQUARE_ENVIRONMENT",
        "SQUARE_APPLICATION_ID",
        "SQUARE_APPLICATION_SECRET",
        "SQUARE_REDIRECT_URI",
        "SQUARE_WEBHOOK_SIGNATURE_KEY",
        "INTEGRATION_ENCRYPTION_KEY",
    ]:
        monkeypatch.delenv(name, raising=False)


def test_development_defaults_are_easy_for_local_setup(monkeypatch: pytest.MonkeyPatch):
    _clear_config_env(monkeypatch)

    config = choose_config().build()

    assert config["FLOWTALLY_ENV"] == "development"
    assert config["SECRET_KEY"] == "flowtally-pilot-local-dev-secret"
    assert config["SQLALCHEMY_DATABASE_URI"].startswith("sqlite:///")
    assert config["SESSION_COOKIE_SECURE"] is False
    assert config["RATELIMIT_STORAGE_URI"] == "memory://"
    assert "http://127.0.0.1:5173" in config["ALLOWED_ORIGINS"]
    assert config["FLOWTALLY_FRONTEND_ORIGIN"] == "http://127.0.0.1:5173"
    assert config["FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF"] is False


@pytest.mark.parametrize(
    ("env", "message"),
    [
        (
            {
                "FLASK_ENV": "staging",
                "SECRET_KEY": "replace-me",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "FLOWTALLY_ENV must be set explicitly",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "sqlite:///tmp/pilot.db",
                "SECRET_KEY": "replace-with-a-long-random-staging-secret",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "SQLite is not allowed",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "SECRET_KEY": "replace-with-a-long-random-staging-secret",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "false",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "SESSION_COOKIE_SECURE must be true",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "SECRET_KEY": "replace-with-a-long-random-staging-secret",
                "FLOWTALLY_ALLOWED_ORIGINS": "*",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "explicit http or https origins only",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "SECRET_KEY": "replace-with-a-long-random-staging-secret",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            },
            "Rate-limit storage must not use memory://",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "SECRET_KEY": "short-secret",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "SECRET_KEY is too weak",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "SECRET_KEY": "a-very-long-explicit-staging-secret-key",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
            },
            "FLOWTALLY_FRONTEND_ORIGIN must be set",
        ),
    ],
)
def test_staging_and_production_startup_rejects_unsafe_settings(monkeypatch: pytest.MonkeyPatch, env: dict[str, str], message: str):
    _clear_config_env(monkeypatch)
    env = dict(env)
    explicit_mode = env.pop("FLOWTALLY_ENV", None)
    if explicit_mode is not None:
        monkeypatch.setenv("FLOWTALLY_ENV", explicit_mode)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ConfigurationError, match=message):
        choose_config().build()


def test_staging_config_builds_when_everything_is_explicit(monkeypatch: pytest.MonkeyPatch):
    _clear_config_env(monkeypatch)
    monkeypatch.setenv("FLOWTALLY_ENV", "staging")
    monkeypatch.setenv("SECRET_KEY", "a-very-long-explicit-staging-secret-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/flowtally")
    monkeypatch.setenv("FLOWTALLY_ALLOWED_ORIGINS", "https://staging.flowtally.ca")
    monkeypatch.setenv("FLOWTALLY_FRONTEND_ORIGIN", "https://staging.flowtally.ca")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "redis://example.invalid/0")

    config = choose_config().build()

    assert config["FLOWTALLY_ENV"] == "staging"
    assert config["SESSION_COOKIE_SECURE"] is True
    assert config["SQLALCHEMY_DATABASE_URI"].startswith("postgresql://")
    assert config["FLOWTALLY_FRONTEND_ORIGIN"] == "https://staging.flowtally.ca"


def test_create_app_rejects_unsafe_staging_startup(monkeypatch: pytest.MonkeyPatch):
    _clear_config_env(monkeypatch)
    monkeypatch.setenv("FLOWTALLY_ENV", "staging")
    monkeypatch.setenv("SECRET_KEY", "short-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/flowtally")
    monkeypatch.setenv("FLOWTALLY_ALLOWED_ORIGINS", "https://staging.flowtally.ca")
    monkeypatch.setenv("FLOWTALLY_FRONTEND_ORIGIN", "https://staging.flowtally.ca")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "redis://example.invalid/0")

    with pytest.raises(ConfigurationError, match="SECRET_KEY is too weak"):
        create_app()


def test_runtime_config_exposes_google_and_square_env(monkeypatch: pytest.MonkeyPatch):
    _clear_config_env(monkeypatch)
    monkeypatch.setenv("GOOGLE_OIDC_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "google-client")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-secret")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:5001/api/auth/google/callback")
    monkeypatch.setenv("FLOWTALLY_FRONTEND_ORIGIN", "http://127.0.0.1:5173")
    monkeypatch.setenv("SQUARE_ENABLED", "true")
    monkeypatch.setenv("SQUARE_ENVIRONMENT", "sandbox")
    monkeypatch.setenv("SQUARE_APPLICATION_ID", "square-app")
    monkeypatch.setenv("SQUARE_APPLICATION_SECRET", "square-secret")
    monkeypatch.setenv("SQUARE_REDIRECT_URI", "http://127.0.0.1:5001/api/integrations/square/callback")
    monkeypatch.setenv("SQUARE_WEBHOOK_SIGNATURE_KEY", "square-webhook-secret")
    monkeypatch.setenv("INTEGRATION_ENCRYPTION_KEY", "x" * 32)

    config = choose_config().build()

    assert config["GOOGLE_OIDC_ENABLED"] is True
    assert config["GOOGLE_CLIENT_ID"] == "google-client"
    assert config["GOOGLE_REDIRECT_URI"].endswith("/api/auth/google/callback")
    assert config["SQUARE_ENABLED"] is True
    assert config["SQUARE_ENVIRONMENT"] == "sandbox"
    assert config["SQUARE_APPLICATION_ID"] == "square-app"
    assert config["INTEGRATION_ENCRYPTION_KEY"] == "x" * 32


@pytest.mark.parametrize(
    ("env", "message"),
    [
        (
            {
                "FLOWTALLY_ENV": "staging",
                "SECRET_KEY": "a-very-long-explicit-staging-secret-key",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
                "GOOGLE_OIDC_ENABLED": "true",
                "GOOGLE_CLIENT_ID": "google-client",
            },
            "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required",
        ),
        (
            {
                "FLOWTALLY_ENV": "staging",
                "SECRET_KEY": "a-very-long-explicit-staging-secret-key",
                "DATABASE_URL": "postgresql://example.invalid/flowtally",
                "FLOWTALLY_ALLOWED_ORIGINS": "https://staging.flowtally.ca",
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": "true",
                "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example.invalid/0",
                "SQUARE_ENABLED": "true",
                "SQUARE_ENVIRONMENT": "sandbox",
                "SQUARE_APPLICATION_ID": "square-app",
                "SQUARE_APPLICATION_SECRET": "square-secret",
                "SQUARE_REDIRECT_URI": "http://127.0.0.1:5001/api/integrations/square/callback",
                "SQUARE_WEBHOOK_SIGNATURE_KEY": "square-webhook-secret",
            },
            "INTEGRATION_ENCRYPTION_KEY",
        ),
    ],
)
def test_enabled_google_and_square_features_fail_closed_without_required_secrets(monkeypatch: pytest.MonkeyPatch, env: dict[str, str], message: str):
    _clear_config_env(monkeypatch)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(ConfigurationError, match=message):
        validate_runtime_config(
            {
                "FLOWTALLY_ENV": "staging",
                "SECRET_KEY": "a-very-long-explicit-staging-secret-key",
                "SQLALCHEMY_DATABASE_URI": "postgresql://example.invalid/flowtally",
                "ALLOWED_ORIGINS": ["https://staging.flowtally.ca"],
                "FLOWTALLY_FRONTEND_ORIGIN": "https://staging.flowtally.ca",
                "SESSION_COOKIE_SECURE": True,
                "RATELIMIT_STORAGE_URI": "redis://example.invalid/0",
                "GOOGLE_OIDC_ENABLED": env.get("GOOGLE_OIDC_ENABLED") == "true",
                "SQUARE_ENABLED": env.get("SQUARE_ENABLED") == "true",
            },
            environment="staging",
        )
