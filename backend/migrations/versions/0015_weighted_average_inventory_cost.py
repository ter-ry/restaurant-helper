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


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _set_setup_context(connection) -> None:
    connection.exec_driver_sql("select set_config('flowtally.access_scope', 'setup', true)")
    connection.exec_driver_sql("select set_config('flowtally.organization_id', '', true)")
    connection.exec_driver_sql("select set_config('flowtally.user_id', '', true)")
    connection.exec_driver_sql("select set_config('flowtally.support_grant_id', '', true)")


def upgrade() -> None:
    op.add_column(
        "inventory_items",
        sa.Column("average_unit_cost", sa.Numeric(14, 6), nullable=False, server_default="0"),
    )
    if _is_postgres():
        _set_setup_context(op.get_bind())
    op.execute(
        """
        UPDATE inventory_items
        SET average_unit_cost = COALESCE(latest_purchase_price / NULLIF(last_purchase_conversion_factor, 0), latest_purchase_price, 0)
        """
    )


def downgrade() -> None:
    op.drop_column("inventory_items", "average_unit_cost")
