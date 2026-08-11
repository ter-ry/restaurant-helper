"""menu items and recipes

Revision ID: 0013_menu_items_and_recipes
Revises: 0012_fix_support_access_grant_rls_recursion
Create Date: 2026-08-11 00:00:00.000000
"""

from __future__ import annotations

from typing import Callable

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection


revision = "0013_menu_items_and_recipes"
down_revision = "0012_fix_support_access_grant_rls_recursion"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _apply_rls(execute_sql: Callable[[str], None]) -> None:
    for table_name, policy_name in [
        ("menu_items", "flowtally_menu_items_tenant_access"),
        ("menu_recipes", "flowtally_menu_recipes_tenant_access"),
        ("menu_recipe_lines", "flowtally_menu_recipe_lines_tenant_access"),
    ]:
        execute_sql(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY')
        execute_sql(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY')
        execute_sql(f'DROP POLICY IF EXISTS "{policy_name}" ON "{table_name}"')
        execute_sql(
            f"""
            CREATE POLICY "{policy_name}"
            ON "{table_name}"
            FOR ALL TO PUBLIC
            USING (flowtally_has_org_access(organization_id))
            WITH CHECK (flowtally_has_org_access(organization_id))
            """
        )


def _remove_rls(execute_sql: Callable[[str], None]) -> None:
    for table_name, policy_name in [
        ("menu_recipe_lines", "flowtally_menu_recipe_lines_tenant_access"),
        ("menu_recipes", "flowtally_menu_recipes_tenant_access"),
        ("menu_items", "flowtally_menu_items_tenant_access"),
    ]:
        execute_sql(f'DROP POLICY IF EXISTS "{policy_name}" ON "{table_name}"')


def upgrade() -> None:
    op.create_table(
        "menu_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False, server_default="Other"),
        sa.Column("selling_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "location_id", "normalized_name", name="uq_menu_item_org_location_normalized_name"),
    )

    op.create_table(
        "menu_recipes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "location_id", "menu_item_id", name="uq_menu_recipe_item"),
    )

    op.create_table(
        "menu_recipe_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("menu_recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("line_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ingredient_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("inventory_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("purchase_unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("conversion_factor", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("recipe_id", "line_index", name="uq_menu_recipe_line_order"),
    )

    if _is_postgres():
        bind = op.get_bind()
        _apply_rls(bind.exec_driver_sql)


def downgrade() -> None:
    if _is_postgres():
        bind = op.get_bind()
        _remove_rls(bind.exec_driver_sql)
    op.drop_table("menu_recipe_lines")
    op.drop_table("menu_recipes")
    op.drop_table("menu_items")

