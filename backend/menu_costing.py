from __future__ import annotations

from decimal import Decimal
from typing import Any

from .models import InventoryItem, MenuItem, Recipe, RecipeIngredient
from .costing import AVERAGE_COST_PRECISION, stock_unit_cost_from_purchase
from .utils import decimal_to_float, serialize_inventory_item


MONEY = Decimal("0.01")


def _decimal(value: Decimal | None, default: str = "0") -> Decimal:
    return Decimal(str(value if value is not None else default))


def current_inventory_unit_cost(item: InventoryItem) -> Decimal | None:
    average_cost = _decimal(item.average_unit_cost, "0")
    if average_cost > 0:
        return average_cost.quantize(AVERAGE_COST_PRECISION)

    latest_cost = stock_unit_cost_from_purchase(item.latest_purchase_price, item.last_purchase_conversion_factor)
    if latest_cost <= 0:
        return None
    return latest_cost.quantize(AVERAGE_COST_PRECISION)


def _ingredient_cost(ingredient: RecipeIngredient) -> Decimal | None:
    inventory_item = ingredient.inventory_item
    quantity_required = _decimal(ingredient.quantity_required, "0")
    if inventory_item is None or not inventory_item.active or quantity_required <= 0:
        return None
    if not ingredient.unit or not inventory_item.stock_unit or ingredient.unit.strip().lower() != inventory_item.stock_unit.strip().lower():
        return None
    cost_per_unit = current_inventory_unit_cost(inventory_item)
    if cost_per_unit is None:
        return None
    return quantity_required * cost_per_unit


def _ingredient_snapshot(ingredient: RecipeIngredient) -> dict[str, Any]:
    inventory_item = ingredient.inventory_item
    cost_per_unit = current_inventory_unit_cost(inventory_item) if inventory_item else None
    quantity_required = _decimal(ingredient.quantity_required, "0")
    line_cost = None
    warnings: list[str] = []

    if inventory_item is None:
        warnings.append("Ingredient is not linked to an inventory item.")
    else:
        if quantity_required <= 0:
            warnings.append("Ingredient quantity must be greater than zero.")
        if inventory_item.active is False:
            warnings.append("Ingredient uses an inactive inventory item.")
        if not ingredient.unit or not inventory_item.stock_unit or ingredient.unit.strip().lower() != inventory_item.stock_unit.strip().lower():
            warnings.append("Ingredient unit does not match the inventory item stock unit.")
        if cost_per_unit is None:
            warnings.append("No current inventory cost is available for this ingredient.")
        elif quantity_required > 0 and inventory_item.active and ingredient.unit and inventory_item.stock_unit and ingredient.unit.strip().lower() == inventory_item.stock_unit.strip().lower():
            line_cost = (quantity_required * cost_per_unit).quantize(MONEY)

    average_cost = _decimal(inventory_item.average_unit_cost, "0") if inventory_item else Decimal("0")
    cost_basis = "weighted_average" if average_cost > 0 else "latest_purchase" if cost_per_unit is not None else None

    return {
        "id": ingredient.id,
        "organizationId": ingredient.organization_id,
        "recipeId": ingredient.recipe_id,
        "inventoryItemId": ingredient.inventory_item_id,
        "quantityRequired": decimal_to_float(ingredient.quantity_required) or 0,
        "unit": ingredient.unit,
        "notes": ingredient.notes,
        "sortOrder": ingredient.sort_order,
        "inventoryItem": serialize_inventory_item(inventory_item) if inventory_item else None,
        "inventoryItemCostPerStockUnit": decimal_to_float(cost_per_unit),
        "costBasis": cost_basis,
        "lineCost": decimal_to_float(line_cost),
        "warnings": warnings,
        "createdAt": ingredient.created_at.isoformat() if ingredient.created_at else None,
        "updatedAt": ingredient.updated_at.isoformat() if ingredient.updated_at else None,
    }


