from __future__ import annotations

from decimal import Decimal
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from backend.app import create_app
from backend.extensions import db


def _postgres_url(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value.startswith("postgres"):
            return value
    return ""


ADMIN_POSTGRES_URL = _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")
MIGRATION_POSTGRES_URL = _postgres_url(
    "FLOWTALLY_MIGRATION_DATABASE_URL",
    "FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL",
    "FLOWTALLY_TEST_POSTGRES_ADMIN_URL",
    "FLOWTALLY_TEST_POSTGRES_URL",
    "DATABASE_URL",
)
RUNTIME_POSTGRES_URL = _postgres_url(
    "FLOWTALLY_TEST_POSTGRES_URL",
    "DATABASE_URL",
    "FLOWTALLY_MIGRATION_DATABASE_URL",
)
POSTGRES_URL = RUNTIME_POSTGRES_URL or MIGRATION_POSTGRES_URL

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL.startswith("postgres"),
    reason="PostgreSQL test database is not configured.",
)


def _runtime_postgres_url() -> str:
    return _postgres_url("FLOWTALLY_TEST_POSTGRES_URL", "DATABASE_URL", "FLOWTALLY_MIGRATION_DATABASE_URL")


def _migration_postgres_url() -> str:
    return _postgres_url(
        "FLOWTALLY_MIGRATION_DATABASE_URL",
        "FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL",
        "FLOWTALLY_TEST_POSTGRES_ADMIN_URL",
        "FLOWTALLY_TEST_POSTGRES_URL",
        "DATABASE_URL",
    )


def _admin_postgres_url() -> str:
    return _postgres_url("FLOWTALLY_TEST_POSTGRES_ADMIN_URL", "DATABASE_URL")


def _migration_engine():
    migration_url = _migration_postgres_url()
    if not migration_url:
        raise RuntimeError("A PostgreSQL migration URL is required for migration acceptance tests")
    return create_engine(migration_url, poolclass=NullPool)


def _set_setup_migration_context(connection) -> None:
    connection.execute(text("select set_config('flowtally.access_scope', 'setup', true)"))
    connection.execute(text("select set_config('flowtally.organization_id', '', true)"))
    connection.execute(text("select set_config('flowtally.user_id', '', true)"))
    connection.execute(text("select set_config('flowtally.support_grant_id', '', true)"))


def _create_app():
    runtime_url = _runtime_postgres_url() or POSTGRES_URL
    return create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "SQLALCHEMY_DATABASE_URI": runtime_url,
            "SESSION_COOKIE_SECURE": False,
            "ALLOWED_ORIGINS": ["http://127.0.0.1:5173"],
            "FLOWTALLY_RATE_LIMIT_STORAGE_URI": "memory://",
            "WTF_CSRF_ENABLED": True,
        }
    )


def _alembic_config(application) -> Config:
    config = Config()
    config.set_main_option("script_location", str((Path(__file__).resolve().parents[1] / "migrations").resolve()))
    config.set_main_option("sqlalchemy.url", application.config["SQLALCHEMY_DATABASE_URI"])
    return config


def _log_connection_state(connection, label: str) -> None:
    snapshot = connection.execute(
        text(
            """
            select
                current_user,
                session_user,
                current_role,
                current_database() as current_database,
                pg_backend_pid() as backend_pid,
                datname,
                pg_get_userbyid(datdba) as database_owner,
                has_database_privilege(current_user, current_database(), 'CREATE') as can_create
            from pg_database
            where datname = current_database()
            """
        )
    ).mappings().one()
    print(f"STATE: {label} -> {dict(snapshot)}", flush=True)


