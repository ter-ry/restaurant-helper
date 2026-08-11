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

    update_item_response = client.patch(
        f"/api/pilot/inventory/items/{item_id}",
        headers=csrf_headers(client),
        json={"latestPurchasePrice": 6},
    )
    assert update_item_response.status_code == 200

    refreshed = client.get("/api/pilot/menu-costing")
    assert refreshed.status_code == 200
    body = refreshed.get_json()
    assert body["recipes"][0]["costPerYield"] == 3.0
    assert body["menuItems"][0]["recipeCostPerYield"] == 3.0
    assert body["menuItems"][0]["grossProfit"] == 9.0

    select_org(client, other_organization.id)
    other_body = client.get("/api/pilot/menu-costing").get_json()
    assert other_body["recipes"] == []
    assert other_body["menuItems"] == []
