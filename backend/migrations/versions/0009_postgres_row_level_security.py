"""postgres row level security

Revision ID: 0009_postgres_row_level_security
Revises: 0008_data_import_pipeline
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from backend.extensions import db


revision = "0009_postgres_row_level_security"
down_revision = "0008_data_import_pipeline"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    context = op.get_context()
    if context is not None:
        return context.dialect.name == "postgresql"
    return db.engine.dialect.name == "postgresql"


def _execute(sql: str) -> None:
    op.execute(sa.text(sql))


def _drop_policy(table: str, policy_name: str) -> None:
    _execute(f'DROP POLICY IF EXISTS "{policy_name}" ON "{table}"')


def _create_policy(table: str, policy_name: str, using_sql: str, with_check_sql: str | None = None) -> None:
    check_sql = with_check_sql or using_sql
    _execute(
        f'CREATE POLICY "{policy_name}" ON "{table}" '
        f'FOR ALL TO PUBLIC USING ({using_sql}) WITH CHECK ({check_sql})'
    )


def _enable_force(table: str) -> None:
    _execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
    _execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')


def _apply_simple_org_table(table: str, *, force: bool = True) -> None:
    if force:
        _enable_force(table)
    else:
        _execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
    _create_policy(table, f"flowtally_{table}_tenant_access", "flowtally_has_org_access(organization_id)")


def upgrade() -> None:
    if not _is_postgres():
        return

    _execute(
        """
        CREATE OR REPLACE FUNCTION flowtally_current_access_scope()
        RETURNS text
        LANGUAGE sql
        STABLE
        AS $$
          SELECT NULLIF(current_setting('flowtally.access_scope', true), '')
        $$;
        """
    )
    _execute(
        """
        CREATE OR REPLACE FUNCTION flowtally_access_scope()
        RETURNS text
        LANGUAGE sql
        STABLE
        AS $$ 
          SELECT flowtally_current_access_scope()
        $$;
        """
    )
    _execute(
        """
        CREATE OR REPLACE FUNCTION flowtally_current_organization_id()
        RETURNS integer
        LANGUAGE sql
        STABLE
        AS $$
          SELECT NULLIF(current_setting('flowtally.organization_id', true), '')::integer
        $$;
        """
    )
    _execute(
        """
        CREATE OR REPLACE FUNCTION flowtally_current_support_grant_id()
        RETURNS integer
        LANGUAGE sql
        STABLE
        AS $$
          SELECT NULLIF(current_setting('flowtally.support_grant_id', true), '')::integer
        $$;
        """
    )
    _execute(
        """
        CREATE OR REPLACE FUNCTION flowtally_support_has_access(row_org_id integer)
        RETURNS boolean
        LANGUAGE sql
        STABLE
        AS $$
          SELECT EXISTS (
            SELECT 1
            FROM support_access_grants grant_row
            WHERE grant_row.id = flowtally_current_support_grant_id()
              AND grant_row.organization_id = row_org_id
              AND grant_row.status = 'active'
              AND grant_row.revoked_at IS NULL
              AND grant_row.starts_at <= timezone('utc', now())
              AND grant_row.expires_at >= timezone('utc', now())
          )
        $$;
        """
    )
    _execute(
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

    org_tables = [
        "organizations",
        "organization_memberships",
        "restaurant_locations",
        "suppliers",
        "inventory_items",
        "supplier_item_mappings",
        "purchase_invoices",
        "purchase_invoice_lines",
        "inventory_movements",
        "stock_count_sessions",
        "stock_count_session_lines",
        "reorder_plans",
        "reorder_plan_lines",
        "reorder_intents",
        "organization_modules",
        "organization_configurations",
        "organization_configuration_versions",
        "dashboard_layouts",
        "support_access_grants",
        "organization_invitations",
        "square_connections",
        "square_catalog_mappings",
        "square_location_mappings",
        "data_import_jobs",
        "data_import_files",
        "data_import_mappings",
        "data_import_rows",
        "data_import_issues",
        "data_import_changes",
    ]
    for table in org_tables:
        _enable_force(table)

    _create_policy(
        "organizations",
        "flowtally_organizations_tenant_access",
        "flowtally_access_scope() = 'setup' OR flowtally_support_has_access(id) OR id = flowtally_current_organization_id()",
        "flowtally_access_scope() IN ('setup', 'public') OR flowtally_support_has_access(id) OR id = flowtally_current_organization_id()",
    )

    for table in [
        "organization_memberships",
        "restaurant_locations",
        "suppliers",
        "inventory_items",
        "supplier_item_mappings",
        "purchase_invoices",
        "inventory_movements",
        "stock_count_sessions",
        "reorder_plans",
        "reorder_intents",
        "organization_modules",
        "organization_configurations",
        "dashboard_layouts",
        "support_access_grants",
        "organization_invitations",
        "square_connections",
        "data_import_jobs",
    ]:
        _create_policy(table, f"flowtally_{table}_tenant_access", "flowtally_has_org_access(organization_id)")

    _create_policy(
        "purchase_invoice_lines",
        "flowtally_purchase_invoice_lines_tenant_access",
        "EXISTS (SELECT 1 FROM purchase_invoices invoice_row WHERE invoice_row.id = purchase_invoice_lines.invoice_id AND flowtally_has_org_access(invoice_row.organization_id))",
    )
    _create_policy(
        "stock_count_session_lines",
        "flowtally_stock_count_session_lines_tenant_access",
        "EXISTS (SELECT 1 FROM stock_count_sessions session_row WHERE session_row.id = stock_count_session_lines.session_id AND flowtally_has_org_access(session_row.organization_id))",
    )
    _create_policy(
        "reorder_plan_lines",
        "flowtally_reorder_plan_lines_tenant_access",
        "EXISTS (SELECT 1 FROM reorder_plans plan_row WHERE plan_row.id = reorder_plan_lines.plan_id AND flowtally_has_org_access(plan_row.organization_id))",
    )
    _create_policy(
        "organization_configuration_versions",
        "flowtally_organization_configuration_versions_tenant_access",
        "EXISTS (SELECT 1 FROM organization_configurations config_row WHERE config_row.id = organization_configuration_versions.organization_configuration_id AND flowtally_has_org_access(config_row.organization_id))",
    )
    _create_policy(
        "data_import_files",
        "flowtally_data_import_files_tenant_access",
        "EXISTS (SELECT 1 FROM data_import_jobs job_row WHERE job_row.id = data_import_files.data_import_job_id AND flowtally_has_org_access(job_row.organization_id))",
    )
    _create_policy(
        "data_import_mappings",
        "flowtally_data_import_mappings_tenant_access",
        "EXISTS (SELECT 1 FROM data_import_jobs job_row WHERE job_row.id = data_import_mappings.data_import_job_id AND flowtally_has_org_access(job_row.organization_id))",
    )
    _create_policy(
        "data_import_rows",
        "flowtally_data_import_rows_tenant_access",
        "EXISTS (SELECT 1 FROM data_import_jobs job_row WHERE job_row.id = data_import_rows.data_import_job_id AND flowtally_has_org_access(job_row.organization_id))",
    )
    _create_policy(
        "data_import_issues",
        "flowtally_data_import_issues_tenant_access",
        "EXISTS (SELECT 1 FROM data_import_rows row_row JOIN data_import_jobs job_row ON job_row.id = row_row.data_import_job_id WHERE row_row.id = data_import_issues.data_import_row_id AND flowtally_has_org_access(job_row.organization_id))",
    )
    _create_policy(
        "data_import_changes",
        "flowtally_data_import_changes_tenant_access",
        "EXISTS (SELECT 1 FROM data_import_jobs job_row WHERE job_row.id = data_import_changes.data_import_job_id AND flowtally_has_org_access(job_row.organization_id))",
    )
    _create_policy(
        "square_locations",
        "flowtally_square_locations_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_locations.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "square_catalog_objects",
        "flowtally_square_catalog_objects_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_catalog_objects.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "square_sync_jobs",
        "flowtally_square_sync_jobs_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_sync_jobs.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "square_sync_cursors",
        "flowtally_square_sync_cursors_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_sync_cursors.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "square_webhook_events",
        "flowtally_square_webhook_events_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_webhook_events.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "square_location_mappings",
        "flowtally_square_location_mappings_tenant_access",
        "EXISTS (SELECT 1 FROM square_locations square_row JOIN square_connections connection_row ON connection_row.id = square_row.square_connection_id WHERE square_row.id = square_location_mappings.square_location_id AND flowtally_has_org_access(connection_row.organization_id)) OR EXISTS (SELECT 1 FROM restaurant_locations restaurant_row WHERE restaurant_row.id = square_location_mappings.restaurant_location_id AND flowtally_has_org_access(restaurant_row.organization_id))",
    )
    _create_policy(
        "support_access_grants",
        "flowtally_support_access_grants_active_lookup",
        "flowtally_access_scope() = 'setup' OR id = flowtally_current_support_grant_id() OR flowtally_has_org_access(organization_id)",
    )
    _create_policy(
        "square_catalog_mappings",
        "flowtally_square_catalog_mappings_tenant_access",
        "EXISTS (SELECT 1 FROM square_catalog_objects object_row JOIN square_connections connection_row ON connection_row.id = object_row.square_connection_id WHERE object_row.id = square_catalog_mappings.square_catalog_object_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _create_policy(
        "audit_events",
        "flowtally_audit_events_tenant_access",
        "organization_id IS NULL OR flowtally_has_org_access(organization_id)",
    )


def downgrade() -> None:
    if not _is_postgres():
        return

    for table, policy_name in [
        ("audit_events", "flowtally_audit_events_tenant_access"),
        ("square_catalog_mappings", "flowtally_square_catalog_mappings_tenant_access"),
        ("square_location_mappings", "flowtally_square_location_mappings_tenant_access"),
        ("support_access_grants", "flowtally_support_access_grants_active_lookup"),
        ("data_import_changes", "flowtally_data_import_changes_tenant_access"),
        ("data_import_issues", "flowtally_data_import_issues_tenant_access"),
        ("data_import_rows", "flowtally_data_import_rows_tenant_access"),
        ("data_import_mappings", "flowtally_data_import_mappings_tenant_access"),
        ("data_import_files", "flowtally_data_import_files_tenant_access"),
        ("organization_configuration_versions", "flowtally_organization_configuration_versions_tenant_access"),
        ("reorder_plan_lines", "flowtally_reorder_plan_lines_tenant_access"),
        ("stock_count_session_lines", "flowtally_stock_count_session_lines_tenant_access"),
        ("purchase_invoice_lines", "flowtally_purchase_invoice_lines_tenant_access"),
        ("square_webhook_events", "flowtally_square_webhook_events_tenant_access"),
        ("square_sync_cursors", "flowtally_square_sync_cursors_tenant_access"),
        ("square_sync_jobs", "flowtally_square_sync_jobs_tenant_access"),
        ("square_catalog_objects", "flowtally_square_catalog_objects_tenant_access"),
        ("square_locations", "flowtally_square_locations_tenant_access"),
        ("square_connections", "flowtally_square_connections_tenant_access"),
        ("organization_invitations", "flowtally_organization_invitations_tenant_access"),
        ("support_access_grants", "flowtally_support_access_grants_tenant_access"),
        ("dashboard_layouts", "flowtally_dashboard_layouts_tenant_access"),
        ("organization_configurations", "flowtally_organization_configurations_tenant_access"),
        ("organization_modules", "flowtally_organization_modules_tenant_access"),
        ("reorder_intents", "flowtally_reorder_intents_tenant_access"),
        ("reorder_plans", "flowtally_reorder_plans_tenant_access"),
        ("stock_count_sessions", "flowtally_stock_count_sessions_tenant_access"),
        ("inventory_movements", "flowtally_inventory_movements_tenant_access"),
        ("purchase_invoices", "flowtally_purchase_invoices_tenant_access"),
        ("supplier_item_mappings", "flowtally_supplier_item_mappings_tenant_access"),
        ("inventory_items", "flowtally_inventory_items_tenant_access"),
        ("suppliers", "flowtally_suppliers_tenant_access"),
        ("restaurant_locations", "flowtally_restaurant_locations_tenant_access"),
        ("organization_memberships", "flowtally_organization_memberships_tenant_access"),
        ("organizations", "flowtally_organizations_tenant_access"),
    ]:
        _drop_policy(table, policy_name)
        _execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
        _execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')

    for func in [
        "flowtally_has_org_access",
        "flowtally_support_has_access",
        "flowtally_current_support_grant_id",
        "flowtally_current_organization_id",
        "flowtally_current_access_scope",
    ]:
        _execute(f"DROP FUNCTION IF EXISTS {func} CASCADE")
