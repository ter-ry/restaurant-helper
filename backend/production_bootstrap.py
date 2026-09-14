from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from .config import ConfigurationError, database_name_from_url, validate_production_database_targets


@dataclass(frozen=True)
class ProductionTargets:
    runtime_url: str
    migration_url: str
    runtime_name: str
    migration_name: str
    expected_name: str


def production_targets_from_environment() -> ProductionTargets:
    runtime_url = os.environ.get("DATABASE_URL", "").strip()
    migration_url = os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL", "").strip()
    if not runtime_url or not migration_url:
        raise ConfigurationError("DATABASE_URL and FLOWTALLY_MIGRATION_DATABASE_URL are required.")
    validate_production_database_targets(runtime_url, migration_url)
    expected = os.environ.get("FLOWTALLY_PRODUCTION_DATABASE_NAME", "flowtally_prod").strip() or "flowtally_prod"
    return ProductionTargets(runtime_url, migration_url, database_name_from_url(runtime_url), database_name_from_url(migration_url), expected)


def validate_preflight_environment() -> list[tuple[str, bool, str]]:
    checks: list[tuple[str, bool, str]] = []
    mode = os.environ.get("FLOWTALLY_ENV", "").strip().lower()
    checks.append(("FLOWTALLY_ENV=production", mode == "production", mode or "missing"))
    frontend = os.environ.get("FLOWTALLY_FRONTEND_ORIGIN", "").strip().rstrip("/")
    checks.append(("HTTPS frontend origin", frontend == "https://app.flowtally.ca", frontend or "missing"))
    google = os.environ.get("GOOGLE_REDIRECT_URI", "").strip()
    google_enabled = os.environ.get("GOOGLE_OIDC_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    checks.append(("Google OIDC enabled", google_enabled, "enabled" if google_enabled else "disabled"))
    checks.append(("Google production callback", google_enabled and google == "https://api.flowtally.ca/api/auth/google/callback", "configured" if google else "missing"))
    checks.append(("Secure session cookie", os.environ.get("SESSION_COOKIE_SECURE", "").strip().lower() == "true", "enabled" if os.environ.get("SESSION_COOKIE_SECURE") else "missing"))
    checks.append(("Split-origin CSRF", os.environ.get("FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF", "").strip().lower() == "true", "enabled" if os.environ.get("FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF") else "missing"))
    checks.append(("Demo mode disabled", os.environ.get("FLOWTALLY_DEMO_READ_ONLY", "false").strip().lower() not in {"1", "true", "yes", "on"}, "disabled"))
    secret = os.environ.get("SECRET_KEY", "").strip()
    checks.append(("Strong SECRET_KEY", len(secret) >= 32 and secret not in {"change-me", "development", "flowtally-pilot-local-dev-secret"}, "configured" if secret else "missing"))
    fernet = os.environ.get("INTEGRATION_ENCRYPTION_KEY", "").strip()
    checks.append(("Fernet key when Square enabled", (os.environ.get("SQUARE_ENABLED", "false").lower() not in {"1", "true", "yes", "on"}) or len(fernet) >= 32, "configured" if fernet else "not required while Square disabled"))
    rate_store = os.environ.get("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "").strip()
    checks.append(("External rate-limit store", bool(rate_store) and not rate_store.startswith("memory://"), "configured" if rate_store else "missing"))
    if runtime := os.environ.get("DATABASE_URL", "").strip():
        migration = os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL", "").strip()
        try:
            validate_production_database_targets(runtime, migration)
            checks.append(("Separate shared-server production database", True, database_name_from_url(runtime)))
        except ConfigurationError as exc:
            checks.append(("Separate shared-server production database", False, str(exc)))
    else:
        checks.append(("Separate shared-server production database", False, "DATABASE_URL missing"))
    return checks


def safe_host_label(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or "unknown"
