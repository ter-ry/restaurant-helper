from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timezone

from flask_login import UserMixin
from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
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
    lifecycle_status = db.Column(db.String(40), nullable=False, default="ACTIVE")
    setup_status = db.Column(db.String(40), nullable=False, default="COMPLETE")
    subscription_status = db.Column(db.String(40), nullable=False, default="ACTIVE")
    setup_template_key = db.Column(db.String(120), nullable=False, default="")
    setup_fee_status = db.Column(db.String(40), nullable=False, default="NONE")
    subscription_provider = db.Column(db.String(120), nullable=False, default="")
    external_customer_reference = db.Column(db.String(255), nullable=False, default="")
    external_subscription_reference = db.Column(db.String(255), nullable=False, default="")
    is_prospect = db.Column(db.Boolean, nullable=False, default=False)
    active_at = db.Column(db.DateTime(timezone=True), nullable=True)
    setup_completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    suspended_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)

    memberships = db.relationship("OrganizationMembership", back_populates="organization", cascade="all, delete-orphan")
    locations = db.relationship("RestaurantLocation", back_populates="organization", cascade="all, delete-orphan")

    @property
    def onboarding_status(self) -> str:
        return self.setup_status

    @onboarding_status.setter
    def onboarding_status(self, value: str) -> None:
        self.setup_status = value


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
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_location_org_name"),)

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
    contact_name = db.Column(db.String(255), nullable=False, default="")
    contact_phone = db.Column(db.String(60), nullable=False, default="")
    contact_email = db.Column(db.String(254), nullable=False, default="")
    ordering_notes = db.Column(db.Text, nullable=False, default="")
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
    __table_args__ = (UniqueConstraint("invoice_id", "line_index", name="uq_purchase_invoice_line_order"),)

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
    __table_args__ = (UniqueConstraint("session_id", "line_index", name="uq_stock_count_session_line_order"),)

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
    __table_args__ = (
        Index(
            "uq_reorder_plans_draft_org_location",
            "organization_id",
            "location_id",
            unique=True,
            sqlite_where=text("status = 'Draft'"),
            postgresql_where=text("status = 'Draft'"),
        ),
    )

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
    __table_args__ = (UniqueConstraint("plan_id", "line_index", name="uq_reorder_plan_line_order"),)

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


class AuditEvent(db.Model):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_organization_created_at", "organization_id", "created_at"),
        Index("ix_audit_events_entity", "entity_type", "entity_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = db.Column(db.String(120), nullable=False, index=True)
    entity_type = db.Column(db.String(120), nullable=False, index=True)
    entity_id = db.Column(db.String(120), nullable=False, default="")
    request_id = db.Column(db.String(120), nullable=False, default="")
    source_ip = db.Column(db.String(120), nullable=True)
    user_agent = db.Column(db.String(255), nullable=True)
    metadata_json = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")
    actor = db.relationship("User")


class ExternalIdentity(TimestampMixin, db.Model):
    __tablename__ = "external_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_external_identity_provider_subject"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = db.Column(db.String(80), nullable=False, index=True)
    provider_subject = db.Column(db.String(255), nullable=False, index=True)
    email_at_link = db.Column(db.String(254), nullable=False, default="")
    last_login_at = db.Column(db.DateTime(timezone=True), nullable=True)

    user = db.relationship("User")


class PlatformRole(TimestampMixin, db.Model):
    __tablename__ = "platform_roles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_platform_role_user"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(40), nullable=False, default="support")
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.Text, nullable=False, default="")

    user = db.relationship("User")


class SupportAccessGrant(TimestampMixin, db.Model):
    __tablename__ = "support_access_grants"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    support_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reason = db.Column(db.Text, nullable=False, default="")
    case_reference = db.Column(db.String(120), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="requested")
    starts_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    visible_in_ui = db.Column(db.Boolean, nullable=False, default=True)

    organization = db.relationship("Organization")
    requested_by = db.relationship("User", foreign_keys=[requested_by_user_id])
    approved_by = db.relationship("User", foreign_keys=[approved_by_user_id])
    support_user = db.relationship("User", foreign_keys=[support_user_id])


