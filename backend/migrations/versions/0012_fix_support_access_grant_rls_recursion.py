"""fix support access grant rls recursion

Revision ID: 0012_fix_support_access_grant_rls_recursion
Revises: 0011_postgres_row_level_security_square_orders
Create Date: 2026-08-08 00:00:00.000000
"""

from __future__ import annotations

from typing import Callable

from alembic import op
from sqlalchemy.engine import Connection


revision = "0012_fix_support_access_grant_rls_recursion"
down_revision = "0011_postgres_row_level_security_square_orders"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _apply_sql(execute_sql: Callable[[str], None]) -> None:
    execute_sql('ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY')
    execute_sql('ALTER TABLE "support_access_grants" FORCE ROW LEVEL SECURITY')
    execute_sql('DROP POLICY IF EXISTS "flowtally_support_access_grants_active_lookup" ON "support_access_grants"')
    execute_sql('DROP POLICY IF EXISTS "flowtally_support_access_grants_tenant_access" ON "support_access_grants"')
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_select_access"
        ON "support_access_grants"
        FOR SELECT TO PUBLIC
        USING (
          flowtally_access_scope() = 'setup'
          OR organization_id = flowtally_current_organization_id()
          OR id = flowtally_current_support_grant_id()
        )
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_insert_access"
        ON "support_access_grants"
        FOR INSERT TO PUBLIC
        WITH CHECK (flowtally_access_scope() = 'setup')
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_update_access"
        ON "support_access_grants"
        FOR UPDATE TO PUBLIC
        USING (flowtally_access_scope() = 'setup')
        WITH CHECK (flowtally_access_scope() = 'setup')
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_delete_access"
        ON "support_access_grants"
        FOR DELETE TO PUBLIC
        USING (flowtally_access_scope() = 'setup')
        """
    )


def _remove_sql(execute_sql: Callable[[str], None]) -> None:
    execute_sql('ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY')
    execute_sql('ALTER TABLE "support_access_grants" FORCE ROW LEVEL SECURITY')
    for policy_name in [
        "flowtally_support_access_grants_delete_access",
        "flowtally_support_access_grants_update_access",
        "flowtally_support_access_grants_insert_access",
        "flowtally_support_access_grants_select_access",
    ]:
        execute_sql(f'DROP POLICY IF EXISTS "{policy_name}" ON "support_access_grants"')
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_active_lookup"
        ON "support_access_grants"
        FOR ALL TO PUBLIC
        USING (
          flowtally_access_scope() = 'setup'
          OR id = flowtally_current_support_grant_id()
          OR flowtally_has_org_access(organization_id)
        )
        WITH CHECK (
          flowtally_access_scope() = 'setup'
          OR id = flowtally_current_support_grant_id()
          OR flowtally_has_org_access(organization_id)
        )
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_support_access_grants_tenant_access"
        ON "support_access_grants"
        FOR ALL TO PUBLIC
        USING (flowtally_has_org_access(organization_id))
        WITH CHECK (flowtally_has_org_access(organization_id))
        """
    )


def apply_postgres_rls(connection: Connection) -> None:
    _apply_sql(connection.exec_driver_sql)


def remove_postgres_rls(connection: Connection) -> None:
    _remove_sql(connection.exec_driver_sql)


def upgrade() -> None:
    if not _is_postgres():
        return
    bind = op.get_bind()
    apply_postgres_rls(bind)


def downgrade() -> None:
    if not _is_postgres():
        return
    bind = op.get_bind()
    remove_postgres_rls(bind)
