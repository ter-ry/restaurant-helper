"""purchase invoice void/correction lineage

Revision ID: 0027_purchase_invoice_void_lineage
Revises: 0026_clover_consumption_cost_snapshot
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0027_purchase_invoice_void_lineage"
down_revision = "0026_clover_consumption_cost_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("purchase_invoices") as batch:
        batch.add_column(sa.Column("corrects_invoice_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("voided_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("void_reason", sa.Text(), nullable=False, server_default=""))
        batch.create_foreign_key("fk_purchase_invoices_corrects_invoice", "purchase_invoices", ["corrects_invoice_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_purchase_invoices_voided_by_user", "users", ["voided_by_user_id"], ["id"], ondelete="SET NULL")
        batch.create_unique_constraint("uq_purchase_invoices_corrects_invoice", ["corrects_invoice_id"])


def downgrade() -> None:
    with op.batch_alter_table("purchase_invoices") as batch:
        batch.drop_constraint("uq_purchase_invoices_corrects_invoice", type_="unique")
        batch.drop_constraint("fk_purchase_invoices_voided_by_user", type_="foreignkey")
        batch.drop_constraint("fk_purchase_invoices_corrects_invoice", type_="foreignkey")
        batch.drop_column("void_reason")
        batch.drop_column("voided_by_user_id")
        batch.drop_column("voided_at")
        batch.drop_column("corrects_invoice_id")
