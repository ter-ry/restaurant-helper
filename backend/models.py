from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timezone

from flask_login import UserMixin
from sqlalchemy import CheckConstraint, UniqueConstraint
from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)


class User(UserMixin, TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    memberships = db.relationship("OrganizationMembership", back_populates="user", cascade="all, delete-orphan")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    def get_id(self) -> str:
        return str(self.id)


class Organization(TimestampMixin, db.Model):
    __tablename__ = "organizations"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False, unique=True, index=True)

    memberships = db.relationship("OrganizationMembership", back_populates="organization", cascade="all, delete-orphan")
    locations = db.relationship("RestaurantLocation", back_populates="organization", cascade="all, delete-orphan")


class OrganizationMembership(TimestampMixin, db.Model):
    __tablename__ = "organization_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_membership_user_organization"),
        CheckConstraint("role in ('owner', 'manager')", name="ck_membership_role"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)

    user = db.relationship("User", back_populates="memberships")
    organization = db.relationship("Organization", back_populates="memberships")


class RestaurantLocation(TimestampMixin, db.Model):
    __tablename__ = "restaurant_locations"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    address_line1 = db.Column(db.String(255), nullable=False, default="")
    address_line2 = db.Column(db.String(255), nullable=False, default="")
    city = db.Column(db.String(120), nullable=False, default="")
    region = db.Column(db.String(120), nullable=False, default="")
    postal_code = db.Column(db.String(40), nullable=False, default="")
    country = db.Column(db.String(120), nullable=False, default="Canada")
    timezone = db.Column(db.String(120), nullable=False, default="America/Toronto")

    organization = db.relationship("Organization", back_populates="locations")


class Supplier(TimestampMixin, db.Model):
    __tablename__ = "suppliers"
    __table_args__ = (UniqueConstraint("organization_id", "normalized_name", name="uq_supplier_org_normalized_name"),)

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    normalized_name = db.Column(db.String(255), nullable=False)
    category_focus = db.Column(db.String(120), nullable=False, default="Other")
    notes = db.Column(db.Text, nullable=False, default="")
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    organization = db.relationship("Organization")


class InventoryItem(TimestampMixin, db.Model):
    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("organization_id", "location_id", "normalized_name", name="uq_inventory_item_org_location_normalized_name"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    name = db.Column(db.String(255), nullable=False)
    normalized_name = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(120), nullable=False, default="Other")
    stock_unit = db.Column(db.String(60), nullable=False, default="each")
    current_on_hand = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    min_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    par_level = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    preferred_supplier_name = db.Column(db.String(255), nullable=False, default="")
    latest_purchase_price = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    last_purchase_unit = db.Column(db.String(60), nullable=False, default="each")
    last_purchase_conversion_factor = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("1"))
    last_received_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_counted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    average_daily_usage = db.Column(db.Numeric(12, 4), nullable=True)
    estimated_cost_method = db.Column(db.String(60), nullable=False, default="latest_purchase")
    active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.Text, nullable=False, default="")
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    supplier = db.relationship("Supplier")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    updated_by = db.relationship("User", foreign_keys=[updated_by_user_id])


