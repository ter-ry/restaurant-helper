from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone

import pytest

from backend.app import create_app
from backend.extensions import db
from backend.models import Organization, OrganizationMembership, OrganizationModule, RestaurantLocation, User
from backend.seed import seed_pilot_data


CONFIG_ENV_VARS = [
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
]


@pytest.fixture(autouse=True)
def clear_config_env(monkeypatch: pytest.MonkeyPatch):
    for name in CONFIG_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    yield


@pytest.fixture()
def app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    for name in CONFIG_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FLOWTALLY_ENV", "testing")

    database_path = tmp_path / "pilot.db"
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{database_path.as_posix()}",
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_FRONTEND_ORIGIN": "http://127.0.0.1:5173",
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )

    with application.app_context():
        db.create_all()
        seed_pilot_data(reset=False)
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def make_operational_organization(
    owner: User,
    *,
    name: str,
    location_name: str,
    role: str = "owner",
    enabled_modules: tuple[str, ...] = ("PURCHASES", "INVENTORY", "REPORTING", "STOCK_COUNTS", "REORDER_PLANS"),
):
    organization = Organization(
        name=name,
        lifecycle_status="ACTIVE",
        setup_status="COMPLETE",
        subscription_status="ACTIVE",
        setup_template_key="GENERIC_RESTAURANT",
        setup_fee_status="confirmed",
        subscription_provider="manual",
        external_customer_reference=f"customer-{name.lower().replace(' ', '-')}",
        external_subscription_reference=f"subscription-{name.lower().replace(' ', '-')}",
        is_prospect=False,
        active_at=datetime.now(timezone.utc),
        setup_completed_at=datetime.now(timezone.utc),
    )
    db.session.add(organization)
    db.session.flush()
    db.session.add(OrganizationMembership(user=owner, organization=organization, role=role))
    db.session.add(
        RestaurantLocation(
            organization=organization,
            name=location_name,
            address_line1="123 Test St",
            address_line2="",
            city="Toronto",
            region="ON",
            postal_code="M5V 1A1",
            country="Canada",
            timezone="America/Toronto",
        )
    )
    for module_key in enabled_modules:
        db.session.add(
            OrganizationModule(
                organization=organization,
                module_key=module_key,
                status="ENABLED",
                enabled_at=datetime.now(timezone.utc),
            )
        )
    db.session.commit()
    return organization
