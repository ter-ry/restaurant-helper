"""verified-free inventory provenance (#279 Phase A, schema only)

Revision ID: 0029_inventory_cost_verifications
Revises: 0028_inventory_transfers

Adds an append-mostly evidence table that records *explicitly verified* genuinely free ($0) stock.
Nothing is backfilled: every historical ``average_unit_cost = 0`` item stays unverified.
No endpoint writes this table yet (integration is parent #279).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0029_inventory_cost_verifications"
down_revision = "0028_inventory_transfers"
branch_labels = None
depends_on = None

TABLE = "inventory_cost_verifications"
FUNCTION = "flowtally_check_cost_verification_scope"
EVIDENCE_TYPES = ("supplier_free_goods", "donation", "promotional_sample", "other_documented")


def _is_postgres() -> bool:
    return op.get_context().dialect.name == "postgresql"


def upgrade() -> None:
    evidence_list = ", ".join(f"'{value}'" for value in EVIDENCE_TYPES)
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("inventory_item_id", sa.Integer(), sa.ForeignKey("inventory_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("consumed_quantity", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=60), nullable=False, server_default="each"),
        sa.Column("evidence_type", sa.String(length=40), nullable=False),
        sa.Column("evidence_note", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(length=60), nullable=False, server_default=""),
        sa.Column("source_record_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("source_line_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(length=120), nullable=False),
        sa.Column("correction_of_id", sa.Integer(), sa.ForeignKey(f"{TABLE}.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("verified_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_inventory_cost_verification_idempotency"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_cost_verification_quantity_positive"),
        sa.CheckConstraint("consumed_quantity >= 0 AND consumed_quantity <= quantity", name="ck_inventory_cost_verification_consumed_range"),
        sa.CheckConstraint(f"evidence_type IN ({evidence_list})", name="ck_inventory_cost_verification_evidence_type"),
        sa.CheckConstraint("length(trim(evidence_note)) > 0", name="ck_inventory_cost_verification_evidence_note"),
        sa.CheckConstraint(
            "(revoked_at IS NULL AND revoked_reason = '') OR (revoked_at IS NOT NULL AND length(trim(revoked_reason)) > 0)",
            name="ck_inventory_cost_verification_revocation",
        ),
    )
    for column in ("organization_id", "location_id", "inventory_item_id", "correction_of_id"):
        op.create_index(f"ix_{TABLE}_{column}", TABLE, [column])
    if _is_postgres():
        op.execute(f'ALTER TABLE "{TABLE}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{TABLE}" FORCE ROW LEVEL SECURITY')
        op.execute(
            f'CREATE POLICY {TABLE}_org_access ON "{TABLE}" '
            "USING (flowtally_has_org_access(organization_id)) WITH CHECK (flowtally_has_org_access(organization_id))"
        )
        # The item (and any corrected record) must belong to the same organization/location as the evidence row.
        # Runs as the invoker, so under forced RLS a foreign-tenant item is invisible and is rejected as well.
        op.execute(
            f"""
            CREATE OR REPLACE FUNCTION {FUNCTION}() RETURNS trigger AS $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM inventory_items
                    WHERE id = NEW.inventory_item_id
                      AND organization_id = NEW.organization_id
                      AND location_id = NEW.location_id
                ) THEN
                    RAISE EXCEPTION 'cost verification item is outside the organization/location scope'
                        USING ERRCODE = '23514';
                END IF;
                IF NEW.correction_of_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM {TABLE}
                    WHERE id = NEW.correction_of_id
                      AND organization_id = NEW.organization_id
                      AND inventory_item_id = NEW.inventory_item_id
                ) THEN
                    RAISE EXCEPTION 'corrected verification is outside the organization/item scope'
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END
            $$ LANGUAGE plpgsql
            """
        )
        op.execute(
            f"CREATE TRIGGER {TABLE}_scope BEFORE INSERT OR UPDATE OF organization_id, location_id, inventory_item_id, correction_of_id "
            f'ON "{TABLE}" FOR EACH ROW EXECUTE FUNCTION {FUNCTION}()'
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute(f'DROP TRIGGER IF EXISTS {TABLE}_scope ON "{TABLE}"')
        op.execute(f"DROP FUNCTION IF EXISTS {FUNCTION}()")
        op.execute(f'DROP POLICY IF EXISTS {TABLE}_org_access ON "{TABLE}"')
        op.execute(f'ALTER TABLE "{TABLE}" NO FORCE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{TABLE}" DISABLE ROW LEVEL SECURITY')
    for column in ("correction_of_id", "inventory_item_id", "location_id", "organization_id"):
        op.drop_index(f"ix_{TABLE}_{column}", table_name=TABLE)
    op.drop_table(TABLE)