def _schema_owner(connection, schema_name: str) -> str:
    return connection.execute(
        text(
            """
            select pg_get_userbyid(nspowner)
            from pg_namespace
            where nspname = :schema_name
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one()


def _table_owner(connection, table_name: str) -> str:
    return connection.execute(
        text(
            """
            select pg_get_userbyid(c.relowner)
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname = :table_name
            """
        ),
        {"table_name": table_name},
    ).scalar_one()


def _pg_role_flags(connection, role_name: str) -> tuple[bool, bool, bool]:
    return connection.execute(
        text(
            """
            select rolsuper, rolbypassrls, rolcanlogin
            from pg_roles
            where rolname = :role_name
            """
        ),
        {"role_name": role_name},
    ).one()


def _assert_login_identity(connection, role_name: str) -> None:
    identity = connection.execute(
        text(
            """
            select current_user, session_user, current_role
            """
        )
    ).one()
    assert identity[0] == role_name, f"expected login as {role_name!r}, got {identity!r}"
    assert identity[1] == role_name, f"expected session user {role_name!r}, got {identity!r}"
    assert identity[2] == role_name, f"expected current role {role_name!r}, got {identity!r}"


def _assert_runtime_schema_usage(connection) -> None:
    has_usage = connection.execute(
        text(
            """
            select has_schema_privilege('flowtally_runtime', 'public', 'USAGE')
            """
        )
    ).scalar_one()
    assert has_usage is True, "expected flowtally_runtime to have USAGE on schema public"


def _restore_runtime_schema_privileges(connection) -> None:
    print("BEFORE: restore runtime schema privileges", flush=True)
    connection.exec_driver_sql("revoke all on schema public from public")
    connection.exec_driver_sql("grant usage on schema public to flowtally_runtime")
    connection.exec_driver_sql("grant select, insert, update, delete on all tables in schema public to flowtally_runtime")
    connection.exec_driver_sql("grant usage, select on all sequences in schema public to flowtally_runtime")
    connection.exec_driver_sql("grant execute on all functions in schema public to flowtally_runtime")
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant select, insert, update, delete on tables to flowtally_runtime
        """
    )
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant usage, select on sequences to flowtally_runtime
        """
    )
    connection.exec_driver_sql(
        """
        alter default privileges for role flowtally_migrator in schema public
            grant execute on functions to flowtally_runtime
        """
    )
    print("AFTER: restore runtime schema privileges", flush=True)


def _reset_public_schema(application) -> None:
    admin_url = _admin_postgres_url()
    if not admin_url:
        raise RuntimeError("FLOWTALLY_TEST_POSTGRES_ADMIN_URL is required for migration bootstrap reset")

    admin_engine = create_engine(admin_url, poolclass=NullPool)
    with admin_engine.begin() as connection:
        print("BEFORE: reset_public_schema connection state", flush=True)
        _log_connection_state(connection, "reset_public_schema connection state")
        print("BEFORE: drop schema if exists public cascade", flush=True)
        connection.exec_driver_sql("drop schema if exists public cascade")
        print("AFTER: drop schema if exists public cascade", flush=True)
        print("BEFORE: create schema public authorization flowtally_migrator", flush=True)
        _log_connection_state(connection, "before create schema public")
        connection.exec_driver_sql("create schema public authorization flowtally_migrator")
        print("AFTER: create schema public authorization flowtally_migrator", flush=True)
        assert _schema_owner(connection, "public") == "flowtally_migrator"
        print("STATE: public schema owner -> flowtally_migrator", flush=True)
        _restore_runtime_schema_privileges(connection)
        _assert_runtime_schema_usage(connection)


def _upgrade_to(application, revision: str) -> Config:
    config = _alembic_config(application)
    with application.app_context():
        command.upgrade(config, revision)
    return config


def _downgrade_to(application, revision: str) -> Config:
    config = _alembic_config(application)
    with application.app_context():
        command.downgrade(config, revision)
    return config


def _assert_policy_exists(policy_name: str, table_name: str) -> None:
    row = db.session.execute(
        text(
            """
            select count(*)
            from pg_policies
            where schemaname = current_schema()
              and tablename = :table_name
              and policyname = :policy_name
            """
        ),
        {"table_name": table_name, "policy_name": policy_name},
    ).scalar_one()
    assert row == 1


def _assert_policy_absent(policy_name: str, table_name: str) -> None:
    row = db.session.execute(
        text(
            """
            select count(*)
            from pg_policies
            where schemaname = current_schema()
              and tablename = :table_name
              and policyname = :policy_name
            """
        ),
        {"table_name": table_name, "policy_name": policy_name},
    ).scalar_one()
    assert row == 0


def _assert_function_exists(function_name: str, argcount: int) -> None:
    row = db.session.execute(
        text(
            """
            select count(*)
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = current_schema()
              and p.proname = :function_name
              and p.pronargs = :argcount
            """
        ),
        {"function_name": function_name, "argcount": argcount},
    ).scalar_one()
    assert row == 1


def _current_revision() -> str:
    return db.session.execute(text("select version_num from public.alembic_version")).scalar_one()


def _assert_runtime_connection() -> None:
    identity = db.session.execute(
        text(
            """
            select
                current_user,
                session_user,
                current_role
            """
        )
    ).one()
    assert identity[0] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"
    assert identity[1] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"
    assert identity[2] == "flowtally_runtime", f"expected runtime connection, got {identity!r}"


def _assert_migration_identity(config: Config) -> None:
    identity = config.attributes.get("flowtally_migration_identity")
    assert identity == ("flowtally_migrator", "flowtally_migrator"), f"migration identity snapshot: {identity!r}"


def _assert_table_owned_by_migrator(table_name: str) -> None:
    with db.engine.connect() as connection:
        assert _table_owner(connection, table_name) == "flowtally_migrator"


def _column_info(table_name: str, column_name: str) -> tuple[str, bool, int | None, int | None]:
    row = db.session.execute(
        text(
            """
            select
                data_type,
                is_nullable,
                numeric_precision,
                numeric_scale
            from information_schema.columns
            where table_schema = current_schema()
              and table_name = :table_name
              and column_name = :column_name
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    ).one()
    data_type, is_nullable, numeric_precision, numeric_scale = row
    return data_type, is_nullable == "YES", numeric_precision, numeric_scale


