from __future__ import annotations

import os
from pathlib import Path

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from flask_wtf import CSRFProtect

db = SQLAlchemy()
migrate = Migrate(directory=str(Path(__file__).resolve().parent / "migrations"))
login_manager = LoginManager()
csrf = CSRFProtect()
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=os.environ.get("FLOWTALLY_RATE_LIMIT_STORAGE_URI", "memory://"),
    default_limits=[],
)
