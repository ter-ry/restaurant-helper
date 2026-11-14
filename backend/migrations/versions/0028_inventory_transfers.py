"""inter-location inventory transfers

Revision ID: 0028_inventory_transfers
Revises: 0027_purchase_invoice_void_lineage
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0028_inventory_transfers"
down_revision = "0027_purchase_invoice_void_lineage"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "inventory_transfers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("to_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("from_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("to_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("unit_cost", sa.Numeric(14, 6), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_inventory_transfer_idempotency"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_transfer_quantity_positive"),
        sa.CheckConstraint("from_location_id <> to_location_id", name="ck_inventory_transfer_distinct_locations"),
    )
    for column in ("organization_id", "from_location_id", "to_location_id", "from_item_id", "to_item_id"):
        op.create_index(f"ix_inventory_transfers_{column}", "inventory_transfers", [column])
    if _is_postgres():
        op.execute('ALTER TABLE "inventory_transfers" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "inventory_transfers" FORCE ROW LEVEL SECURITY')
        op.execute('CREATE POLICY inventory_transfers_org_access ON "inventory_transfers" USING (flowtally_has_org_access(organization_id)) WITH CHECK (flowtally_has_org_access(organization_id))')


def downgrade() -> None:
    if _is_postgres():
        op.execute('DROP POLICY IF EXISTS inventory_transfers_org_access ON "inventory_transfers"')
        op.execute('ALTER TABLE "inventory_transfers" NO FORCE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "inventory_transfers" DISABLE ROW LEVEL SECURITY')
    for column in ("to_item_id", "from_item_id", "to_location_id", "from_location_id", "organization_id"):
        op.drop_index(f"ix_inventory_transfers_{column}", table_name="inventory_transfers")
    op.drop_table("inventory_transfers")
