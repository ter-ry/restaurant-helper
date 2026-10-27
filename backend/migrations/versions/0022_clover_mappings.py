"""add tenant-scoped Clover location and menu mappings

Revision ID: 0022_clover_mappings
Revises: 0021_clover_connections
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0022_clover_mappings"
down_revision = "0021_clover_connections"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "clover_location_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clover_connection_id", sa.Integer(), sa.ForeignKey("clover_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_merchant_id", sa.String(length=255), nullable=False),
        sa.Column("clover_location_id", sa.String(length=255), nullable=True),
        sa.Column("confirmed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("clover_connection_id", "restaurant_location_id", name="uq_clover_location_mapping_scope"),
        sa.UniqueConstraint("clover_connection_id", "clover_location_id", name="uq_clover_location_mapping_provider_location"),
    )
    op.create_index("ix_clover_location_mappings_connection", "clover_location_mappings", ["clover_connection_id"])
    op.create_index("ix_clover_location_mappings_organization", "clover_location_mappings", ["organization_id"])
    op.create_index("ix_clover_location_mappings_restaurant_location", "clover_location_mappings", ["restaurant_location_id"])

    op.create_table(
        "clover_menu_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clover_connection_id", sa.Integer(), sa.ForeignKey("clover_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("clover_merchant_id", sa.String(length=255), nullable=False),
        sa.Column("clover_item_id", sa.String(length=255), nullable=False),
        sa.Column("clover_item_group_id", sa.String(length=255), nullable=True),
        sa.Column("clover_option_ids_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("clover_modifier_group_ids_json", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("flowtally_menu_item_id", sa.Integer(), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("mapped_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("clover_connection_id", "restaurant_location_id", "clover_item_id", name="uq_clover_menu_mapping_item"),
        sa.UniqueConstraint("clover_connection_id", "restaurant_location_id", "flowtally_menu_item_id", name="uq_clover_menu_mapping_target"),
    )
    op.create_index("ix_clover_menu_mappings_connection", "clover_menu_mappings", ["clover_connection_id"])
    op.create_index("ix_clover_menu_mappings_organization", "clover_menu_mappings", ["organization_id"])
    op.create_index("ix_clover_menu_mappings_restaurant_location", "clover_menu_mappings", ["restaurant_location_id"])
    op.create_index("ix_clover_menu_mappings_menu_item", "clover_menu_mappings", ["flowtally_menu_item_id"])

    if _is_postgres():
        for table, policy in (
            ("clover_location_mappings", "clover_location_mappings_org_access"),
            ("clover_menu_mappings", "clover_menu_mappings_org_access"),
        ):
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(
                f'CREATE POLICY {policy} ON "{table}" USING (flowtally_has_org_access(organization_id)) WITH CHECK (flowtally_has_org_access(organization_id))'
            )


def downgrade() -> None:
    if _is_postgres():
        for table, policy in (
            ("clover_location_mappings", "clover_location_mappings_org_access"),
            ("clover_menu_mappings", "clover_menu_mappings_org_access"),
        ):
            op.execute(f'DROP POLICY IF EXISTS {policy} ON "{table}"')
            op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
    op.drop_index("ix_clover_menu_mappings_menu_item", table_name="clover_menu_mappings")
    op.drop_index("ix_clover_menu_mappings_restaurant_location", table_name="clover_menu_mappings")
    op.drop_index("ix_clover_menu_mappings_organization", table_name="clover_menu_mappings")
    op.drop_index("ix_clover_menu_mappings_connection", table_name="clover_menu_mappings")
    op.drop_table("clover_menu_mappings")
    op.drop_index("ix_clover_location_mappings_restaurant_location", table_name="clover_location_mappings")
    op.drop_index("ix_clover_location_mappings_organization", table_name="clover_location_mappings")
    op.drop_index("ix_clover_location_mappings_connection", table_name="clover_location_mappings")
    op.drop_table("clover_location_mappings")
