"""durable OCR printed-amount evidence and audited override on purchase invoices (#169)

Revision ID: 0030_purchase_invoice_ocr_evidence
Revises: 0029_inventory_cost_verifications

Additive, nullable columns only. No backfill: existing invoices keep NULL evidence and behave exactly as before.
purchase_invoices already has forced RLS; new columns inherit it. Downgrade drops the columns (evidence is lost).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0030_purchase_invoice_ocr_evidence"
down_revision = "0029_inventory_cost_verifications"
branch_labels = None
depends_on = None

TABLE = "purchase_invoices"


def upgrade() -> None:
    with op.batch_alter_table(TABLE) as batch:
        batch.add_column(sa.Column("ocr_printed_subtotal", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_printed_tax", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_printed_total", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_evidence_captured_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("ocr_override_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("ocr_override_line_total", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_override_expected_amount", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_override_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_purchase_invoices_ocr_override_by"), nullable=True))
        batch.add_column(sa.Column("ocr_override_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table(TABLE) as batch:
        for column in (
            "ocr_override_at",
            "ocr_override_by_user_id",
            "ocr_override_expected_amount",
            "ocr_override_line_total",
            "ocr_override_reason",
            "ocr_evidence_captured_at",
            "ocr_printed_total",
            "ocr_printed_tax",
            "ocr_printed_subtotal",
        ):
            batch.drop_column(column)
