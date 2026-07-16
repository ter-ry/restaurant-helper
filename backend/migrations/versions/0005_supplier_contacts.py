"""supplier contacts

Revision ID: 0005_supplier_contacts
Revises: 0004_reorder_plan_draft_unique
Create Date: 2026-07-16 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_supplier_contacts"
down_revision = "0004_reorder_plan_draft_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("suppliers", sa.Column("contact_name", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("suppliers", sa.Column("contact_phone", sa.String(length=60), nullable=False, server_default=""))
    op.add_column("suppliers", sa.Column("contact_email", sa.String(length=254), nullable=False, server_default=""))
    op.add_column("suppliers", sa.Column("ordering_notes", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("suppliers", "ordering_notes")
    op.drop_column("suppliers", "contact_email")
    op.drop_column("suppliers", "contact_phone")
    op.drop_column("suppliers", "contact_name")
