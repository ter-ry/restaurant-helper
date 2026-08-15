"""authenticated membership discovery"""

from __future__ import annotations

from typing import Callable

from alembic import op
from sqlalchemy.engine import Connection


revision = "0014_authenticated_membership_discovery"
down_revision = "0013_menu_costing_core"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _apply_sql(execute_sql: Callable[[str], None]) -> None:
    execute_sql(
        """
        CREATE OR REPLACE FUNCTION flowtally_current_user_id()
        RETURNS integer
        LANGUAGE sql
        STABLE
        AS $$
          SELECT NULLIF(current_setting('flowtally.user_id', true), '')::integer
        $$;
        """
    )

    execute_sql('DROP POLICY IF EXISTS "flowtally_organizations_tenant_access" ON "organizations"')
    execute_sql('DROP POLICY IF EXISTS "flowtally_organization_memberships_tenant_access" ON "organization_memberships"')

    execute_sql(
        """
        CREATE POLICY "flowtally_organization_memberships_read_access" ON "organization_memberships"
        FOR SELECT TO PUBLIC
        USING (
          flowtally_access_scope() = 'setup'
          OR user_id = flowtally_current_user_id()
          OR organization_id = flowtally_current_organization_id()
        )
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_organization_memberships_write_access" ON "organization_memberships"
        FOR ALL TO PUBLIC
        USING (
          flowtally_access_scope() = 'setup'
          OR organization_id = flowtally_current_organization_id()
        )
        WITH CHECK (
          flowtally_access_scope() = 'setup'
          OR organization_id = flowtally_current_organization_id()
        )
        """
    )

    execute_sql(
        """
        CREATE POLICY "flowtally_organizations_read_access" ON "organizations"
        FOR SELECT TO PUBLIC
        USING (
          flowtally_access_scope() IN ('setup', 'public')
          OR flowtally_support_has_access(id)
          OR id = flowtally_current_organization_id()
          OR EXISTS (
            SELECT 1
            FROM organization_memberships membership_row
            WHERE membership_row.organization_id = organizations.id
              AND membership_row.user_id = flowtally_current_user_id()
          )
        )
        """
    )
    execute_sql(
        """
        CREATE POLICY "flowtally_organizations_write_access" ON "organizations"
        FOR ALL TO PUBLIC
        USING (
          flowtally_access_scope() IN ('setup', 'public')
          OR flowtally_support_has_access(id)
          OR id = flowtally_current_organization_id()
        )
        WITH CHECK (
          flowtally_access_scope() IN ('setup', 'public')
          OR flowtally_support_has_access(id)
          OR id = flowtally_current_organization_id()
        )
        """
    )


def apply_postgres_rls(connection: Connection) -> None:
    _apply_sql(connection.exec_driver_sql)


def upgrade() -> None:
    if not _is_postgres():
        return
    apply_postgres_rls(op.get_bind())


def downgrade() -> None:
    if not _is_postgres():
        return
    connection = op.get_bind()
    connection.exec_driver_sql('DROP POLICY IF EXISTS "flowtally_organizations_write_access" ON "organizations"')
    connection.exec_driver_sql('DROP POLICY IF EXISTS "flowtally_organizations_read_access" ON "organizations"')
    connection.exec_driver_sql('DROP POLICY IF EXISTS "flowtally_organization_memberships_write_access" ON "organization_memberships"')
    connection.exec_driver_sql('DROP POLICY IF EXISTS "flowtally_organization_memberships_read_access" ON "organization_memberships"')
    connection.exec_driver_sql(
        """
        CREATE POLICY "flowtally_organizations_tenant_access" ON "organizations"
        FOR ALL TO PUBLIC
        USING (flowtally_access_scope() = 'setup' OR flowtally_support_has_access(id) OR id = flowtally_current_organization_id())
        WITH CHECK (flowtally_access_scope() IN ('setup', 'public') OR flowtally_support_has_access(id) OR id = flowtally_current_organization_id())
        """
    )
    connection.exec_driver_sql(
        """
        CREATE POLICY "flowtally_organization_memberships_tenant_access" ON "organization_memberships"
        FOR ALL TO PUBLIC
        USING (flowtally_has_org_access(organization_id))
        WITH CHECK (flowtally_has_org_access(organization_id))
        """
    )
    connection.exec_driver_sql("DROP FUNCTION IF EXISTS flowtally_current_user_id CASCADE")
