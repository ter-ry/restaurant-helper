"""daily close sessions

Revision ID: 0016_daily_close_sessions
Revises: 0015_weighted_average_inventory_cost
Create Date: 2026-08-30 00:00:00.000000
"""

from __future__ import annotations

from typing import Callable

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import Connection


revision = "0016_daily_close_sessions"
down_revision = "0015_weighted_average_inventory_cost"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _create_table() -> None:
    op.create_table(
        "daily_close_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("business_date", sa.Date(), nullable=False, index=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="DRAFT"),
        sa.Column("summary_snapshot_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("usage_snapshot_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("exceptions_snapshot_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "location_id", "business_date", name="uq_daily_close_session_scope"),
    )


def _drop_table() -> None:
    op.drop_table("daily_close_sessions")


def _apply_sql(execute_sql: Callable[[str], None]) -> None:
    _create_table()
    execute_sql('ALTER TABLE "daily_close_sessions" ENABLE ROW LEVEL SECURITY')
    execute_sql('ALTER TABLE "daily_close_sessions" FORCE ROW LEVEL SECURITY')
    execute_sql(
        """
        CREATE POLICY "flowtally_daily_close_sessions_tenant_access"
        ON "daily_close_sessions"
        FOR ALL TO PUBLIC
        USING (flowtally_has_org_access(organization_id))
        WITH CHECK (flowtally_has_org_access(organization_id))
        """
    )


def apply_postgres_migration(connection: Connection) -> None:
    _apply_sql(connection.exec_driver_sql)


def remove_postgres_migration(connection: Connection) -> None:
    connection.exec_driver_sql('DROP POLICY IF EXISTS "flowtally_daily_close_sessions_tenant_access" ON "daily_close_sessions"')
    _drop_table()


def upgrade() -> None:
    if not _is_postgres():
        return
    apply_postgres_migration(op.get_bind())


def downgrade() -> None:
    if not _is_postgres():
        return
    remove_postgres_migration(op.get_bind())
