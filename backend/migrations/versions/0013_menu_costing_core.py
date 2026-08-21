"""menu costing core

Revision ID: 0013_menu_costing_core
Revises: 0012_fix_support_access_grant_rls_recursion
Create Date: 2026-08-11 00:00:00.000000
"""

from __future__ import annotations

from typing import Callable

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection


revision = "0013_menu_costing_core"
down_revision = "0012_fix_support_access_grant_rls_recursion"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _create_tables() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("yield_quantity", sa.Numeric(12, 4), nullable=False, server_default="1"),
        sa.Column("yield_unit", sa.String(length=60), nullable=False, server_default="servings"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "location_id", "normalized_name", name="uq_recipe_org_location_normalized_name"),
    )
    op.create_table(
        "recipe_ingredients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("quantity_required", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("recipe_id", "inventory_item_id", name="uq_recipe_ingredient_recipe_inventory_item"),
    )
    op.create_table(
        "menu_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id", ondelete="RESTRICT"), nullable=False, index=True),
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


def _drop_tables() -> None:
    for table_name in ["menu_items", "recipe_ingredients", "recipes"]:
        op.drop_table(table_name)


def _apply_sql(execute_sql: Callable[[str], None]) -> None:
    _create_tables()

    for table in ["recipes", "recipe_ingredients", "menu_items"]:
        execute_sql(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        execute_sql(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        execute_sql(
            f"""
            CREATE POLICY "flowtally_{table}_tenant_access"
            ON "{table}"
            FOR ALL TO PUBLIC
            USING (flowtally_has_org_access(organization_id))
            WITH CHECK (flowtally_has_org_access(organization_id))
            """
        )


def apply_postgres_migration(connection: Connection) -> None:
    _apply_sql(connection.exec_driver_sql)


def remove_postgres_migration(connection: Connection) -> None:
    for table in ["menu_items", "recipe_ingredients", "recipes"]:
        for policy_name in [f"flowtally_{table}_tenant_access"]:
            connection.exec_driver_sql(f'DROP POLICY IF EXISTS "{policy_name}" ON "{table}"')
    _drop_tables()


def upgrade() -> None:
    if not _is_postgres():
        return
    apply_postgres_migration(op.get_bind())


def downgrade() -> None:
    if not _is_postgres():
        return
    remove_postgres_migration(op.get_bind())
