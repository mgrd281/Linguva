-- Local/CI only. Creates the database roles Linguva expects (plus a test-only probe role):
--   linguva_owner : owns the schema and runs migrations
--   linguva_app   : runtime role (DML only, subject to row-level security)
-- Passwords here are for local development and CI containers only.
-- Staging/production roles are created by the operator with generated secrets.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_owner') THEN
    CREATE ROLE linguva_owner LOGIN CREATEDB PASSWORD 'linguva_owner_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    CREATE ROLE linguva_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'linguva_app_dev';
  END IF;
  -- Tests only: a role with no grants, to prove that privileges (not just
  -- RLS) keep other database users away from tenant data.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_probe') THEN
    CREATE ROLE linguva_probe LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'linguva_probe_dev';
  END IF;
END
$$;

SELECT 'CREATE DATABASE linguva_dev OWNER linguva_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'linguva_dev')\gexec
SELECT 'CREATE DATABASE linguva_test OWNER linguva_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'linguva_test')\gexec
-- Scratch database for `prisma migrate diff` (it is wiped on every run).
SELECT 'CREATE DATABASE linguva_shadow OWNER linguva_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'linguva_shadow')\gexec
