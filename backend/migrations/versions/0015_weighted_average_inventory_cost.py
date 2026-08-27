"""weighted average inventory cost

Revision ID: 0015_weighted_average_inventory_cost
Revises: 0014_authenticated_membership_discovery
Create Date: 2026-08-27 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0015_weighted_average_inventory_cost"
down_revision = "0014_authenticated_membership_discovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inventory_items",
        sa.Column("average_unit_cost", sa.Numeric(14, 6), nullable=False, server_default="0"),
    )
    op.execute(
        """
        UPDATE inventory_items
        SET average_unit_cost = COALESCE(latest_purchase_price / NULLIF(last_purchase_conversion_factor, 0), latest_purchase_price, 0)
        """
    )


def downgrade() -> None:
    op.drop_column("inventory_items", "average_unit_cost")
