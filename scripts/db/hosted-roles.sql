-- Creates Linguva's two database roles and database on a hosted PostgreSQL
-- (Railway staging or production; docs/RAILWAY_STAGING.md §3). Run once per
-- environment as the platform's admin user. Passwords come from your shell
-- environment; they are never written to a file or shown:
--
--   export LINGUVA_OWNER_PASSWORD="$(openssl rand -hex 24)"
--   export LINGUVA_APP_PASSWORD="$(openssl rand -hex 24)"
--   psql "<admin connection URL>" -v ON_ERROR_STOP=1 -f scripts/db/hosted-roles.sql
--
--   linguva_owner : owns the database and schema, runs migrations only
--   linguva_app   : runtime role: no superuser, no row-level-security bypass,
--                   cannot create roles or databases (DML through RLS only)
\set QUIET on
\getenv owner_password LINGUVA_OWNER_PASSWORD
\getenv app_password LINGUVA_APP_PASSWORD
\if :{?owner_password}
\else
  \echo 'LINGUVA_OWNER_PASSWORD is not set'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'LINGUVA_APP_PASSWORD is not set'
  \quit
\endif

SELECT format('CREATE ROLE linguva_owner LOGIN NOSUPERUSER NOCREATEROLE PASSWORD %L', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_owner')\gexec
SELECT format('CREATE ROLE linguva_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app')\gexec

SELECT 'CREATE DATABASE linguva OWNER linguva_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'linguva')\gexec
REVOKE ALL ON DATABASE linguva FROM PUBLIC;
GRANT CONNECT ON DATABASE linguva TO linguva_owner, linguva_app;

\unset owner_password
\unset app_password
\set QUIET off
SELECT rolname AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls, rolcreaterole AS create_role, rolcreatedb AS create_db
FROM pg_roles WHERE rolname IN ('linguva_owner', 'linguva_app') ORDER BY 1;
