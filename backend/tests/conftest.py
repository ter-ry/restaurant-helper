from __future__ import annotations

from pathlib import Path

import pytest

from backend.app import create_app
from backend.extensions import db
from backend.seed import seed_pilot_data


@pytest.fixture()
def app(tmp_path: Path):
    database_path = tmp_path / "pilot.db"
    application = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{database_path.as_posix()}",
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
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
