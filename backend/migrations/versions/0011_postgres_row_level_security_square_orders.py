"""postgres row level security for square orders

Revision ID: 0011_postgres_row_level_security_square_orders
Revises: 0010_square_orders_sync
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from typing import Callable

from alembic import op
from sqlalchemy.engine import Connection


revision = "0011_postgres_row_level_security_square_orders"
down_revision = "0010_square_orders_sync"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        return op.get_context().dialect.name == "postgresql"
    except Exception:
        return False


def _apply_sql(execute_sql: Callable[[str], None]) -> None:
    def enable_force_policy(table_name: str, policy_name: str, predicate_sql: str) -> None:
        execute_sql(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")
        execute_sql(f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY")
        execute_sql(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")
        execute_sql(f"CREATE POLICY {policy_name} ON {table_name} USING ({predicate_sql}) WITH CHECK ({predicate_sql})")

    enable_force_policy(
        "square_orders",
        "flowtally_square_orders_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_orders.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    enable_force_policy(
        "square_order_lines",
        "flowtally_square_order_lines_tenant_access",
        "EXISTS (SELECT 1 FROM square_orders order_row JOIN square_connections connection_row ON connection_row.id = order_row.square_connection_id WHERE order_row.id = square_order_lines.square_order_id AND flowtally_has_org_access(connection_row.organization_id))",
    )
    enable_force_policy(
        "square_daily_sales_summaries",
        "flowtally_square_daily_sales_summaries_tenant_access",
        "EXISTS (SELECT 1 FROM square_connections connection_row WHERE connection_row.id = square_daily_sales_summaries.square_connection_id AND flowtally_has_org_access(connection_row.organization_id))",
    )


def _remove_sql(execute_sql: Callable[[str], None]) -> None:
    for table_name, policy_name in [
        ("square_daily_sales_summaries", "flowtally_square_daily_sales_summaries_tenant_access"),
        ("square_order_lines", "flowtally_square_order_lines_tenant_access"),
        ("square_orders", "flowtally_square_orders_tenant_access"),
    ]:
        execute_sql(f"DROP POLICY IF EXISTS {policy_name} ON {table_name}")


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
