-- Review text search that can use an index (reviewed in
-- docs/SECURITY_MODEL.md §5l and docs/SECURITY_REVIEW_MEMORY_FUZZY.md,
-- "Second function: linguva_draft_search").
--
-- Under row-level security PostgreSQL may not evaluate LIKE (not LEAKPROOF)
-- before the tenant policy, so no index can serve it and every search read
-- all of a shop's pending drafts (about 4 ms per 1,000). Same pattern as
-- linguva_memory_fuzzy(): the function runs as the table owner, which RLS
-- doesn't force for this one table, and applies the tenant filter itself
-- from the same transaction setting the policy uses. It takes no shop
-- argument, returns only ids of PENDING drafts, returns nothing without a
-- tenant (fail closed), and bounds its input and output. The runtime role
-- stays under RLS for every direct query on the table.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Run migrations as the non-superuser owner role (linguva_owner), not as %', current_user;
  END IF;
END
$$;

-- Title, original and translation of pending drafts, lower-cased and
-- separated by a control character (a search can't match across them).
CREATE INDEX "TranslationDraft_pending_search_idx" ON "TranslationDraft"
  USING GIN ("shopId" uuid_ops, (lower(COALESCE("resourceTitle", '') || chr(1) || "sourceValue" || chr(1) || "value")) gin_trgm_ops)
  WHERE "status" = 'PENDING';

ALTER TABLE "TranslationDraft" NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.linguva_draft_search(p_text text, p_limit integer)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  -- Same expression as the tenant_isolation policy. An invalid value raises
  -- an error instead of returning data.
  tenant uuid := NULLIF(pg_catalog.current_setting('app.shop_id', true), '')::uuid;
  needle text;
BEGIN
  IF tenant IS NULL OR p_text IS NULL OR pg_catalog.length(p_text) < 3 OR pg_catalog.length(p_text) > 100 THEN
    RETURN;
  END IF;
  -- Matched literally: \, % and _ are escaped (LIKE's escape character is \).
  needle := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.lower(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
    SELECT d."id"
    FROM public."TranslationDraft" d
    WHERE d."shopId" = tenant
      AND d."status" = 'PENDING'
      AND pg_catalog.lower(COALESCE(d."resourceTitle", '') || pg_catalog.chr(1) || d."sourceValue" || pg_catalog.chr(1) || d."value") LIKE needle
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 5001);
END
$$;

REVOKE ALL ON FUNCTION public.linguva_draft_search(text, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'linguva_app') THEN
    GRANT EXECUTE ON FUNCTION public.linguva_draft_search(text, integer) TO linguva_app;
  END IF;
END
$$;
