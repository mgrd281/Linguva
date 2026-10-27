# Multilingual SEO and Markets: architecture and plan

Status: **S1 implemented and tested against the simulated Admin API** (at the owner's request, ahead of live verification). S2–S5 are planned. Nothing SEO-related is verified on a real development store yet (docs/DEV_STORE_SETUP.md); the live contract tests already check that `meta_title` and `meta_description` are translatable keys of products and collections.

Labels: **VERIFIED (schema)** = present in the downloaded Admin API 2026-10 schema; **VERIFIED (docs)** = stated on shopify.dev; **TESTED (fake)** = covered by automated tests against the simulated Admin API; **ASSUMPTION** = to be confirmed on a dev store.

## 1. What the existing architecture already covers

| Capability | State | Evidence |
|---|---|---|
| SEO title and description of products and collections are translatable content keys `meta_title` and `meta_description` | VERIFIED (docs); live check in `tests/live` (not run yet) | SHOPIFY_API_MATRIX §2.1 |
| They flow through the normal pipeline: segmentation, glossary, memory, validation, drafts/review, digest-checked publishing, protection, history | TESTED (fake): `tests/integration/collections.test.ts` translates collection `meta_title` | Pipeline treats them as text fields |
| URL handles are never machine-translated; manual edits are possible with a warning in the editor | Implemented, TESTED (fake) | `isMachineTranslatable` excludes `URI` |
| Coverage per resource and language (translated / missing / outdated) | Implemented, TESTED (fake) | `app/lib/coverage.ts`, list pages |
| Outdated detection after a source change | Implemented, TESTED (fake), live check prepared | `Translation.outdated`, digest comparison |
| Market-specific memory and glossary entries | Implemented, TESTED | `marketId` columns |
| Market-specific **translations** (`TranslationInput.marketId`) | Not implemented. Linguva reads and writes market-independent translations only and never touches market-specific ones | VERIFIED (schema/docs): `translations(locale, marketId)`, `translationsRegister` with `marketId` |

**Gaps found during the review (to fix before SEO work):**

1. `TranslationRevision`, `TranslationDraft` and the protection rule have no `marketId`. That is correct today, because only global translations are written. Market-specific publishing needs it in their keys first (migration, §4 S4).
2. Length checks use a generic ratio. Search snippets need absolute limits (§3).
3. Scopes don't include `read_markets`. Markets features need a scope update, which merchants must approve.

## 2. Shopify facts the plan relies on

| Fact | Label |
|---|---|
| `TranslatableResourceType` includes PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG, MEDIA_IMAGE, COLLECTION_IMAGE, ARTICLE_IMAGE, METAFIELD, METAOBJECT, SHOP, SHOP_POLICY, MENU, LINK, FILTER | VERIFIED (schema) |
| `TranslatableResource.translatableContent(marketId)`, `translations(locale, marketId, outdated)`, `nestedTranslatableResources` | VERIFIED (schema) |
| `translationsRegister` accepts `marketId` per translation, even for the default language ("Canadian element" example) | VERIFIED (docs) |
| `translationsRemove(resourceId, translationKeys, locales, marketIds)` | VERIFIED (schema); live check prepared |
| Handles are translatable for PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG. Redirects aren't created for language-specific URLs when a handle changes later | VERIFIED (docs) |
| Error codes `INVALID_VALUE_FOR_HANDLE_TRANSLATION`, `INVALID_LOCALE_FOR_MARKET`, `TOO_MANY_KEYS_FOR_RESOURCE` | VERIFIED (schema) |
| `Market.webPresences` (connection) → `MarketWebPresence { defaultLocale, alternateLocales, subfolderSuffix, domain, rootUrls { locale url } }` | VERIFIED (schema, codegen-validated query in `tests/live/fixtures.ts`) |
| `shopLocaleEnable(locale, marketWebPresenceIds)` | VERIFIED (schema) |
| Image alt text is the `alt` key of `MEDIA_IMAGE` resources | ASSUMPTION — confirm keys and how product media are reached (`translatableResources(MEDIA_IMAGE)` vs. nested resources) on the dev store |
| The storefront outputs `hreflang` alternates for published locales per web presence | ASSUMPTION (theme-dependent). Linguva checks, it doesn't inject tags |
| Whether a translated handle that collides with another resource's handle is rejected or suffixed | ASSUMPTION — test on the dev store |

## 3. Features and design

### S1 SEO fields: titles and meta descriptions — Implemented, Tested (fake store)

Implemented as described below, in `app/lib/seo.ts` (rules shared by server and editor), `translate-fields.ts` (warnings on AI output), `components/SeoPanel.tsx` (live counter and preview) and `TranslationJob.fieldScope` (`ALL` | `SEO`). Limits: title 15–60, description 50–155 width units (one per grapheme, two for CJK/fullwidth). Findings are warnings: in the editor they show next to the field, in review they show on the draft, and with automatic publishing a flagged result waits in Review. Duplicate titles across resources are left to the S5 audit.
- Show `meta_title` and `meta_description` as their own "Search engine listing" group in the editor, with a SERP preview (title, URL from `rootUrls` plus the translated handle, description).
- SEO checks per language as validation issues (warnings, never blocking): title over 60 characters, description over 155 characters, under 15% of the limit, the same as the source text (untranslated), the same title on several resources in one language, forbidden glossary terms. Pixel-width estimation is optional later.
- Fallback rule: if the source has no `meta_title`, Shopify uses the title. Linguva shows "uses translated title" instead of reporting a missing field.
- AI prompt context: "SEO title, keep under 60 characters". DeepL has no length control, so the result is checked and flagged, not truncated (truncation could break meaning).

### S2 Translatable handles
- Suggestion only, never automatic publishing: slug from the translated title (lowercase, NFKC, spaces → `-`, keep letters of the target script; transliteration for Latin-only stores as an option), with uniqueness checked against handles already registered for that language.
- Publishing a handle needs explicit confirmation in the editor and is never part of bulk jobs unless a separate, explicit "handles" option is chosen.
- Map `INVALID_VALUE_FOR_HANDLE_TRANSLATION` to a clear field error.
- Changing an already published translated handle warns that old language URLs won't redirect (VERIFIED limitation), and records the old handle in history.

### S3 Image alt text
- New resource kind `MEDIA_IMAGE` (plus `COLLECTION_IMAGE`) in `app/lib/resource-kinds.ts`, after the dev-store check of how product media are listed.
- Shown in the product editor as "Images" with a thumbnail, and in bulk jobs as a separate option ("include image alt text").
- Missing source alt text is reported as an SEO issue (accessibility) but not generated by Linguva in this phase (AI image description is a separate, paid feature decision).

### S4 Markets and language mapping
- Read-only Markets page first (needs `read_markets`): each market, its web presences, default and alternate languages, URL per language (`rootUrls`, `subfolderSuffix`/domain), and published state from `shopLocales`.
- Checks: language enabled but unpublished; published but not attached to any web presence; web presence language without translations (coverage under N%); market-specific translations that override global ones (read with `translations(locale, marketId)`).
- Market-specific translations as an advanced option later: `marketId` added to revisions, drafts, job items and the protection rule (migration with `NULLS NOT DISTINCT` uniqueness), jobs gain an optional `marketId`, and `INVALID_LOCALE_FOR_MARKET` is handled. Linguva never deletes or overwrites market-specific translations it didn't create.
- Enabling languages for a web presence (`shopLocaleEnable`, `marketWebPresenceIds`) only from an explicit merchant action, within the 20-locale limit.

### S5 SEO health and missing translations — Implemented (report and dashboard), Tested (fake store)

Implemented: `app/.server/coverage/coverage.ts`, queue `translation-coverage`, page `/app/coverage`. One report per shop at a time scans PRODUCT and COLLECTION for every target language, page by page (idempotent: a page only counts if the report is still at the position it was read from). It stores counts per language, type and field key, SEO findings, duplicate SEO titles as SHA-256 hashes, and up to 200 worst resources per language as ids. No merchant text, no Shopify writes, no AI. "Translate gaps" and "SEO only" start targeted bulk jobs. Not yet: webhook-driven refresh, pages/articles/metafields.

Original plan:
- Background audit job (new job kind `AUDIT`): reuses paginated discovery and the rate limiter, no provider, no writes. It stores per shop, language, resource type and field key: counts of translated / missing / outdated / SEO-issue. Results are aggregates, no merchant text.
- Dashboard: coverage per language and field group (content, SEO, handles, images), the worst resources, and "fix" links that start a targeted bulk job (for example "only meta descriptions, German").
- Freshness: re-run on demand and after bulk jobs; webhook-driven refresh (`products/update`, `collections/update`) later with debounce.

## 4. Data model changes (planned)

| Change | Phase |
|---|---|
| `TranslationJob.fieldFilter text[]` (for example only `meta_*`) and `includeHandles boolean` default false | S1/S2 |
| `SeoAuditRun` (shopId, status, startedAt, finishedAt) and `SeoAuditStat` (shopId, runId, locale, resourceType, key, translated, missing, outdated, issues) under RLS | S5 |
| `marketId uuid/text NULL` on TranslationRevision, TranslationDraft, TranslationJob(Item), with unique keys using `NULLS NOT DISTINCT` | S4 (market-specific publishing only) |
| `ShopMarket` mirror (shopId, marketGid, name, webPresences jsonb, syncedAt) | S4 |

All additive migrations; existing rows keep `marketId = NULL` (global). Migration checks: `prisma migrate diff` drift test, RLS and grants in the same migration, and a test that the app role can't bypass them.

## 5. Order, tests and acceptance

| Step | Scope | Exit criteria |
|---|---|---|
| 0 | **Prerequisite:** run `pnpm test:live` (read + writes) and the manual checklist on a dev store; record results | All live contract checks pass, or deviations are fixed first |
| S1 | SEO group, SERP preview, SEO checks, field filter for bulk | Unit tests for checks (incl. RTL/CJK lengths), integration test for "only meta fields" jobs, live: meta fields read back |
| S5 | Audit job and dashboard | Integration: counts match the fake store; security: no text in stats, tenant isolation; live: counts match the dev store |
| S2 | Handle suggestions, confirmation, error mapping | Unit: slug rules per script; live: handle accepted, collision behaviour documented |
| S3 | Image alt text | Live discovery of MEDIA_IMAGE confirmed first; integration tests with fake media |
| S4 | Markets page (read-only), then market-specific translations | Scope update approved by owner; live: web presences read; migration tests |

## 6. Risks

| Risk | Mitigation |
|---|---|
| A translated handle breaks existing links or creates duplicates | Never automatic; confirmation; uniqueness check; history |
| SEO limits differ per search engine and script | Warnings only; configurable limits |
| Market overrides hide global translations, confusing coverage | Markets page shows overrides explicitly |
| Scope change (`read_markets`) requires merchant re-approval | Optional scope, requested only when the merchant opens Markets |
| Audit cost on large catalogs | Rate limiter, page size, aggregates only, resumable cursor |
