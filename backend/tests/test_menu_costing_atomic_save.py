from __future__ import annotations

from backend.models import RecipeIngredient, User
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_menu_costing_api import csrf_headers, login, select_org

MODULES = ("PURCHASES", "INVENTORY", "MENU_COSTING")


def _setup(client, name="Atomic Cafe"):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name=name, location_name=f"{name} Kitchen", enabled_modules=MODULES)
    select_org(client, org.id)
    ids = []
    for item_name, price in (("Cheese", 4), ("Bread", 2), ("Butter", 3)):
        r = client.post(
            "/api/pilot/inventory/items",
            headers=csrf_headers(client),
            json={"name": item_name, "category": "Food", "stockUnit": "each", "currentOnHand": 0, "latestPurchasePrice": price, "lastPurchaseConversionFactor": 1, "active": True},
        )
        assert r.status_code == 201
        ids.append(r.get_json()["id"])
    return org, ids


def _save(client, recipe_id, body):
    url = "/api/pilot/menu-costing/recipes/save" if recipe_id is None else f"/api/pilot/menu-costing/recipes/{recipe_id}/save"
    method = client.post
    return method(url, headers=csrf_headers(client), json=body)


def test_atomic_create_update_reorder_and_delete(client):
    _, (cheese, bread, butter) = _setup(client)
    created = _save(client, None, {"name": "Toast", "yieldQuantity": 1, "ingredients": [
        {"inventoryItemId": cheese, "quantityRequired": 2, "unit": "each"},
        {"inventoryItemId": bread, "quantityRequired": 1},
    ]})
    assert created.status_code == 201
    body = created.get_json()
    assert [i["inventoryItemId"] for i in body["ingredients"]] == [cheese, bread]
    assert body["totalCost"] == 10.0
    rid = body["id"]
    cheese_row = body["ingredients"][0]["id"]

    # reorder, edit quantity, drop bread, add butter, rename: one call
    updated = _save(client, rid, {"name": "Toast Deluxe", "ingredients": [
        {"inventoryItemId": butter, "quantityRequired": 1},
        {"id": cheese_row, "inventoryItemId": cheese, "quantityRequired": 3},
    ]})
    assert updated.status_code == 200
    out = updated.get_json()
    assert out["name"] == "Toast Deluxe"
    assert [i["inventoryItemId"] for i in out["ingredients"]] == [butter, cheese]
    assert out["totalCost"] == 15.0
    assert cheese_row in [i["id"] for i in out["ingredients"]]

    # authoritative state matches a fresh GET
    fresh = client.get("/api/pilot/menu-costing").get_json()["recipes"][0]
    assert fresh["totalCost"] == out["totalCost"]

    # swap inventory items between rows (unique-constraint hazard) works
    rows = {i["inventoryItemId"]: i["id"] for i in out["ingredients"]}
    swapped = _save(client, rid, {"name": "Toast Deluxe", "ingredients": [
        {"id": rows[butter], "inventoryItemId": cheese, "quantityRequired": 1},
        {"id": rows[cheese], "inventoryItemId": butter, "quantityRequired": 1},
    ]})
    assert swapped.status_code == 200
    assert [i["inventoryItemId"] for i in swapped.get_json()["ingredients"]] == [cheese, butter]

    cleared = _save(client, rid, {"name": "Toast Deluxe", "ingredients": []})
    assert cleared.status_code == 200
    assert cleared.get_json()["ingredients"] == []


def test_atomic_save_rolls_back_on_any_invalid_line(client):
    _, (cheese, bread, _) = _setup(client, "Rollback Cafe")
    rid = _save(client, None, {"name": "Sandwich", "ingredients": [{"inventoryItemId": cheese, "quantityRequired": 2}]}).get_json()["id"]

    ROW = client.get("/api/pilot/menu-costing").get_json()["recipes"][0]["ingredients"][0]["id"]
    for bad, status in (
        ([{"inventoryItemId": bread, "quantityRequired": 1}, {"inventoryItemId": cheese, "quantityRequired": 0}], 400),
        ([{"inventoryItemId": bread, "quantityRequired": 1}, {"inventoryItemId": bread, "quantityRequired": 1}], 409),
        ([{"inventoryItemId": bread, "quantityRequired": 1}, {"inventoryItemId": 999999, "quantityRequired": 1}], 404),
        ([{"id": 999999, "inventoryItemId": bread, "quantityRequired": 1}], 404),
        ([{"id": ROW, "inventoryItemId": cheese, "quantityRequired": 1}, {"id": ROW, "inventoryItemId": bread, "quantityRequired": 1}], 400),
    ):
        r = _save(client, rid, {"name": "Renamed", "ingredients": bad})
        assert r.status_code in (status, 422), r.get_json()
        assert r.status_code != 200
        state = client.get("/api/pilot/menu-costing").get_json()["recipes"][0]
        assert state["name"] == "Sandwich"
        assert [i["inventoryItemId"] for i in state["ingredients"]] == [cheese]


def test_atomic_save_name_conflict_and_tenant_isolation(client):
    _, (cheese, _, _) = _setup(client, "Tenant A")
    a_recipe = _save(client, None, {"name": "Soup", "ingredients": [{"inventoryItemId": cheese, "quantityRequired": 1}]}).get_json()["id"]
    other = _save(client, None, {"name": "Salad", "ingredients": []}).get_json()["id"]
    assert _save(client, other, {"name": "soup", "ingredients": []}).status_code == 409
    assert _save(client, None, {"name": "SOUP"}).status_code == 409

    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org_b = make_operational_organization(owner, name="Tenant B", location_name="B Kitchen", enabled_modules=MODULES)
    select_org(client, org_b.id)
    assert _save(client, a_recipe, {"name": "Hijack", "ingredients": []}).status_code == 404
    assert _save(client, None, {"name": "Mine", "ingredients": [{"inventoryItemId": cheese, "quantityRequired": 1}]}).status_code == 404
    assert RecipeIngredient.query.filter_by(recipe_id=a_recipe).count() == 1


def test_atomic_save_requires_menu_costing_module(client):
    login(client)
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    org = make_operational_organization(owner, name="No Costing", location_name="NC Kitchen", enabled_modules=("PURCHASES", "INVENTORY"))
    select_org(client, org.id)
    assert _save(client, None, {"name": "Nope", "ingredients": []}).status_code == 403
    assert _save(client, 1, {"name": "Nope", "ingredients": []}).status_code == 403
