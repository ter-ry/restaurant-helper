from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os

from .extensions import db
from .models import (
    AuditEvent,
    DashboardLayout,
    ExternalIdentity,
    InventoryItem,
    InventoryMovement,
    MenuItem,
    MenuRecipe,
    MenuRecipeLine,
    Organization,
    OrganizationConfiguration,
    OrganizationConfigurationVersion,
    OrganizationInvitation,
    OrganizationMembership,
    OrganizationModule,
    PlatformRole,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    ReorderIntent,
    RestaurantLocation,
    SquareCatalogMapping,
    SquareCatalogObject,
    SquareConnection,
    SquareLocation,
    SquareLocationMapping,
    SquareSyncCursor,
    SquareSyncJob,
    SquareWebhookEvent,
    StockCountSession,
    StockCountSessionLine,
    SupportAccessGrant,
    Supplier,
    SupplierItemMapping,
    User,
)


LOCAL_OWNER_EMAIL = "owner@flowtally.local"
LOCAL_OWNER_PASSWORD = "PilotOwner123!"
LOCAL_MANAGER_EMAIL = "manager@flowtally.local"
LOCAL_MANAGER_PASSWORD = "PilotManager123!"
LOCAL_ORGANIZATION_NAME = "Flowtally Pilot Restaurant"
LOCAL_LOCATION_NAME = "Flowtally Pilot Kitchen"


@dataclass(slots=True)
class SeedResult:
    organization_id: int
    owner_id: int
    manager_id: int
    location_id: int


SUPPLIER_SEED = [
    {"name": "Oak Valley Meat Co", "category_focus": "Chicken, protein, proteins", "contact_name": "Mina Patel", "contact_phone": "416-555-0188", "contact_email": "orders@oakvalleymeat.ca", "ordering_notes": "Order by 2pm for next-day delivery."},
    {"name": "Metro Packaging Co", "category_focus": "Cups, lids, straws, napkins", "contact_name": "Jordan Lee", "contact_phone": "416-555-0144", "contact_email": "toronto@metropackaging.ca", "ordering_notes": "Case pack sizes only."},
    {"name": "GTA Beverage Supply", "category_focus": "Tea, tapioca, milk, drink base", "contact_name": "Sofia Chen", "contact_phone": "416-555-0192", "contact_email": "hello@gtabeverage.ca", "ordering_notes": "Weekly delivery every Tuesday."},
    {"name": "Fresh Dairy Toronto", "category_focus": "Cream, milk, eggs", "contact_name": "Noah Brown", "contact_phone": "416-555-0136", "contact_email": "orders@freshdairyto.ca", "ordering_notes": "Cooler delivery; confirm after 4pm."},
    {"name": "Northern Produce Market", "category_focus": "Lettuce, produce, vegetables", "contact_name": "Ari Singh", "contact_phone": "416-555-0167", "contact_email": "produce@northernmarket.ca", "ordering_notes": "Harvest pricing changes daily."},
    {"name": "Harbour Dry Goods", "category_focus": "Rice, noodles, pasta, sugar, oil", "contact_name": "Lena Gomez", "contact_phone": "416-555-0119", "contact_email": "orders@harbourdrygoods.ca", "ordering_notes": "Use replacement items when stock is tight."},
]

