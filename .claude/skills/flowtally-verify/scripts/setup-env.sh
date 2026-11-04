#!/usr/bin/env bash
# Reproduce the CI backend environment locally (disposable, local-only).
# Usage: source .claude/skills/flowtally-verify/scripts/setup-env.sh
# Creates/reuses .venv (Python 3.12 like CI), starts local PostgreSQL 16, provisions the
# disposable flowtally roles/database via scripts/provision_postgres_roles.sql and exports
# the five URLs from .github/workflows/ci.yml. Never point these at a real database.
_ft_root="$(git rev-parse --show-toplevel)" || return 1
cd "$_ft_root" || return 1

# 1. One interpreter: python and pip must both come from .venv.
if [ ! -x .venv/bin/python ]; then
  _py="$(command -v python3.12 || command -v python3)"
  "$_py" -m venv .venv || return 1
fi
# shellcheck disable=SC1091
. .venv/bin/activate
if ! python -c 'import flask, sqlalchemy, psycopg2, pytest' 2>/dev/null; then
  python -m pip install -q --upgrade pip && \
  python -m pip install -q -r backend/requirements.txt -r requirements.txt pytest || return 1
fi
[ "$(python -c 'import sys;print(sys.prefix)')" = "$(python -m pip --version | sed -E 's#.* from (.*)/lib/.*#\1#')" ] \
  || echo "WARN: python and pip disagree" >&2

# 2. Local PostgreSQL 16 (needs root; skip gracefully otherwise).
if command -v pg_ctlcluster >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then
  pg_lsclusters | grep -q ' online' || pg_ctlcluster 16 main start
  for _i in $(seq 1 20); do pg_isready -q && break; sleep 1; done
  _psql() { runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -q "$@"; }
  _psql -Atc "select 1 from pg_roles where rolname='flowtally'" | grep -q 1 || \
    _psql -c "create role flowtally login superuser password 'flowtally'"
  _psql -Atc "select 1 from pg_database where datname='flowtally_test'" | grep -q 1 || \
    _psql -c "create database flowtally_test owner flowtally"
  PGPASSWORD=flowtally psql -X -v ON_ERROR_STOP=1 -q -h localhost -U flowtally -d flowtally_test \
    -f scripts/provision_postgres_roles.sql >/dev/null
  _h=localhost:5432/flowtally_test
  export FLOWTALLY_TEST_POSTGRES_ADMIN_URL="postgresql+psycopg2://flowtally:flowtally@$_h"
  export FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL="postgresql+psycopg2://flowtally_migrator:flowtally_migrator@$_h"
  export FLOWTALLY_MIGRATION_DATABASE_URL="$FLOWTALLY_TEST_POSTGRES_MIGRATOR_URL"
  export FLOWTALLY_TEST_POSTGRES_URL="postgresql+psycopg2://flowtally_runtime:flowtally_runtime@$_h"
  export DATABASE_URL="$FLOWTALLY_TEST_POSTGRES_URL"
  echo "PostgreSQL ready (disposable local flowtally_test)."
else
  echo "PostgreSQL not available/root required: PG-gated tests will skip. Report that." >&2
fi
export PYTHONUNBUFFERED=1
echo "python=$(command -v python) $(python -V 2>&1); pip=$(python -m pip --version | cut -d' ' -f1-2)"
