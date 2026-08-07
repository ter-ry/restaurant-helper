"""data import pipeline

Revision ID: 0008_data_import_pipeline
Revises: 0007_commercial_onboarding_and_square_foundation
Create Date: 2026-08-07 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008_data_import_pipeline"
down_revision = "0007_commercial_onboarding_and_square_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "data_import_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_type", sa.String(length=40), nullable=False, server_default="csv"),
        sa.Column("source_file_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_file_extension", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("source_mime_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("source_hash", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("storage_path", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="UPLOADED"),
        sa.Column("entity_scope", sa.String(length=80), nullable=False, server_default="supplier"),
        sa.Column("mapping_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("summary_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("preview_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("applied_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("batch_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("rollback_blockers_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "source_hash", name="uq_data_import_job_org_source_hash"),
    )

    op.create_index("ix_data_import_jobs_organization_id", "data_import_jobs", ["organization_id"])
    op.create_index("ix_data_import_jobs_created_by_user_id", "data_import_jobs", ["created_by_user_id"])
    op.create_index("ix_data_import_jobs_approved_by_user_id", "data_import_jobs", ["approved_by_user_id"])
    op.create_index("ix_data_import_jobs_source_hash", "data_import_jobs", ["source_hash"])

    op.create_table(
        "data_import_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data_import_job_id", sa.Integer(), sa.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False, server_default="source"),
        sa.Column("original_file_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("storage_path", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("sha256", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("data_import_job_id", "role", name="uq_data_import_file_job_role"),
    )
    op.create_index("ix_data_import_files_data_import_job_id", "data_import_files", ["data_import_job_id"])

    op.create_table(
        "data_import_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data_import_job_id", sa.Integer(), sa.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_column_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("target_field_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("mapping_type", sa.String(length=40), nullable=False, server_default="manual"),
        sa.Column("fixed_value_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("data_import_job_id", "target_field_name", name="uq_data_import_mapping_target_field"),
    )
    op.create_index("ix_data_import_mappings_data_import_job_id", "data_import_mappings", ["data_import_job_id"])

    op.create_table(
        "data_import_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data_import_job_id", sa.Integer(), sa.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("entity_type", sa.String(length=80), nullable=False, server_default="supplier"),
        sa.Column("source_row_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("normalized_row_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("row_fingerprint", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="preview"),
        sa.Column("target_entity_type", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("target_entity_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("issue_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("warning_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("can_rollback", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("data_import_job_id", "row_number", name="uq_data_import_row_number"),
        sa.UniqueConstraint("data_import_job_id", "row_fingerprint", name="uq_data_import_row_fingerprint"),
    )
    op.create_index("ix_data_import_rows_data_import_job_id", "data_import_rows", ["data_import_job_id"])
    op.create_index("ix_data_import_rows_row_fingerprint", "data_import_rows", ["row_fingerprint"])

    op.create_table(
        "data_import_issues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data_import_row_id", sa.Integer(), sa.ForeignKey("data_import_rows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="warning"),
        sa.Column("field_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("code", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_data_import_issues_data_import_row_id", "data_import_issues", ["data_import_row_id"])

    op.create_table(
        "data_import_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data_import_job_id", sa.Integer(), sa.ForeignKey("data_import_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("data_import_row_id", sa.Integer(), sa.ForeignKey("data_import_rows.id", ondelete="CASCADE"), nullable=True),
        sa.Column("entity_type", sa.String(length=80), nullable=False, server_default="supplier"),
        sa.Column("change_type", sa.String(length=40), nullable=False, server_default="create"),
        sa.Column("target_entity_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("row_fingerprint", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("previous_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("applied_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("rollbackable", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="preview"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("data_import_job_id", "row_fingerprint", name="uq_data_import_change_fingerprint"),
    )
    op.create_index("ix_data_import_changes_data_import_job_id", "data_import_changes", ["data_import_job_id"])
    op.create_index("ix_data_import_changes_data_import_row_id", "data_import_changes", ["data_import_row_id"])
    op.create_index("ix_data_import_changes_row_fingerprint", "data_import_changes", ["row_fingerprint"])


def downgrade() -> None:
    op.drop_index("ix_data_import_changes_row_fingerprint", table_name="data_import_changes")
    op.drop_index("ix_data_import_changes_data_import_row_id", table_name="data_import_changes")
    op.drop_index("ix_data_import_changes_data_import_job_id", table_name="data_import_changes")
    op.drop_table("data_import_changes")

    op.drop_index("ix_data_import_issues_data_import_row_id", table_name="data_import_issues")
    op.drop_table("data_import_issues")

    op.drop_index("ix_data_import_rows_row_fingerprint", table_name="data_import_rows")
    op.drop_index("ix_data_import_rows_data_import_job_id", table_name="data_import_rows")
    op.drop_table("data_import_rows")

    op.drop_index("ix_data_import_mappings_data_import_job_id", table_name="data_import_mappings")
    op.drop_table("data_import_mappings")

    op.drop_index("ix_data_import_files_data_import_job_id", table_name="data_import_files")
    op.drop_table("data_import_files")

    op.drop_index("ix_data_import_jobs_source_hash", table_name="data_import_jobs")
    op.drop_index("ix_data_import_jobs_approved_by_user_id", table_name="data_import_jobs")
    op.drop_index("ix_data_import_jobs_created_by_user_id", table_name="data_import_jobs")
    op.drop_index("ix_data_import_jobs_organization_id", table_name="data_import_jobs")
    op.drop_table("data_import_jobs")

