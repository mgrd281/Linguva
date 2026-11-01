# Translation Engine

Status: the pipeline in §2, translation memory (§2.1) and glossary (§2.2) are **implemented and tested**; the benchmark (§4) is planned.

## 1. Feature feasibility matrix

| Feature | Feasible via official API? | Basis | Notes / limits | Phase |
|---|---|---|---|---|
| Translate products, collections, pages, blogs, articles (title, body, SEO, handle) | Yes | `translatableResources` + `translationsRegister` (VERIFIED) | Max 250 translations per call | 2 |
| Product options / option values | Yes | PRODUCT_OPTION(_VALUE).name (VERIFIED) | Discovered via `nestedTranslatableResources` | 2 |
| Image alt text | Yes | MEDIA_IMAGE / COLLECTION_IMAGE / ARTICLE_IMAGE alt | | 3 |
| Menus, links, filters | Yes | MENU, LINK, FILTER | | 3 |
| Metaobjects / public metafields | Yes, partial | METAOBJECT; only public metafields | Non-public metafields can't be translated | 3 |
| Theme content (sections, locale files, app embeds) | Yes | 7 ONLINE_STORE_THEME* types, dynamic keys | Very many keys per theme; Liquid placeholders must be protected; per-market theme rendering depends on the merchant's plan | 3 |
| Policies | Yes | SHOP_POLICY.body | UI must warn: legal texts need human/legal review | 3 |
| Shop-level SEO | Yes | SHOP.meta_title / meta_description | | 4 |
| Product tags | **No** | Tags can't be translated (VERIFIED) | Don't advertise | — |
| URL handle translation | Yes | `handle` key | Changing a handle later breaks language-specific redirects (VERIFIED caveat). Show a warning | 4 |
| Market-specific translations | Yes | `marketId` on `TranslationInput` (VERIFIED) | Theme content per market depends on plan | 4 |
| Enable/publish languages | Yes | `shopLocaleEnable` / `shopLocaleUpdate` | Hard limit of 20 enabled and 20 published locales (VERIFIED). Primary locale can't be changed via API | 4 |
| Outdated detection | Yes | `Translation.outdated` + digest comparison | | 2 |
| Auto-translate new/changed content | Yes | Resource webhooks + reconciliation | No dedicated translation webhook found (ASSUMPTION) | 3 |
| Bulk discovery of 100k-product catalogs | Likely | Bulk operations (rules VERIFIED) | Whether `translatableResources` is bulk-eligible: **test on a dev store** | 2 |
| hreflang/canonical injection | **Not planned** | Shopify themes already render alternate links for published locales (ASSUMPTION — verify per theme) | We audit, we don't inject | 4 |
| Email/notification templates, checkout texts | Possible | EMAIL_TEMPLATE etc. | Liquid-heavy, so high risk. Post-launch | Later |
| Rollback | Yes, partial | Re-register an older revision value with the **current** digest | Only possible while the source is unchanged from that revision's source | 3 |

## 2. Pipeline

```
discover → fetch(source, digest) → normalize → protect → TM lookup → route provider
  → reserve quota → translate → restore → validate → save (draft/approved)
  → [review] → revalidate digest → translationsRegister → read-back verify → commit usage
```

| Step | Details |
|---|---|
| Discover | Paginate `translatableResources(resourceType, first: 250)` or use a bulk query. Upsert `TranslationResource` and `TranslationEntry(status=MISSING)` in streamed batches |
| Normalize | Choose by `LocalizableContentType`. HTML/RICH_TEXT → parse with `parse5` into a DOM and extract text nodes plus translatable attributes (`alt`, `title`). JSON/RICH_TEXT_FIELD → walk the JSON and extract `value` nodes. URL/URI/FILE_REFERENCE → **never translated** |
| Protect | Replace with opaque tokens (`⟦0⟧`): Liquid `{{ }}` / `{% %}`, `{placeholders}`, URLs, emails, SKUs (merchant regex), numbers with units, currency amounts, glossary PROTECT terms, `<code>` contents |
| Memory | Exact match on (shopId, srcLocale, tgtLocale, market, sha256(normalized source)). Fuzzy matches (pg_trgm ≥ 0.85) are shown as **suggestions only**, never auto-applied |
| Route | TM hit → no provider. Otherwise the engines the shop's consent covers, in order DeepL → Microsoft Azure → Google Cloud (configured ones only, DeepL always first): the first that offers the target language translates the whole request; failover on quota, refused credentials, outages, unsupported languages and too large segments, never on rate limits (`providers/engine-router.ts`, docs/AI_ENGINES.md). One engine configured: that engine directly |
| Translate | Batch segments per provider limits. Timeouts, bounded retries with exponential backoff + jitter. Error classes: RETRYABLE (429, 5xx, timeout), FATAL (auth, unsupported pair), CONTENT (rejected) |
| Restore + validate | All tokens are present exactly once. HTML tag multiset equals the source. No new attributes or URLs. Length ratio within bounds per pair. Numbers/units preserved. Glossary PREFERRED applied and FORBIDDEN absent. Sanitizer allow-list. Failures → `FAILED` with code; never published |
| Save | `TranslationEntry` + `TranslationRevision`. `isManuallyLocked` entries are never overwritten automatically |
| Publish | Re-fetch digests via `translatableResourcesByIds`. Digest changed → `STALE`, re-queue. Else `translationsRegister`, check `userErrors`, read back |

