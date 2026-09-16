from __future__ import annotations

import click
import json
import os
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, Response, g, jsonify, request, session
from flask_wtf.csrf import CSRFError
from flask_login import logout_user
from sqlalchemy import inspect

from .auth import bp as auth_bp
from .commercial import bp as commercial_bp
from .audit import ensure_request_id
from .access import enforce_operational_access
from .imports import bp as imports_bp
from .config import choose_config, validate_runtime_config
from .extensions import csrf, db, limiter, login_manager, migrate
from .models import AuditEvent, DailyCloseSession, InventoryItem, InventoryMovement, InventoryWasteEvent, MenuItem, Organization, PlatformRole, Recipe, RestaurantLocation, Supplier, User
from .ocr import bp as ocr_bp
from .tenant_context import apply_request_tenant_context
from .daily_close import bp as daily_close_bp
from .pilot_api import bp as pilot_api_bp
from .organizations import bp as organizations_bp
from .platform_admin import bp as platform_admin_bp
from .square_integration import bp as square_integration_bp
from .policy import enforce_endpoint_permission
from .seed import DEMO_RESTAURANT_NAME, SeedResult, seed_pilot_data, seed_official_demo_data
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
    def enforce_demo_read_only() -> Response | None:
        """Keep a demo deployment browseable while making every write server-authoritative."""
        if not app.config.get("FLOWTALLY_DEMO_READ_ONLY") or request.method in {"HEAD", "OPTIONS"}:
            return None
        if not request.path.startswith("/api/"):
            return None
        # Only the purpose-built demo session entry and normal session teardown
        # remain available. Password/Google auth and callback routes can write
        # users, identities, audit events, or session context and stay blocked.
        if request.path in {"/api/auth/demo-login", "/api/auth/logout"}:
            return None
        if request.method == "GET" and request.path in {"/api/auth/csrf", "/api/auth/me"}:
            return None
        if request.method == "GET" and not request.path.startswith("/api/auth/"):
            return None
        return json_error("Demo mode is read-only; changes are disabled.", 403)

    # Flask-WTF installs its CSRF hook during csrf.init_app; put the demo guard
    # ahead of it so blocked writes receive the explicit demo response.
    app.before_request_funcs.setdefault(None, []).insert(0, enforce_demo_read_only)

    @app.before_request
    def enforce_split_origin_browser_boundary():
        if not app.config.get("FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF"):
            return None
        if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
            return None
        if not request.path.startswith("/api/"):
            return None
        # Square sends server-to-server webhooks without browser Origin/Referer
        # headers. Signature verification remains mandatory in the webhook view.
        if request.path == "/api/integrations/square/webhooks":
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
            response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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
    app.register_blueprint(daily_close_bp)
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

    @app.cli.command("seed-demo")
    @click.option("--profile", default="casual_restaurant", show_default=True)
    @click.option("--reset", is_flag=True, help="Reset the canonical demo organization before seeding.")
    @click.option("--restaurant-name", default=None)
    @click.option("--location-name", default=None)
    @click.option("--overlay", type=click.Path(exists=True, dir_okay=False, path_type=Path), default=None)
    def seed_demo_command(profile: str, reset: bool, restaurant_name: str | None, location_name: str | None, overlay: Path | None) -> None:
        """Seed the deterministic, isolated demo profile (never production)."""
        if app.config.get("FLOWTALLY_ENV") == "production":
            raise click.ClickException("seed-demo is disabled in production; use a separate demo environment.")
        database_uri = str(app.config.get("SQLALCHEMY_DATABASE_URI") or "")
        database_name = urlparse(database_uri).path.rsplit("/", 1)[-1].lower()
        expected_demo_database = str(app.config.get("FLOWTALLY_DEMO_DATABASE_NAME") or "").strip().lower()
        if not app.config.get("FLOWTALLY_DEMO_ISOLATED") or not expected_demo_database or database_name != expected_demo_database:
            raise click.ClickException("seed-demo requires FLOWTALLY_DEMO_ISOLATED=true and an explicitly identified FLOWTALLY_DEMO_DATABASE_NAME matching the selected database.")
        if database_name in {"flowtally_prod", "defaultdb"}:
            raise click.ClickException("seed-demo refuses the production/default database; configure an isolated demo database.")
        if profile not in {"casual_restaurant"}:
            raise click.ClickException("Unknown demo profile. Available profiles: casual_restaurant")
        if not inspect(db.engine).has_table("audit_events"):
            db.create_all()
        if reset:
            raise click.ClickException("Demo reset is intentionally disabled by this command; use a disposable demo database and recreate it explicitly.")
        existing_demo = Organization.query.filter_by(name=DEMO_RESTAURANT_NAME).first()
        if existing_demo is not None:
            demo_owner = User.query.filter_by(email="owner@flowtally.local").first()
            demo_location = RestaurantLocation.query.filter_by(organization_id=existing_demo.id).order_by(RestaurantLocation.id.asc()).first()
            if demo_owner is None or demo_location is None:
                raise click.ClickException("The existing demo organization is incomplete; refusing to repair it implicitly.")
            result = SeedResult(organization_id=existing_demo.id, owner_id=demo_owner.id, manager_id=demo_owner.id, location_id=demo_location.id)
        else:
            result = seed_pilot_data(reset=False, confirm_production=False, demo=True)
        changes: dict[str, object] = {}
        if overlay:
            try:
                changes = json.loads(overlay.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise click.ClickException(f"Could not read demo overlay: {exc}") from exc
        organization = db.session.get(Organization, result.organization_id)
        location = db.session.get(RestaurantLocation, result.location_id)
        if organization is None or location is None:
            raise click.ClickException("Seeded demo organization or location was not found.")
        restaurant_name = restaurant_name or changes.get("restaurant_name")
        location_name = location_name or changes.get("location_name")
        if restaurant_name:
            organization.name = str(restaurant_name)
        if location_name:
            location.name = str(location_name)
        supplier = Supplier.query.filter_by(organization_id=organization.id).order_by(Supplier.id.asc()).first()
        extra_items = [
            ("Avocado", "Produce", "kg", 3, 7), ("Pickles", "Prep", "jar", 2, 5),
            ("Cheddar", "Dairy", "kg", 2, 6), ("Bacon", "Protein", "kg", 2, 5),
            ("Chicken Thigh", "Protein", "kg", 3, 8), ("Mushrooms", "Produce", "kg", 2, 5),
            ("Onions", "Produce", "kg", 3, 8), ("Garlic", "Produce", "kg", 1, 3),
            ("Mayonnaise", "Prep", "L", 2, 4), ("Ketchup", "Prep", "L", 2, 4),
            ("Mustard", "Prep", "L", 1, 3), ("Butter", "Dairy", "kg", 2, 4),
            ("Coffee Beans", "Beverage", "kg", 4, 8), ("Sparkling Water", "Beverage", "case", 2, 5),
        ]
        for name, category, unit, minimum, par in extra_items:
            if not InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=name.lower()).first():
                db.session.add(InventoryItem(organization_id=organization.id, location_id=location.id, supplier_id=supplier.id if supplier else None, name=name, normalized_name=name.lower(), category=category, stock_unit=unit, current_on_hand=Decimal(str(par + 2)), min_quantity=Decimal(str(minimum)), par_level=Decimal(str(par)), preferred_supplier_name=supplier.name if supplier else "", latest_purchase_price=Decimal("4.50"), last_purchase_unit=unit, last_purchase_conversion_factor=Decimal("1"), average_daily_usage=Decimal("0.5")))
        menu_names = ["Harbour Burger", "Chicken Rice Bowl", "Toronto Breakfast", "House Salad", "Iced Latte", "Berry Parfait", "Seasonal Soup"]
        for name in menu_names:
            if not MenuItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=name.lower()).first():
                db.session.add(MenuItem(organization_id=organization.id, location_id=location.id, name=name, normalized_name=name.lower(), category="Menu", selling_price=Decimal("16.00"), notes="Canonical demo menu item"))
        recipe_names = ["Harbour Burger", "Chicken Rice Bowl", "Breakfast Hash", "House Salad", "Iced Latte", "Berry Parfait"]
        for name in recipe_names:
            if not Recipe.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=name.lower()).first():
                db.session.add(Recipe(organization_id=organization.id, location_id=location.id, name=name, normalized_name=name.lower(), description="Canonical demo recipe", yield_quantity=Decimal("1"), yield_unit="batch", created_by_user_id=result.owner_id, updated_by_user_id=result.owner_id))
        waste_item = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, name="Chicken Breast").first()
        if waste_item and not InventoryWasteEvent.query.filter_by(organization_id=organization.id, location_id=location.id, reason="Demo spoilage").first():
            before = Decimal(str(waste_item.current_on_hand))
            after = before - Decimal("0.25")
            movement = InventoryMovement(organization_id=organization.id, location_id=location.id, inventory_item_id=waste_item.id, quantity_delta=Decimal("-0.25"), quantity_before=before, quantity_after=after, unit=waste_item.stock_unit, source_type="waste", source_record_id="demo-waste-1", source_line_id="", reason="Demo spoilage", actor_user_id=result.owner_id)
            db.session.add(movement)
            db.session.flush()
            db.session.add(InventoryWasteEvent(organization_id=organization.id, location_id=location.id, inventory_item_id=waste_item.id, inventory_movement_id=movement.id, quantity=Decimal("0.25"), unit=waste_item.stock_unit, reason="Demo spoilage", note="Seeded operational story", unit_cost=waste_item.latest_purchase_price, total_cost=(waste_item.latest_purchase_price * Decimal("0.25")), created_by_user_id=result.owner_id))
            waste_item.current_on_hand = after
        if not DailyCloseSession.query.filter_by(organization_id=organization.id, location_id=location.id).first():
            db.session.add(DailyCloseSession(organization_id=organization.id, location_id=location.id, business_date=date.today() - timedelta(days=1), status="COMPLETED", summary_snapshot_json={"sales": 1840, "expectedInventory": 1260}, usage_snapshot_json={"square": "demo"}, exceptions_snapshot_json=["Small count variance"], notes="Completed canonical demo close", completed_by_user_id=result.owner_id, created_by_user_id=result.owner_id))
            db.session.add(DailyCloseSession(organization_id=organization.id, location_id=location.id, business_date=date.today(), status="DRAFT", summary_snapshot_json={}, usage_snapshot_json={}, exceptions_snapshot_json=[], notes="Open demo close", created_by_user_id=result.owner_id))
        menu_overrides = changes.get("menu_items", {}) if isinstance(changes, dict) else {}
        if isinstance(menu_overrides, dict):
            for old_name, new_name in menu_overrides.items():
                item = MenuItem.query.filter_by(organization_id=organization.id, location_id=location.id, name=str(old_name)).first()
                if item:
                    item.name = str(new_name)
                    item.normalized_name = str(new_name).strip().lower()
        seed_official_demo_data(organization_id=organization.id, location_id=location.id, owner_id=result.owner_id)
        db.session.commit()
        click.echo(f"Seeded demo profile={profile} organization={organization.id} location={location.id} reset={reset}")

    @app.cli.command("init-db")
    def init_db_command() -> None:
        db.create_all()
        print("Database tables created.")

    @app.cli.group("platform-role")
    def platform_role_group() -> None:
        """Controlled operator commands for platform role administration."""

    @platform_role_group.command("set")
    @click.option("--email", required=True)
    @click.option("--role", required=True, type=click.Choice(("setup_admin", "support")))
    def set_platform_role_command(email: str, role: str) -> None:
        """Assign a supported platform role to an existing user."""
        normalized_email = email.strip().lower()
        user = User.query.filter(db.func.lower(User.email) == normalized_email).first()
        if user is None:
            raise click.ClickException(f"No existing user found for {normalized_email}.")

        platform_role = PlatformRole.query.filter_by(user_id=user.id).first()
        if platform_role is not None and platform_role.is_active and platform_role.role != role:
            raise click.ClickException(
                f"User {user.email} already has active platform role {platform_role.role}; refusing to replace it."
            )

        if platform_role is None:
            platform_role = PlatformRole(user_id=user.id, role=role, is_active=True)
            db.session.add(platform_role)
            changed = True
        else:
            changed = platform_role.role != role or not platform_role.is_active
            platform_role.role = role
            platform_role.is_active = True

        if changed:
            db.session.add(
                AuditEvent(
                    actor_user_id=user.id,
                    event_type="platform_role_assigned",
                    entity_type="user",
                    entity_id=str(user.id),
                    request_id="platform-role-cli",
                    metadata_json={"role": role, "source": "operator_cli"},
                )
            )
            db.session.commit()
            click.echo(f"Assigned platform role {role} to {user.email} (user_id={user.id}).")
        else:
            click.echo(f"Platform role {role} already assigned to {user.email} (user_id={user.id}).")

    return app