def test_postgres_migrations_upgrade_from_fresh_database():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0015_weighted_average_inventory_cost"
        _assert_function_exists("flowtally_current_user_id", 0)
        _assert_table_owned_by_migrator("suppliers")
        _assert_table_owned_by_migrator("recipes")
        _assert_table_owned_by_migrator("recipe_ingredients")
        _assert_table_owned_by_migrator("menu_items")
        data_type, nullable, precision, scale = _column_info("inventory_items", "average_unit_cost")
        assert data_type == "numeric"
        assert nullable is False
        assert precision == 14
        assert scale == 6
        _assert_policy_exists("flowtally_organizations_read_access", "organizations")
        _assert_policy_exists("flowtally_organizations_write_access", "organizations")
        _assert_policy_absent("flowtally_organizations_tenant_access", "organizations")
        _assert_policy_exists("flowtally_organization_memberships_read_access", "organization_memberships")
        _assert_policy_exists("flowtally_organization_memberships_write_access", "organization_memberships")
        _assert_policy_absent("flowtally_organization_memberships_tenant_access", "organization_memberships")
        _assert_policy_exists("flowtally_suppliers_tenant_access", "suppliers")
        _assert_policy_exists("flowtally_data_import_jobs_tenant_access", "data_import_jobs")
        _assert_policy_exists("flowtally_square_orders_tenant_access", "square_orders")
        _assert_policy_exists("flowtally_support_access_grants_select_access", "support_access_grants")
        _assert_policy_exists("flowtally_recipes_tenant_access", "recipes")
        _assert_policy_exists("flowtally_recipe_ingredients_tenant_access", "recipe_ingredients")
        _assert_policy_exists("flowtally_menu_items_tenant_access", "menu_items")


def test_postgres_migrations_upgrade_from_secure_backend_head():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "0006_audit_events_and_tenant_constraints")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0006_audit_events_and_tenant_constraints"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0015_weighted_average_inventory_cost"
        _assert_function_exists("flowtally_current_user_id", 0)
        _assert_table_owned_by_migrator("audit_events")
        _assert_policy_exists("flowtally_audit_events_tenant_access", "audit_events")
        _assert_policy_exists("flowtally_organizations_read_access", "organizations")
        _assert_policy_exists("flowtally_organizations_write_access", "organizations")
        _assert_policy_exists("flowtally_organization_memberships_read_access", "organization_memberships")
        _assert_policy_exists("flowtally_organization_memberships_write_access", "organization_memberships")


def test_postgres_migrations_upgrade_from_partial_commercial_head():
    application = _create_app()
    _reset_public_schema(application)
    migration_config = _upgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0015_weighted_average_inventory_cost"
        _assert_function_exists("flowtally_current_user_id", 0)
        _assert_table_owned_by_migrator("square_location_mappings")
        _assert_policy_exists("flowtally_organizations_read_access", "organizations")
        _assert_policy_exists("flowtally_organizations_write_access", "organizations")
        _assert_policy_exists("flowtally_organization_memberships_read_access", "organization_memberships")
        _assert_policy_exists("flowtally_organization_memberships_write_access", "organization_memberships")

    migration_config = _downgrade_to(application, "0007_commercial_onboarding_and_square_foundation")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0007_commercial_onboarding_and_square_foundation"

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0015_weighted_average_inventory_cost"
        _assert_function_exists("flowtally_current_user_id", 0)
        _assert_policy_exists("flowtally_square_location_mappings_tenant_access", "square_location_mappings")
        _assert_policy_exists("flowtally_organizations_read_access", "organizations")
        _assert_policy_exists("flowtally_organizations_write_access", "organizations")
        _assert_policy_exists("flowtally_organization_memberships_read_access", "organization_memberships")
        _assert_policy_exists("flowtally_organization_memberships_write_access", "organization_memberships")


