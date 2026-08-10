\set ON_ERROR_STOP on

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowtally_migrator') THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOINHERIT',
            'flowtally_migrator',
            :'migrator_password'
        );
    ELSE
        EXECUTE format(
            'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOINHERIT',
            'flowtally_migrator',
            :'migrator_password'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowtally_runtime') THEN
        EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOINHERIT',
            'flowtally_runtime',
            :'runtime_password'
        );
    ELSE
        EXECUTE format(
            'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOINHERIT',
            'flowtally_runtime',
            :'runtime_password'
        );
    END IF;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO flowtally_migrator, flowtally_runtime;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO flowtally_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO flowtally_migrator;
GRANT USAGE ON SCHEMA public TO flowtally_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowtally_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flowtally_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO flowtally_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE flowtally_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowtally_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE flowtally_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO flowtally_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE flowtally_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO flowtally_runtime;

SELECT
    rolname,
    rolsuper,
    rolbypassrls,
    rolcanlogin
FROM pg_roles
WHERE rolname IN ('flowtally_migrator', 'flowtally_runtime')
ORDER BY rolname;

SELECT
    current_database() AS database_name,
    pg_get_userbyid(datdba) AS database_owner,
    has_database_privilege(current_user, current_database(), 'CREATE') AS current_user_can_create
FROM pg_database
WHERE datname = current_database();
