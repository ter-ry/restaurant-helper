from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError

from .audit import record_audit_event
from .extensions import db
from .models import (
    InventoryItem,
    InventoryMovement,
    MenuItem,
    MenuRecipe,
    MenuRecipeLine,
    OrganizationMembership,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareOrder,
    StockCountSession,
)
from .policy import require_permission
from .utils import (
    decimal_to_float,
    get_current_location,
    get_current_organization_bundle,
    json_error,
    serialize_count_session,
    serialize_menu_item,
    serialize_menu_recipe,
    serialize_menu_recipe_line,
)
from .validation import RequestValidationError

bp = Blueprint("menu_api", __name__)

MONEY = Decimal("0.01")
QTY = Decimal("0.0001")
DEFAULT_LOOKBACK_DAYS = 14
MASS_UNITS = {"kg", "g"}
VOLUME_UNITS = {"l", "ml"}
COUNT_UNITS = {"each", "unit"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _json_body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise RequestValidationError("Request body must be JSON.", {"body": "Expected a JSON object."})
    return payload


def _to_decimal(value: Any, *, field: str, required: bool = True, places: str = "0.01") -> Decimal:
    if value in (None, ""):
        if required:
            raise RequestValidationError("Validation failed.", {field: "This field is required."})
        return Decimal("0")
    try:
        return Decimal(str(value)).quantize(Decimal(places))
    except (InvalidOperation, ValueError):
        raise RequestValidationError("Validation failed.", {field: "Enter a valid number."}) from None


def _to_quantity(value: Any, *, field: str, required: bool = True) -> Decimal:
    return _to_decimal(value, field=field, required=required, places="0.0001")


def _to_int(value: Any, *, field: str, required: bool = True) -> int:
    if value in (None, ""):
        if required:
            raise RequestValidationError("Validation failed.", {field: "This field is required."})
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        raise RequestValidationError("Validation failed.", {field: "Enter a valid whole number."}) from None


def _normalize_name(value: str) -> str:
    return " ".join(" ".join(ch if ch.isalnum() else " " for ch in value.lower()).split())


def _normalize_unit_name(value: str) -> str:
    unit = str(value or "").strip().lower()
    return unit[:-1] if unit.endswith("s") and unit[:-1] in MASS_UNITS | VOLUME_UNITS | COUNT_UNITS else unit


def _unit_family(unit: str) -> str | None:
    normalized = _normalize_unit_name(unit)
    if normalized in MASS_UNITS:
        return "mass"
    if normalized in VOLUME_UNITS:
        return "volume"
    if normalized in COUNT_UNITS:
        return "count"
    return None


def _convert_quantity(quantity: Decimal, source_unit: str, target_unit: str) -> Decimal | None:
    source = _normalize_unit_name(source_unit)
    target = _normalize_unit_name(target_unit)
    source_family = _unit_family(source)
    target_family = _unit_family(target)
    if source_family is None or target_family is None or source_family != target_family:
        return None

    if source == target:
        return quantity.quantize(QTY)

    if source_family == "mass":
        source_factor = Decimal("1000") if source == "kg" else Decimal("1")
        target_factor = Decimal("1000") if target == "kg" else Decimal("1")
    elif source_family == "volume":
        source_factor = Decimal("1000") if source == "l" else Decimal("1")
        target_factor = Decimal("1000") if target == "l" else Decimal("1")
    else:
        source_factor = Decimal("1")
        target_factor = Decimal("1")

    return (quantity * source_factor / target_factor).quantize(QTY)


def _current_context():
    organization, membership, locations = get_current_organization_bundle()
    location = get_current_location()
    if organization is None or membership is None or location is None:
        return None, None, None, None
    return organization, membership, locations, location


def _require_context():
    organization, membership, locations, location = _current_context()
    if organization is None or membership is None or location is None:
        return None
    return organization, membership, locations, location


def _require_menu_manage(membership: OrganizationMembership):
    return require_permission(membership.role if membership else None, "menu.manage")


def _inventory_unit_cost(item: InventoryItem) -> Decimal | None:
    purchase_price = Decimal(item.latest_purchase_price or 0)
    conversion_factor = Decimal(item.last_purchase_conversion_factor or 0)
    if purchase_price <= 0:
        return None
    if conversion_factor <= 0:
        return None
    return (purchase_price / conversion_factor).quantize(MONEY)


def _latest_square_connection(organization_id: int) -> SquareConnection | None:
    return SquareConnection.query.filter_by(organization_id=organization_id).order_by(SquareConnection.updated_at.desc(), SquareConnection.id.desc()).first()


def _menu_items_query(organization_id: int, location_id: int):
    return MenuItem.query.filter_by(organization_id=organization_id, location_id=location_id).order_by(MenuItem.active.desc(), MenuItem.name.asc())


def _validate_recipe_lines(payload_lines: list[dict[str, Any]], organization_id: int, location_id: int) -> list[MenuRecipeLine]:
    recipe_lines: list[MenuRecipeLine] = []
    for index, line_payload in enumerate(payload_lines):
        ingredient_name = str(line_payload.get("ingredientName") or line_payload.get("name") or "").strip()
        if not ingredient_name:
            raise RequestValidationError("Recipe validation failed.", {f"recipeLines[{index}].ingredientName": "Ingredient name is required."})
        inventory_item_id = line_payload.get("inventoryItemId")
        inventory_item = None
        if inventory_item_id not in (None, ""):
            inventory_item = InventoryItem.query.filter_by(id=_to_int(inventory_item_id, field=f"recipeLines[{index}].inventoryItemId"), organization_id=organization_id, location_id=location_id).first()
            if inventory_item is None:
                raise RequestValidationError("Recipe validation failed.", {f"recipeLines[{index}].inventoryItemId": "That inventory item is not available for this location."})
        quantity = _to_quantity(line_payload.get("quantity"), field=f"recipeLines[{index}].quantity")
        if quantity <= 0:
            raise RequestValidationError("Recipe validation failed.", {f"recipeLines[{index}].quantity": "Quantity must be greater than zero."})
        conversion_factor_raw = line_payload.get("conversionFactor")
        conversion_factor = _to_quantity(1 if conversion_factor_raw in (None, "") else conversion_factor_raw, field=f"recipeLines[{index}].conversionFactor", required=False)
        if conversion_factor <= 0:
            conversion_factor = Decimal("1")
        recipe_lines.append(
            MenuRecipeLine(
                organization_id=organization_id,
                location_id=location_id,
                inventory_item_id=inventory_item.id if inventory_item else None,
                line_index=index,
                ingredient_name=ingredient_name,
                quantity=quantity,
                unit=str(line_payload.get("unit") or "each").strip() or "each",
                inventory_unit=str(line_payload.get("inventoryUnit") or (inventory_item.stock_unit if inventory_item else "each")).strip() or "each",
                purchase_unit=str(line_payload.get("purchaseUnit") or (inventory_item.last_purchase_unit if inventory_item else "each")).strip() or "each",
                conversion_factor=conversion_factor,
                notes=str(line_payload.get("notes") or "").strip(),
            )
        )
    return recipe_lines


def _validate_menu_item_payload(payload: dict[str, Any], *, require_recipe_lines: bool = False) -> dict[str, Any]:
    errors: dict[str, str] = {}
    name = str(payload.get("name") or "").strip()
    if not name:
        errors["name"] = "Menu item name is required."
    selling_price = payload.get("sellingPrice")
    if selling_price in (None, ""):
        errors["sellingPrice"] = "Selling price is required."
    recipe_lines = payload.get("recipeLines")
    if require_recipe_lines and (not isinstance(recipe_lines, list) or not recipe_lines):
        errors["recipeLines"] = "Add at least one recipe line."
    if recipe_lines is not None and not isinstance(recipe_lines, list):
        errors["recipeLines"] = "Recipe lines must be a list."
    if errors:
        raise RequestValidationError("Menu item validation failed.", errors)
    return payload


def _replace_recipe(menu_item: MenuItem, payload_lines: list[dict[str, Any]]) -> MenuRecipe:
    recipe = menu_item.recipe
    if recipe is None:
        recipe = MenuRecipe(
            organization_id=menu_item.organization_id,
            location_id=menu_item.location_id,
            menu_item_id=menu_item.id,
            created_by_user_id=current_user.id,
            updated_by_user_id=current_user.id,
        )
        db.session.add(recipe)
        db.session.flush()
    recipe.lines = []
    db.session.flush()
    recipe.lines = _validate_recipe_lines(payload_lines, menu_item.organization_id, menu_item.location_id)
    recipe.updated_by_user_id = current_user.id
    recipe.updated_at = _now()
    return recipe


def _sales_line_lookup(connection: SquareConnection | None, organization_id: int, menu_items: list[MenuItem]) -> dict[str, int]:
    lookup: dict[str, int] = {}
    if connection is None:
        return lookup

    catalog_objects = SquareCatalogObject.query.filter_by(square_connection_id=connection.id).all()
    object_id_to_catalog = {obj.square_object_id: obj for obj in catalog_objects}
    catalog_id_to_menu_id = {
        mapping.square_catalog_object_id: int(mapping.flowtally_entity_id)
        for mapping in SquareCatalogMapping.query.join(SquareCatalogObject, SquareCatalogObject.id == SquareCatalogMapping.square_catalog_object_id)
        .filter(
            SquareCatalogObject.square_connection_id == connection.id,
            SquareCatalogMapping.mapping_type == "menu_item",
            SquareCatalogMapping.flowtally_entity_type == "menu_item",
        )
        .all()
        if mapping.flowtally_entity_id.isdigit()
    }

    for square_object_id, catalog_object in object_id_to_catalog.items():
        mapped_menu_id = catalog_id_to_menu_id.get(catalog_object.id)
        if mapped_menu_id is not None:
            lookup[square_object_id] = mapped_menu_id
    return lookup


def _latest_count_session_for_location(organization_id: int, location_id: int) -> StockCountSession | None:
    return (
        StockCountSession.query.filter_by(organization_id=organization_id, location_id=location_id, status="Completed")
        .order_by(StockCountSession.completed_at.desc(), StockCountSession.updated_at.desc(), StockCountSession.id.desc())
        .first()
    )


def _latest_completed_count_session_before(organization_id: int, location_id: int, moment: datetime) -> StockCountSession | None:
    return (
        StockCountSession.query.filter_by(organization_id=organization_id, location_id=location_id, status="Completed")
        .filter(StockCountSession.completed_at.isnot(None))
        .filter(StockCountSession.completed_at <= moment)
        .order_by(StockCountSession.completed_at.desc(), StockCountSession.updated_at.desc(), StockCountSession.id.desc())
        .first()
    )


def _menu_snapshot(organization_id: int, location_id: int, *, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> dict[str, Any]:
    now = _now()
    lookback_start = now - timedelta(days=max(1, lookback_days))
    menu_items = _menu_items_query(organization_id, location_id).all()
    inventory_items = InventoryItem.query.filter_by(organization_id=organization_id, location_id=location_id, active=True).all()
    opening_count_session = _latest_completed_count_session_before(organization_id, location_id, lookback_start)
    latest_count_session = _latest_count_session_for_location(organization_id, location_id)
    opening_lookup: dict[int, Any] = {}
    if opening_count_session is not None:
        opening_lookup = {line.inventory_item_id: line for line in opening_count_session.lines}
    closing_lookup: dict[int, Any] = {}
    if latest_count_session is not None:
        closing_lookup = {line.inventory_item_id: line for line in latest_count_session.lines}

    connection = _latest_square_connection(organization_id)
    sales_lookup = _sales_line_lookup(connection, organization_id, menu_items)
    sales_units_by_menu_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    sales_net_by_menu_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    unmapped_sales: list[dict[str, Any]] = []
    received_purchases_by_inventory_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    if connection is not None:
        movements = (
            InventoryMovement.query.filter_by(organization_id=organization_id, location_id=location_id)
            .filter(InventoryMovement.source_type.in_(["invoice receipt", "invoice correction"]))
            .all()
        )
        for movement in movements:
            movement_moment = _aware_datetime(movement.created_at)
            if movement_moment is None or movement_moment < lookback_start:
                continue
            received_purchases_by_inventory_item[movement.inventory_item_id] += Decimal(movement.quantity_delta or 0)

    if connection is not None:
        orders = (
            SquareOrder.query.filter_by(square_connection_id=connection.id, restaurant_location_id=location_id)
            .order_by(SquareOrder.closed_at.desc(), SquareOrder.ordered_at.desc(), SquareOrder.id.desc())
            .all()
        )
        for order in orders:
            order_moment = order.closed_at or order.ordered_at
            order_moment = _aware_datetime(order_moment)
            if order_moment is None or order_moment < lookback_start:
                continue
            for line in order.lines:
                quantity = Decimal(line.quantity or 0)
                matched_menu_item_id = sales_lookup.get(line.square_item_variation_id)
                if matched_menu_item_id is None:
                    unmapped_sales.append(
                        {
                            "squareOrderId": order.square_order_id,
                            "squareItemVariationId": line.square_item_variation_id,
                            "name": line.name,
                            "quantity": decimal_to_float(line.quantity) or 0,
                            "netAmount": decimal_to_float(line.net_amount) or 0,
                        }
                    )
                    continue
                sales_units_by_menu_item[matched_menu_item_id] += quantity
                sales_net_by_menu_item[matched_menu_item_id] += Decimal(line.net_amount or 0)

    usage_by_inventory_item: defaultdict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    menu_payloads: list[dict[str, Any]] = []
    for menu_item in menu_items:
        recipe = menu_item.recipe
        recipe_line_payloads: list[dict[str, Any]] = []
        recipe_cost = Decimal("0")
        recipe_cost_complete = True
        usage_complete = True
        costing_issues: list[str] = []
        sold_units = sales_units_by_menu_item.get(menu_item.id, Decimal("0"))
        if recipe is None or not recipe.lines:
            recipe_cost_complete = False
            usage_complete = False
        for recipe_line in recipe.lines if recipe else []:
            inventory_item = recipe_line.inventory_item
            unit_cost = _inventory_unit_cost(inventory_item) if inventory_item else None
            line_cost = None
            normalized_quantity = None
            if inventory_item is not None:
                normalized_quantity = _convert_quantity(Decimal(recipe_line.quantity or 0), recipe_line.unit, inventory_item.stock_unit)
            if inventory_item is None:
                usage_complete = False
                recipe_cost_complete = False
                costing_issues.append(f"Untracked ingredient: {recipe_line.ingredient_name}")
            elif normalized_quantity is None:
                usage_complete = False
                recipe_cost_complete = False
                costing_issues.append(f"Incompatible units for {recipe_line.ingredient_name}")
            else:
                usage_by_inventory_item[inventory_item.id] += normalized_quantity * sold_units
                if unit_cost is not None:
                    line_cost = (normalized_quantity * unit_cost).quantize(MONEY)
                    recipe_cost += line_cost
                else:
                    recipe_cost_complete = False
                    costing_issues.append(f"Missing cost for {recipe_line.ingredient_name}")
            recipe_line_payloads.append(
                serialize_menu_recipe_line(
                    recipe_line,
                    unit_cost=decimal_to_float(unit_cost),
                    line_cost=decimal_to_float(line_cost),
                )
                    )
        selling_price = Decimal(menu_item.selling_price or 0)
        gross_profit = None
        margin_percent = None
        food_cost_percent = None
        if recipe_cost_complete:
            gross_profit = (selling_price - recipe_cost).quantize(MONEY)
            if selling_price > 0:
                margin_percent = round(float(gross_profit / selling_price * 100), 1)
                food_cost_percent = round(float(recipe_cost / selling_price * 100), 1)
        mapping = None
        if connection is not None:
            mapping = (
                SquareCatalogMapping.query.join(SquareCatalogObject, SquareCatalogObject.id == SquareCatalogMapping.square_catalog_object_id)
                .filter(
                    SquareCatalogObject.square_connection_id == connection.id,
                    SquareCatalogMapping.mapping_type == "menu_item",
                    SquareCatalogMapping.flowtally_entity_type == "menu_item",
                    SquareCatalogMapping.flowtally_entity_id == str(menu_item.id),
                )
                .first()
            )
        data_issues: list[str] = []
        if recipe is None or not recipe.lines:
            data_issues.append("Recipe missing")
        if not usage_complete:
            data_issues.append("Untracked ingredients")
        if not recipe_cost_complete:
            data_issues.append("Incomplete costing")
        data_issues.extend(costing_issues)
        if mapping is None:
            data_issues.append("Square mapping missing")
        menu_payload = serialize_menu_item(menu_item, recipe_payload=serialize_menu_recipe(recipe, line_payloads=recipe_line_payloads) if recipe else None)
        menu_payload.update(
            {
                "salesUnits": decimal_to_float(sold_units) or 0,
                "salesNetAmount": decimal_to_float(sales_net_by_menu_item.get(menu_item.id, Decimal("0"))) or 0,
                "recipeCost": decimal_to_float(recipe_cost) if recipe_cost_complete else None,
                "grossProfit": decimal_to_float(gross_profit),
                "marginPercent": margin_percent,
                "foodCostPercent": food_cost_percent,
                "costingComplete": recipe_cost_complete,
                "usageComplete": usage_complete,
                "mappingStatus": "Mapped" if mapping is not None else "Unmapped",
                "squareCatalogObjectId": mapping.square_catalog_object_id if mapping is not None else None,
                "dataIssues": data_issues,
            }
        )
        menu_payloads.append(menu_payload)

    inventory_usage: list[dict[str, Any]] = []
    for inventory_item in inventory_items:
        theoretical_usage = usage_by_inventory_item.get(inventory_item.id, Decimal("0"))
        opening_count_line = opening_lookup.get(inventory_item.id)
        closing_count_line = closing_lookup.get(inventory_item.id)
        opening_reference_quantity = None
        if opening_count_line is not None:
            opening_reference_quantity = Decimal(opening_count_line.resulting_quantity if opening_count_line.resulting_quantity is not None else opening_count_line.counted_quantity or 0)
        received_purchases = received_purchases_by_inventory_item.get(inventory_item.id, Decimal("0"))
        expected_inventory = None
        if opening_reference_quantity is not None:
            expected_inventory = (opening_reference_quantity + received_purchases - theoretical_usage).quantize(QTY)
        actual_stock_count = None
        if closing_count_line is not None:
            actual_stock_count = decimal_to_float(closing_count_line.resulting_quantity if closing_count_line.resulting_quantity is not None else closing_count_line.counted_quantity)
        variance = None
        estimated_cost_variance = None
        if actual_stock_count is not None and expected_inventory is not None:
            variance = round(actual_stock_count - float(expected_inventory), 4)
            unit_cost = _inventory_unit_cost(inventory_item)
            if unit_cost is not None:
                estimated_cost_variance = round(variance * float(unit_cost), 2)
        inventory_usage.append(
            {
                "inventoryItemId": inventory_item.id,
                "inventoryItemName": inventory_item.name,
                "stockUnit": inventory_item.stock_unit,
                "referenceInventory": decimal_to_float(opening_reference_quantity),
                "referenceInventorySessionId": opening_count_session.id if opening_count_session is not None else None,
                "referenceInventoryCompletedAt": serialize_count_session(opening_count_session)["completedAt"] if opening_count_session is not None else None,
                "receivedPurchases": decimal_to_float(received_purchases) or 0,
                "theoreticalUsage": decimal_to_float(theoretical_usage) or 0,
                "expectedInventory": decimal_to_float(expected_inventory),
                "actualStockCount": actual_stock_count,
                "variance": variance,
                "estimatedCostVariance": estimated_cost_variance,
                "latestCountSessionId": latest_count_session.id if latest_count_session is not None else None,
                "latestCountCompletedAt": serialize_count_session(latest_count_session)["completedAt"] if latest_count_session is not None else None,
                "calculationComplete": opening_reference_quantity is not None and actual_stock_count is not None,
            }
        )

    summary = {
        "menuItemCount": len(menu_items),
        "recipeCount": sum(1 for item in menu_items if item.recipe is not None and item.recipe.lines),
        "mappedMenuItemCount": sum(1 for item in menu_payloads if item["mappingStatus"] == "Mapped"),
        "salesUnits": round(sum(float(item["salesUnits"]) for item in menu_payloads), 4),
        "salesNetAmount": round(sum(float(item["salesNetAmount"]) for item in menu_payloads), 2),
        "recipeCost": round(sum(float(item["recipeCost"]) for item in menu_payloads if item["recipeCost"] is not None), 2),
        "grossProfit": round(sum(float(item["grossProfit"]) for item in menu_payloads if item["grossProfit"] is not None), 2),
        "inventoryVarianceCount": sum(1 for row in inventory_usage if row["variance"] is not None),
        "estimatedCostVariance": round(sum(float(row["estimatedCostVariance"]) for row in inventory_usage if row["estimatedCostVariance"] is not None), 2),
        "receivedPurchasesCount": sum(1 for row in inventory_usage if (row["receivedPurchases"] or 0) != 0),
        "incompleteCostingCount": sum(1 for item in menu_payloads if not item["costingComplete"]),
        "incompleteUsageCount": sum(1 for item in menu_payloads if not item["usageComplete"]),
        "unmappedSalesCount": len(unmapped_sales),
        "openingCountSessionId": opening_count_session.id if opening_count_session is not None else None,
        "latestCountSessionId": latest_count_session.id if latest_count_session is not None else None,
    }
    return {
        "summary": summary,
        "menuItems": menu_payloads,
        "inventoryUsage": inventory_usage,
        "unmappedSales": unmapped_sales[:20],
        "openingCountSession": serialize_count_session(opening_count_session) if opening_count_session is not None else None,
        "latestCountSession": serialize_count_session(latest_count_session) if latest_count_session is not None else None,
        "salesStartDate": lookback_start.date().isoformat(),
        "salesEndDate": now.date().isoformat(),
    }


@bp.get("/api/pilot/menu-costing")
@login_required
def menu_costing():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = require_permission(membership.role if membership else None, "operational.read")
    if permission_error is not None:
        return permission_error
    lookback_days = request.args.get("lookbackDays", str(DEFAULT_LOOKBACK_DAYS))
    snapshot = _menu_snapshot(organization.id, location.id, lookback_days=_to_int(lookback_days, field="lookbackDays", required=False) or DEFAULT_LOOKBACK_DAYS)
    return jsonify(snapshot), 200


@bp.get("/api/pilot/menu-items/<int:item_id>")
@login_required
def menu_item_detail(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = require_permission(membership.role if membership else None, "operational.read")
    if permission_error is not None:
        return permission_error
    menu_item = MenuItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if menu_item is None:
        return json_error("Menu item not found.", 404)
    snapshot = _menu_snapshot(organization.id, location.id)
    item_payload = next((entry for entry in snapshot["menuItems"] if entry["id"] == menu_item.id), None)
    if item_payload is None:
        return json_error("Menu item not found.", 404)
    return jsonify(item_payload), 200


@bp.post("/api/pilot/menu-items")
@login_required
def create_menu_item():
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_menu_manage(membership)
    if permission_error is not None:
        return permission_error
    payload = _validate_menu_item_payload(_json_body())
    name = str(payload.get("name") or "").strip()
    normalized = _normalize_name(name)
    duplicate = MenuItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=normalized).first()
    if duplicate is not None:
        return json_error("A menu item with that name already exists.", 409)
    menu_item = MenuItem(
        organization_id=organization.id,
        location_id=location.id,
        name=name,
        normalized_name=normalized,
        category=str(payload.get("category") or "Other").strip() or "Other",
        selling_price=_to_decimal(payload.get("sellingPrice"), field="sellingPrice"),
        active=bool(payload.get("active", True)),
        notes=str(payload.get("notes") or "").strip(),
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.session.add(menu_item)
    db.session.flush()
    if isinstance(payload.get("recipeLines"), list) and payload.get("recipeLines"):
        _replace_recipe(menu_item, list(payload.get("recipeLines") or []))
    record_audit_event(
        event_type="menu.item_created",
        entity_type="menu_item",
        entity_id=menu_item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"name": menu_item.name, "category": menu_item.category, "sellingPrice": decimal_to_float(menu_item.selling_price) or 0},
    )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return json_error("Could not create the menu item.", 500)
    return jsonify(_menu_snapshot(organization.id, location.id)), 201


@bp.patch("/api/pilot/menu-items/<int:item_id>")
@login_required
def update_menu_item(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_menu_manage(membership)
    if permission_error is not None:
        return permission_error
    menu_item = MenuItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if menu_item is None:
        return json_error("Menu item not found.", 404)
    payload = _validate_menu_item_payload(_json_body())
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        normalized = _normalize_name(name)
        duplicate = MenuItem.query.filter(
            MenuItem.organization_id == organization.id,
            MenuItem.location_id == location.id,
            MenuItem.normalized_name == normalized,
            MenuItem.id != menu_item.id,
        ).first()
        if duplicate is not None:
            return json_error("A menu item with that name already exists.", 409)
        menu_item.name = name
        menu_item.normalized_name = normalized
    if "category" in payload:
        menu_item.category = str(payload.get("category") or "Other").strip() or "Other"
    if "sellingPrice" in payload:
        menu_item.selling_price = _to_decimal(payload.get("sellingPrice"), field="sellingPrice")
    if "active" in payload:
        menu_item.active = bool(payload.get("active"))
    if "notes" in payload:
        menu_item.notes = str(payload.get("notes") or "").strip()
    menu_item.updated_by_user_id = current_user.id
    menu_item.updated_at = _now()
    if isinstance(payload.get("recipeLines"), list):
        _replace_recipe(menu_item, list(payload.get("recipeLines") or []))
    record_audit_event(
        event_type="menu.item_updated",
        entity_type="menu_item",
        entity_id=menu_item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"name": menu_item.name, "category": menu_item.category, "sellingPrice": decimal_to_float(menu_item.selling_price) or 0},
    )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return json_error("Could not update the menu item.", 500)
    return jsonify(_menu_snapshot(organization.id, location.id)), 200


@bp.delete("/api/pilot/menu-items/<int:item_id>")
@login_required
def delete_menu_item(item_id: int):
    context = _require_context()
    if context is None:
        return json_error("No pilot location is available for the current account.", 404)
    organization, membership, _, location = context
    permission_error = _require_menu_manage(membership)
    if permission_error is not None:
        return permission_error
    menu_item = MenuItem.query.filter_by(id=item_id, organization_id=organization.id, location_id=location.id).first()
    if menu_item is None:
        return json_error("Menu item not found.", 404)
    menu_item.active = False
    menu_item.updated_by_user_id = current_user.id
    menu_item.updated_at = _now()
    record_audit_event(
        event_type="menu.item_deactivated",
        entity_type="menu_item",
        entity_id=menu_item.id,
        organization_id=organization.id,
        location_id=location.id,
        actor_user_id=current_user.id,
        metadata={"name": menu_item.name, "category": menu_item.category, "sellingPrice": decimal_to_float(menu_item.selling_price) or 0},
    )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return json_error("Could not deactivate the menu item.", 500)
    return jsonify(_menu_snapshot(organization.id, location.id)), 200