def test_postgres_migrations_backfill_weighted_average_inventory_cost():
    application = _create_app()
    _reset_public_schema(application)

    migration_config = _upgrade_to(application, "0014_authenticated_membership_discovery")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0014_authenticated_membership_discovery"

        migration_engine = _migration_engine()
        with migration_engine.begin() as connection:
            identity = connection.execute(text("select current_user, session_user, current_role")).one()
            assert identity[0] == "flowtally_migrator", f"expected migrator identity, got {identity!r}"
            assert identity[1] == "flowtally_migrator", f"expected migrator identity, got {identity!r}"
            assert identity[2] == "flowtally_migrator", f"expected migrator identity, got {identity!r}"
            _set_setup_migration_context(connection)
            assert (
                connection.execute(text("select current_setting('flowtally.access_scope', true)")).scalar_one()
                == "setup"
            )

            connection.execute(
                text(
                    """
                    insert into organizations (
                        id,
                        name,
                        lifecycle_status,
                        setup_status,
                        subscription_status,
                        setup_template_key,
                        setup_fee_status,
                        subscription_provider,
                        external_customer_reference,
                        external_subscription_reference,
                        is_prospect,
                        active_at,
                        setup_completed_at,
                        created_at,
                        updated_at
                    ) values (
                        1,
                        'Demo Bistro',
                        'ACTIVE',
                        'COMPLETE',
                        'ACTIVE',
                        'GENERIC_RESTAURANT',
                        'confirmed',
                        '',
                        '',
                        '',
                        false,
                        current_timestamp,
                        current_timestamp,
                        current_timestamp,
                        current_timestamp
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    insert into restaurant_locations (
                        id,
                        organization_id,
                        name,
                        address_line1,
                        address_line2,
                        city,
                        region,
                        postal_code,
                        country,
                        timezone,
                        created_at,
                        updated_at
                    ) values (
                        7,
                        1,
                        'Main Dining Room',
                        '',
                        '',
                        'Toronto',
                        'ON',
                        '',
                        'Canada',
                        'America/Toronto',
                        current_timestamp,
                        current_timestamp
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    insert into inventory_items (
                        id,
                        organization_id,
                        location_id,
                        name,
                        normalized_name,
                        category,
                        stock_unit,
                        current_on_hand,
                        min_quantity,
                        par_level,
                        preferred_supplier_name,
                        latest_purchase_price,
                        last_purchase_unit,
                        last_purchase_conversion_factor,
                        estimated_cost_method,
                        active,
                        notes,
                        created_at,
                        updated_at
                    ) values (
                        11,
                        1,
                        7,
                        'Chicken Breast',
                        'chicken breast',
                        'Protein',
                        'kg',
                        100,
                        0,
                        0,
                        'Local Foods',
                        7,
                        'kg',
                        2,
                        'latest_purchase_price',
                        true,
                        '',
                        current_timestamp,
                        current_timestamp
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    insert into inventory_items (
                        id,
                        organization_id,
                        location_id,
                        name,
                        normalized_name,
                        category,
                        stock_unit,
                        current_on_hand,
                        min_quantity,
                        par_level,
                        preferred_supplier_name,
                        latest_purchase_price,
                        last_purchase_unit,
                        last_purchase_conversion_factor,
                        estimated_cost_method,
                        active,
                        notes,
                        created_at,
                        updated_at
                    ) values (
                        12,
                        1,
                        7,
                        'Salt',
                        'salt',
                        'Dry goods',
                        'kg',
                        0,
                        0,
                        0,
                        '',
                        7,
                        'kg',
                        0,
                        'latest_purchase_price',
                        true,
                        '',
                        current_timestamp,
                        current_timestamp
                    )
                    """
                )
            )

    migration_config = _upgrade_to(application, "head")
    with application.app_context():
        _assert_migration_identity(migration_config)
        _assert_runtime_connection()
        assert _current_revision() == "0015_weighted_average_inventory_cost"

    with _migration_engine().begin() as connection:
        _set_setup_migration_context(connection)
        assert connection.execute(text("select current_setting('flowtally.access_scope', true)")).scalar_one() == "setup"
        data_type, nullable, precision, scale = (
            connection.execute(
                text(
                    """
                    select
                        data_type,
                        is_nullable,
                        numeric_precision,
                        numeric_scale
                    from information_schema.columns
                    where table_schema = current_schema()
                      and table_name = :table_name
                      and column_name = :column_name
                    """
                ),
                {"table_name": "inventory_items", "column_name": "average_unit_cost"},
            )
            .one()
        )
        assert data_type == "numeric"
        assert nullable == "NO"
        assert precision == 14
        assert scale == 6

        rows = connection.execute(
            text(
                """
                select name, latest_purchase_price, last_purchase_conversion_factor, average_unit_cost
                from inventory_items
                order by id
                """
            )
        ).mappings().all()
        assert rows[0]["name"] == "Chicken Breast"
        assert rows[0]["latest_purchase_price"] == Decimal("7.00")
        assert rows[0]["last_purchase_conversion_factor"] == Decimal("2.0000")
        assert rows[0]["average_unit_cost"] == Decimal("3.500000")
        assert rows[1]["name"] == "Salt"
        assert rows[1]["latest_purchase_price"] == Decimal("7.00")
        assert rows[1]["last_purchase_conversion_factor"] == Decimal("0.0000")
        assert rows[1]["average_unit_cost"] == Decimal("7.000000")
