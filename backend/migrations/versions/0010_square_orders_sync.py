"""square orders sync

Revision ID: 0010_square_orders_sync
Revises: 0009_postgres_row_level_security
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_square_orders_sync"
down_revision = "0009_postgres_row_level_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "square_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("square_order_id", sa.String(length=255), nullable=False),
        sa.Column("square_location_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_state", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="CAD"),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tip_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("refund_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("net_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("item_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("line_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "square_order_id", name="uq_square_order_connection_order"),
    )

    op.create_table(
        "square_order_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_order_id", sa.Integer(), sa.ForeignKey("square_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("line_uid", sa.String(length=255), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("square_item_variation_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tip_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("net_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_order_id", "line_uid", name="uq_square_order_line_uid"),
    )

    op.create_table(
        "square_daily_sales_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("square_location_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sale_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="CAD"),
        sa.Column("gross_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tip_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("refund_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("net_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("order_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cancelled_order_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "sale_date", "square_location_id", name="uq_square_sales_summary_scope"),
    )


def downgrade() -> None:
    op.drop_table("square_daily_sales_summaries")
    op.drop_table("square_order_lines")
    op.drop_table("square_orders")

