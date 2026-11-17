"""purchase invoice OCR provenance (#169)

Revision ID: 0030_invoice_ocr_provenance
Revises: 0029_inventory_cost_verifications

Stores the amounts the original document printed (server-signed at OCR time) so the receipt guard cannot be
bypassed by saving, reloading or editing invoice totals. Nullable, no backfill: legacy rows stay NULL.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0030_invoice_ocr_provenance"
down_revision = "0029_inventory_cost_verifications"
branch_labels = None
depends_on = None

COLUMNS = ("ocr_printed_subtotal", "ocr_printed_tax", "ocr_printed_total")


def upgrade() -> None:
    with op.batch_alter_table("purchase_invoices") as batch:
        for name in COLUMNS:
            batch.add_column(sa.Column(name, sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("ocr_provenance_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("purchase_invoices") as batch:
        batch.drop_column("ocr_provenance_at")
        for name in reversed(COLUMNS):
            batch.drop_column(name)
