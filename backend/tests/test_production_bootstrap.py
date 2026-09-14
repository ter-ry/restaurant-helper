from __future__ import annotations

from backend.production_bootstrap import validate_preflight_environment


def test_preflight_accepts_shared_host_separate_database_and_square_disabled(monkeypatch):
    values = {
        "FLOWTALLY_ENV": "production",
        "DATABASE_URL": "postgresql://runtime@example/flowtally_prod",
        "FLOWTALLY_MIGRATION_DATABASE_URL": "postgresql://migrator@example/flowtally_prod",
        "FLOWTALLY_FRONTEND_ORIGIN": "https://app.flowtally.ca",
        "SESSION_COOKIE_SECURE": "true",
        "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF": "true",
        "SECRET_KEY": "x" * 64,
        "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "redis://example/0",
        "GOOGLE_OIDC_ENABLED": "true",
        "GOOGLE_REDIRECT_URI": "https://api.flowtally.ca/api/auth/google/callback",
        "SQUARE_ENABLED": "false",
        "FLOWTALLY_DEMO_READ_ONLY": "false",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)

    checks = dict((label, passed) for label, passed, _ in validate_preflight_environment())
    assert checks["FLOWTALLY_ENV=production"] is True
    assert checks["Separate shared-server production database"] is True
    assert checks["Google OIDC enabled"] is True
    assert checks["Fernet key when Square enabled"] is True


def test_preflight_rejects_defaultdb(monkeypatch):
    monkeypatch.setenv("FLOWTALLY_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql://runtime@example/defaultdb")
    monkeypatch.setenv("FLOWTALLY_MIGRATION_DATABASE_URL", "postgresql://migrator@example/flowtally_prod")
    checks = dict((label, passed) for label, passed, _ in validate_preflight_environment())
    assert checks["Separate shared-server production database"] is False
