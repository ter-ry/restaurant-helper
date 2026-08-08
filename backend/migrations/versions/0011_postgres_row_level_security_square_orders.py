"""postgres row level security for square orders

Revision ID: 0011_postgres_row_level_security_square_orders
Revises: 0010_square_orders_sync
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from alembic import op

from backend.extensions import db


revision = "0011_postgres_row_level_security_square_orders"
down_revision = "0010_square_orders_sync"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        context = op.get_context()
    except Exception:
        context = None
    if context is not None:
        return context.dialect.name == "postgresql"
    try:
        return db.engine.dialect.name == "postgresql"
    except Exception:
        return False


def _enable_force_policy(table_name: str, policy_name: str, predicate_sql: str) -> None:
    try:
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")
        op.execute(f"CREATE POLICY {policy_name} ON {table_name} USING ({predicate_sql}) WITH CHECK ({predicate_sql})")
        return
    except AttributeError:
        pass
    with db.engine.begin() as connection:
        connection.exec_driver_sql(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        connection.exec_driver_sql(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
        connection.exec_driver_sql(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")
        connection.exec_driver_sql(f"CREATE POLICY {policy_name} ON {table_name} USING ({predicate_sql}) WITH CHECK ({predicate_sql})")


def upgrade() -> None:
    if not _is_postgres():
        return

    _enable_force_policy(
        "square_orders",
        "flowtally_square_orders_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_orders.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _enable_force_policy(
        "square_order_lines",
        "flowtally_square_order_lines_tenant_access",
        "EXISTS (SELECT 1 FROM square_orders order_row JOIN square_connections connection_row ON connection_row.id = order_row.square_connection_id WHERE order_row.id = square_order_lines.square_order_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    _enable_force_policy(
        "square_daily_sales_summaries",
        "flowtally_square_daily_sales_summaries_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_daily_sales_summaries.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )


def downgrade() -> None:
    if not _is_postgres():
        return

    for table_name, policy_name in [
        ("square_daily_sales_summaries", "flowtally_square_daily_sales_summaries_tenant_access"),
        ("square_order_lines", "flowtally_square_order_lines_tenant_access"),
        ("square_orders", "flowtally_square_orders_tenant_access"),
    ]:
        try:
            op.execute(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")
        except AttributeError:
            with db.engine.begin() as connection:
                connection.exec_driver_sql(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")
