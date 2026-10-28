"""add timestamps to Clover mapping tables

Revision ID: 0023_clover_mapping_timestamps
Revises: 0022_clover_mappings
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0023_clover_mapping_timestamps"
down_revision = "0022_clover_mappings"
branch_labels = None
depends_on = None


_TABLES = ("clover_location_mappings", "clover_menu_mappings")


def _is_sqlite() -> bool:
    return op.get_context().dialect.name == "sqlite"


def _add_nullable_columns(table: str) -> None:
    op.add_column(table, sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(table, sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))


def _make_non_nullable(table: str) -> None:
    if _is_sqlite():
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "created_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=False,
            )
            batch.alter_column(
                "updated_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=False,
            )
        return
    op.alter_column(
        table,
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )
    op.alter_column(
        table,
        "updated_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
    )


def upgrade() -> None:
    for table in _TABLES:
        _add_nullable_columns(table)
        # Mapping rows predate TimestampMixin columns. Use the provider
        # confirmation time when available; otherwise use one migration
        # timestamp for both values so every retained row is valid.
        if table == "clover_location_mappings":
            op.execute(
                sa.text(
                    'UPDATE "clover_location_mappings" '
                    "SET created_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP), "
                    "updated_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP) "
                    "WHERE created_at IS NULL OR updated_at IS NULL"
                )
            )
        else:
            op.execute(
                sa.text(
                    'UPDATE "clover_menu_mappings" '
                    "SET created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP "
                    "WHERE created_at IS NULL OR updated_at IS NULL"
                )
            )
        _make_non_nullable(table)


def downgrade() -> None:
    for table in reversed(_TABLES):
        if _is_sqlite():
            with op.batch_alter_table(table) as batch:
                batch.drop_column("updated_at")
                batch.drop_column("created_at")
        else:
            op.drop_column(table, "updated_at")
            op.drop_column(table, "created_at")
