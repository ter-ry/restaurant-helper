"""add tenant-scoped Clover OAuth connections

Revision ID: 0021_clover_connections
Revises: 0020_enforce_missing_postgres_rls
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0021_clover_connections"
down_revision = "0020_enforce_missing_postgres_rls"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "clover_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("environment", sa.String(length=40), nullable=False, server_default="sandbox"),
        sa.Column("region", sa.String(length=40), nullable=False, server_default="north_america"),
        sa.Column("merchant_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("merchant_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="disconnected"),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("recovery_token_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("access_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recovery_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_connection_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", name="uq_clover_connection_organization"),
    )
    op.create_index("ix_clover_connections_organization_id", "clover_connections", ["organization_id"])
    if _is_postgres():
        op.execute('ALTER TABLE "clover_connections" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "clover_connections" FORCE ROW LEVEL SECURITY')
        op.execute('CREATE POLICY clover_connections_org_access ON "clover_connections" USING (flowtally_has_org_access(organization_id)) WITH CHECK (flowtally_has_org_access(organization_id))')


def downgrade() -> None:
    if _is_postgres():
        op.execute('DROP POLICY IF EXISTS clover_connections_org_access ON "clover_connections"')
        op.execute('ALTER TABLE "clover_connections" NO FORCE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "clover_connections" DISABLE ROW LEVEL SECURITY')
    op.drop_index("ix_clover_connections_organization_id", table_name="clover_connections")
    op.drop_table("clover_connections")