def serialize_recipe(recipe: Recipe) -> dict[str, Any]:
    ingredient_snapshots = [_ingredient_snapshot(ingredient) for ingredient in recipe.ingredients]
    warnings = [warning for ingredient in ingredient_snapshots for warning in ingredient["warnings"]]
    raw_costs = [_ingredient_cost(ingredient) for ingredient in recipe.ingredients]
    costs = [cost for cost in raw_costs if cost is not None]
    cost_available = bool(raw_costs) and len(costs) == len(raw_costs) and recipe.yield_quantity is not None and Decimal(str(recipe.yield_quantity)) > 0
    total_cost = sum(costs, start=Decimal("0")).quantize(MONEY) if cost_available else None
    if cost_available:
        displayed_line_total = sum((Decimal(str(ingredient["lineCost"])) for ingredient in ingredient_snapshots), start=Decimal("0")).quantize(MONEY)
        if displayed_line_total != total_cost:
            warnings.append("Ingredient lines are rounded to cents for display; recipe totals retain higher precision before currency rounding.")
    cost_per_yield = None
    if total_cost is not None and Decimal(str(recipe.yield_quantity)) > 0:
        cost_per_yield = (total_cost / Decimal(str(recipe.yield_quantity))).quantize(MONEY)

    return {
        "id": recipe.id,
        "organizationId": recipe.organization_id,
        "locationId": recipe.location_id,
        "name": recipe.name,
        "normalizedName": recipe.normalized_name,
        "description": recipe.description,
        "yieldQuantity": decimal_to_float(recipe.yield_quantity),
        "yieldUnit": recipe.yield_unit,
        "active": bool(recipe.active),
        "notes": recipe.notes,
        "ingredientCount": len(ingredient_snapshots),
        "ingredients": ingredient_snapshots,
        "totalCost": decimal_to_float(total_cost),
        "costPerYield": decimal_to_float(cost_per_yield),
        "costAvailable": cost_available,
        "warnings": warnings,
        "createdByUserId": recipe.created_by_user_id,
        "updatedByUserId": recipe.updated_by_user_id,
        "createdAt": recipe.created_at.isoformat() if recipe.created_at else None,
        "updatedAt": recipe.updated_at.isoformat() if recipe.updated_at else None,
    }


def serialize_menu_item(menu_item: MenuItem) -> dict[str, Any]:
    recipe = menu_item.recipe
    recipe_snapshot = serialize_recipe(recipe) if recipe else None
    recipe_cost = Decimal(str(recipe_snapshot["costPerYield"])) if recipe_snapshot and recipe_snapshot["costPerYield"] is not None else None
    selling_price = _decimal(menu_item.selling_price, "0")
    gross_profit = None
    food_cost_percent = None
    gross_margin_percent = None
    warnings: list[str] = []

    if recipe_snapshot is None:
        warnings.append("Menu item is not linked to a recipe.")
    else:
        warnings.extend(recipe_snapshot["warnings"])
        if not recipe_snapshot["costAvailable"]:
            warnings.append("Recipe cost is not fully available yet.")

    if recipe_cost is not None and selling_price > 0:
        gross_profit = (selling_price - recipe_cost).quantize(MONEY)
        food_cost_percent = ((recipe_cost / selling_price) * Decimal("100")).quantize(Decimal("0.1"))
        gross_margin_percent = ((gross_profit / selling_price) * Decimal("100")).quantize(Decimal("0.1"))

    return {
        "id": menu_item.id,
        "organizationId": menu_item.organization_id,
        "locationId": menu_item.location_id,
        "recipeId": menu_item.recipe_id,
        "name": menu_item.name,
        "normalizedName": menu_item.normalized_name,
        "category": menu_item.category,
        "sellingPrice": decimal_to_float(menu_item.selling_price) or 0,
        "active": bool(menu_item.active),
        "notes": menu_item.notes,
        "recipe": recipe_snapshot,
        "recipeCostPerYield": decimal_to_float(recipe_cost),
        "grossProfit": decimal_to_float(gross_profit),
        "foodCostPercent": decimal_to_float(food_cost_percent),
        "grossMarginPercent": decimal_to_float(gross_margin_percent),
        "costAvailable": recipe_snapshot["costAvailable"] if recipe_snapshot else False,
        "warnings": warnings,
        "createdByUserId": menu_item.created_by_user_id,
        "updatedByUserId": menu_item.updated_by_user_id,
        "createdAt": menu_item.created_at.isoformat() if menu_item.created_at else None,
        "updatedAt": menu_item.updated_at.isoformat() if menu_item.updated_at else None,
    }
