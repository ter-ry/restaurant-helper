from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
DEFAULT_ALLOWED_ORIGINS = {
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://localhost:5173",
    "https://flowtally.ca",
    "https://www.flowtally.ca",
}
DEFAULT_DEVELOPMENT_SECRET = "flowtally-pilot-local-dev-secret"
PROD_LIKE_MODES = {"staging", "production"}
VALID_MODES = {"development", "testing", "staging", "production"}
WEAK_SECRETS = {
    DEFAULT_DEVELOPMENT_SECRET,
    "change-me",
    "change-me-in-local-dev",
    "dev",
    "development",
    "password",
    "secret",
    "test",
}


class ConfigurationError(RuntimeError):
    """Raised when the application is asked to start with unsafe settings."""


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_mode() -> tuple[str, bool]:
    explicit = os.environ.get("FLOWTALLY_ENV", "").strip().lower()
    if explicit:
        if explicit in {"dev"}:
            return "development", True
        if explicit in {"test"}:
            return "testing", True
        if explicit in VALID_MODES:
            return explicit, True
        raise ConfigurationError("FLOWTALLY_ENV must be one of development, testing, staging, or production.")

    legacy = os.environ.get("FLASK_ENV", "").strip().lower()
    if legacy:
        if legacy in {"dev"}:
            return "development", False
        if legacy in {"test"}:
            return "testing", False
        if legacy in VALID_MODES:
            return legacy, False
        raise ConfigurationError("FLASK_ENV contains an unsupported value. Use FLOWTALLY_ENV instead.")

    return "development", False


def _database_uri(mode: str) -> str:
    configured = os.environ.get("DATABASE_URL", "").strip()
    if configured:
        if configured.startswith("postgres://"):
            configured = "postgresql://" + configured.removeprefix("postgres://")
        if mode in PROD_LIKE_MODES and configured.startswith("sqlite:"):
            if not _env_bool("FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL", False):
                raise ConfigurationError(
                    "SQLite is not allowed in staging or production unless FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL is enabled."
                )
        return configured

    if mode in PROD_LIKE_MODES:
        raise ConfigurationError("DATABASE_URL must be set in staging and production.")

    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(INSTANCE_DIR / 'flowtally_pilot.db').resolve().as_posix()}"


def _allowed_origins(mode: str) -> list[str]:
    configured = os.environ.get("FLOWTALLY_ALLOWED_ORIGINS", "").strip()
    if not configured:
        if mode in PROD_LIKE_MODES:
            raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must be set in staging and production.")
        return sorted(DEFAULT_ALLOWED_ORIGINS)

    origins: list[str] = []
    for raw_origin in configured.split(","):
        origin = raw_origin.strip()
        if not origin:
            continue
        parsed = urlparse(origin)
        if "*" in origin or parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must contain explicit http or https origins only.")
        if mode in PROD_LIKE_MODES and parsed.scheme != "https":
            raise ConfigurationError("Staging and production CORS origins must use https.")
        origins.append(origin)

    unique_origins = list(dict.fromkeys(origins))
    if not unique_origins:
        raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must contain at least one origin.")
    return unique_origins


def _frontend_origin(mode: str) -> str:
    configured = os.environ.get("FLOWTALLY_FRONTEND_ORIGIN", "").strip()
    if not configured:
        if mode in PROD_LIKE_MODES:
            raise ConfigurationError("FLOWTALLY_FRONTEND_ORIGIN must be set in staging and production.")
        return "http://127.0.0.1:5173"

    parsed = urlparse(configured)
    if "*" in configured or parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigurationError("FLOWTALLY_FRONTEND_ORIGIN must contain an explicit http or https origin only.")
    if mode in PROD_LIKE_MODES and parsed.scheme != "https":
        raise ConfigurationError("Staging and production frontend origins must use https.")
    return configured.rstrip("/")


