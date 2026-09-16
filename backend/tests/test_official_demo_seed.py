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
)


def test_official_demo_seed_is_populated_and_idempotent(app):
    runner = app.test_cli_runner()
    first = runner.invoke(args=["seed-demo"])
    assert first.exit_code == 0, first.output

    with app.app_context():
        connection = SquareConnection.query.one()
        assert connection.environment == "demo"
        assert connection.square_merchant_id == "demo-harbour-kitchen"
        assert connection.access_token_ciphertext == ""
        assert Supplier.query.count() >= 6
        assert MenuItem.query.count() >= 7
        assert RecipeIngredient.query.count() >= 10
        assert SquareCatalogMapping.query.filter_by(status="imported_recipe_needed").count() >= 1
        assert SquareOrder.query.count() == 7
        assert SquareDailySalesSummary.query.count() == 7
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
    assert "production/default database" in guarded.output


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