class SupplierItemMapping(TimestampMixin, db.Model):
    __tablename__ = "supplier_item_mappings"
    __table_args__ = (
        UniqueConstraint("organization_id", "supplier_id", "inventory_item_id", "normalized_supplier_item_name", name="uq_supplier_item_mapping"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_item_name = db.Column(db.String(255), nullable=False)
    normalized_supplier_item_name = db.Column(db.String(255), nullable=False)
    purchase_unit = db.Column(db.String(60), nullable=False, default="each")
    inventory_unit = db.Column(db.String(60), nullable=False, default="each")
    conversion_factor = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("1"))
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    supplier = db.relationship("Supplier")
    inventory_item = db.relationship("InventoryItem")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    updated_by = db.relationship("User", foreign_keys=[updated_by_user_id])


class PurchaseInvoice(TimestampMixin, db.Model):
    __tablename__ = "purchase_invoices"
    __table_args__ = (
        UniqueConstraint("organization_id", "location_id", "supplier_id", "invoice_number", name="uq_invoice_org_location_supplier_number"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True)
    invoice_number = db.Column(db.String(120), nullable=False)
    invoice_date = db.Column(db.Date, nullable=False)
    subtotal = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    tax = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    total_amount = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    notes = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="Draft")
    source_file_name = db.Column(db.String(255), nullable=False, default="")
    source_file_type = db.Column(db.String(120), nullable=False, default="")
    source_file_key = db.Column(db.String(255), nullable=False, default="")
    extracted_text = db.Column(db.Text, nullable=False, default="")
    extraction_status = db.Column(db.String(40), nullable=False, default="manual")
    received_at = db.Column(db.DateTime(timezone=True), nullable=True)
    received_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    posted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    supplier = db.relationship("Supplier")
    lines = db.relationship("PurchaseInvoiceLine", back_populates="invoice", cascade="all, delete-orphan", order_by="PurchaseInvoiceLine.line_index.asc()")
    received_by = db.relationship("User", foreign_keys=[received_by_user_id])
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    updated_by = db.relationship("User", foreign_keys=[updated_by_user_id])


class PurchaseInvoiceLine(TimestampMixin, db.Model):
    __tablename__ = "purchase_invoice_lines"

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(db.Integer, db.ForeignKey("purchase_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True, index=True)
    supplier_item_mapping_id = db.Column(db.Integer, db.ForeignKey("supplier_item_mappings.id", ondelete="SET NULL"), nullable=True, index=True)
    line_index = db.Column(db.Integer, nullable=False, default=0)
    description = db.Column(db.String(255), nullable=False)
    normalized_description = db.Column(db.String(255), nullable=False)
    purchase_unit = db.Column(db.String(60), nullable=False, default="each")
    inventory_unit = db.Column(db.String(60), nullable=False, default="each")
    conversion_factor = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("1"))
    quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    unit_price = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    line_total = db.Column(db.Numeric(12, 2), nullable=False, default=Decimal("0"))
    confidence = db.Column(db.Numeric(5, 4), nullable=False, default=Decimal("0"))
    needs_review = db.Column(db.Boolean, nullable=False, default=True)
    previous_unit_price = db.Column(db.Numeric(12, 2), nullable=True)
    price_change_percent = db.Column(db.Numeric(8, 2), nullable=True)
    note = db.Column(db.Text, nullable=False, default="")

    invoice = db.relationship("PurchaseInvoice", back_populates="lines")
    inventory_item = db.relationship("InventoryItem")
    supplier_item_mapping = db.relationship("SupplierItemMapping")


class InventoryMovement(TimestampMixin, db.Model):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        UniqueConstraint("organization_id", "location_id", "source_type", "source_record_id", "source_line_id", name="uq_inventory_movement_source"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity_delta = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    quantity_before = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    quantity_after = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    unit = db.Column(db.String(60), nullable=False, default="each")
    source_type = db.Column(db.String(60), nullable=False)
    source_record_id = db.Column(db.String(120), nullable=False, default="")
    source_line_id = db.Column(db.String(120), nullable=False, default="")
    reason = db.Column(db.Text, nullable=False, default="")
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    inventory_item = db.relationship("InventoryItem")
    actor = db.relationship("User")


class StockCountSession(TimestampMixin, db.Model):
    __tablename__ = "stock_count_sessions"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    status = db.Column(db.String(30), nullable=False, default="Draft")
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    counted_by = db.Column(db.String(255), nullable=False, default="")
    notes = db.Column(db.Text, nullable=False, default="")
    item_count = db.Column(db.Integer, nullable=False, default=0)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    finalized_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    lines = db.relationship("StockCountSessionLine", back_populates="session", cascade="all, delete-orphan", order_by="StockCountSessionLine.line_index.asc()")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    finalized_by = db.relationship("User", foreign_keys=[finalized_by_user_id])


class StockCountSessionLine(TimestampMixin, db.Model):
    __tablename__ = "stock_count_session_lines"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("stock_count_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    line_index = db.Column(db.Integer, nullable=False, default=0)
    item_name_snapshot = db.Column(db.String(255), nullable=False)
    stock_unit_snapshot = db.Column(db.String(60), nullable=False, default="each")
    expected_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    counted_quantity = db.Column(db.Numeric(12, 4), nullable=True)
    variance = db.Column(db.Numeric(12, 4), nullable=True)
    resulting_quantity = db.Column(db.Numeric(12, 4), nullable=True)
    note = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="pending")

    session = db.relationship("StockCountSession", back_populates="lines")
    inventory_item = db.relationship("InventoryItem")


class ReorderPlan(TimestampMixin, db.Model):
    __tablename__ = "reorder_plans"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False, default="Current reorder plan")
    status = db.Column(db.String(30), nullable=False, default="Draft")
    notes = db.Column(db.Text, nullable=False, default="")
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    prepared_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    completed_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    prepared_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    lines = db.relationship("ReorderPlanLine", back_populates="plan", cascade="all, delete-orphan", order_by="ReorderPlanLine.line_index.asc()")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    prepared_by = db.relationship("User", foreign_keys=[prepared_by_user_id])
    completed_by = db.relationship("User", foreign_keys=[completed_by_user_id])


class ReorderPlanLine(TimestampMixin, db.Model):
    __tablename__ = "reorder_plan_lines"

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(db.Integer, db.ForeignKey("reorder_plans.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True)
    line_index = db.Column(db.Integer, nullable=False, default=0)
    inventory_item_name_snapshot = db.Column(db.String(255), nullable=False)
    supplier_name_snapshot = db.Column(db.String(255), nullable=False, default="")
    category_snapshot = db.Column(db.String(120), nullable=False, default="Other")
    purchase_unit_snapshot = db.Column(db.String(60), nullable=False, default="each")
    inventory_unit_snapshot = db.Column(db.String(60), nullable=False, default="each")
    conversion_factor_snapshot = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("1"))
    current_on_hand_snapshot = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    minimum_quantity_snapshot = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    par_level_snapshot = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    suggested_quantity_snapshot = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    order_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    excluded = db.Column(db.Boolean, nullable=False, default=False)
    estimated_unit_cost_snapshot = db.Column(db.Numeric(12, 2), nullable=True)
    estimated_line_cost_snapshot = db.Column(db.Numeric(12, 2), nullable=True)
    notes = db.Column(db.Text, nullable=False, default="")

    plan = db.relationship("ReorderPlan", back_populates="lines")
    inventory_item = db.relationship("InventoryItem")
    supplier = db.relationship("Supplier")


class ReorderIntent(TimestampMixin, db.Model):
    __tablename__ = "reorder_intents"
    __table_args__ = (UniqueConstraint("organization_id", "location_id", "inventory_item_id", name="uq_reorder_intent_item_location"),)

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    suggested_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    adjusted_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=Decimal("0"))
    estimated_cost = db.Column(db.Numeric(12, 2), nullable=True)
    status = db.Column(db.String(30), nullable=False, default="Needs ordering")
    ordered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    notes = db.Column(db.Text, nullable=False, default="")
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    inventory_item = db.relationship("InventoryItem")
    actor = db.relationship("User")
