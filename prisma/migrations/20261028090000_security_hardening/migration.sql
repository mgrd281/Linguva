-- Security hardening after review (docs/SECURITY_REVIEW_MEMORY_FUZZY.md).
--
-- 1. linguva_memory_fuzzy(): the definer function now resolves nothing
--    through the caller-influenced search path. search_path is pg_catalog,
--    then pg_temp (which PostgreSQL never searches for functions or
--    operators), and every table, type, function and operator from the
--    public schema is schema-qualified. Oversized input is refused.
-- 2. The function must not be owned by a superuser or a role that bypasses
--    RLS: such an owner would turn any future flaw in it into a full bypass.
-- 3. AuditLog is insert-only for the runtime role (it never reads it, and
--    the table holds entries of every shop).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Run migrations as the non-superuser owner role (linguva_owner), not as %', current_user;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.linguva_memory_fuzzy(
  p_source_locale text,
  p_target_locale text,
  p_market text,
  p_text text,
  p_min_length integer,
  p_max_length integer,
  p_threshold real,
  p_limit integer
)
RETURNS TABLE (id uuid, "sourceText" text, "targetText" text, status public."MemoryStatus", score double precision)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Same expression as the tenant_isolation policy. An invalid value raises
  -- an error instead of returning data.
  tenant uuid := NULLIF(pg_catalog.current_setting('app.shop_id', true), '')::uuid;
BEGIN
  IF tenant IS NULL OR p_text IS NULL OR p_threshold IS NULL OR p_threshold < 0.3
     OR p_source_locale IS NULL OR p_target_locale IS NULL OR p_market IS NULL
     OR pg_catalog.length(p_text) > 2000 THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('pg_trgm.similarity_threshold', p_threshold::text, true);
  RETURN QUERY
    SELECT m."id", m."sourceText", m."targetText", m."status",
           public.similarity(m."sourceText", p_text)::double precision AS score
    FROM public."TranslationMemory" m
    WHERE m."shopId" = tenant
      AND m."sourceLocale" = p_source_locale
      AND m."targetLocale" = p_target_locale
      AND m."market" IN (p_market, '')
      AND pg_catalog.length(m."sourceText") BETWEEN p_min_length AND p_max_length
      AND m."sourceText" OPERATOR(public.%) p_text
    ORDER BY score DESC, m."status" ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 10);
END
$$;

REVOKE ALL ON FUNCTION public.linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT EXECUTE ON FUNCTION public.linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer) TO linguva_app;
    REVOKE SELECT ON "AuditLog" FROM linguva_app;
  END IF;
END
$$;
