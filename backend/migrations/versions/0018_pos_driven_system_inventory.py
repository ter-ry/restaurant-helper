"""apply mapped Square sales to system inventory

Revision ID: 0018_pos_driven_system_inventory
Revises: 0017_square_catalog_version_bigint
Create Date: 2026-09-01 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0018_pos_driven_system_inventory"
down_revision = "0017_square_catalog_version_bigint"
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
        "square_connections",
        sa.Column("inventory_depletion_activated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "square_order_line_inventory_consumptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("square_order_line_id", sa.Integer(), sa.ForeignKey("square_order_lines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("applied_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_order_line_id", "inventory_item_id", name="uq_square_order_line_inventory_consumption"),
    )
    if _is_postgres():
        _set_setup_context(op.get_bind())
        op.execute("ALTER TABLE square_order_line_inventory_consumptions ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE square_order_line_inventory_consumptions FORCE ROW LEVEL SECURITY")
        op.execute(
            """
            CREATE POLICY flowtally_square_order_line_inventory_consumptions_tenant_access
            ON square_order_line_inventory_consumptions
            FOR ALL TO PUBLIC
            USING (flowtally_has_org_access(organization_id))
            WITH CHECK (flowtally_has_org_access(organization_id))
            """
        )
        op.execute(
            """
            UPDATE square_connections
            SET inventory_depletion_activated_at = CURRENT_TIMESTAMP
            WHERE inventory_depletion_activated_at IS NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE square_connections
            SET inventory_depletion_activated_at = CURRENT_TIMESTAMP
            WHERE inventory_depletion_activated_at IS NULL
            """
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute("DROP POLICY IF EXISTS flowtally_square_order_line_inventory_consumptions_tenant_access ON square_order_line_inventory_consumptions")
    op.drop_table("square_order_line_inventory_consumptions")
    op.drop_column("square_connections", "inventory_depletion_activated_at")