INVENTORY_SEED = [
    {"name": "Chicken Breast", "category": "Protein", "stock_unit": "kg", "current_on_hand": 1.5, "min_quantity": 4, "par_level": 8, "preferred_supplier": "Oak Valley Meat Co", "latest_purchase_price": 7.80, "average_daily_usage": 1.2},
    {"name": "Rice", "category": "Dry goods", "stock_unit": "kg", "current_on_hand": 9, "min_quantity": 8, "par_level": 20, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 3.20, "average_daily_usage": 0.95},
    {"name": "Noodles", "category": "Dry goods", "stock_unit": "kg", "current_on_hand": 3.5, "min_quantity": 4, "par_level": 10, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 4.40, "average_daily_usage": 0.65},
    {"name": "Pasta", "category": "Dry goods", "stock_unit": "kg", "current_on_hand": 2, "min_quantity": 2, "par_level": 6, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 4.80, "average_daily_usage": 0.45},
    {"name": "Tomato Sauce", "category": "Prep", "stock_unit": "L", "current_on_hand": 1, "min_quantity": 2, "par_level": 5, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 6.25, "average_daily_usage": 0.28},
    {"name": "Cream", "category": "Dairy", "stock_unit": "L", "current_on_hand": 5, "min_quantity": 3, "par_level": 9, "preferred_supplier": "Fresh Dairy Toronto", "latest_purchase_price": 4.40, "average_daily_usage": 0.6},
    {"name": "Eggs", "category": "Breakfast", "stock_unit": "dozen", "current_on_hand": 0, "min_quantity": 1, "par_level": 3, "preferred_supplier": "Fresh Dairy Toronto", "latest_purchase_price": 5.90, "average_daily_usage": 0.75},
    {"name": "Bread Buns", "category": "Bakery", "stock_unit": "pack", "current_on_hand": 4, "min_quantity": 6, "par_level": 14, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 2.60, "average_daily_usage": 0.9},
    {"name": "Lettuce", "category": "Produce", "stock_unit": "head", "current_on_hand": 0.5, "min_quantity": 1, "par_level": 4, "preferred_supplier": "Northern Produce Market", "latest_purchase_price": 1.85, "average_daily_usage": 0.35},
    {"name": "Sugar", "category": "Dry goods", "stock_unit": "kg", "current_on_hand": 10, "min_quantity": 5, "par_level": 12, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 2.90, "average_daily_usage": 0.45},
    {"name": "Vegetable Oil", "category": "Prep", "stock_unit": "L", "current_on_hand": 15, "min_quantity": 4, "par_level": 10, "preferred_supplier": "Harbour Dry Goods", "latest_purchase_price": 8.20, "average_daily_usage": 0.2},
    {"name": "Tea Base", "category": "Drink base", "stock_unit": "kg", "current_on_hand": 20, "min_quantity": 10, "par_level": 18, "preferred_supplier": "GTA Beverage Supply", "latest_purchase_price": 18.50, "average_daily_usage": 0.9},
    {"name": "Milk", "category": "Dairy", "stock_unit": "L", "current_on_hand": 8, "min_quantity": 6, "par_level": 12, "preferred_supplier": "Fresh Dairy Toronto", "latest_purchase_price": 2.85, "average_daily_usage": 1.6},
    {"name": "Tapioca Pearls", "category": "Drink base", "stock_unit": "kg", "current_on_hand": 0.5, "min_quantity": 2, "par_level": 6, "preferred_supplier": "GTA Beverage Supply", "latest_purchase_price": 48.00, "average_daily_usage": 0.18},
    {"name": "Cups", "category": "Packaging", "stock_unit": "each", "current_on_hand": 24, "min_quantity": 12, "par_level": 24, "preferred_supplier": "Metro Packaging Co", "latest_purchase_price": 0.16, "average_daily_usage": 1.0},
    {"name": "Lids", "category": "Packaging", "stock_unit": "each", "current_on_hand": 16, "min_quantity": 8, "par_level": 20, "preferred_supplier": "Metro Packaging Co", "latest_purchase_price": 0.06, "average_daily_usage": 0.85},
    {"name": "Straws", "category": "Packaging", "stock_unit": "each", "current_on_hand": 30, "min_quantity": 10, "par_level": 30, "preferred_supplier": "Metro Packaging Co", "latest_purchase_price": 0.03, "average_daily_usage": 0.4},
    {"name": "Napkins", "category": "Packaging", "stock_unit": "each", "current_on_hand": 45, "min_quantity": 20, "par_level": 40, "preferred_supplier": "Metro Packaging Co", "latest_purchase_price": 0.02, "average_daily_usage": 0.55},
]