### 2.1 Translation memory (implemented)

- Stored per shop, source locale, target locale and market (`""` = all markets), at **segment** level (the same segments the provider sees, with inline codes), keyed by a whitespace-insensitive SHA-256 of the segment.
- **Exact matches** are applied automatically before any provider call. Approved entries are always used; unreviewed machine entries only when the shop allows it (Settings, on by default). Market-specific entries win over general ones.
- **Fuzzy matches** (pg_trgm `similarity`, default ≥ 0.6, length within ±50 %) are only suggestions in the editor ("Fill from memory"); they are never published automatically.
- Identical segments within one request are sent to the provider once. Memory hits and duplicates are not billed and don't count against the monthly quota.
- Entries are written when translations are published: APPROVED for anything a person wrote or approved, MACHINE for automatic publishing. An approved entry is never replaced by machine output. A person's own translation is aligned with the source segment by segment (inline codes are matched by tag + attributes or literal value); segments whose structure differs are not stored rather than guessed.

### 2.2 Glossary (implemented)

| Rule | Effect |
|---|---|
| Never translate | The term becomes an opaque code; it is copied verbatim |
| Always translate as | The term becomes an opaque code that renders as the merchant's translation, so the provider can't change the wording (grammatical inflection is not adapted) |
| Never use | A target wording that blocks the result (the field is rejected, never published) |

Terms apply to all languages or one, and to all markets or one; the most specific term wins. CSV import validates every row and imports nothing if any row is invalid; export neutralises spreadsheet formulas.

### 2.3 Review and protection (implemented)

- Bulk jobs save **drafts** unless the merchant explicitly enabled automatic publishing (Settings; who and when is recorded). Drafts are published through the same digest-checked save as the editor; a draft whose source changed becomes STALE.
- An outdated translation is **protected** from bulk jobs if a person wrote or approved it, or if Linguva didn't write it (manual edits in Shopify, other apps). Only Linguva's own unreviewed machine output is refreshed, unless the merchant ticks "Also replace … written or approved by a person" for that job.
- Every write creates a revision (origin, approval, actor). The value Linguva replaces is kept as an `EXTERNAL` revision. A revision can be restored only while the source digest is unchanged, because Shopify accepts translations only for the current source.

## 3. Loop and duplicate prevention

- Translation writes don't change source content, so the source digest stays the same. A `products/update` webhook whose relevant source hashes are unchanged is ignored.
- Debounce: the per-resource auto-translate job is delayed 60s, and the job ID is `auto:{shopId}:{resourceGid}`, so bursts collapse into one job.
- Idempotency key per item: `{shopId}:{resourceGid}:{key}:{locale}:{market}:{sourceDigest}`.

## 4. Benchmark plan (Phase 3)

- Corpus: 200 synthetic, non-merchant segments per language pair from DE/EN to EN, AR, FR, ES, IT, PL, NL, SV, UK. Include HTML, specs tables, units, brand terms, and Liquid placeholders.
- Objective metrics: placeholder/HTML integrity (must be 100%), glossary adherence, COMET or chrF against references where available, latency p50/p95, cost per 1M characters.
- Human review: blind A/B on 50 segments per pair by native reviewers for marketing copy.
- Arabic: RTL rendering check in the preview, plus numeral style policy (Western vs Eastern Arabic numerals as a setting).
- Results are recorded in `docs/benchmarks/` with the date and provider versions. No claims without data.
