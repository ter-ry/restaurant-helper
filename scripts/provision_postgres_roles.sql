DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowtally_migrator') THEN
        CREATE ROLE flowtally_migrator LOGIN PASSWORD 'flowtally_migrator' NOSUPERUSER NOBYPASSRLS NOINHERIT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowtally_runtime') THEN
        CREATE ROLE flowtally_runtime LOGIN PASSWORD 'flowtally_runtime' NOSUPERUSER NOBYPASSRLS NOINHERIT;
    END IF;
END
$$;

ALTER ROLE flowtally_migrator NOSUPERUSER NOBYPASSRLS NOINHERIT;
ALTER ROLE flowtally_runtime NOSUPERUSER NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE flowtally_test TO flowtally_migrator, flowtally_runtime;
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
