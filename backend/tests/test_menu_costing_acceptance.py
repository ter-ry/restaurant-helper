"""Acceptance tests for menu costing with a fixed realistic cafe dataset (Square only, issue #193).

Dataset (all money CAD; expected values are derived by hand, not from the code under test):

Ingredients (stock unit cost after receipts)
  Espresso beans  kg  10 bags x 2 kg @ $36.00/bag          -> $18.00/kg
  Whole milk      L   100 L @ $1.50, then 100 L @ $1.70    -> weighted avg $1.60/L after both receipts
  Flour           kg  1 sack x 25 kg @ $30.00              -> $1.20/kg
  Butter          kg  1 case x 5 kg @ $45.00               -> $9.00/kg

Recipes
  Latte           yield 1   : 0.018 kg beans + 0.25 L milk
  Blueberry Muffin yield 12 : 1.5 kg flour + 0.6 kg butter + 0.5 L milk (batch, per-muffin cost)
  Drip Coffee     yield 1   : 0.012 kg beans
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from backend.extensions import db
from backend.models import (
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareLocation,
    SquareLocationMapping,
    SquareOrder,
    SquareOrderLine,
    User,
)
from backend.seed import LOCAL_OWNER_EMAIL
from backend.tests.conftest import make_operational_organization
from backend.tests.test_menu_costing_api import csrf_headers, login, select_org
from backend.tests.test_square_integration import configure_square

MODULES = ("PURCHASES", "INVENTORY", "REPORTING", "STOCK_COUNTS", "MENU_COSTING", "SQUARE_INTEGRATION")


def _post(client, url, payload, status=201):
    response = client.post(url, headers=csrf_headers(client), json=payload)
    assert response.status_code == status, response.get_json()
    return response.get_json()


def _item(client, name, unit):
    return _post(client, "/api/pilot/inventory/items", {"name": name, "category": "Cafe", "stockUnit": unit, "currentOnHand": 0, "active": True})


def _receive(client, number, supplier, item, *, purchase_unit, factor, quantity, unit_price):
    total = round(quantity * unit_price, 2)
    invoice = _post(client, "/api/pilot/purchases/invoices", {
        "supplierName": supplier,
        "invoiceNumber": number,
        "invoiceDate": "2026-08-01",
        "subtotal": total,
        "tax": 0,
        "totalAmount": total,
        "status": "Ready",
        "lineItems": [{
            "description": item["name"],
            "inventoryItemId": item["id"],
            "purchaseUnit": purchase_unit,
            "inventoryUnit": item["stockUnit"],
            "conversionFactor": factor,
            "quantity": quantity,
            "unitPrice": unit_price,
            "lineTotal": total,
            "needsReview": False,
        }],
    })
    received = client.post(f"/api/pilot/purchases/invoices/{invoice['id']}/receive", headers=csrf_headers(client))
    assert received.status_code == 200, received.get_json()


def _recipe(client, name, yield_quantity, lines):
    recipe = _post(client, "/api/pilot/menu-costing/recipes", {"name": name, "yieldQuantity": yield_quantity, "yieldUnit": "servings", "active": True})
    ingredient_ids = []
    for index, (item, quantity) in enumerate(lines):
        added = _post(client, f"/api/pilot/menu-costing/recipes/{recipe['id']}/ingredients", {
            "inventoryItemId": item["id"], "quantityRequired": quantity, "unit": item["stockUnit"], "sortOrder": index,
        })
        ingredient_ids.append(added["ingredients"][-1]["id"])
    return recipe["id"], ingredient_ids


def _menu_item(client, name, recipe_id, price):
    return _post(client, "/api/pilot/menu-costing/menu-items", {"name": name, "category": "Cafe", "recipeId": recipe_id, "sellingPrice": price, "active": True})


def _menu(client):
    body = client.get("/api/pilot/menu-costing").get_json()
    return {row["name"]: row for row in body["menuItems"]}


def _seed_square_sales(organization_id, location_id, owner_id, menu_ids, quantities):
    connection = SquareConnection(organization_id=organization_id, environment="sandbox", square_merchant_id="merchant-cost", status="connected", sync_status="idle")
    db.session.add(connection)
    db.session.flush()
    square_location = SquareLocation(square_connection_id=connection.id, square_location_id="LOC-1", name="Front Bar", status="active", raw_payload_json={"id": "LOC-1"})
    db.session.add(square_location)
    db.session.flush()
    db.session.add(SquareLocationMapping(square_location_id=square_location.id, restaurant_location_id=location_id, mapped_by_user_id=owner_id))
    price = {"Latte": Decimal("5.00"), "Blueberry Muffin": Decimal("3.50"), "Drip Coffee": Decimal("3.00")}
    for index, (name, menu_id) in enumerate(menu_ids.items()):
        variation = SquareCatalogObject(square_connection_id=connection.id, square_object_id=f"VAR-{index}", object_type="ITEM_VARIATION", version=1, is_deleted=False, raw_payload_json={"id": f"VAR-{index}"})
        db.session.add(variation)
        db.session.flush()
        db.session.add(SquareCatalogMapping(square_catalog_object_id=variation.id, mapping_type="menu_item", flowtally_entity_type="menu_item", flowtally_entity_id=str(menu_id), status="mapped", mapped_by_user_id=owner_id))
        quantity = Decimal(quantities[name])
        gross = price[name] * quantity
        order = SquareOrder(
            square_connection_id=connection.id, square_order_id=f"ORDER-{index}", square_location_id="LOC-1", restaurant_location_id=location_id,
            order_state="COMPLETED", currency="CAD", gross_amount=gross, discount_amount=Decimal("0"), tax_amount=Decimal("0"), tip_amount=Decimal("0"),
            refund_amount=Decimal("0"), net_amount=gross, item_quantity=quantity, line_count=1,
            ordered_at=datetime(2026, 8, 8, 16, index, tzinfo=timezone.utc), closed_at=datetime(2026, 8, 8, 16, index + 10, tzinfo=timezone.utc),
            raw_payload_json={"id": f"ORDER-{index}"},
        )
        db.session.add(order)
        db.session.flush()
        db.session.add(SquareOrderLine(
            order=order, line_uid=f"line-{index}", line_index=0, square_item_variation_id=f"VAR-{index}", name=name, quantity=quantity,
            gross_amount=gross, discount_amount=Decimal("0"), tax_amount=Decimal("0"), tip_amount=Decimal("0"), net_amount=gross,
            raw_payload_json={"uid": f"line-{index}", "gross_sales_money": {"amount": int(gross * 100), "currency": "CAD"}},
        ))
    db.session.commit()


def test_menu_costing_acceptance_cafe_dataset(app, client):
    login(client)
    configure_square(app)
    # Acceptance criterion 2: Square outputs below are produced with the Clover inventory flag off (default).
    assert not app.config.get("CLOVER_ORDER_INVENTORY_ENABLED")
    owner = User.query.filter_by(email=LOCAL_OWNER_EMAIL).first()
    organization = make_operational_organization(owner, name="Acceptance Cafe", location_name="Queen St", enabled_modules=MODULES)
    organization_id, location_id, owner_id = organization.id, organization.locations[0].id, owner.id
    select_org(client, organization_id)

    beans, milk, flour, butter = _item(client, "Espresso Beans", "kg"), _item(client, "Whole Milk", "L"), _item(client, "Flour", "kg"), _item(client, "Butter", "kg")
    _receive(client, "AC-1", "Roaster Co", beans, purchase_unit="bag", factor=2, quantity=10, unit_price=36)
    _receive(client, "AC-2", "Mill Co", flour, purchase_unit="sack", factor=25, quantity=1, unit_price=30)
    _receive(client, "AC-3", "Dairy Co", butter, purchase_unit="case", factor=5, quantity=1, unit_price=45)
    _receive(client, "AC-4", "Dairy Co", milk, purchase_unit="L", factor=1, quantity=100, unit_price=1.50)

    latte_recipe, latte_lines = _recipe(client, "Latte", 1, [(beans, "0.018"), (milk, "0.25")])
    muffin_recipe, muffin_lines = _recipe(client, "Blueberry Muffin", 12, [(flour, "1.5"), (butter, "0.6"), (milk, "0.5")])
    drip_recipe, _ = _recipe(client, "Drip Coffee", 1, [(beans, "0.012")])
    _menu_item(client, "Latte", latte_recipe, 5)
    _menu_item(client, "Blueberry Muffin", muffin_recipe, 3.5)
    _menu_item(client, "Drip Coffee", drip_recipe, 3)

    # Before the milk price change: milk $1.50/L.
    # Latte 0.018*18 + 0.25*1.50 = 0.324 + 0.375 = 0.699 -> 0.70; Muffin batch 1.80 + 5.40 + 0.75 = 7.95 -> 0.6625 -> 0.66 each.
    before = _menu(client)
    assert before["Latte"]["recipeCostPerYield"] == 0.70
    assert before["Blueberry Muffin"]["recipeCostPerYield"] == 0.66
    assert before["Blueberry Muffin"]["recipe"]["totalCost"] == 7.95

    # Mid-period price change: second milk receipt at $1.70/L -> weighted average (100*1.50 + 100*1.70)/200 = $1.60/L.
    _receive(client, "AC-5", "Dairy Co", milk, purchase_unit="L", factor=1, quantity=100, unit_price=1.70)

    menu = _menu(client)
    latte, muffin, drip = menu["Latte"], menu["Blueberry Muffin"], menu["Drip Coffee"]
    # Latte: 0.324 + 0.25*1.60 = 0.724 -> 0.72 ; profit 4.28 ; food cost 14.4% ; margin 85.6%
    assert latte["recipe"]["ingredients"][1]["costBasis"] == "weighted_average"
    assert latte["recipe"]["ingredients"][1]["inventoryItemCostPerStockUnit"] == 1.6
    assert (latte["recipeCostPerYield"], latte["grossProfit"], latte["foodCostPercent"], latte["grossMarginPercent"]) == (0.72, 4.28, 14.4, 85.6)
    # Muffin (multi-unit batch, yield 12): 1.80 + 5.40 + 0.80 = 8.00 -> 0.6667 -> 0.67 each ; profit 2.83 ; 19.1% ; 80.9%
    assert muffin["recipe"]["totalCost"] == 8.0
    assert (muffin["recipeCostPerYield"], muffin["grossProfit"], muffin["foodCostPercent"], muffin["grossMarginPercent"]) == (0.67, 2.83, 19.1, 80.9)
    # Drip: 0.012*18 = 0.216 -> 0.22 ; profit 2.78 ; 7.3% ; 92.7%
    assert (drip["recipeCostPerYield"], drip["grossProfit"], drip["foodCostPercent"], drip["grossMarginPercent"]) == (0.22, 2.78, 7.3, 92.7)

    # Reporting through the real endpoint with Square sales: 40 lattes, 24 muffins, 30 drip coffees.
    with app.app_context():
        _seed_square_sales(organization_id, location_id, owner_id, {"Latte": latte["id"], "Blueberry Muffin": muffin["id"], "Drip Coffee": drip["id"]}, {"Latte": 40, "Blueberry Muffin": 24, "Drip Coffee": 30})
    report = client.get("/api/pilot/reports", query_string={"view": "daily", "date": "2026-08-08"})
    assert report.status_code == 200
    rows = {row["name"]: row for row in report.get_json()["sales"]["byMenuItem"]}
    assert rows["Latte"]["quantity"] == 40 and rows["Latte"]["netAmount"] == 200.0
    assert rows["Latte"]["currentCostPerSale"] == 0.72 and rows["Latte"]["estimatedGrossProfit"] == 171.2  # 4.28 * 40
    assert rows["Blueberry Muffin"]["quantity"] == 24 and rows["Blueberry Muffin"]["netAmount"] == 84.0
    assert rows["Blueberry Muffin"]["estimatedGrossProfit"] == 67.92  # 2.83 * 24
    assert rows["Drip Coffee"]["quantity"] == 30 and rows["Drip Coffee"]["estimatedGrossProfit"] == 83.4  # 2.78 * 30
    costing = report.get_json()["costing"]
    # Cost = 40*0.72 + 24*0.67 + 30*0.22 = 28.80 + 16.08 + 6.60 = 51.48 on sales 200 + 84 + 90 = 374
    assert costing["costCoveragePercent"] == 100.0
    assert costing["costReadySalesAmount"] == 374.0
    assert costing["estimatedFoodCostPercent"] == round(51.48 / 374 * 100, 2)
    assert report.get_json()["sales"]["unmappedLines"] == []

    # Theoretical usage through the Square usage report (unrounded recipe quantities x units sold).
    usage = client.get("/api/integrations/square/usage", query_string={
        "organizationId": organization_id, "locationId": location_id, "startAt": "2026-08-08T00:00:00Z", "endAt": "2026-08-08T23:59:59Z",
    })
    assert usage.status_code == 200, usage.get_json()
    theoretical = {row["inventoryItemName"]: row["theoreticalUsage"] for row in usage.get_json()["usage"]["ingredientUsage"]}
    assert theoretical == {
        "Espresso Beans": 1.08,  # 40*0.018 + 30*0.012
        "Whole Milk": 11.0,  # 40*0.25 + 24*(0.5/12)
        "Flour": 3.0,  # 24*(1.5/12)
        "Butter": 1.2,  # 24*(0.6/12)
    }

    # Recipe edit refreshes cost: latte beans 0.018 -> 0.020 kg => 0.36 + 0.40 = 0.76.
    patched = client.patch(f"/api/pilot/menu-costing/recipes/{latte_recipe}/ingredients/{latte_lines[0]}", headers=csrf_headers(client), json={"quantityRequired": "0.02"})
    assert patched.status_code == 200, patched.get_json()
    assert _menu(client)["Latte"]["recipeCostPerYield"] == 0.76
    # Ingredient delete refreshes cost: remove butter from the muffin => 1.80 + 0.80 = 2.60 / 12 = 0.2167 -> 0.22.
    deleted = client.delete(f"/api/pilot/menu-costing/recipes/{muffin_recipe}/ingredients/{muffin_lines[1]}", headers=csrf_headers(client))
    assert deleted.status_code in (200, 204)
    assert _menu(client)["Blueberry Muffin"]["recipeCostPerYield"] == 0.22
    refreshed = client.get("/api/pilot/reports", query_string={"view": "daily", "date": "2026-08-08"}).get_json()
    refreshed_rows = {row["name"]: row for row in refreshed["sales"]["byMenuItem"]}
    assert refreshed_rows["Latte"]["currentCostPerSale"] == 0.76
    assert refreshed_rows["Blueberry Muffin"]["currentCostPerSale"] == 0.22