class OrganizationInvitation(TimestampMixin, db.Model):
    __tablename__ = "organization_invitations"
    __table_args__ = (
        UniqueConstraint("token", name="uq_organization_invitation_token"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_email = db.Column(db.String(254), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False, default="manager")
    token = db.Column(db.String(120), nullable=False, index=True)
    status = db.Column(db.String(40), nullable=False, default="pending")
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    accepted_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    accepted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    single_use = db.Column(db.Boolean, nullable=False, default=True)

    organization = db.relationship("Organization")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    accepted_by = db.relationship("User", foreign_keys=[accepted_by_user_id])


class OrganizationModule(TimestampMixin, db.Model):
    __tablename__ = "organization_modules"
    __table_args__ = (
        UniqueConstraint("organization_id", "module_key", name="uq_organization_module_key"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = db.Column(db.String(120), nullable=False, index=True)
    status = db.Column(db.String(40), nullable=False, default="DISABLED")
    configuration_json = db.Column(db.JSON, nullable=False, default=dict)
    enabled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    enabled_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    organization = db.relationship("Organization")
    enabled_by = db.relationship("User")


class OrganizationConfiguration(TimestampMixin, db.Model):
    __tablename__ = "organization_configurations"

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    draft_name = db.Column(db.String(255), nullable=False, default="Default configuration")
    current_version_id = db.Column(db.Integer, nullable=True)

    organization = db.relationship("Organization")


class OrganizationConfigurationVersion(TimestampMixin, db.Model):
    __tablename__ = "organization_configuration_versions"

    id = db.Column(db.Integer, primary_key=True)
    organization_configuration_id = db.Column(db.Integer, db.ForeignKey("organization_configurations.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(40), nullable=False, default="draft")
    configuration_json = db.Column(db.JSON, nullable=False, default=dict)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)
    reverted_from_version_id = db.Column(db.Integer, db.ForeignKey("organization_configuration_versions.id", ondelete="SET NULL"), nullable=True)

    configuration = db.relationship("OrganizationConfiguration", foreign_keys=[organization_configuration_id])
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    published_by = db.relationship("User", foreign_keys=[published_by_user_id])


class DataImportJob(TimestampMixin, db.Model):
    __tablename__ = "data_import_jobs"
    __table_args__ = (
        UniqueConstraint("organization_id", "source_hash", name="uq_data_import_job_org_source_hash"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approved_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    source_type = db.Column(db.String(40), nullable=False, default="csv")
    source_file_name = db.Column(db.String(255), nullable=False, default="")
    source_file_extension = db.Column(db.String(20), nullable=False, default="")
    source_mime_type = db.Column(db.String(120), nullable=False, default="")
    source_hash = db.Column(db.String(128), nullable=False, default="", index=True)
    storage_path = db.Column(db.String(512), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="UPLOADED")
    entity_scope = db.Column(db.String(80), nullable=False, default="supplier")
    mapping_json = db.Column(db.JSON, nullable=False, default=dict)
    summary_json = db.Column(db.JSON, nullable=False, default=dict)
    row_count = db.Column(db.Integer, nullable=False, default=0)
    preview_row_count = db.Column(db.Integer, nullable=False, default=0)
    applied_row_count = db.Column(db.Integer, nullable=False, default=0)
    blocked_row_count = db.Column(db.Integer, nullable=False, default=0)
    warning_count = db.Column(db.Integer, nullable=False, default=0)
    approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    executed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    rolled_back_at = db.Column(db.DateTime(timezone=True), nullable=True)
    batch_id = db.Column(db.String(120), nullable=False, default="")
    rollback_blockers_json = db.Column(db.JSON, nullable=False, default=list)

    organization = db.relationship("Organization")
    created_by = db.relationship("User", foreign_keys=[created_by_user_id])
    approved_by = db.relationship("User", foreign_keys=[approved_by_user_id])
    files = db.relationship("DataImportFile", back_populates="job", cascade="all, delete-orphan")
    mappings = db.relationship("DataImportMapping", back_populates="job", cascade="all, delete-orphan", order_by="DataImportMapping.display_order.asc()")
    rows = db.relationship("DataImportRow", back_populates="job", cascade="all, delete-orphan", order_by="DataImportRow.row_number.asc()")
    changes = db.relationship("DataImportChange", back_populates="job", cascade="all, delete-orphan", order_by="DataImportChange.id.asc()")


class DataImportFile(TimestampMixin, db.Model):
    __tablename__ = "data_import_files"
    __table_args__ = (
        UniqueConstraint("data_import_job_id", "role", name="uq_data_import_file_job_role"),
    )

    id = db.Column(db.Integer, primary_key=True)
    data_import_job_id = db.Column(db.Integer, db.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(40), nullable=False, default="source")
    original_file_name = db.Column(db.String(255), nullable=False, default="")
    storage_path = db.Column(db.String(512), nullable=False, default="")
    sha256 = db.Column(db.String(128), nullable=False, default="")
    byte_size = db.Column(db.Integer, nullable=False, default=0)
    mime_type = db.Column(db.String(120), nullable=False, default="")
    uploaded_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    job = db.relationship("DataImportJob", back_populates="files")


class DataImportMapping(TimestampMixin, db.Model):
    __tablename__ = "data_import_mappings"
    __table_args__ = (
        UniqueConstraint("data_import_job_id", "target_field_name", name="uq_data_import_mapping_target_field"),
    )

    id = db.Column(db.Integer, primary_key=True)
    data_import_job_id = db.Column(db.Integer, db.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_column_name = db.Column(db.String(255), nullable=False, default="")
    target_field_name = db.Column(db.String(255), nullable=False, default="")
    mapping_type = db.Column(db.String(40), nullable=False, default="manual")
    fixed_value_json = db.Column(db.JSON, nullable=False, default=dict)
    display_order = db.Column(db.Integer, nullable=False, default=0)
    is_required = db.Column(db.Boolean, nullable=False, default=False)

    job = db.relationship("DataImportJob", back_populates="mappings")


class DataImportRow(TimestampMixin, db.Model):
    __tablename__ = "data_import_rows"
    __table_args__ = (
        UniqueConstraint("data_import_job_id", "row_number", name="uq_data_import_row_number"),
        UniqueConstraint("data_import_job_id", "row_fingerprint", name="uq_data_import_row_fingerprint"),
    )

    id = db.Column(db.Integer, primary_key=True)
    data_import_job_id = db.Column(db.Integer, db.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    row_number = db.Column(db.Integer, nullable=False, default=0)
    entity_type = db.Column(db.String(80), nullable=False, default="supplier")
    source_row_json = db.Column(db.JSON, nullable=False, default=dict)
    normalized_row_json = db.Column(db.JSON, nullable=False, default=dict)
    row_fingerprint = db.Column(db.String(128), nullable=False, default="", index=True)
    status = db.Column(db.String(40), nullable=False, default="preview")
    target_entity_type = db.Column(db.String(80), nullable=False, default="")
    target_entity_id = db.Column(db.String(120), nullable=False, default="")
    issue_summary = db.Column(db.Text, nullable=False, default="")
    warning_count = db.Column(db.Integer, nullable=False, default=0)
    blocked_count = db.Column(db.Integer, nullable=False, default=0)
    can_rollback = db.Column(db.Boolean, nullable=False, default=True)

    job = db.relationship("DataImportJob", back_populates="rows")
    issues = db.relationship("DataImportIssue", back_populates="row", cascade="all, delete-orphan", order_by="DataImportIssue.id.asc()")
    changes = db.relationship("DataImportChange", back_populates="row", cascade="all, delete-orphan", order_by="DataImportChange.id.asc()")


class DataImportIssue(TimestampMixin, db.Model):
    __tablename__ = "data_import_issues"

    id = db.Column(db.Integer, primary_key=True)
    data_import_row_id = db.Column(db.Integer, db.ForeignKey("data_import_rows.id", ondelete="CASCADE"), nullable=False, index=True)
    severity = db.Column(db.String(20), nullable=False, default="warning")
    field_name = db.Column(db.String(255), nullable=False, default="")
    code = db.Column(db.String(80), nullable=False, default="")
    message = db.Column(db.Text, nullable=False, default="")

    row = db.relationship("DataImportRow", back_populates="issues")


class DataImportChange(TimestampMixin, db.Model):
    __tablename__ = "data_import_changes"
    __table_args__ = (
        UniqueConstraint("data_import_job_id", "row_fingerprint", name="uq_data_import_change_fingerprint"),
    )

    id = db.Column(db.Integer, primary_key=True)
    data_import_job_id = db.Column(db.Integer, db.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    data_import_row_id = db.Column(db.Integer, db.ForeignKey("data_import_rows.id", ondelete="CASCADE"), nullable=True, index=True)
    entity_type = db.Column(db.String(80), nullable=False, default="supplier")
    change_type = db.Column(db.String(40), nullable=False, default="create")
    target_entity_id = db.Column(db.String(120), nullable=False, default="")
    row_fingerprint = db.Column(db.String(128), nullable=False, default="", index=True)
    previous_json = db.Column(db.JSON, nullable=False, default=dict)
    applied_json = db.Column(db.JSON, nullable=False, default=dict)
    rollbackable = db.Column(db.Boolean, nullable=False, default=True)
    status = db.Column(db.String(40), nullable=False, default="preview")

    job = db.relationship("DataImportJob", back_populates="changes")
    row = db.relationship("DataImportRow", back_populates="changes")


class DashboardLayout(TimestampMixin, db.Model):
    __tablename__ = "dashboard_layouts"
    __table_args__ = (
        UniqueConstraint("organization_id", "location_id", "role", "version", name="uq_dashboard_layout_scope"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=True, index=True)
    role = db.Column(db.String(20), nullable=False, default="owner")
    widgets_json = db.Column(db.JSON, nullable=False, default=list)
    version = db.Column(db.Integer, nullable=False, default=1)
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)

    organization = db.relationship("Organization")
    location = db.relationship("RestaurantLocation")


class SquareConnection(TimestampMixin, db.Model):
    __tablename__ = "square_connections"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_square_connection_organization"),
    )

    id = db.Column(db.Integer, primary_key=True)
    organization_id = db.Column(db.Integer, db.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    environment = db.Column(db.String(40), nullable=False, default="sandbox")
    square_merchant_id = db.Column(db.String(255), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="disconnected")
    access_token_ciphertext = db.Column(db.Text, nullable=False, default="")
    refresh_token_ciphertext = db.Column(db.Text, nullable=False, default="")
    token_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_sync_at = db.Column(db.DateTime(timezone=True), nullable=True)
    sync_status = db.Column(db.String(40), nullable=False, default="idle")
    sync_error = db.Column(db.Text, nullable=False, default="")

    organization = db.relationship("Organization")


class SquareLocation(TimestampMixin, db.Model):
    __tablename__ = "square_locations"
    __table_args__ = (
        UniqueConstraint("square_connection_id", "square_location_id", name="uq_square_location_connection_external"),
    )

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    square_location_id = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="active")
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)

    connection = db.relationship("SquareConnection")


class SquareLocationMapping(TimestampMixin, db.Model):
    __tablename__ = "square_location_mappings"
    __table_args__ = (
        UniqueConstraint("square_location_id", name="uq_square_location_mapping_square_location"),
    )

    id = db.Column(db.Integer, primary_key=True)
    square_location_id = db.Column(db.Integer, db.ForeignKey("square_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    restaurant_location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True)
    mapped_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    mapped_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    square_location = db.relationship("SquareLocation")
    restaurant_location = db.relationship("RestaurantLocation")
    mapped_by = db.relationship("User")


class SquareCatalogObject(TimestampMixin, db.Model):
    __tablename__ = "square_catalog_objects"
    __table_args__ = (
        UniqueConstraint("square_connection_id", "square_object_id", name="uq_square_catalog_connection_object"),
    )

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    square_object_id = db.Column(db.String(255), nullable=False)
    object_type = db.Column(db.String(120), nullable=False, default="")
    version = db.Column(db.Integer, nullable=False, default=0)
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)

    connection = db.relationship("SquareConnection")


class SquareCatalogMapping(TimestampMixin, db.Model):
    __tablename__ = "square_catalog_mappings"
    __table_args__ = (
        UniqueConstraint("square_catalog_object_id", "mapping_type", name="uq_square_catalog_mapping_type"),
    )

    id = db.Column(db.Integer, primary_key=True)
    square_catalog_object_id = db.Column(db.Integer, db.ForeignKey("square_catalog_objects.id", ondelete="CASCADE"), nullable=False, index=True)
    mapping_type = db.Column(db.String(120), nullable=False, default="menu_item")
    flowtally_entity_type = db.Column(db.String(120), nullable=False, default="")
    flowtally_entity_id = db.Column(db.String(120), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="unmapped")
    mapped_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    square_catalog_object = db.relationship("SquareCatalogObject")
    mapped_by = db.relationship("User")


class SquareSyncJob(TimestampMixin, db.Model):
    __tablename__ = "square_sync_jobs"

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    job_type = db.Column(db.String(120), nullable=False, default="")
    status = db.Column(db.String(40), nullable=False, default="queued")
    requested_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    error_message = db.Column(db.Text, nullable=False, default="")
    cursor_json = db.Column(db.JSON, nullable=False, default=dict)

    connection = db.relationship("SquareConnection")


class SquareSyncCursor(TimestampMixin, db.Model):
    __tablename__ = "square_sync_cursors"
    __table_args__ = (UniqueConstraint("square_connection_id", "cursor_key", name="uq_square_sync_cursor_key"),)

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    cursor_key = db.Column(db.String(120), nullable=False)
    cursor_value = db.Column(db.String(255), nullable=False, default="")
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    connection = db.relationship("SquareConnection")


class SquareWebhookEvent(TimestampMixin, db.Model):
    __tablename__ = "square_webhook_events"
    __table_args__ = (UniqueConstraint("square_connection_id", "event_id", name="uq_square_webhook_event"),)

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = db.Column(db.String(255), nullable=False)
    event_type = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(40), nullable=False, default="received")
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)
    processed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    error_message = db.Column(db.Text, nullable=False, default="")

    connection = db.relationship("SquareConnection")


class SquareOrder(TimestampMixin, db.Model):
    __tablename__ = "square_orders"
    __table_args__ = (UniqueConstraint("square_connection_id", "square_order_id", name="uq_square_order_connection_order"),)

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    square_order_id = db.Column(db.String(255), nullable=False)
    square_location_id = db.Column(db.String(255), nullable=False, default="")
    restaurant_location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True, index=True)
    order_state = db.Column(db.String(80), nullable=False, default="")
    currency = db.Column(db.String(8), nullable=False, default="CAD")
    gross_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    discount_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tax_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tip_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    refund_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    net_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    item_quantity = db.Column(db.Numeric(12, 4), nullable=False, default=0)
    line_count = db.Column(db.Integer, nullable=False, default=0)
    ordered_at = db.Column(db.DateTime(timezone=True), nullable=True)
    closed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    refunded_at = db.Column(db.DateTime(timezone=True), nullable=True)
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)
    last_synced_at = db.Column(db.DateTime(timezone=True), nullable=True)
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)

    connection = db.relationship("SquareConnection")
    restaurant_location = db.relationship("RestaurantLocation")
    lines = db.relationship("SquareOrderLine", back_populates="order", cascade="all, delete-orphan", order_by="SquareOrderLine.line_index.asc()")


class SquareOrderLine(TimestampMixin, db.Model):
    __tablename__ = "square_order_lines"
    __table_args__ = (UniqueConstraint("square_order_id", "line_uid", name="uq_square_order_line_uid"),)

    id = db.Column(db.Integer, primary_key=True)
    square_order_id = db.Column(db.Integer, db.ForeignKey("square_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    line_uid = db.Column(db.String(255), nullable=False)
    line_index = db.Column(db.Integer, nullable=False, default=0)
    square_item_variation_id = db.Column(db.String(255), nullable=False, default="")
    name = db.Column(db.String(255), nullable=False, default="")
    quantity = db.Column(db.Numeric(12, 4), nullable=False, default=0)
    gross_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    discount_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tax_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tip_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    net_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)

    order = db.relationship("SquareOrder", back_populates="lines")


class SquareDailySalesSummary(TimestampMixin, db.Model):
    __tablename__ = "square_daily_sales_summaries"
    __table_args__ = (UniqueConstraint("square_connection_id", "sale_date", "square_location_id", name="uq_square_sales_summary_scope"),)

    id = db.Column(db.Integer, primary_key=True)
    square_connection_id = db.Column(db.Integer, db.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    square_location_id = db.Column(db.String(255), nullable=False, default="")
    restaurant_location_id = db.Column(db.Integer, db.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True, index=True)
    sale_date = db.Column(db.Date, nullable=False, index=True)
    currency = db.Column(db.String(8), nullable=False, default="CAD")
    gross_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    discount_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tax_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    tip_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    refund_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    net_amount = db.Column(db.Numeric(12, 2), nullable=False, default=0)
    order_count = db.Column(db.Integer, nullable=False, default=0)
    cancelled_order_count = db.Column(db.Integer, nullable=False, default=0)
    raw_payload_json = db.Column(db.JSON, nullable=False, default=dict)

    connection = db.relationship("SquareConnection")
    restaurant_location = db.relationship("RestaurantLocation")
