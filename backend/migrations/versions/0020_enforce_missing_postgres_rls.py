"""enforce RLS on existing tenant-scoped audit and Square tables

Revision ID: 0020_enforce_missing_postgres_rls
Revises: 0019_square_menu_import_and_inventory_waste
"""

from __future__ import annotations

from alembic import op


revision = "0020_enforce_missing_postgres_rls"
down_revision = "0019_square_menu_import_and_inventory_waste"
branch_labels = None
depends_on = None


TENANT_TABLES = (
    "audit_events",
    "square_catalog_objects",
    "square_locations",
    "square_sync_cursors",
    "square_sync_jobs",
    "square_webhook_events",
)


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def upgrade() -> None:
    if not _is_postgres():
        return
    for table_name in TENANT_TABLES:
        op.execute(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY')


def downgrade() -> None:
    if not _is_postgres():
        return
    for table_name in TENANT_TABLES:
        op.execute(f'ALTER TABLE "{table_name}" NO FORCE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table_name}" DISABLE ROW LEVEL SECURITY')
