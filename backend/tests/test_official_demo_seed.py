from __future__ import annotations

from backend.models import (
    InventoryMovement,
    InventoryWasteEvent,
    MenuItem,
    RecipeIngredient,
    SquareCatalogMapping,
    SquareConnection,
    SquareDailySalesSummary,
    SquareOrder,
    Supplier,
    PlatformRole,
    SupportAccessGrant,
    User,
)
from backend.menu_costing import serialize_menu_item


def test_official_demo_seed_is_populated_and_idempotent(app):
    runner = app.test_cli_runner()
    first = runner.invoke(args=["seed-demo"])
    assert first.exit_code == 0, first.output

    with app.app_context():
        demo_owner = User.query.filter_by(email="owner@flowtally.local").one()
        assert PlatformRole.query.filter_by(user_id=demo_owner.id).count() == 0
        assert SupportAccessGrant.query.filter_by(support_user_id=demo_owner.id).count() == 0
        connection = SquareConnection.query.one()
        assert connection.environment == "demo"
        assert connection.square_merchant_id == "demo-harbour-kitchen"
        assert connection.access_token_ciphertext == ""
        assert Supplier.query.count() >= 6
        assert {item.name for item in MenuItem.query.order_by(MenuItem.id.asc()).all()} == {
            "Harbour Burger",
            "Chicken Rice Bowl",
            "Toronto Breakfast",
            "House Salad",
            "Iced Latte",
            "Berry Parfait",
            "Seasonal Soup",
        }
        assert MenuItem.query.count() == 7
        assert RecipeIngredient.query.count() >= 10
        assert SquareCatalogMapping.query.filter_by(status="imported_recipe_needed").count() >= 1
        assert SquareOrder.query.count() == 21
        assert SquareDailySalesSummary.query.count() == 21
        ordered_dates = [entry.ordered_at.date() for entry in SquareOrder.query.order_by(SquareOrder.ordered_at.asc()).all()]
        assert ordered_dates[0] < ordered_dates[-1]
        assert InventoryWasteEvent.query.count() >= 1
        assert InventoryMovement.query.count() >= 1
        counts = {
            "menus": MenuItem.query.count(),
            "ingredients": RecipeIngredient.query.count(),
            "orders": SquareOrder.query.count(),
            "summaries": SquareDailySalesSummary.query.count(),
        }

    second = runner.invoke(args=["seed-demo"])
    assert second.exit_code == 0, second.output
    with app.app_context():
        assert MenuItem.query.count() == counts["menus"]
        assert RecipeIngredient.query.count() == counts["ingredients"]
        assert SquareOrder.query.count() == counts["orders"]
        assert SquareDailySalesSummary.query.count() == counts["summaries"]


def test_official_demo_seed_refuses_production(app, monkeypatch):
    app.config["FLOWTALLY_DEMO_ISOLATED"] = False
    missing_identity = app.test_cli_runner().invoke(args=["seed-demo"])
    assert missing_identity.exit_code != 0
    assert "explicitly identified" in missing_identity.output
    app.config["FLOWTALLY_DEMO_ISOLATED"] = True
    monkeypatch.setenv("FLOWTALLY_ENV", "production")
    # The app's already-built config remains testing; exercise the command's
    # explicit production guard without opening a production connection.
    app.config["FLOWTALLY_ENV"] = "production"
    result = app.test_cli_runner().invoke(args=["seed-demo"])
    assert result.exit_code != 0
    assert "disabled in production" in result.output

    app.config["FLOWTALLY_ENV"] = "staging"
    app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://demo-user:secret@example.test/flowtally_prod"
    guarded = app.test_cli_runner().invoke(args=["seed-demo"])
    assert guarded.exit_code != 0
    assert "explicitly identified" in guarded.output


def test_official_demo_dashboard_reads_seeded_records(app):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    client = app.test_client()
    token = client.get("/api/auth/csrf").get_json()["csrfToken"]
    login = client.post(
        "/api/auth/login",
        json={"email": "owner@flowtally.local", "password": "PilotOwner123!"},
        headers={"X-CSRFToken": token},
    )
    assert login.status_code == 200
    dashboard = client.get("/api/pilot/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.get_json()["summary"]["inventoryItemCount"] >= 20


def test_official_demo_exposes_real_operational_calculations(app):
    assert app.test_cli_runner().invoke(args=["seed-demo"]).exit_code == 0
    app.config["FLOWTALLY_DEMO_READ_ONLY"] = True
    client = app.test_client()
    token = client.get("/api/auth/csrf").get_json()["csrfToken"]
    assert client.post("/api/auth/demo-login", headers={"X-CSRFToken": token}).status_code == 200

    with app.app_context():
        menu_items = [serialize_menu_item(item) for item in MenuItem.query.order_by(MenuItem.id.asc()).all()]
    assert sum(1 for item in menu_items if item["costAvailable"]) >= 6
    assert all(item["grossMarginPercent"] is not None for item in menu_items if item["costAvailable"])
    assert any(item["name"] == "Seasonal Soup" and not item["costAvailable"] for item in menu_items)

    inventory = client.get("/api/pilot/inventory").get_json()
    assert inventory["summary"]["inventoryLowStockCount"] >= 1
    assert inventory["summary"]["inventoryReorderNowCount"] >= 1

    purchases = client.get("/api/pilot/purchases").get_json()
    assert any(change["changePercent"] != 0 for change in purchases["priceChanges"])

    waste = client.get("/api/pilot/inventory/waste-events").get_json()
    assert waste["wasteEvents"]

    counts = client.get("/api/pilot/inventory/count-sessions").get_json()
    assert any(line.get("variance") not in (None, 0) for session in counts["countSessions"] for line in session.get("lines", []))
