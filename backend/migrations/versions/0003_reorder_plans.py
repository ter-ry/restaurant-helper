"""reorder plans

Revision ID: 0003_reorder_plans
Revises: 0002_pilot_domain
Create Date: 2026-07-15 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_reorder_plans"
down_revision = "0002_pilot_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reorder_plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default="Current reorder plan"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="Draft"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("prepared_by_user_id", sa.Integer(), nullable=True),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["location_id"], ["restaurant_locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prepared_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reorder_plans_organization_id"), "reorder_plans", ["organization_id"], unique=False)
    op.create_index(op.f("ix_reorder_plans_location_id"), "reorder_plans", ["location_id"], unique=False)

    op.create_table(
        "reorder_plan_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("inventory_item_name_snapshot", sa.String(length=255), nullable=False),
        sa.Column("supplier_name_snapshot", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("category_snapshot", sa.String(length=120), nullable=False, server_default="Other"),
        sa.Column("purchase_unit_snapshot", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("inventory_unit_snapshot", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("conversion_factor_snapshot", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("current_on_hand_snapshot", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("minimum_quantity_snapshot", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("par_level_snapshot", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("suggested_quantity_snapshot", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("order_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("excluded", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("estimated_unit_cost_snapshot", sa.Numeric(12, 2), nullable=True),
        sa.Column("estimated_line_cost_snapshot", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plan_id"], ["reorder_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reorder_plan_lines_plan_id"), "reorder_plan_lines", ["plan_id"], unique=False)
    op.create_index(op.f("ix_reorder_plan_lines_inventory_item_id"), "reorder_plan_lines", ["inventory_item_id"], unique=False)
    op.create_index(op.f("ix_reorder_plan_lines_supplier_id"), "reorder_plan_lines", ["supplier_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_reorder_plan_lines_supplier_id"), table_name="reorder_plan_lines")
    op.drop_index(op.f("ix_reorder_plan_lines_inventory_item_id"), table_name="reorder_plan_lines")
    op.drop_index(op.f("ix_reorder_plan_lines_plan_id"), table_name="reorder_plan_lines")
    op.drop_table("reorder_plan_lines")
    op.drop_index(op.f("ix_reorder_plans_location_id"), table_name="reorder_plans")
    op.drop_index(op.f("ix_reorder_plans_organization_id"), table_name="reorder_plans")
    op.drop_table("reorder_plans")
