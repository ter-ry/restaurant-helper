"""audit events and tenant constraints

Revision ID: 0006_audit_events_and_tenant_constraints
Revises: 0005_supplier_contacts
Create Date: 2026-08-05 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_audit_events_and_tenant_constraints"
down_revision = "0005_supplier_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("entity_type", sa.String(length=120), nullable=False),
        sa.Column("entity_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("request_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("source_ip", sa.String(length=120), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_audit_events_organization_created_at", "audit_events", ["organization_id", "created_at"])
    op.create_index("ix_audit_events_entity", "audit_events", ["entity_type", "entity_id"])
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_index("ix_audit_events_entity_type", "audit_events", ["entity_type"])
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])

    with op.batch_alter_table("restaurant_locations") as batch_op:
        batch_op.create_unique_constraint("uq_location_org_name", ["organization_id", "name"])

    with op.batch_alter_table("purchase_invoice_lines") as batch_op:
        batch_op.create_unique_constraint("uq_purchase_invoice_line_order", ["invoice_id", "line_index"])

    with op.batch_alter_table("stock_count_session_lines") as batch_op:
        batch_op.create_unique_constraint("uq_stock_count_session_line_order", ["session_id", "line_index"])

    with op.batch_alter_table("reorder_plan_lines") as batch_op:
        batch_op.create_unique_constraint("uq_reorder_plan_line_order", ["plan_id", "line_index"])


def downgrade() -> None:
    with op.batch_alter_table("reorder_plan_lines") as batch_op:
        batch_op.drop_constraint("uq_reorder_plan_line_order", type_="unique")

    with op.batch_alter_table("stock_count_session_lines") as batch_op:
        batch_op.drop_constraint("uq_stock_count_session_line_order", type_="unique")

    with op.batch_alter_table("purchase_invoice_lines") as batch_op:
        batch_op.drop_constraint("uq_purchase_invoice_line_order", type_="unique")

    with op.batch_alter_table("restaurant_locations") as batch_op:
        batch_op.drop_constraint("uq_location_org_name", type_="unique")

    op.drop_index("ix_audit_events_actor_user_id", table_name="audit_events")
    op.drop_index("ix_audit_events_entity_type", table_name="audit_events")
    op.drop_index("ix_audit_events_event_type", table_name="audit_events")
    op.drop_index("ix_audit_events_entity", table_name="audit_events")
    op.drop_index("ix_audit_events_organization_created_at", table_name="audit_events")
    op.drop_table("audit_events")
