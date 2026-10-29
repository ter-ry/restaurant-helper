"""add Clover shadow order tables

Revision ID: 0024_clover_shadow_orders
Revises: 0023_clover_mapping_timestamps
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0024_clover_shadow_orders"
down_revision = "0023_clover_mapping_timestamps"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "clover_shadow_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_connection_id", sa.Integer(), sa.ForeignKey("clover_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_merchant_id", sa.String(255), nullable=False),
        sa.Column("clover_order_id", sa.String(255), nullable=False),
        sa.Column("provider_status", sa.String(80), nullable=False, server_default=""),
        sa.Column("normalized_status", sa.String(40), nullable=False, server_default="review"),
        sa.Column("payment_status", sa.String(40), nullable=False, server_default="unknown"),
        sa.Column("potentially_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("requires_review", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("source_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_cents", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="CAD"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.UniqueConstraint("clover_connection_id", "clover_order_id", name="uq_clover_shadow_order_provider"),
    )
    op.create_index("ix_clover_shadow_orders_organization", "clover_shadow_orders", ["organization_id"])
    op.create_index("ix_clover_shadow_orders_location", "clover_shadow_orders", ["restaurant_location_id"])
    op.create_index("ix_clover_shadow_orders_modified", "clover_shadow_orders", ["clover_connection_id", "source_modified_at"])

    op.create_table(
        "clover_shadow_order_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("shadow_order_id", sa.Integer(), sa.ForeignKey("clover_shadow_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_line_item_id", sa.String(255), nullable=False),
        sa.Column("clover_item_id", sa.String(255), nullable=False, server_default=""),
        sa.Column("clover_item_group_id", sa.String(255), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit_price_cents", sa.Integer(), nullable=True),
        sa.Column("provider_status", sa.String(80), nullable=False, server_default=""),
        sa.Column("modifier_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("mapping_status", sa.String(40), nullable=False, server_default="unmapped"),
        sa.Column("recipe_preview_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("shadow_order_id", "clover_line_item_id", name="uq_clover_shadow_order_line_provider"),
    )
    op.create_index("ix_clover_shadow_order_lines_organization", "clover_shadow_order_lines", ["organization_id"])
    op.create_index("ix_clover_shadow_order_lines_location", "clover_shadow_order_lines", ["restaurant_location_id"])
    if _is_postgres():
        for table, policy in (
            ("clover_shadow_orders", "clover_shadow_orders_org_access"),
            ("clover_shadow_order_lines", "clover_shadow_order_lines_org_access"),
        ):
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(
                f'CREATE POLICY {policy} ON "{table}" USING (flowtally_has_org_access(organization_id)) WITH CHECK (flowtally_has_org_access(organization_id))'
            )


def downgrade() -> None:
    if _is_postgres():
        for table, policy in (
            ("clover_shadow_order_lines", "clover_shadow_order_lines_org_access"),
            ("clover_shadow_orders", "clover_shadow_orders_org_access"),
        ):
            op.execute(f'DROP POLICY IF EXISTS {policy} ON "{table}"')
            op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
    op.drop_index("ix_clover_shadow_order_lines_location", table_name="clover_shadow_order_lines")
    op.drop_index("ix_clover_shadow_order_lines_organization", table_name="clover_shadow_order_lines")
    op.drop_table("clover_shadow_order_lines")
    op.drop_index("ix_clover_shadow_orders_modified", table_name="clover_shadow_orders")
    op.drop_index("ix_clover_shadow_orders_location", table_name="clover_shadow_orders")
    op.drop_index("ix_clover_shadow_orders_organization", table_name="clover_shadow_orders")
    op.drop_table("clover_shadow_orders")
