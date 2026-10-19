from __future__ import annotations

from backend.models import User
from backend.seed import LOCAL_OWNER_EMAIL, LOCAL_OWNER_PASSWORD
from backend.tests.conftest import make_operational_organization


def login(client):
    csrf = client.get("/api/auth/csrf").get_json()["csrfToken"]
    response = client.post(
        "/api/auth/login",
        json={"email": LOCAL_OWNER_EMAIL, "password": LOCAL_OWNER_PASSWORD},
        headers={"X-CSRFToken": csrf},
    )
    assert response.status_code == 200


def csrf_headers(client):
    return {"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrfToken"]}


def select_org(client, organization_id: int):
    response = client.post("/api/organizations/select", headers=csrf_headers(client), json={"organizationId": organization_id})
    assert response.status_code == 200


def test_menu_costing_requires_module_entitlement(client):
    login(client)
    response = client.get("/api/pilot/menu-costing")
    assert response.status_code == 403
    body = response.get_json()
    assert body["errors"]["module"] == "Menu Costing"


def test_menu_costing_persists_and_tracks_live_costs(client):
    login(client)

    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    assert owner is not None
    organization = make_operational_organization(
        owner,
        name="Menu Costing Cafe",
        location_name="Menu Kitchen",
        enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING"),
    )
    other_organization = make_operational_organization(
        owner,
        name="Menu Costing Bistro",
        location_name="Bistro Kitchen",
        enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING"),
    )

    select_org(client, organization.id)

    item_response = client.post(
        "/api/pilot/inventory/items",
        headers=csrf_headers(client),
        json={
            "name": "Cheese",
            "category": "Dairy",
            "stockUnit": "each",
            "currentOnHand": 0,
            "latestPurchasePrice": 4,
            "lastPurchaseConversionFactor": 2,
            "active": True,
        },
    )
    assert item_response.status_code == 201
    item_id = item_response.get_json()["id"]

    recipe_response = client.post(
        "/api/pilot/menu-costing/recipes",
        headers=csrf_headers(client),
        json={
            "name": "Cheesy Toast",
            "description": "Toasted bread with cheese",
            "yieldQuantity": 2,
            "yieldUnit": "servings",
            "active": True,
            "notes": "Pilot recipe",
        },
    )
    assert recipe_response.status_code == 201
    recipe_id = recipe_response.get_json()["id"]

    ingredient_response = client.post(
        f"/api/pilot/menu-costing/recipes/{recipe_id}/ingredients",
        headers=csrf_headers(client),
        json={
            "inventoryItemId": item_id,
            "quantityRequired": 2,
            "unit": "each",
            "sortOrder": 1,
            "notes": "Two portions of cheese",
        },
    )
    assert ingredient_response.status_code == 201
    ingredient_recipe = ingredient_response.get_json()
    assert ingredient_recipe["costPerYield"] == 2.0
    assert ingredient_recipe["totalCost"] == 4.0
    assert ingredient_recipe["ingredients"][0]["lineCost"] == 4.0

    menu_item_response = client.post(
        "/api/pilot/menu-costing/menu-items",
        headers=csrf_headers(client),
        json={
            "name": "Cheesy Toast",
            "category": "Breakfast",
            "recipeId": recipe_id,
            "sellingPrice": 12,
            "active": True,
            "notes": "Pilot menu item",
        },
    )
    assert menu_item_response.status_code == 201
    menu_item = menu_item_response.get_json()
    assert menu_item["recipeCostPerYield"] == 2.0
    assert menu_item["grossProfit"] == 10.0
    assert menu_item["foodCostPercent"] == 16.7

    refreshed = client.get("/api/pilot/menu-costing")
    assert refreshed.status_code == 200
    body = refreshed.get_json()
    assert body["recipes"][0]["costPerYield"] == 2.0
    assert body["menuItems"][0]["recipeCostPerYield"] == 2.0
    assert body["menuItems"][0]["grossProfit"] == 10.0

    select_org(client, other_organization.id)
    other_body = client.get("/api/pilot/menu-costing").get_json()
    assert other_body["recipes"] == []
    assert other_body["menuItems"] == []


def test_empty_recipe_and_unit_mismatch_are_not_cost_ready(client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Cost Integrity Cafe", location_name="Cost Kitchen", enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING"))
    select_org(client, organization.id)

    empty = client.post("/api/pilot/menu-costing/recipes", headers=csrf_headers(client), json={"name": "Empty", "yieldQuantity": 4, "yieldUnit": "servings"})
    assert empty.status_code == 201
    assert empty.get_json()["costAvailable"] is False
    assert empty.get_json()["totalCost"] is None

    item = client.post("/api/pilot/inventory/items", headers=csrf_headers(client), json={"name": "Flour", "category": "Dry", "stockUnit": "kg", "currentOnHand": 4, "averageUnitCost": 12, "active": True}).get_json()
    recipe = client.post("/api/pilot/menu-costing/recipes", headers=csrf_headers(client), json={"name": "Mismatched", "yieldQuantity": 1, "yieldUnit": "serving"}).get_json()
    response = client.post(f"/api/pilot/menu-costing/recipes/{recipe['id']}/ingredients", headers=csrf_headers(client), json={"inventoryItemId": item["id"], "quantityRequired": 250, "unit": "g"})
    assert response.status_code == 201
    body = response.get_json()
    assert body["costAvailable"] is False
    assert body["totalCost"] is None
    assert body["ingredients"][0]["lineCost"] is None
    assert any("unit does not match" in warning for warning in body["warnings"])


def test_fractional_recipe_costs_preserve_precision_until_currency_rounding(client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Precision Cafe", location_name="Precision Kitchen", enabled_modules=("PURCHASES", "INVENTORY", "MENU_COSTING"))
    select_org(client, organization.id)
    first = client.post("/api/pilot/inventory/items", headers=csrf_headers(client), json={"name": "Milk", "category": "Dairy", "stockUnit": "kg", "currentOnHand": 4, "latestPurchasePrice": 12, "lastPurchaseConversionFactor": 1, "active": True}).get_json()
    second = client.post("/api/pilot/inventory/items", headers=csrf_headers(client), json={"name": "Sugar", "category": "Dry", "stockUnit": "kg", "currentOnHand": 4, "latestPurchasePrice": 8, "lastPurchaseConversionFactor": 1, "active": True}).get_json()
    recipe = client.post("/api/pilot/menu-costing/recipes", headers=csrf_headers(client), json={"name": "Fractional", "yieldQuantity": 4, "yieldUnit": "servings"}).get_json()
    for item, quantity in ((first, "0.25"), (second, "0.125")):
        response = client.post(f"/api/pilot/menu-costing/recipes/{recipe['id']}/ingredients", headers=csrf_headers(client), json={"inventoryItemId": item["id"], "quantityRequired": quantity, "unit": "kg"})
        assert response.status_code == 201
    body = response.get_json()
    assert body["totalCost"] == 4.0
    assert body["costPerYield"] == 1.0
    assert sorted(ingredient["lineCost"] for ingredient in body["ingredients"]) == [1.0, 3.0]