INVOICE_SEED = [
    {
        "supplier": "Oak Valley Meat Co",
        "invoice_number": "OV-1038",
        "days_ago": 17,
        "status": "Completed",
        "lines": [
            {"item": "Chicken Breast", "description": "Chicken Breast 1kg", "quantity": 1, "unit_price": 7.20, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "Oak Valley Meat Co",
        "invoice_number": "OV-1041",
        "days_ago": 13,
        "status": "Completed",
        "lines": [
            {"item": "Chicken Breast", "description": "Chicken Breast 1kg", "quantity": 1, "unit_price": 7.80, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "Metro Packaging Co",
        "invoice_number": "MP-2200",
        "days_ago": 16,
        "status": "Completed",
        "lines": [
            {"item": "Cups", "description": "Cup 50-pack", "quantity": 2, "unit_price": 3.95, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 50},
            {"item": "Lids", "description": "Lid 50-pack", "quantity": 1, "unit_price": 2.05, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 50},
            {"item": "Straws", "description": "Straw sleeve 100-pack", "quantity": 1, "unit_price": 1.40, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 100},
            {"item": "Napkins", "description": "Napkin 250-pack", "quantity": 1, "unit_price": 1.10, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 250},
        ],
    },
    {
        "supplier": "Metro Packaging Co",
        "invoice_number": "MP-2201",
        "days_ago": 9,
        "status": "Completed",
        "lines": [
            {"item": "Cups", "description": "Cup 50-pack", "quantity": 2, "unit_price": 4.10, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 50},
            {"item": "Lids", "description": "Lid 50-pack", "quantity": 1, "unit_price": 2.20, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 50},
            {"item": "Straws", "description": "Straw sleeve 100-pack", "quantity": 1, "unit_price": 1.45, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 100},
            {"item": "Napkins", "description": "Napkin 250-pack", "quantity": 1, "unit_price": 1.15, "purchase_unit": "pack", "inventory_unit": "each", "conversion_factor": 250},
        ],
    },
    {
        "supplier": "GTA Beverage Supply",
        "invoice_number": "GB-3300",
        "days_ago": 15,
        "status": "Completed",
        "lines": [
            {"item": "Tea Base", "description": "Tea Base 2kg", "quantity": 2, "unit_price": 17.90, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Tapioca Pearls", "description": "Tapioca Pearls 0.25kg", "quantity": 2, "unit_price": 44.00, "purchase_unit": "bag", "inventory_unit": "kg", "conversion_factor": 0.25},
            {"item": "Milk", "description": "Milk 2L", "quantity": 2, "unit_price": 2.65, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "GTA Beverage Supply",
        "invoice_number": "GB-3301",
        "days_ago": 8,
        "status": "Completed",
        "lines": [
            {"item": "Tea Base", "description": "Tea Base 2kg", "quantity": 2, "unit_price": 18.50, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Tapioca Pearls", "description": "Tapioca Pearls 0.25kg", "quantity": 2, "unit_price": 48.00, "purchase_unit": "bag", "inventory_unit": "kg", "conversion_factor": 0.25},
            {"item": "Milk", "description": "Milk 2L", "quantity": 2, "unit_price": 2.85, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "Harbour Dry Goods",
        "invoice_number": "HD-5501",
        "days_ago": 7,
        "status": "Completed",
        "lines": [
            {"item": "Rice", "description": "Rice 3kg", "quantity": 3, "unit_price": 3.10, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Noodles", "description": "Noodles 1.5kg", "quantity": 1.5, "unit_price": 4.30, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Pasta", "description": "Pasta 1kg", "quantity": 1, "unit_price": 4.60, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Sugar", "description": "Sugar 2kg", "quantity": 2, "unit_price": 2.85, "purchase_unit": "kg", "inventory_unit": "kg", "conversion_factor": 1},
            {"item": "Vegetable Oil", "description": "Vegetable Oil 3L", "quantity": 1, "unit_price": 8.20, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 3},
            {"item": "Bread Buns", "description": "Bread Buns 4-pack", "quantity": 4, "unit_price": 2.40, "purchase_unit": "pack", "inventory_unit": "pack", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "Fresh Dairy Toronto",
        "invoice_number": "FD-4400",
        "days_ago": 6,
        "status": "Draft",
        "lines": [
            {"item": "Cream", "description": "Cream 1L", "quantity": 1, "unit_price": 4.35, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 1},
            {"item": "Eggs", "description": "Eggs 12-pack", "quantity": 1, "unit_price": 5.80, "purchase_unit": "dozen", "inventory_unit": "dozen", "conversion_factor": 1},
            {"item": "Milk", "description": "Milk 4L", "quantity": 4, "unit_price": 2.90, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 1},
        ],
    },
    {
        "supplier": "Northern Produce Market",
        "invoice_number": "NP-6600",
        "days_ago": 5,
        "status": "Draft",
        "lines": [
            {"item": "Lettuce", "description": "Lettuce head", "quantity": 0.5, "unit_price": 1.70, "purchase_unit": "head", "inventory_unit": "head", "conversion_factor": 1},
            {"item": "Tomato Sauce", "description": "Tomato Sauce 1L", "quantity": 1, "unit_price": 6.10, "purchase_unit": "L", "inventory_unit": "L", "conversion_factor": 1},
        ],
    },
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _seed_date(days_ago: int) -> date:
    return (_now() - timedelta(days=days_ago)).date()


def _upsert_user(*, email: str, password: str, is_active: bool = True) -> User:
    user = User.query.filter_by(email=email).first()
    if user is None:
        user = User(email=email, is_active=is_active)
        db.session.add(user)
    else:
        user.is_active = is_active
    user.set_password(password)
    return user


def _upsert_organization() -> Organization:
    organization = Organization.query.filter_by(name=LOCAL_ORGANIZATION_NAME).first()
    if organization is None:
        organization = Organization(
            name=LOCAL_ORGANIZATION_NAME,
            lifecycle_status="ACTIVE",
            setup_status="COMPLETE",
            subscription_status="ACTIVE",
            setup_template_key="CAFE",
            setup_fee_status="confirmed",
            subscription_provider="manual",
            external_customer_reference="seed-local-customer",
            external_subscription_reference="seed-local-subscription",
            is_prospect=False,
            active_at=_now(),
            setup_completed_at=_now(),
        )
        db.session.add(organization)
    else:
        organization.lifecycle_status = "ACTIVE"
        organization.setup_status = "COMPLETE"
        organization.subscription_status = "ACTIVE"
        organization.setup_template_key = "CAFE"
        organization.setup_fee_status = "confirmed"
        organization.subscription_provider = "manual"
        organization.external_customer_reference = "seed-local-customer"
        organization.external_subscription_reference = "seed-local-subscription"
        organization.is_prospect = False
        organization.active_at = organization.active_at or _now()
        organization.setup_completed_at = organization.setup_completed_at or _now()
        organization.suspended_at = None
        organization.cancelled_at = None
    return organization


def _upsert_module(organization: Organization, module_key: str, *, status: str = "ENABLED") -> OrganizationModule:
    module = OrganizationModule.query.filter_by(organization_id=organization.id, module_key=module_key).first()
    if module is None:
        module = OrganizationModule(
            organization_id=organization.id,
            module_key=module_key,
            status=status,
            configuration_json={},
            enabled_at=_now(),
        )
        db.session.add(module)
    else:
        module.status = status
        module.enabled_at = module.enabled_at or _now()
    return module


def _upsert_membership(user: User, organization: Organization, role: str) -> OrganizationMembership:
    membership = OrganizationMembership.query.filter_by(user_id=user.id, organization_id=organization.id).first()
    if membership is None:
        membership = OrganizationMembership(user=user, organization=organization, role=role)
        db.session.add(membership)
    else:
        membership.role = role
    return membership


def _upsert_location(organization: Organization) -> RestaurantLocation:
    location = RestaurantLocation.query.filter_by(organization_id=organization.id, name=LOCAL_LOCATION_NAME).first()
    if location is None:
        location = RestaurantLocation(
            organization=organization,
            name=LOCAL_LOCATION_NAME,
            address_line1="123 Queen St W",
            address_line2="Suite 400",
            city="Toronto",
            region="ON",
            postal_code="M5H 2M9",
            country="Canada",
            timezone="America/Toronto",
        )
        db.session.add(location)
    return location


def _normalize_name(value: str) -> str:
    return " ".join(" ".join(ch if ch.isalnum() else " " for ch in value.lower()).split())


def _clear_seed_data() -> None:
    for model in [
        AuditEvent,
        SquareWebhookEvent,
        SquareSyncCursor,
        SquareSyncJob,
        SquareCatalogMapping,
        SquareCatalogObject,
        SquareLocationMapping,
        SquareLocation,
        SquareConnection,
        MenuRecipeLine,
        MenuRecipe,
        MenuItem,
        DashboardLayout,
        OrganizationConfigurationVersion,
        OrganizationConfiguration,
        OrganizationInvitation,
        OrganizationModule,
        SupportAccessGrant,
        PlatformRole,
        ExternalIdentity,
        InventoryMovement,
        SupplierItemMapping,
        PurchaseInvoiceLine,
        ReorderIntent,
        StockCountSessionLine,
        StockCountSession,
        PurchaseInvoice,
        InventoryItem,
        Supplier,
        RestaurantLocation,
        OrganizationMembership,
        User,
        Organization,
    ]:
        db.session.query(model).delete(synchronize_session=False)
    db.session.flush()


def _get_or_create_supplier(organization: Organization, spec: dict[str, str]) -> Supplier:
    normalized = _normalize_name(spec["name"])
    supplier = Supplier.query.filter_by(organization_id=organization.id, normalized_name=normalized).first()
    if supplier is None:
        supplier = Supplier(
            organization_id=organization.id,
            name=spec["name"],
            normalized_name=normalized,
            category_focus=spec["category_focus"],
            contact_name=spec.get("contact_name", ""),
            contact_phone=spec.get("contact_phone", ""),
            contact_email=spec.get("contact_email", ""),
            ordering_notes=spec.get("ordering_notes", ""),
            notes="",
        )
        db.session.add(supplier)
    else:
        supplier.name = spec["name"]
        supplier.category_focus = spec["category_focus"]
        supplier.contact_name = spec.get("contact_name", "")
        supplier.contact_phone = spec.get("contact_phone", "")
        supplier.contact_email = spec.get("contact_email", "")
        supplier.ordering_notes = spec.get("ordering_notes", "")
    return supplier


def _get_or_create_inventory_item(organization: Organization, location: RestaurantLocation, supplier_by_name: dict[str, Supplier], spec: dict[str, object]) -> InventoryItem:
    normalized = _normalize_name(str(spec["name"]))
    item = InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=normalized).first()
    supplier = supplier_by_name.get(str(spec["preferred_supplier"]))
    if item is None:
        item = InventoryItem(
            organization_id=organization.id,
            location_id=location.id,
            supplier_id=supplier.id if supplier else None,
            name=str(spec["name"]),
            normalized_name=normalized,
            category=str(spec["category"]),
            stock_unit=str(spec["stock_unit"]),
            current_on_hand=Decimal(str(spec["current_on_hand"])),
            min_quantity=Decimal(str(spec["min_quantity"])),
            par_level=Decimal(str(spec["par_level"])),
            preferred_supplier_name=str(spec["preferred_supplier"]),
            latest_purchase_price=Decimal(str(spec["latest_purchase_price"])),
            last_purchase_unit=str(spec["stock_unit"]),
            last_purchase_conversion_factor=Decimal("1"),
            last_received_at=None,
            last_counted_at=None,
            average_daily_usage=Decimal(str(spec["average_daily_usage"])),
            estimated_cost_method="latest_purchase",
            active=True,
            notes="",
        )
        db.session.add(item)
    else:
        item.supplier_id = supplier.id if supplier else None
        item.name = str(spec["name"])
        item.normalized_name = normalized
        item.category = str(spec["category"])
        item.stock_unit = str(spec["stock_unit"])
        item.current_on_hand = Decimal(str(spec["current_on_hand"]))
        item.min_quantity = Decimal(str(spec["min_quantity"]))
        item.par_level = Decimal(str(spec["par_level"]))
        item.preferred_supplier_name = str(spec["preferred_supplier"])
        item.latest_purchase_price = Decimal(str(spec["latest_purchase_price"]))
        item.last_purchase_unit = str(spec["stock_unit"])
        item.last_purchase_conversion_factor = Decimal("1")
        item.average_daily_usage = Decimal(str(spec["average_daily_usage"]))
        item.active = True
        item.notes = ""
    return item


def _line_total(quantity: object, unit_price: object) -> Decimal:
    return Decimal(str(quantity)) * Decimal(str(unit_price))


def _seed_invoice(
    organization: Organization,
    location: RestaurantLocation,
    supplier_by_name: dict[str, Supplier],
    item_by_name: dict[str, InventoryItem],
    spec: dict[str, object],
    *,
    actor_id: int,
) -> PurchaseInvoice:
    supplier = supplier_by_name[str(spec["supplier"])]
    invoice_number = str(spec["invoice_number"])
    invoice = PurchaseInvoice.query.filter_by(
        organization_id=organization.id,
        location_id=location.id,
        supplier_id=supplier.id,
        invoice_number=invoice_number,
    ).first()
    if invoice is None:
        invoice = PurchaseInvoice(
            organization_id=organization.id,
            location_id=location.id,
            supplier_id=supplier.id,
            invoice_number=invoice_number,
            invoice_date=_seed_date(int(spec["days_ago"])),
            subtotal=Decimal("0"),
            tax=Decimal("0"),
            total_amount=Decimal("0"),
            notes="",
            status=str(spec["status"]),
            source_file_name=f"{invoice_number}.pdf",
            source_file_type="application/pdf",
            source_file_key="",
            extracted_text="Seeded pilot invoice",
            extraction_status="manual",
            created_by_user_id=actor_id,
            updated_by_user_id=actor_id,
        )
        db.session.add(invoice)
        db.session.flush()
    else:
        invoice.invoice_date = _seed_date(int(spec["days_ago"]))
        invoice.status = str(spec["status"])
        invoice.source_file_name = f"{invoice_number}.pdf"
        invoice.source_file_type = "application/pdf"
        invoice.extracted_text = "Seeded pilot invoice"
        invoice.extraction_status = "manual"
        invoice.updated_by_user_id = actor_id

    invoice.lines.clear()
    db.session.flush()

    subtotal = Decimal("0")
    for index, line_spec in enumerate(spec["lines"]):
        item = item_by_name[str(line_spec["item"])]
        quantity = Decimal(str(line_spec["quantity"]))
        unit_price = Decimal(str(line_spec["unit_price"]))
        line_total = _line_total(quantity, unit_price)
        subtotal += line_total
        line = PurchaseInvoiceLine(
            invoice=invoice,
            inventory_item_id=item.id,
            line_index=index,
            description=str(line_spec["description"]),
            normalized_description=_normalize_name(str(line_spec["description"])),
            purchase_unit=str(line_spec.get("purchase_unit", "each")),
            inventory_unit=str(line_spec.get("inventory_unit", item.stock_unit)),
            conversion_factor=Decimal(str(line_spec.get("conversion_factor", 1))),
            quantity=quantity,
            unit_price=unit_price,
            line_total=line_total,
            confidence=Decimal("0.92"),
            needs_review=False,
            previous_unit_price=unit_price if str(spec["status"]) == "Completed" and line_spec["description"].startswith("Chicken Breast") else None,
            price_change_percent=None,
            note="",
        )
        db.session.add(line)

    invoice.subtotal = subtotal
    invoice.tax = (subtotal * Decimal("0.13")).quantize(Decimal("0.01"))
    invoice.total_amount = (invoice.subtotal + invoice.tax).quantize(Decimal("0.01"))
    invoice.notes = "Seeded pilot invoice"
    invoice.updated_by_user_id = actor_id

    db.session.flush()

    if str(spec["status"]) == "Completed":
        _apply_invoice_receipt(invoice, actor_id)

    return invoice


def _apply_invoice_receipt(invoice: PurchaseInvoice, actor_id: int) -> None:
    if invoice.status == "Completed" and invoice.received_at is not None:
        return

    now = _now()
    for line in invoice.lines:
        item = line.inventory_item
        if item is None:
          continue

        quantity_delta = (Decimal(line.quantity) * Decimal(line.conversion_factor)).quantize(Decimal("0.0001"))
        before = Decimal(item.current_on_hand)
        after = (before + quantity_delta).quantize(Decimal("0.0001"))
        movement = InventoryMovement(
            organization_id=invoice.organization_id,
            location_id=invoice.location_id,
            inventory_item_id=item.id,
            quantity_delta=quantity_delta,
            quantity_before=before,
            quantity_after=after,
            unit=item.stock_unit,
            source_type="invoice receipt",
            source_record_id=str(invoice.id),
            source_line_id=str(line.id),
            reason=f"Invoice {invoice.invoice_number} received",
            actor_user_id=actor_id,
        )
        db.session.add(movement)
        item.current_on_hand = after
        item.latest_purchase_price = line.unit_price
        item.last_purchase_unit = line.purchase_unit
        item.last_purchase_conversion_factor = line.conversion_factor
        item.preferred_supplier_name = invoice.supplier.name
        item.last_received_at = now
        item.updated_by_user_id = actor_id
        item.updated_at = now

        mapping = SupplierItemMapping.query.filter_by(
            organization_id=invoice.organization_id,
            supplier_id=invoice.supplier_id,
            inventory_item_id=item.id,
            normalized_supplier_item_name=_normalize_name(line.description),
        ).first()
        if mapping is None:
            mapping = SupplierItemMapping(
                organization_id=invoice.organization_id,
                supplier_id=invoice.supplier_id,
                inventory_item_id=item.id,
                supplier_item_name=line.description,
                normalized_supplier_item_name=_normalize_name(line.description),
                purchase_unit=line.purchase_unit,
                inventory_unit=item.stock_unit,
                conversion_factor=line.conversion_factor,
                last_seen_at=now,
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
            )
            db.session.add(mapping)
        else:
            mapping.purchase_unit = line.purchase_unit
            mapping.inventory_unit = item.stock_unit
            mapping.conversion_factor = line.conversion_factor
            mapping.last_seen_at = now
            mapping.updated_by_user_id = actor_id

    invoice.status = "Completed"
    invoice.received_at = now
    invoice.received_by_user_id = actor_id
    invoice.posted_at = now
    invoice.updated_by_user_id = actor_id


def _seed_count_session(organization: Organization, location: RestaurantLocation, item_by_name: dict[str, InventoryItem], *, actor_id: int) -> StockCountSession:
    session_record = StockCountSession(
        organization_id=organization.id,
        location_id=location.id,
        status="Completed",
        started_at=_now() - timedelta(days=2),
        completed_at=_now() - timedelta(days=2, hours=-1),
        counted_by="Manager on duty",
        notes="Pilot closing count",
        item_count=5,
        created_by_user_id=actor_id,
        finalized_by_user_id=actor_id,
    )
    db.session.add(session_record)
    db.session.flush()

    lines = [
        ("Chicken Breast", 3.5, 3.3),
        ("Rice", 12, 11.5),
        ("Cups", 224, 223.5),
        ("Tapioca Pearls", 1, 1),
        ("Eggs", 0, 0),
    ]
    for index, (item_name, counted, resulting) in enumerate(lines):
        item = item_by_name[item_name]
        expected = Decimal(str(item.current_on_hand))
        counted_value = Decimal(str(counted))
        line = StockCountSessionLine(
            session_id=session_record.id,
            inventory_item_id=item.id,
            line_index=index,
            item_name_snapshot=item.name,
            stock_unit_snapshot=item.stock_unit,
            expected_quantity=expected,
            counted_quantity=counted_value,
            variance=(counted_value - expected).quantize(Decimal("0.0001")),
            resulting_quantity=Decimal(str(resulting)),
            note="Seeded count line",
            status="confirmed",
        )
        db.session.add(line)
        item.current_on_hand = Decimal(str(resulting))
        item.last_counted_at = _now() - timedelta(days=2)
        item.updated_by_user_id = actor_id
    return session_record


def _seed_opening_count_session(organization: Organization, location: RestaurantLocation, item_by_name: dict[str, InventoryItem], *, actor_id: int) -> StockCountSession:
    session_record = StockCountSession(
        organization_id=organization.id,
        location_id=location.id,
        status="Completed",
        started_at=_now() - timedelta(days=18),
        completed_at=_now() - timedelta(days=18, hours=-1),
        counted_by="Manager on duty",
        notes="Pilot opening count",
        item_count=5,
        created_by_user_id=actor_id,
        finalized_by_user_id=actor_id,
    )
    db.session.add(session_record)
    db.session.flush()

    lines = [
        ("Chicken Breast", 6.0),
        ("Rice", 10.0),
        ("Cups", 200.0),
        ("Tapioca Pearls", 2.0),
        ("Eggs", 12.0),
    ]
    for index, (item_name, counted) in enumerate(lines):
        item = item_by_name[item_name]
        counted_value = Decimal(str(counted))
        line = StockCountSessionLine(
            session_id=session_record.id,
            inventory_item_id=item.id,
            line_index=index,
            item_name_snapshot=item.name,
            stock_unit_snapshot=item.stock_unit,
            expected_quantity=counted_value,
            counted_quantity=counted_value,
            variance=Decimal("0"),
            resulting_quantity=counted_value,
            note="Seeded opening count line",
            status="confirmed",
        )
        db.session.add(line)
        item.current_on_hand = counted_value
        item.last_counted_at = _now() - timedelta(days=18)
        item.updated_by_user_id = actor_id
    return session_record


def _seed_reorder_intents(organization: Organization, location: RestaurantLocation, item_by_name: dict[str, InventoryItem], *, actor_id: int) -> None:
    for item_name in ["Chicken Breast", "Tomato Sauce", "Lettuce", "Tapioca Pearls", "Eggs"]:
        item = item_by_name[item_name]
        suggested = max(0, float(item.par_level) - float(item.current_on_hand))
        intent = ReorderIntent.query.filter_by(organization_id=organization.id, location_id=location.id, inventory_item_id=item.id).first()
        if intent is None:
            intent = ReorderIntent(
                organization_id=organization.id,
                location_id=location.id,
                inventory_item_id=item.id,
                suggested_quantity=Decimal(str(suggested)),
                adjusted_quantity=Decimal(str(suggested)),
                estimated_cost=(Decimal(str(suggested)) * item.latest_purchase_price).quantize(Decimal("0.01")) if suggested > 0 else None,
                status="Needs ordering",
                notes="Seeded reorder need",
                actor_user_id=actor_id,
            )
            db.session.add(intent)


MENU_SEED = [
    {
        "name": "Classic Milk Tea",
        "category": "Signature drinks",
        "selling_price": 7.95,
        "notes": "Core cafe drink with stable margin.",
        "recipe": [
            {"ingredient_name": "Tea Base", "quantity": 0.006, "unit": "kg", "inventory_item": "Tea Base"},
            {"ingredient_name": "Milk", "quantity": 0.25, "unit": "L", "inventory_item": "Milk"},
            {"ingredient_name": "Tapioca Pearls", "quantity": 0.03, "unit": "kg", "inventory_item": "Tapioca Pearls"},
            {"ingredient_name": "Cups", "quantity": 1, "unit": "each", "inventory_item": "Cups"},
            {"ingredient_name": "Lids", "quantity": 1, "unit": "each", "inventory_item": "Lids"},
            {"ingredient_name": "Straws", "quantity": 1, "unit": "each", "inventory_item": "Straws"},
        ],
    },
    {
        "name": "Chicken Rice Bowl",
        "category": "Lunch bowls",
        "selling_price": 14.95,
        "notes": "High-volume bowl with a tight protein cost.",
        "recipe": [
            {"ingredient_name": "Chicken Breast", "quantity": 0.16, "unit": "kg", "inventory_item": "Chicken Breast"},
            {"ingredient_name": "Rice", "quantity": 0.14, "unit": "kg", "inventory_item": "Rice"},
            {"ingredient_name": "Vegetable Oil", "quantity": 0.01, "unit": "L", "inventory_item": "Vegetable Oil"},
            {"ingredient_name": "Lettuce", "quantity": 0.25, "unit": "head", "inventory_item": "Lettuce"},
        ],
    },
    {
        "name": "Tomato Cream Pasta",
        "category": "Noodles / pasta",
        "selling_price": 15.95,
        "notes": "Lunch pasta where sauce pricing matters.",
        "recipe": [
            {"ingredient_name": "Pasta", "quantity": 0.17, "unit": "kg", "inventory_item": "Pasta"},
            {"ingredient_name": "Tomato Sauce", "quantity": 0.12, "unit": "L", "inventory_item": "Tomato Sauce"},
            {"ingredient_name": "Cream", "quantity": 0.06, "unit": "L", "inventory_item": "Cream"},
        ],
    },
]


def _seed_menu_items(
    organization: Organization,
    location: RestaurantLocation,
    item_by_name: dict[str, InventoryItem],
    *,
    actor_id: int,
) -> None:
    for spec in MENU_SEED:
        normalized = _normalize_name(spec["name"])
        menu_item = MenuItem.query.filter_by(organization_id=organization.id, location_id=location.id, normalized_name=normalized).first()
        if menu_item is None:
            menu_item = MenuItem(
                organization_id=organization.id,
                location_id=location.id,
                name=spec["name"],
                normalized_name=normalized,
                category=spec["category"],
                selling_price=Decimal(str(spec["selling_price"])),
                active=True,
                notes=spec.get("notes", ""),
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
            )
            db.session.add(menu_item)
            db.session.flush()
        else:
            menu_item.name = spec["name"]
            menu_item.normalized_name = normalized
            menu_item.category = spec["category"]
            menu_item.selling_price = Decimal(str(spec["selling_price"]))
            menu_item.notes = spec.get("notes", "")
            menu_item.active = True
            menu_item.updated_by_user_id = actor_id

        recipe = MenuRecipe.query.filter_by(organization_id=organization.id, location_id=location.id, menu_item_id=menu_item.id).first()
        if recipe is None:
            recipe = MenuRecipe(
                organization_id=organization.id,
                location_id=location.id,
                menu_item_id=menu_item.id,
                notes=spec.get("notes", ""),
                created_by_user_id=actor_id,
                updated_by_user_id=actor_id,
            )
            db.session.add(recipe)
            db.session.flush()
        else:
            recipe.notes = spec.get("notes", "")
            recipe.updated_by_user_id = actor_id
            recipe.lines = []
            db.session.flush()

        for index, line_spec in enumerate(spec["recipe"]):
            inventory_item = item_by_name.get(line_spec["inventory_item"])
            if inventory_item is None:
                continue
            recipe.lines.append(
                MenuRecipeLine(
                    organization_id=organization.id,
                    location_id=location.id,
                    recipe_id=recipe.id,
                    inventory_item_id=inventory_item.id,
                    line_index=index,
                    ingredient_name=line_spec["ingredient_name"],
                    quantity=Decimal(str(line_spec["quantity"])),
                    unit=line_spec["unit"],
                    inventory_unit=inventory_item.stock_unit,
                    purchase_unit=inventory_item.last_purchase_unit,
                    conversion_factor=inventory_item.last_purchase_conversion_factor or Decimal("1"),
                    notes="Seeded menu recipe",
                )
            )


def _current_environment() -> str:
    return os.environ.get("FLOWTALLY_ENV", os.environ.get("FLASK_ENV", "development")).strip().lower()


def _allow_seed_reset_in_current_environment(*, confirm_production: bool) -> None:
    if _current_environment() in {"staging", "production"}:
        if not confirm_production:
            raise RuntimeError("Pilot seed/reset is disabled in staging and production unless --confirm-production-seeding is provided.")
        if os.environ.get("FLOWTALLY_ALLOW_PRODUCTION_SEEDING", "").strip().lower() not in {"1", "true", "yes", "on"}:
            raise RuntimeError("FLOWTALLY_ALLOW_PRODUCTION_SEEDING must be enabled to seed or reset in staging and production.")


def seed_pilot_data(*, reset: bool = False, confirm_production: bool = False) -> SeedResult:
    _allow_seed_reset_in_current_environment(confirm_production=confirm_production)
    if reset:
        _clear_seed_data()

    organization = _upsert_organization()
    db.session.flush()

    existing_inventory_count = InventoryItem.query.filter_by(organization_id=organization.id).count()
    existing_invoice_count = PurchaseInvoice.query.filter_by(organization_id=organization.id).count()
    if not reset and existing_inventory_count and existing_invoice_count:
        owner = _upsert_user(email=LOCAL_OWNER_EMAIL, password=LOCAL_OWNER_PASSWORD, is_active=True)
        manager = _upsert_user(email=LOCAL_MANAGER_EMAIL, password=LOCAL_MANAGER_PASSWORD, is_active=True)
        db.session.flush()
        _upsert_membership(owner, organization, "owner")
        _upsert_membership(manager, organization, "manager")
        location = _upsert_location(organization)
        for module_key in ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "REPORTING"]:
            _upsert_module(organization, module_key)
        item_by_name = {
            item.name: item
            for item in InventoryItem.query.filter_by(organization_id=organization.id, location_id=location.id).all()
        }
        _seed_menu_items(organization, location, item_by_name, actor_id=owner.id)
        db.session.commit()
        return SeedResult(organization_id=organization.id, owner_id=owner.id, manager_id=manager.id, location_id=location.id)

    owner = _upsert_user(email=LOCAL_OWNER_EMAIL, password=LOCAL_OWNER_PASSWORD, is_active=True)
    manager = _upsert_user(email=LOCAL_MANAGER_EMAIL, password=LOCAL_MANAGER_PASSWORD, is_active=True)
    db.session.flush()

    _upsert_membership(owner, organization, "owner")
    _upsert_membership(manager, organization, "manager")
    location = _upsert_location(organization)
    db.session.flush()
    for module_key in ["PURCHASES", "INVENTORY", "STOCK_COUNTS", "REORDER_PLANS", "MENU_COSTING", "REPORTING"]:
        _upsert_module(organization, module_key)

    suppliers = [_get_or_create_supplier(organization, spec) for spec in SUPPLIER_SEED]
    db.session.flush()
    supplier_by_name = {supplier.name: supplier for supplier in suppliers}

    items = [_get_or_create_inventory_item(organization, location, supplier_by_name, spec) for spec in INVENTORY_SEED]
    db.session.flush()
    item_by_name = {item.name: item for item in items}

    _seed_opening_count_session(organization, location, item_by_name, actor_id=owner.id)

    for spec in INVOICE_SEED:
        _seed_invoice(organization, location, supplier_by_name, item_by_name, spec, actor_id=owner.id)
    db.session.flush()

    _seed_count_session(organization, location, item_by_name, actor_id=manager.id)
    _seed_reorder_intents(organization, location, item_by_name, actor_id=manager.id)
    _seed_menu_items(organization, location, item_by_name, actor_id=owner.id)

    db.session.commit()
    return SeedResult(organization_id=organization.id, owner_id=owner.id, manager_id=manager.id, location_id=location.id)
