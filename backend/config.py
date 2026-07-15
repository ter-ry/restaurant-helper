from __future__ import annotations

import os
from pathlib import Path
from typing import Any


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


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _database_uri() -> str:
    configured = os.environ.get("DATABASE_URL", "").strip()
    if configured:
        if configured.startswith("postgres://"):
            return "postgresql://" + configured.removeprefix("postgres://")
        return configured

    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(INSTANCE_DIR / 'flowtally_pilot.db').resolve().as_posix()}"


def _allowed_origins() -> list[str]:
    configured = os.environ.get("FLOWTALLY_ALLOWED_ORIGINS", "").strip()
    if not configured:
        return sorted(DEFAULT_ALLOWED_ORIGINS)
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


class BaseConfig:
    @staticmethod
    def build() -> dict[str, Any]:
        return {
            "SECRET_KEY": os.environ.get("SECRET_KEY", "flowtally-pilot-local-dev-secret"),
            "SQLALCHEMY_DATABASE_URI": _database_uri(),
            "SQLALCHEMY_TRACK_MODIFICATIONS": False,
            "SQLALCHEMY_ENGINE_OPTIONS": {"pool_pre_ping": True},
            "JSON_SORT_KEYS": False,
            "SESSION_COOKIE_NAME": os.environ.get("SESSION_COOKIE_NAME", "flowtally_pilot_session"),
            "SESSION_COOKIE_HTTPONLY": True,
            "SESSION_COOKIE_SECURE": _env_bool("SESSION_COOKIE_SECURE", False),
            "SESSION_COOKIE_SAMESITE": os.environ.get("SESSION_COOKIE_SAMESITE", "Lax"),
            "WTF_CSRF_HEADERS": ["X-CSRFToken", "X-CSRF-Token"],
            "WTF_CSRF_TIME_LIMIT": int(os.environ.get("WTF_CSRF_TIME_LIMIT", "3600")),
            "MAX_CONTENT_LENGTH": int(os.environ.get("MAX_CONTENT_LENGTH", str(15 * 1024 * 1024))),
            "RATELIMIT_DEFAULT": "200 per hour",
            "RATELIMIT_STORAGE_URI": os.environ.get("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "memory://"),
            "ALLOWED_ORIGINS": _allowed_origins(),
        }


class DevelopmentConfig(BaseConfig):
    @staticmethod
    def build() -> dict[str, Any]:
        config = BaseConfig.build()
        config.update({"DEBUG": True, "TESTING": False})
        return config


class TestingConfig(BaseConfig):
    @staticmethod
    def build() -> dict[str, Any]:
        config = BaseConfig.build()
        config.update(
            {
                "TESTING": True,
                "SESSION_COOKIE_SECURE": False,
                "ALLOWED_ORIGINS": ["http://127.0.0.1:5173", "http://localhost:5173"],
            }
        )
        return config


class ProductionConfig(BaseConfig):
    @staticmethod
    def build() -> dict[str, Any]:
        config = BaseConfig.build()
        config.update({"DEBUG": False, "TESTING": False, "SESSION_COOKIE_SECURE": _env_bool("SESSION_COOKIE_SECURE", True)})
        return config


def choose_config() -> type[BaseConfig]:
    environment = os.environ.get("FLOWTALLY_ENV", os.environ.get("FLASK_ENV", "development")).strip().lower()
    if environment in {"production", "prod"}:
        return ProductionConfig
    if environment in {"testing", "test"}:
        return TestingConfig
    return DevelopmentConfig

