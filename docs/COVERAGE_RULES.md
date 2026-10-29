# Translation coverage: how it is counted

The coverage page (`/app/coverage`) and the Overview show how complete each language is. These are the rules; they live in `app/lib/coverage-rules.ts` and are tested in `tests/unit/coverage-rules.test.ts` (pure rules) and `tests/integration/coverage.test.ts` (scan and sync).

## 1. What is counted

| Rule | Detail |
|---|---|
| Unit | A **field**: one translatable text of one item in one language (a product's title, its description, its SEO title, an image's alt text, a custom field's value, a theme text…). |
| Empty originals | A field whose original is empty or only whitespace is **not counted**: there is nothing to translate. It is never "missing". |
| Items | Every Shopify translatable resource type of Admin API 2026-10, plus custom fields per owner type (products, collections, pages, blog posts) instead of the deprecated `METAFIELD` listing. Custom fields: the first 50 metafields per item that Shopify marks `translatable`. |
| Images | Alt text per image type (product, collection and blog post images). |

## 2. One state per field

Each counted field has exactly one state, by this priority:

| Priority | State | Meaning |
|---|---|---|
| 1 | Complete | A translation that is **not outdated** is live in Shopify. |
| 2 | Needs review | An AI draft waits on Review and has quality notes (numbers, terms, tone…). |
| 3 | Draft | An AI draft waits on Review without notes. **Drafts are never complete**: customers don't see them until approved. |
| 4 | Failed | The item's latest finished attempt in a translation job for this language failed (FAILED or DEAD); a later successful or skipped attempt clears it. |
| 5 | Outdated | A translation exists, but the original changed since (Shopify's `outdated` flag). |
| 6 | Missing | No translation. |

A blank translation counts as missing.

## 3. Percentages

- Complete fields ÷ counted fields, **rounded down**: 99.6 % shows as 99 %, so 100 % only appears when every counted field is complete; under 1 % with some complete shows as "<1 %".
- With nothing to count (0 of 0) there is **no percentage** ("—"), never 100 %.

## 4. Not in the totals (shown on their own rows)

| What | Why |
|---|---|
| Theme content (7 theme resource types) | Thousands of texts that come with the theme and its apps; most never appear in a typical store and would drown the catalog's figure. |
| Notification templates (email, packing slip) | Liquid code, translated one by one with care. |
| URLs (handles) | Optional: a translated handle changes the address customers and search engines know. |

## 5. Languages and markets

- The **whole-store** figure covers **published** languages only. Unpublished languages are shown, marked "Not published", and not included.
- The **market filter** (needs the optional `read_markets` scope) limits the languages to those a market offers. Translations made only for one market (market-specific overrides) are **not counted separately**; the market-independent translation is counted.

## 6. Scan states

| State | Meaning on the page |
|---|---|
| Not scanned | No scan has read this language and type yet. |
| Being scanned | The current scan is reading it. |
| No access | The app lacks the optional access scope for the type; it isn't a failure, and earlier results are removed. |
| Scan didn't finish | The scan stopped in this type; figures may be older. |
| Nothing to translate | Scanned, with no counted field (folded away in the type table). |

## 7. Keeping the figures current

| Event | Update |
|---|---|
| A translation is saved or restored in Linguva (editor, Review approval, automatic publishing) | The item is updated right after the save, from the resource as read before the write plus the values written. |
| A translation is removed in Linguva | The item is updated the same way. |
| Drafts are saved, approved, rejected or retired | Draft and review states of those items are read again. |
| A job item finishes | Failed state of that item is read again. |
| products/collections create/update webhook | The item is read from Shopify again in every scanned language (30 s delay, repeated saves merged). A deleted resource is removed. |
| Full scan ("Rescan store") | Every type and language is read; items Shopify no longer returns are removed; counts are rebuilt from the items. |

Changes made outside Linguva to other content (pages, blogs, theme, menus) appear after the next scan. A scan read made before a save never overwrites the newer state (each item keeps the time of the Shopify state it reflects).

## 8. Storage and privacy

Coverage stores field keys, states, counts, resource ids and a 32-character hash of the translated SEO title (to find duplicates), **never merchant text** (`tests/security/coverage-security.test.ts`). Titles in the item list are read live from Shopify for the visible page. Review: [SECURITY_MODEL.md §5m](SECURITY_MODEL.md).

## 9. Measured performance (local, PostgreSQL 16)

50,000 products × 3 languages (150,000 items): dashboard summary 170 ms, a page of items behind a number ≤ 11 ms (20 pages deep), item update after a save 22 ms (`tests/performance/coverage-scale.perf.test.ts`). Not yet measured against a real Shopify store: scan duration depends on Shopify's rate limits (one page of 50 items, or 10 custom field owners, per request).
