-- Fuzzy translation memory search that can use a trigram index.
--
-- Under row-level security, PostgreSQL may not evaluate the trigram
-- operator `%` (not LEAKPROOF) before the tenant policy, so no index can
-- serve it and every search computed similarity for all of a shop's entries
-- (about 450 ms at 100,000 entries). The function below runs as the table
-- owner, which RLS doesn't force for this one table, and applies the tenant
-- filter itself, from the same transaction setting the policy uses. It takes
-- no shop argument, so a caller can't choose another tenant, and returns
-- nothing when no tenant is set (fail closed). The runtime role stays under
-- RLS for every direct query on the table.

CREATE EXTENSION IF NOT EXISTS btree_gin;

-- DropIndex
DROP INDEX "TranslationMemory_sourceText_idx";

-- CreateIndex
CREATE INDEX "TranslationMemory_shopId_sourceText_idx" ON "TranslationMemory" USING GIN ("shopId" uuid_ops, "sourceText" gin_trgm_ops);

ALTER TABLE "TranslationMemory" NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION linguva_memory_fuzzy(
  p_source_locale text,
  p_target_locale text,
  p_market text,
  p_text text,
  p_min_length integer,
  p_max_length integer,
  p_threshold real,
  p_limit integer
)
RETURNS TABLE (id uuid, "sourceText" text, "targetText" text, status "MemoryStatus", score double precision)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tenant uuid := NULLIF(current_setting('app.shop_id', true), '')::uuid;
BEGIN
  IF tenant IS NULL OR p_text IS NULL OR p_threshold IS NULL OR p_threshold < 0.3 THEN
    RETURN;
  END IF;
  PERFORM set_config('pg_trgm.similarity_threshold', p_threshold::text, true);
  RETURN QUERY
    SELECT m."id", m."sourceText", m."targetText", m."status", similarity(m."sourceText", p_text)::double precision AS score
    FROM "TranslationMemory" m
    WHERE m."shopId" = tenant
      AND m."sourceLocale" = p_source_locale
      AND m."targetLocale" = p_target_locale
      AND m."market" IN (p_market, '')
      AND length(m."sourceText") BETWEEN p_min_length AND p_max_length
      AND m."sourceText" % p_text
    ORDER BY score DESC, m."status" ASC
    LIMIT LEAST(GREATEST(p_limit, 1), 10);
END
$$;

REVOKE ALL ON FUNCTION linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT EXECUTE ON FUNCTION linguva_memory_fuzzy(text, text, text, text, integer, integer, real, integer) TO linguva_app;
  END IF;
END
$$;