def _secret_key(mode: str) -> str:
    configured = os.environ.get("SECRET_KEY", "").strip()
    if configured:
        if mode in PROD_LIKE_MODES and (len(configured) < 32 or configured in WEAK_SECRETS):
            raise ConfigurationError("SECRET_KEY is too weak for staging or production.")
        return configured

    if mode in PROD_LIKE_MODES:
        raise ConfigurationError("SECRET_KEY must be set in staging and production.")

    return DEFAULT_DEVELOPMENT_SECRET


def _session_cookie_secure(mode: str) -> bool:
    configured = os.environ.get("SESSION_COOKIE_SECURE")
    if mode in PROD_LIKE_MODES:
        if configured is None:
            raise ConfigurationError("SESSION_COOKIE_SECURE must be set to true in staging and production.")
        if not _env_bool("SESSION_COOKIE_SECURE", False):
            raise ConfigurationError("SESSION_COOKIE_SECURE must be true in staging and production.")
        return True
    return _env_bool("SESSION_COOKIE_SECURE", False)


def _rate_limit_storage_uri(mode: str) -> str:
    configured = os.environ.get("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "").strip()
    if configured:
        if mode in PROD_LIKE_MODES and configured.startswith("memory://") and not _demo_memory_rate_limit_allowed(mode):
            raise ConfigurationError("Rate-limit storage must not use memory:// in staging or production.")
        return configured

    if mode in PROD_LIKE_MODES:
        raise ConfigurationError("FLOWTALLY_RATE_LIMIT_STORAGE_URI must be set in staging and production.")

    return "memory://"


def _database_engine_options(mode: str) -> dict[str, Any]:
    options: dict[str, Any] = {"pool_pre_ping": True}
    if mode not in PROD_LIKE_MODES:
        return options
    pool_size = int(os.environ.get("FLOWTALLY_DB_POOL_SIZE", "4"))
    max_overflow = int(os.environ.get("FLOWTALLY_DB_MAX_OVERFLOW", "2"))
    if pool_size < 1 or max_overflow < 0:
        raise ConfigurationError("FLOWTALLY_DB_POOL_SIZE must be positive and FLOWTALLY_DB_MAX_OVERFLOW cannot be negative.")
    options["pool_size"] = pool_size
    options["max_overflow"] = max_overflow
    return options


def database_name_from_url(value: str) -> str:
    """Return the logical database name without exposing any URL credentials."""
    parsed = urlparse(value.strip())
    return (parsed.path or "").lstrip("/").split("?", 1)[0]


def _demo_memory_rate_limit_allowed(mode: str, database_url: str | None = None) -> bool:
    """Allow memory-backed limits only for an explicitly isolated demo database."""
    if mode != "staging":
        return False
    if not _env_bool("FLOWTALLY_DEMO_READ_ONLY", False) or not _env_bool("FLOWTALLY_DEMO_ISOLATED", False):
        return False
    expected = os.environ.get("FLOWTALLY_DEMO_DATABASE_NAME", "").strip()
    targeted = database_name_from_url(database_url or os.environ.get("DATABASE_URL", ""))
    return bool(expected and targeted == expected and expected not in {"defaultdb", "flowtally_prod"})


def validate_production_database_targets(runtime_url: str, migration_url: str) -> None:
    expected = os.environ.get("FLOWTALLY_PRODUCTION_DATABASE_NAME", "flowtally_prod").strip() or "flowtally_prod"
    runtime_name = database_name_from_url(runtime_url)
    migration_name = database_name_from_url(migration_url)
    if not runtime_name or not migration_name:
        raise ConfigurationError("Production DATABASE_URL and FLOWTALLY_MIGRATION_DATABASE_URL must include a database name.")
    if runtime_name == "defaultdb" or migration_name == "defaultdb":
        raise ConfigurationError("Production database connections must not target staging database defaultdb.")
    if runtime_name != expected or migration_name != expected:
        raise ConfigurationError(f"Production database connections must target {expected}.")
    if runtime_name != migration_name:
        raise ConfigurationError("Production runtime and migration URLs must target the same database.")


class BaseConfig:
    mode = "development"

    @classmethod
    def build(cls) -> dict[str, Any]:
        config_mode, mode_is_explicit = _env_mode()
        if config_mode != cls.mode:
            raise ConfigurationError(f"Configuration mode {config_mode!r} does not match {cls.__name__}.")
        if cls.mode in PROD_LIKE_MODES and not mode_is_explicit:
            raise ConfigurationError("FLOWTALLY_ENV must be set explicitly for staging and production.")

        config = {
            "FLOWTALLY_ENV": cls.mode,
            "SECRET_KEY": _secret_key(cls.mode),
            "SQLALCHEMY_DATABASE_URI": _database_uri(cls.mode),
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "FLOWTALLY_PERFORMANCE_DIAGNOSTICS": _env_bool("FLOWTALLY_PERFORMANCE_DIAGNOSTICS", False),
            "SQLALCHEMY_ENGINE_OPTIONS": _database_engine_options(cls.mode),
            "JSON_SORT_KEYS": False,
            "SESSION_COOKIE_NAME": os.environ.get("SESSION_COOKIE_NAME", "flowtally_pilot_session"),
            "SESSION_COOKIE_HTTPONLY": True,
            "SESSION_COOKIE_SECURE": _session_cookie_secure(cls.mode),
            "SESSION_COOKIE_SAMESITE": os.environ.get("SESSION_COOKIE_SAMESITE", "Lax"),
            "WTF_CSRF_HEADERS": ["X-CSRFToken", "X-CSRF-Token"],
            "WTF_CSRF_TIME_LIMIT": int(os.environ.get("WTF_CSRF_TIME_LIMIT", "3600")),
            "MAX_CONTENT_LENGTH": int(os.environ.get("MAX_CONTENT_LENGTH", str(15 * 1024 * 1024))),
            "RATELIMIT_DEFAULT": "200 per hour",
            "RATELIMIT_STORAGE_URI": _rate_limit_storage_uri(cls.mode),
            "ALLOWED_ORIGINS": _allowed_origins(cls.mode),
            "FLOWTALLY_FRONTEND_ORIGIN": _frontend_origin(cls.mode),
            "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF": _env_bool(
                "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF", cls.mode in PROD_LIKE_MODES
            ),
            "WTF_CSRF_SSL_STRICT": not _env_bool(
                "FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF", cls.mode in PROD_LIKE_MODES
            ),
            "GOOGLE_OIDC_ENABLED": _env_bool("GOOGLE_OIDC_ENABLED", False),
            "GOOGLE_CLIENT_ID": os.environ.get("GOOGLE_CLIENT_ID", "").strip(),
            "GOOGLE_CLIENT_SECRET": os.environ.get("GOOGLE_CLIENT_SECRET", "").strip(),
            "GOOGLE_REDIRECT_URI": os.environ.get("GOOGLE_REDIRECT_URI", "").strip(),
            "SQUARE_ENABLED": _env_bool("SQUARE_ENABLED", False),
            "SQUARE_ENVIRONMENT": os.environ.get("SQUARE_ENVIRONMENT", "sandbox").strip().lower() or "sandbox",
            "SQUARE_APPLICATION_ID": os.environ.get("SQUARE_APPLICATION_ID", "").strip(),
            "SQUARE_APPLICATION_SECRET": os.environ.get("SQUARE_APPLICATION_SECRET", "").strip(),
            "SQUARE_REDIRECT_URI": os.environ.get("SQUARE_REDIRECT_URI", "").strip(),
            "SQUARE_WEBHOOK_SIGNATURE_KEY": os.environ.get("SQUARE_WEBHOOK_SIGNATURE_KEY", "").strip(),
            "INTEGRATION_ENCRYPTION_KEY": os.environ.get("INTEGRATION_ENCRYPTION_KEY", "").strip(),
            "FLOWTALLY_DEMO_READ_ONLY": _env_bool("FLOWTALLY_DEMO_READ_ONLY", False),
            "FLOWTALLY_DEMO_DATABASE_NAME": os.environ.get("FLOWTALLY_DEMO_DATABASE_NAME", "").strip(),
            "FLOWTALLY_DEMO_ISOLATED": _env_bool("FLOWTALLY_DEMO_ISOLATED", False),
            "FLOWTALLY_PRODUCTION_DATABASE_NAME": os.environ.get("FLOWTALLY_PRODUCTION_DATABASE_NAME", "flowtally_prod").strip() or "flowtally_prod",
        }
        validate_runtime_config(config, environment=cls.mode)
        return config


class DevelopmentConfig(BaseConfig):
    mode = "development"

    @classmethod
    def build(cls) -> dict[str, Any]:
        config = super().build()
        config.update({"DEBUG": True, "TESTING": False})
        return config


class TestingConfig(BaseConfig):
    mode = "testing"

    @classmethod
    def build(cls) -> dict[str, Any]:
        config = super().build()
        config.update(
            {
                "TESTING": True,
                "SESSION_COOKIE_SECURE": False,
                "ALLOWED_ORIGINS": ["http://127.0.0.1:5173", "http://localhost:5173"],
                "RATELIMIT_STORAGE_URI": "memory://",
            }
        )
        return config


class StagingConfig(BaseConfig):
    mode = "staging"

    @classmethod
    def build(cls) -> dict[str, Any]:
        config = super().build()
        config.update({"DEBUG": False, "TESTING": False})
        return config


class ProductionConfig(BaseConfig):
    mode = "production"

    @classmethod
    def build(cls) -> dict[str, Any]:
        config = super().build()
        config.update({"DEBUG": False, "TESTING": False})
        return config


def choose_config() -> type[BaseConfig]:
    environment, _ = _env_mode()
    if environment == "production":
        return ProductionConfig
    if environment == "staging":
        return StagingConfig
    if environment == "testing":
        return TestingConfig
    return DevelopmentConfig


def validate_runtime_config(config: dict[str, Any], *, environment: str | None = None) -> None:
    mode = (environment or str(config.get("FLOWTALLY_ENV") or "")).strip().lower()
    if mode not in PROD_LIKE_MODES:
        return

    explicit_environment = os.environ.get("FLOWTALLY_ENV", "").strip()
    if not explicit_environment:
        raise ConfigurationError("FLOWTALLY_ENV must be set explicitly for staging and production.")

    secret_key = str(config.get("SECRET_KEY") or "").strip()
    if len(secret_key) < 32 or secret_key in WEAK_SECRETS:
        raise ConfigurationError("SECRET_KEY is too weak for staging or production.")

    database_url = str(config.get("SQLALCHEMY_DATABASE_URI") or "").strip()
    if not database_url:
        raise ConfigurationError("DATABASE_URL must be set in staging and production.")
    parsed_database = urlparse(database_url)
    if parsed_database.scheme == "sqlite" and not _env_bool("FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL", False):
        raise ConfigurationError("SQLite is not allowed in staging or production unless FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL is enabled.")
    if mode == "production":
        migration_url = os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL", "").strip()
        if not migration_url:
            raise ConfigurationError("FLOWTALLY_MIGRATION_DATABASE_URL must be set in production.")
        validate_production_database_targets(database_url, migration_url)

    allowed_origins = [origin.strip() for origin in os.environ.get("FLOWTALLY_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
    if not allowed_origins:
        raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must be set in staging and production.")
    if any(origin == "*" or "*" in origin for origin in allowed_origins):
        raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must contain explicit http or https origins only.")
    if not config.get("ALLOWED_ORIGINS"):
        raise ConfigurationError("FLOWTALLY_ALLOWED_ORIGINS must not be empty.")

    if not _env_bool("SESSION_COOKIE_SECURE", False):
        raise ConfigurationError("SESSION_COOKIE_SECURE must be true in staging and production.")

    if mode == "production":
        if not bool(config.get("FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF")):
            raise ConfigurationError("Production must enforce split-origin CSRF.")
        cookie_name = str(config.get("SESSION_COOKIE_NAME") or "").strip().lower()
        if not cookie_name or "pilot" in cookie_name or "staging" in cookie_name:
            raise ConfigurationError("Production must use a commercial session cookie name.")

    frontend_origin = str(config.get("FLOWTALLY_FRONTEND_ORIGIN") or "").strip().rstrip("/")
    if not frontend_origin:
        raise ConfigurationError("FLOWTALLY_FRONTEND_ORIGIN must be set in staging and production.")
    parsed_frontend_origin = urlparse(frontend_origin)
    if parsed_frontend_origin.scheme != "https" or not parsed_frontend_origin.netloc:
        raise ConfigurationError("FLOWTALLY_FRONTEND_ORIGIN must be an explicit https URL in staging and production.")

    rate_limit_storage = str(config.get("RATELIMIT_STORAGE_URI") or "").strip()
    if not rate_limit_storage or (
        rate_limit_storage.startswith("memory://")
        and not _demo_memory_rate_limit_allowed(mode, database_url)
    ):
        raise ConfigurationError("Rate-limit storage must not use memory:// in staging or production.")

    google_enabled = bool(config.get("GOOGLE_OIDC_ENABLED"))
    if mode == "production" and not google_enabled:
        raise ConfigurationError("Production requires GOOGLE_OIDC_ENABLED=true.")
    if google_enabled:
        google_client_id = str(config.get("GOOGLE_CLIENT_ID") or "").strip()
        google_client_secret = str(config.get("GOOGLE_CLIENT_SECRET") or "").strip()
        google_redirect_uri = str(config.get("GOOGLE_REDIRECT_URI") or "").strip()
        if not google_client_id or not google_client_secret or not google_redirect_uri:
            raise ConfigurationError("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required when Google login is enabled.")
        parsed_google_redirect = urlparse(google_redirect_uri)
        if parsed_google_redirect.scheme != "https" or not parsed_google_redirect.netloc:
            raise ConfigurationError("GOOGLE_REDIRECT_URI must be an explicit https URL in staging and production.")
        if mode == "production" and "staging" in google_redirect_uri.lower():
            raise ConfigurationError("Production must not use a staging Google callback.")

    square_enabled = bool(config.get("SQUARE_ENABLED"))
    if square_enabled:
        square_environment = str(config.get("SQUARE_ENVIRONMENT") or "").strip().lower()
        square_application_id = str(config.get("SQUARE_APPLICATION_ID") or "").strip()
        square_application_secret = str(config.get("SQUARE_APPLICATION_SECRET") or "").strip()
        square_redirect_uri = str(config.get("SQUARE_REDIRECT_URI") or "").strip()
        square_webhook_key = str(config.get("SQUARE_WEBHOOK_SIGNATURE_KEY") or "").strip()
        integration_key = str(config.get("INTEGRATION_ENCRYPTION_KEY") or "").strip()
        if not square_application_id or not square_application_secret or not square_redirect_uri or not square_webhook_key or not integration_key:
            raise ConfigurationError(
                "SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET, SQUARE_REDIRECT_URI, SQUARE_WEBHOOK_SIGNATURE_KEY, and INTEGRATION_ENCRYPTION_KEY are required when Square is enabled."
            )
        if len(integration_key) < 32:
            raise ConfigurationError("INTEGRATION_ENCRYPTION_KEY must be at least 32 characters long when Square is enabled.")
        if square_environment not in {"sandbox", "production"}:
            raise ConfigurationError("SQUARE_ENVIRONMENT must be either sandbox or production.")
        if mode == "staging" and square_environment != "sandbox":
            raise ConfigurationError("Staging must default to Square Sandbox.")
        if mode == "production" and square_environment != "production":
            raise ConfigurationError("Production must not use Square Sandbox credentials.")
        if mode == "production" and "staging" in square_redirect_uri.lower():
            raise ConfigurationError("Production must not use a staging Square callback.")
