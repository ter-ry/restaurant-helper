"""add Clover shadow inventory consumption ledger

Revision ID: 0025_clover_shadow_inventory_consumption
Revises: 0024_clover_shadow_orders
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0025_clover_shadow_inventory_consumption"
down_revision = "0024_clover_shadow_orders"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "clover_shadow_order_line_inventory_consumptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_shadow_order_line_id", sa.Integer(), sa.ForeignKey("clover_shadow_order_lines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("applied_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("clover_shadow_order_line_id", "inventory_item_id", name="uq_clover_shadow_order_line_inventory_consumption"),
    )
    op.create_index("ix_clover_shadow_order_line_inventory_consumptions_org", "clover_shadow_order_line_inventory_consumptions", ["organization_id"])
    op.create_index("ix_clover_shadow_order_line_inventory_consumptions_location", "clover_shadow_order_line_inventory_consumptions", ["location_id"])
    if _is_postgres():
        op.execute('ALTER TABLE "clover_shadow_order_line_inventory_consumptions" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "clover_shadow_order_line_inventory_consumptions" FORCE ROW LEVEL SECURITY')
        op.execute(
            'CREATE POLICY clover_shadow_order_line_inventory_consumptions_org_access '
            'ON "clover_shadow_order_line_inventory_consumptions" '
            'USING (flowtally_has_org_access(organization_id)) '
            'WITH CHECK (flowtally_has_org_access(organization_id))'
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute('DROP POLICY IF EXISTS clover_shadow_order_line_inventory_consumptions_org_access ON "clover_shadow_order_line_inventory_consumptions"')
        op.execute('ALTER TABLE "clover_shadow_order_line_inventory_consumptions" NO FORCE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "clover_shadow_order_line_inventory_consumptions" DISABLE ROW LEVEL SECURITY')
    op.drop_index("ix_clover_shadow_order_line_inventory_consumptions_location", table_name="clover_shadow_order_line_inventory_consumptions")
    op.drop_index("ix_clover_shadow_order_line_inventory_consumptions_org", table_name="clover_shadow_order_line_inventory_consumptions")
    op.drop_table("clover_shadow_order_line_inventory_consumptions")
