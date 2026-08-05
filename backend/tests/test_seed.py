from __future__ import annotations

import pytest

from backend.extensions import db
from backend.models import Organization, RestaurantLocation, User
from backend.app import create_app
from backend.seed import LOCAL_MANAGER_EMAIL, LOCAL_OWNER_EMAIL, LOCAL_ORGANIZATION_NAME, LOCAL_LOCATION_NAME, seed_pilot_data


def test_seed_is_idempotent(app):
    with app.app_context():
        first = seed_pilot_data(reset=False)
        second = seed_pilot_data(reset=False)

        assert first.organization_id == second.organization_id
        assert first.location_id == second.location_id
        assert User.query.filter(User.email.in_([LOCAL_OWNER_EMAIL, LOCAL_MANAGER_EMAIL])).count() == 2
        assert Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).count() == 1
        assert RestaurantLocation.query.filter_by(name=LOCAL_LOCATION_NAME).count() == 1


def test_seed_reset_rebuilds_pilot_tenant(app):
    with app.app_context():
        db.session.add(Organization(name="Temporary Org"))
        db.session.commit()

        result = seed_pilot_data(reset=True)

        assert result.organization_id > 0
        assert User.query.filter(User.email.in_([LOCAL_OWNER_EMAIL, LOCAL_MANAGER_EMAIL])).count() == 2
        assert Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).count() == 1
        assert RestaurantLocation.query.filter_by(name=LOCAL_LOCATION_NAME).count() == 1


def test_migrations_upgrade_and_seed_on_fresh_database(tmp_path, monkeypatch):
    database_path = tmp_path / "fresh-migration.db"
    monkeypatch.setenv("FLOWTALLY_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path.as_posix()}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    monkeypatch.setenv("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "memory://")
    monkeypatch.setenv("FLOWTALLY_ALLOWED_ORIGINS", "http://127.0.0.1:5173")
    application = create_app()

    runner = application.test_cli_runner()
    result = runner.invoke(args=["db", "upgrade"])
    assert result.exit_code == 0, result.output

    with application.app_context():
        seeded = seed_pilot_data(reset=False)
        assert seeded.organization_id > 0
        assert User.query.filter(User.email.in_([LOCAL_OWNER_EMAIL, LOCAL_MANAGER_EMAIL])).count() == 2
        assert Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).count() == 1
        assert RestaurantLocation.query.filter_by(name=LOCAL_LOCATION_NAME).count() == 1


def test_seed_refuses_in_staging_without_confirmation(monkeypatch):
    monkeypatch.setenv("FLOWTALLY_ENV", "staging")
    monkeypatch.setenv("SECRET_KEY", "a-very-long-explicit-staging-secret-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/flowtally")
    monkeypatch.setenv("FLOWTALLY_ALLOWED_ORIGINS", "https://staging.flowtally.ca")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "redis://example.invalid/0")
    monkeypatch.delenv("FLOWTALLY_ALLOW_PRODUCTION_SEEDING", raising=False)

    with pytest.raises(RuntimeError, match="disabled in staging and production"):
        seed_pilot_data(reset=True)
