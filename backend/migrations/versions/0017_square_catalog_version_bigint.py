"""store Square catalog versions as 64-bit integers

Revision ID: 0017_square_catalog_version_bigint
Revises: 0016_daily_close_sessions
Create Date: 2026-08-31 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0017_square_catalog_version_bigint"
down_revision = "0016_daily_close_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().dialect.name == "postgresql":
        op.alter_column(
            "square_catalog_objects",
            "version",
            existing_type=sa.Integer(),
            type_=sa.BigInteger(),
            existing_nullable=False,
        )


def downgrade() -> None:
    if op.get_context().dialect.name == "postgresql":
        op.alter_column(
            "square_catalog_objects",
            "version",
            existing_type=sa.BigInteger(),
            type_=sa.Integer(),
            existing_nullable=False,
        )
