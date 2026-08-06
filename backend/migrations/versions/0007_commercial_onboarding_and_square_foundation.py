"""commercial onboarding and square foundation

Revision ID: 0007_commercial_onboarding_and_square_foundation
Revises: 0006_audit_events_and_tenant_constraints
Create Date: 2026-08-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_commercial_onboarding_and_square_foundation"
down_revision = "0006_audit_events_and_tenant_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("organizations") as batch_op:
        batch_op.add_column(sa.Column("lifecycle_status", sa.String(length=40), nullable=False, server_default="DEMO"))
        batch_op.add_column(sa.Column("setup_status", sa.String(length=40), nullable=False, server_default="NOT_STARTED"))
        batch_op.add_column(sa.Column("subscription_status", sa.String(length=40), nullable=False, server_default="NONE"))
        batch_op.add_column(sa.Column("setup_template_key", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("setup_fee_status", sa.String(length=40), nullable=False, server_default="NONE"))
        batch_op.add_column(sa.Column("subscription_provider", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("external_customer_reference", sa.String(length=255), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("external_subscription_reference", sa.String(length=255), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("is_prospect", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        batch_op.add_column(sa.Column("active_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("setup_completed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "external_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("email_at_link", sa.String(length=254), nullable=False, server_default=""),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("provider", "provider_subject", name="uq_external_identity_provider_subject"),
    )

    op.create_table(
        "platform_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=40), nullable=False, server_default="support"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", name="uq_platform_role_user"),
    )

    op.create_table(
        "support_access_grants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("support_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("case_reference", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="requested"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("visible_in_ui", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "organization_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_email", sa.String(length=254), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="manager"),
        sa.Column("token", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("single_use", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("token", name="uq_organization_invitation_token"),
    )

    op.create_table(
        "organization_modules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="DISABLED"),
        sa.Column("configuration_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enabled_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "module_key", name="uq_organization_module_key"),
    )

    op.create_table(
        "organization_configurations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("draft_name", sa.String(length=255), nullable=False, server_default="Default configuration"),
        sa.Column("current_version_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "organization_configuration_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_configuration_id", sa.Integer(), sa.ForeignKey("organization_configurations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="draft"),
        sa.Column("configuration_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reverted_from_version_id", sa.Integer(), sa.ForeignKey("organization_configuration_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "dashboard_layouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="owner"),
        sa.Column("widgets_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", "location_id", "role", "version", name="uq_dashboard_layout_scope"),
    )

    op.create_table(
        "square_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("environment", sa.String(length=40), nullable=False, server_default="sandbox"),
        sa.Column("square_merchant_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="disconnected"),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_status", sa.String(length=40), nullable=False, server_default="idle"),
        sa.Column("sync_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("organization_id", name="uq_square_connection_organization"),
    )

    op.create_table(
        "square_locations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("square_location_id", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "square_location_id", name="uq_square_location_connection_external"),
    )

    op.create_table(
        "square_location_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_location_id", sa.Integer(), sa.ForeignKey("square_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("restaurant_location_id", sa.Integer(), sa.ForeignKey("restaurant_locations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mapped_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mapped_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_location_id", name="uq_square_location_mapping_square_location"),
    )

    op.create_table(
        "square_catalog_objects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("square_object_id", sa.String(length=255), nullable=False),
        sa.Column("object_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "square_object_id", name="uq_square_catalog_connection_object"),
    )

    op.create_table(
        "square_catalog_mappings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_catalog_object_id", sa.Integer(), sa.ForeignKey("square_catalog_objects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mapping_type", sa.String(length=120), nullable=False, server_default="menu_item"),
        sa.Column("flowtally_entity_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("flowtally_entity_id", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="unmapped"),
        sa.Column("mapped_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_catalog_object_id", "mapping_type", name="uq_square_catalog_mapping_type"),
    )

    op.create_table(
        "square_sync_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="queued"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("cursor_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "square_sync_cursors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cursor_key", sa.String(length=120), nullable=False),
        sa.Column("cursor_value", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "cursor_key", name="uq_square_sync_cursor_key"),
    )

    op.create_table(
        "square_webhook_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("square_connection_id", sa.Integer(), sa.ForeignKey("square_connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="received"),
        sa.Column("raw_payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("square_connection_id", "event_id", name="uq_square_webhook_event"),
    )


def downgrade() -> None:
    op.drop_table("square_webhook_events")
    op.drop_table("square_sync_cursors")
    op.drop_table("square_sync_jobs")
    op.drop_table("square_catalog_mappings")
    op.drop_table("square_catalog_objects")
    op.drop_table("square_location_mappings")
    op.drop_table("square_locations")
    op.drop_table("square_connections")
    op.drop_table("dashboard_layouts")
    op.drop_table("organization_configuration_versions")
    op.drop_table("organization_configurations")
    op.drop_table("organization_modules")
    op.drop_table("organization_invitations")
    op.drop_table("support_access_grants")
    op.drop_table("platform_roles")
    op.drop_table("external_identities")

    with op.batch_alter_table("organizations") as batch_op:
        batch_op.drop_column("cancelled_at")
        batch_op.drop_column("suspended_at")
        batch_op.drop_column("setup_completed_at")
        batch_op.drop_column("active_at")
        batch_op.drop_column("is_prospect")
        batch_op.drop_column("external_subscription_reference")
        batch_op.drop_column("external_customer_reference")
        batch_op.drop_column("subscription_provider")
        batch_op.drop_column("setup_fee_status")
        batch_op.drop_column("setup_template_key")
        batch_op.drop_column("subscription_status")
        batch_op.drop_column("setup_status")
        batch_op.drop_column("lifecycle_status")
