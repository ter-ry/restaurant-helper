from __future__ import annotations

from logging.config import fileConfig
from pathlib import Path
import os

from alembic import context
from flask import current_app, has_app_context
from sqlalchemy import engine_from_config, pool, text

from backend.extensions import db

config = context.config

if config.config_file_name is not None and Path(config.config_file_name).exists():
    fileConfig(config.config_file_name)

target_metadata = db.metadata


def _migration_database_url() -> str:
    if has_app_context():
        app_url = str(current_app.config.get("SQLALCHEMY_DATABASE_URI") or "").strip()
        if app_url.startswith("sqlite:"):
            return app_url
    configured_url = (config.get_main_option("sqlalchemy.url") or "").strip()
    if configured_url.startswith("sqlite:"):
        return configured_url
    return (
        os.environ.get("FLOWTALLY_MIGRATION_DATABASE_URL")
        or os.environ.get("FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL")
        or os.environ.get("FLOWTALLY_TEST_POSTGRES_ADMIN_URL")
        or os.environ.get("FLOWTALLY_TEST_POSTGRES_URL")
        or os.environ.get("DATABASE_URL")
        or configured_url
        or ""
    ).strip()


def _version_table_schema() -> str | None:
    url = _migration_database_url().lower()
    return "public" if url.startswith("postgres") else None


def run_migrations_offline() -> None:
    url = _migration_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        version_table_schema=_version_table_schema(),
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = _migration_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if connection.dialect.name == "postgresql":
            migration_identity = connection.execute(
                text(
                    """
                    select
                        current_user,
                        session_user
                    """
                )
            ).one()
            config.attributes["flowtally_migration_identity"] = tuple(migration_identity)
            connection.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS public.alembic_version (
                    version_num VARCHAR(255) NOT NULL,
                    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
                )
                """
            )
            connection.exec_driver_sql(
                "ALTER TABLE public.alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"
            )
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, version_table_schema=_version_table_schema())
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
