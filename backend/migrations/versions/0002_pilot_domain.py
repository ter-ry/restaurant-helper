"""pilot domain tables

Revision ID: 0002_pilot_domain
Revises: 0001_initial
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_pilot_domain"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("category_focus", sa.String(length=120), nullable=False, server_default="Other"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "normalized_name", name="uq_supplier_org_normalized_name"),
    )
    op.create_index(op.f("ix_suppliers_organization_id"), "suppliers", ["organization_id"], unique=False)

    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False, server_default="Other"),
        sa.Column("stock_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("current_on_hand", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("min_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("par_level", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("preferred_supplier_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("latest_purchase_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("last_purchase_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("last_purchase_conversion_factor", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("last_received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_counted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("average_daily_usage", sa.Numeric(12, 4), nullable=True),
        sa.Column("estimated_cost_method", sa.String(length=60), nullable=False, server_default="latest_purchase"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "location_id", "normalized_name", name="uq_inventory_item_org_location_normalized_name"),
    )
    op.create_index(op.f("ix_inventory_items_organization_id"), "inventory_items", ["organization_id"], unique=False)
    op.create_index(op.f("ix_inventory_items_location_id"), "inventory_items", ["location_id"], unique=False)
    op.create_index(op.f("ix_inventory_items_supplier_id"), "inventory_items", ["supplier_id"], unique=False)

    op.create_table(
        "supplier_item_mappings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("supplier_item_name", sa.String(length=255), nullable=False),
        sa.Column("normalized_supplier_item_name", sa.String(length=255), nullable=False),
        sa.Column("purchase_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("inventory_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("conversion_factor", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "supplier_id", "inventory_item_id", "normalized_supplier_item_name", name="uq_supplier_item_mapping"),
    )
    op.create_index(op.f("ix_supplier_item_mappings_organization_id"), "supplier_item_mappings", ["organization_id"], unique=False)
    op.create_index(op.f("ix_supplier_item_mappings_supplier_id"), "supplier_item_mappings", ["supplier_id"], unique=False)
    op.create_index(op.f("ix_supplier_item_mappings_inventory_item_id"), "supplier_item_mappings", ["inventory_item_id"], unique=False)

    op.create_table(
        "purchase_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.String(length=120), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=False),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="Draft"),
        sa.Column("source_file_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_file_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("source_file_key", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("extracted_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("extraction_status", sa.String(length=40), nullable=False, server_default="manual"),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["received_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "location_id", "supplier_id", "invoice_number", name="uq_invoice_org_location_supplier_number"),
    )
    op.create_index(op.f("ix_purchase_invoices_organization_id"), "purchase_invoices", ["organization_id"], unique=False)
    op.create_index(op.f("ix_purchase_invoices_location_id"), "purchase_invoices", ["location_id"], unique=False)
    op.create_index(op.f("ix_purchase_invoices_supplier_id"), "purchase_invoices", ["supplier_id"], unique=False)

    op.create_table(
        "inventory_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("quantity_delta", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("quantity_before", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("quantity_after", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("source_type", sa.String(length=60), nullable=False),
        sa.Column("source_record_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("source_line_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "location_id", "source_type", "source_record_id", "source_line_id", name="uq_inventory_movement_source"),
    )
    op.create_index(op.f("ix_inventory_movements_organization_id"), "inventory_movements", ["organization_id"], unique=False)
    op.create_index(op.f("ix_inventory_movements_location_id"), "inventory_movements", ["location_id"], unique=False)
    op.create_index(op.f("ix_inventory_movements_inventory_item_id"), "inventory_movements", ["inventory_item_id"], unique=False)

    op.create_table(
        "stock_count_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="Draft"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("counted_by", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("finalized_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["finalized_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stock_count_sessions_organization_id"), "stock_count_sessions", ["organization_id"], unique=False)
    op.create_index(op.f("ix_stock_count_sessions_location_id"), "stock_count_sessions", ["location_id"], unique=False)

    op.create_table(
        "stock_count_session_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_name_snapshot", sa.String(length=255), nullable=False),
        sa.Column("stock_unit_snapshot", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("expected_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("counted_quantity", sa.Numeric(12, 4), nullable=True),
        sa.Column("variance", sa.Numeric(12, 4), nullable=True),
        sa.Column("resulting_quantity", sa.Numeric(12, 4), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["stock_count_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stock_count_session_lines_session_id"), "stock_count_session_lines", ["session_id"], unique=False)
    op.create_index(op.f("ix_stock_count_session_lines_inventory_item_id"), "stock_count_session_lines", ["inventory_item_id"], unique=False)

    op.create_table(
        "reorder_intents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("suggested_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("adjusted_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("estimated_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="Needs ordering"),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "location_id", "inventory_item_id", name="uq_reorder_intent_item_location"),
    )
    op.create_index(op.f("ix_reorder_intents_organization_id"), "reorder_intents", ["organization_id"], unique=False)
    op.create_index(op.f("ix_reorder_intents_location_id"), "reorder_intents", ["location_id"], unique=False)
    op.create_index(op.f("ix_reorder_intents_inventory_item_id"), "reorder_intents", ["inventory_item_id"], unique=False)

    op.create_table(
        "purchase_invoice_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=True),
        sa.Column("supplier_item_mapping_id", sa.Integer(), nullable=True),
        sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("normalized_description", sa.String(length=255), nullable=False),
        sa.Column("purchase_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("inventory_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("conversion_factor", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=False, server_default="0"),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("previous_unit_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("price_change_percent", sa.Numeric(8, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["purchase_invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_item_mapping_id"], ["supplier_item_mappings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_purchase_invoice_lines_invoice_id"), "purchase_invoice_lines", ["invoice_id"], unique=False)
    op.create_index(op.f("ix_purchase_invoice_lines_inventory_item_id"), "purchase_invoice_lines", ["inventory_item_id"], unique=False)
    op.create_index(op.f("ix_purchase_invoice_lines_supplier_item_mapping_id"), "purchase_invoice_lines", ["supplier_item_mapping_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_purchase_invoice_lines_supplier_item_mapping_id"), table_name="purchase_invoice_lines")
    op.drop_index(op.f("ix_purchase_invoice_lines_inventory_item_id"), table_name="purchase_invoice_lines")
    op.drop_index(op.f("ix_purchase_invoice_lines_invoice_id"), table_name="purchase_invoice_lines")
    op.drop_table("purchase_invoice_lines")

    op.drop_index(op.f("ix_reorder_intents_inventory_item_id"), table_name="reorder_intents")
    op.drop_index(op.f("ix_reorder_intents_location_id"), table_name="reorder_intents")
    op.drop_index(op.f("ix_reorder_intents_organization_id"), table_name="reorder_intents")
    op.drop_table("reorder_intents")

    op.drop_index(op.f("ix_stock_count_session_lines_inventory_item_id"), table_name="stock_count_session_lines")
    op.drop_index(op.f("ix_stock_count_session_lines_session_id"), table_name="stock_count_session_lines")
    op.drop_table("stock_count_session_lines")

    op.drop_index(op.f("ix_stock_count_sessions_location_id"), table_name="stock_count_sessions")
    op.drop_index(op.f("ix_stock_count_sessions_organization_id"), table_name="stock_count_sessions")
    op.drop_table("stock_count_sessions")

    op.drop_index(op.f("ix_inventory_movements_inventory_item_id"), table_name="inventory_movements")
    op.drop_index(op.f("ix_inventory_movements_location_id"), table_name="inventory_movements")
    op.drop_index(op.f("ix_inventory_movements_organization_id"), table_name="inventory_movements")
    op.drop_table("inventory_movements")

    op.drop_index(op.f("ix_purchase_invoices_supplier_id"), table_name="purchase_invoices")
    op.drop_index(op.f("ix_purchase_invoices_location_id"), table_name="purchase_invoices")
    op.drop_index(op.f("ix_purchase_invoices_organization_id"), table_name="purchase_invoices")
    op.drop_table("purchase_invoices")

    op.drop_index(op.f("ix_supplier_item_mappings_inventory_item_id"), table_name="supplier_item_mappings")
    op.drop_index(op.f("ix_supplier_item_mappings_supplier_id"), table_name="supplier_item_mappings")
    op.drop_index(op.f("ix_supplier_item_mappings_organization_id"), table_name="supplier_item_mappings")
    op.drop_table("supplier_item_mappings")

    op.drop_index(op.f("ix_inventory_items_supplier_id"), table_name="inventory_items")
    op.drop_index(op.f("ix_inventory_items_location_id"), table_name="inventory_items")
    op.drop_index(op.f("ix_inventory_items_organization_id"), table_name="inventory_items")
    op.drop_table("inventory_items")

    op.drop_index(op.f("ix_suppliers_organization_id"), table_name="suppliers")
    op.drop_table("suppliers")
