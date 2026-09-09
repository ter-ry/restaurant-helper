"""add Square menu shells and first-class inventory waste

Revision ID: 0019_square_menu_import_and_inventory_waste
Revises: 0018_pos_driven_system_inventory
Create Date: 2026-09-09 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0019_square_menu_import_and_inventory_waste"
down_revision = "0018_pos_driven_system_inventory"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def upgrade() -> None:
    with op.batch_alter_table("menu_items") as batch_op:
        batch_op.alter_column("recipe_id", existing_type=sa.Integer(), nullable=True)
    op.create_table(
        "inventory_waste_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("inventory_movement_id", sa.Integer(), sa.ForeignKey("inventory_movements.id", ondelete="RESTRICT"), nullable=True, index=True),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("reason", sa.String(length=80), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP"), index=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("total_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("inventory_movement_id", name="uq_inventory_waste_event_movement"),
    )
    if _is_postgres():
        op.execute("ALTER TABLE inventory_waste_events ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE inventory_waste_events FORCE ROW LEVEL SECURITY")
        op.execute("""
            CREATE POLICY flowtally_inventory_waste_events_tenant_access
            ON inventory_waste_events FOR ALL TO PUBLIC
            USING (flowtally_has_org_access(organization_id))
            WITH CHECK (flowtally_has_org_access(organization_id))
        """)


def downgrade() -> None:
    bind = op.get_bind()
    null_count = bind.execute(sa.text("SELECT COUNT(*) FROM menu_items WHERE recipe_id IS NULL")).scalar_one()
    if null_count:
        raise RuntimeError(
            f"Cannot downgrade 0019 while {null_count} menu item(s) have no recipe; assign recipes before downgrading."
        )
    if _is_postgres():
        op.execute("DROP POLICY IF EXISTS flowtally_inventory_waste_events_tenant_access ON inventory_waste_events")
    op.drop_table("inventory_waste_events")
    with op.batch_alter_table("menu_items") as batch_op:
        batch_op.alter_column("recipe_id", existing_type=sa.Integer(), nullable=False)
