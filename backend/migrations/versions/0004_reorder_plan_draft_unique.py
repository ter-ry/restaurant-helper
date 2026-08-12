"""reorder plan draft uniqueness

Revision ID: 0004_reorder_plan_draft_unique
Revises: 0003_reorder_plans
Create Date: 2026-07-15 00:00:01.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_reorder_plan_draft_unique"
down_revision = "0003_reorder_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_reorder_plans_draft_org_location",
        "reorder_plans",
        ["organization_id", "location_id"],
        unique=True,
        sqlite_where=sa.text("status = 'Draft'"),
        postgresql_where=sa.text("status = 'Draft'"),
    )


def downgrade() -> None:
    op.drop_index("uq_reorder_plans_draft_org_location", table_name="reorder_plans")
