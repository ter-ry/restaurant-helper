from __future__ import annotations

import click
import os
from urllib.parse import urlparse

from flask import Flask, Response, g, jsonify, request, session
from flask_wtf.csrf import CSRFError
from flask_login import logout_user

from .auth import bp as auth_bp
from .commercial import bp as commercial_bp
from .audit import ensure_request_id
from .access import enforce_operational_access
from .imports import bp as imports_bp
from .config import choose_config, validate_runtime_config
from .extensions import csrf, db, limiter, login_manager, migrate
from .models import User
from .ocr import bp as ocr_bp
from .tenant_context import apply_request_tenant_context
from .pilot_api import bp as pilot_api_bp
from .organizations import bp as organizations_bp
from .platform_admin import bp as platform_admin_bp
from .square_integration import bp as square_integration_bp
from .policy import enforce_endpoint_permission
from .seed import seed_pilot_data
from .validation import RequestValidationError
from .utils import json_error


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(choose_config().build())
    if test_config:
        app.config.update(test_config)
    validate_runtime_config(app.config, environment=app.config.get("FLOWTALLY_ENV"))

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)

    login_manager.login_view = "auth.login"
    login_manager.session_protection = "strong"

    @app.before_request
    def assign_request_id() -> None:
        ensure_request_id()

    @app.before_request
    def enforce_split_origin_browser_boundary():
        if not app.config.get("FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF"):
            return None
        if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
            return None
        if not request.path.startswith("/api/"):
            return None

        allowed_origins = set(app.config.get("ALLOWED_ORIGINS", []))
        frontend_origin = str(app.config.get("FLOWTALLY_FRONTEND_ORIGIN") or "").strip().rstrip("/")
        if frontend_origin:
            allowed_origins.add(frontend_origin)

        origin = request.headers.get("Origin", "").strip()
        referer = request.headers.get("Referer", "").strip()

        def _extract_origin(value: str) -> str:
            parsed = urlparse(value)
            if not parsed.scheme or not parsed.netloc:
                return ""
            return f"{parsed.scheme}://{parsed.netloc}"

        if origin:
            if origin not in allowed_origins:
                return json_error("Origin does not match the configured frontend.", 403)
            return None

        if referer:
            if _extract_origin(referer) not in allowed_origins:
                return json_error("Referrer does not match the configured frontend.", 403)
            return None

        return json_error("Origin or referrer is required for browser API requests.", 403)

    @login_manager.user_loader
    def load_user(user_id: str) -> User | None:
        if not user_id:
            return None
        user = User.query.filter_by(id=int(user_id)).first()
        if user is None or not user.is_active:
            return None
        return user

    @login_manager.unauthorized_handler
    def unauthorized() -> tuple[object, int]:
        return json_error("Authentication required.", 401)

    @app.before_request
    def reject_inactive_sessions():
        user_id = session.get("_user_id")
        if not user_id:
            return
        try:
            db.session.expire_all()
            user = User.query.filter_by(id=int(user_id)).first()
        except (TypeError, ValueError):
            user = None
        if user is None or not user.is_active:
            logout_user()
            return json_error("Authentication required.", 401)

    @app.before_request
    def set_postgres_tenant_context():
        apply_request_tenant_context()

    @app.before_request
    def enforce_centralized_policy():
        return enforce_endpoint_permission()

    @app.before_request
    def enforce_commercial_access():
        return enforce_operational_access()

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        request_id = getattr(g, "request_id", None)
        if request_id:
            response.headers.setdefault("X-Request-Id", str(request_id))
        if request.path.startswith("/api/"):
            origin = request.headers.get("Origin", "")
            allowed_origins = set(app.config.get("ALLOWED_ORIGINS", []))
            if origin in allowed_origins:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
                response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Accept, X-CSRFToken, X-CSRF-Token")
            response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        return response

    @app.errorhandler(400)
    def handle_bad_request(error: Exception) -> tuple[object, int]:
        return json_error("Bad request.", 400)

    @app.errorhandler(RequestValidationError)
    def handle_validation_error(error: RequestValidationError) -> tuple[object, int]:
        return json_error(error.message, 400, errors=error.errors)

    @app.errorhandler(CSRFError)
    def handle_csrf_error(error: CSRFError) -> tuple[object, int]:
        return json_error(error.description or "CSRF validation failed.", 400)

    @app.errorhandler(404)
    def handle_not_found(error: Exception) -> tuple[object, int]:
        if request.path.startswith("/api/"):
            return json_error("Not found.", 404)
        return json_error("Not found.", 404)

    @app.errorhandler(405)
    def handle_method_not_allowed(error: Exception) -> tuple[object, int]:
        return json_error("Method not allowed.", 405)

    @app.errorhandler(413)
    def handle_payload_too_large(error: Exception) -> tuple[object, int]:
        return json_error("Uploaded file is too large.", 413)

    @app.route("/api/<path:_path>", methods=["OPTIONS"])
    @app.route("/api", methods=["OPTIONS"])
    def api_options(_path: str = "") -> Response:
        return Response(status=204)

    @limiter.exempt
    @app.get("/api/health")
    def health() -> tuple[dict[str, object], int]:
        return (
            {
                "status": "ok",
                "service": "flowtally-pilot-backend",
                "environment": app.config.get("FLOWTALLY_ENV", "development"),
                "databaseUrlConfigured": bool(app.config.get("SQLALCHEMY_DATABASE_URI")),
                "csrfEnabled": bool(app.config.get("WTF_CSRF_ENABLED", True)),
                "ocrConfigured": bool(os.environ.get("OCR_SPACE_API_KEY", "").strip()),
                "googleOidcEnabled": bool(app.config.get("GOOGLE_OIDC_ENABLED")),
                "squareEnabled": bool(app.config.get("SQUARE_ENABLED")),
            },
            200,
        )

    csrf.exempt(ocr_bp)
    app.register_blueprint(ocr_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(commercial_bp)
    app.register_blueprint(imports_bp)
    app.register_blueprint(organizations_bp)
    app.register_blueprint(platform_admin_bp)
    app.register_blueprint(square_integration_bp)
    app.register_blueprint(pilot_api_bp)

    @app.cli.group("seed")
    def seed_group() -> None:
        """Seed local pilot data."""

    @seed_group.command("pilot")
    @click.option(
        "--confirm-production-seeding",
        is_flag=True,
        help="Required together with FLOWTALLY_ALLOW_PRODUCTION_SEEDING when seeding staging or production.",
    )
    def seed_pilot_command(confirm_production_seeding: bool) -> None:
        result = seed_pilot_data(reset=False, confirm_production=confirm_production_seeding)
        print(
            "Seeded pilot data: "
            f"organization={result.organization_id}, owner={result.owner_id}, manager={result.manager_id}, location={result.location_id}"
        )

    @seed_group.command("reset-pilot")
    @click.option(
        "--confirm-production-seeding",
        is_flag=True,
        help="Required together with FLOWTALLY_ALLOW_PRODUCTION_SEEDING when resetting staging or production.",
    )
    def reset_pilot_command(confirm_production_seeding: bool) -> None:
        result = seed_pilot_data(reset=True, confirm_production=confirm_production_seeding)
        print(
            "Reset and seeded pilot data: "
            f"organization={result.organization_id}, owner={result.owner_id}, manager={result.manager_id}, location={result.location_id}"
        )

    @app.cli.command("init-db")
    def init_db_command() -> None:
        db.create_all()
        print("Database tables created.")

    return app
