"""add Clover consumption cost snapshots

Revision ID: 0026_clover_consumption_cost_snapshot
Revises: 0025_clover_shadow_inventory_consumption
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0026_clover_consumption_cost_snapshot"
down_revision = "0025_clover_shadow_inventory_consumption"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clover_shadow_order_line_inventory_consumptions",
        sa.Column("unit_cost_snapshot", sa.Numeric(14, 6), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("clover_shadow_order_line_inventory_consumptions", "unit_cost_snapshot")
