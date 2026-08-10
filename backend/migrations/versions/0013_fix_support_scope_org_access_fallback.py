"""fix support scope org access fallback

Revision ID: 0013_fix_support_scope_org_access_fallback
Revises: 0012_fix_support_access_grant_rls_recursion
Create Date: 2026-08-10 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0013_fix_support_scope_org_access_fallback"
down_revision = "0012_fix_support_access_grant_rls_recursion"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _apply_sql(execute_sql) -> None:
    execute_sql(
        """
        CREATE OR REPLACE FUNCTION flowtally_has_org_access(row_org_id integer)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        AS $$
          SELECT CASE
            WHEN row_org_id IS NULL THEN false
            WHEN flowtally_current_access_scope() = 'setup' THEN true
            WHEN flowtally_current_access_scope() = 'support' THEN flowtally_support_has_access(row_org_id)
            WHEN flowtally_current_access_scope() = 'customer' THEN row_org_id = flowtally_current_organization_id()
            ELSE row_org_id = flowtally_current_organization_id()
          END
        $$;
        """
    )


def _remove_sql(execute_sql) -> None:
    execute_sql(
        """
        CREATE OR REPLACE FUNCTION flowtally_has_org_access(row_org_id integer)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        AS $$
          SELECT CASE
            WHEN row_org_id IS NULL THEN false
            WHEN flowtally_current_access_scope() = 'setup' THEN true
            WHEN flowtally_support_has_access(row_org_id) THEN true
            ELSE row_org_id = flowtally_current_organization_id()
          END
        $$;
        """
    )


def upgrade() -> None:
    if not _is_postgres():
        return
    _apply_sql(op.get_bind().exec_driver_sql)


def downgrade() -> None:
    if not _is_postgres():
        return
    _remove_sql(op.get_bind().exec_driver_sql)
