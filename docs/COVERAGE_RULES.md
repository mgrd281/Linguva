# Translation coverage: how it is counted

The coverage page (`/app/coverage`) and the Overview show how complete each language is. These are the rules; they live in `app/lib/coverage-rules.ts` and are tested in `tests/unit/coverage-rules.test.ts` (pure rules) and `tests/integration/coverage.test.ts` (scan and sync).

## 1. What is counted

| Rule | Detail |
|---|---|
| Unit | A **field**: one translatable text of one item in one language (a product's title, its description, its SEO title, an image's alt text, a custom field's value, a theme text…). |
| Empty originals | A field whose original is empty or only whitespace is **not counted**: there is nothing to translate. It is never "missing". |
| Items | Every Shopify translatable resource type of Admin API 2026-10, plus custom fields per owner type (products, collections, pages, blog posts) instead of the deprecated `METAFIELD` listing. Custom fields: every metafield of the item that Shopify marks `translatable`, whatever comes before it (owners are read ten at a time with their first 50 metafields of any kind; an owner with more is read on, 100 at a time). |
| Images | Alt text per image type (product, collection and blog post images). |

What each type gets beyond the count is in §10.

## 2. One state per field

Each counted field has exactly one state, by this priority:

| Priority | State | Meaning |
|---|---|---|
| 1 | Complete | A translation that is **not outdated** is live in Shopify. |
| 2 | Needs review | An AI draft waits on Review and has quality notes (numbers, terms, tone…). |
| 3 | Draft | An AI draft waits on Review without notes. **Drafts are never complete**: customers don't see them until approved. A draft counts only for the original it was made for: after the original changed it can't be published (approving it is refused), so the field shows as outdated or missing. |
| 4 | Failed | The item's latest finished attempt in a translation job for this language failed (FAILED or DEAD); a later successful or skipped attempt clears it. |
| 5 | Outdated | A translation exists, but the original changed since (Shopify's `outdated` flag). |
| 6 | Missing | No translation. |

A blank translation counts as missing.

## 3. Percentages

- Complete fields ÷ counted fields, **rounded down** in integer arithmetic: 99.6 % shows as 99 % (and 29 of 100 as 29 %), so 100 % only appears when every counted field is complete; under 1 % with some complete shows as "<1 %".
- With nothing to count (0 of 0) there is **no percentage** ("—"), never 100 %.
- Only a language **read in full** has a percentage: one the newest completed scan read, with a scan state for every type the figures count. A language published since, one being read for the first time, or one whose figures went with it (removed in Shopify, or the former primary language; §7) shows "not fully read yet" instead, and the whole-store figure says "measured in N of M published languages". The Overview's share follows the same rule (`measuredLocales`, `app/lib/coverage-view.ts`).

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
| No access | The app lacks the optional access scope for the type; it isn't a failure, and earlier results are removed. Its content is **not checked**: the whole-store figure and the Overview say how many content types Linguva can't read, with "Allow access", and never say "all done" or "fully translated" while one exists. |
| Scan didn't finish | The scan stopped in this type; figures may be older. |
| Nothing to translate | Scanned, with no counted field (folded away in the type table). |

The next step never says "everything is translated" over what wasn't read: content a scan didn't finish, a published language not read in full, a type without access, or a scan under way (the figures may still change).

## 7. Keeping the figures current

| Event | Update |
|---|---|
| A translation is saved or restored in Linguva (editor, Review approval, automatic publishing) | The item is updated right after the save, from the resource as read before the write plus the values written. |
| A translation is removed in Linguva | The item is updated the same way. |
| Drafts are saved, approved, rejected or retired | Draft and review states of those items are read again (a draft for an older original doesn't count, §2). |
| A job item runs (bulk or automatic) | The resource as the job read it, and the images and custom fields it read with it, replace the items' state: an original changed in Shopify shows as outdated, and the job's new drafts as drafts, without a scan. |
| A job item finishes | Failed state of that item is read again. A resource the job found deleted is removed in every language, with the custom fields it owns. |
| products/collections create/update webhook | The item is read from Shopify again in every language its type was read in, also while a scan reads the type or after one stopped in it (30 s delay, repeated saves merged; a refresh that fails for good is dropped, so the next save queues a new one). A deleted resource is removed. |
| products/delete, collections/delete webhook | The resource and the custom fields it owns are removed in every language at once. New webhook topics take effect once the app configuration is released with `shopify app deploy`. |
| Pages, blog posts and blogs changed in Shopify (no webhooks) | With automatic translation on, the periodic check (every 30 minutes) queues the same read as a webhook. |
| A language is removed in Shopify, or the primary language changes | At the next language sync (any page, or the worker's check), the coverage of every language that is no longer an additional language is removed and its pending drafts are retired (STALE, reason `LOCALE_GONE`); they no longer count on the Overview or Review. Added back, the language is measured again before it counts. |
| Full scan ("Rescan store") | Every type and language is read; items Shopify no longer returns are removed; counts are rebuilt from the items. |

Other changes made outside Linguva (menus, theme, policies, and pages or blogs while automatic translation is off) appear after the next scan, and so do translations removed outside Linguva. Image alt text of a deleted product or collection stays until the next scan of its type (images carry no owner yet). A scan read made before a save or refresh never overwrites the newer state (each item keeps the time of the Shopify state it reflects).

## 8. Storage and privacy

Coverage stores field keys, states, counts, resource ids, a 32-character hash of the translated SEO title (to find duplicates) and the first 16 hex digits of Shopify's digest of each counted original (to tell a draft for an older original), **never merchant text** (`tests/security/coverage-security.test.ts`). Titles in the item list are read live from Shopify for the visible page. Review: [SECURITY_MODEL.md §5m](SECURITY_MODEL.md), [§5p](SECURITY_MODEL.md).

## 9. Measured performance (local, PostgreSQL 16)

50,000 products × 3 languages (150,000 items): dashboard summary 170 ms, a page of items behind a number ≤ 11 ms (20 pages deep), item update after a save 22 ms (`tests/performance/coverage-scale.perf.test.ts`). Not yet measured against a real Shopify store: scan duration depends on Shopify's rate limits (one page of 50 items, or 10 custom field owners, per request).

## 10. What each type gets

What coverage counts, and what Linguva can do about the gaps, per type. "Bulk" is "Translate missing" (missing, outdated and failed fields; drafts unless automatic publishing is on); "Automatic" is automatic translation of new and changed content (Settings); "Editor" is translating one item by hand or with AI.

| Content | Coverage | Bulk | Automatic | Editor |
|---|---|---|---|---|
| Products, collections | Yes | Yes | Yes: webhooks (about a minute) and the periodic check; own fields only | Yes |
| Pages, blog posts, blogs | Yes | Yes | Yes: the periodic check only (every 30 minutes, at most 500 changes per type and run); own fields only | Yes |
| Image alt text (product, collection, blog post images) | Yes | With the owner's job ("images and custom fields") | No | On the owner's page |
| Custom fields of products, collections, pages, blog posts | Yes, every translatable one | With the owner's job, the first 100 per item | No | On the owner's page, the first 100 per item |
| Custom fields of blogs | No | With the blog's job, the first 100 | No | On the blog's page, the first 100 |
| Store listing, filters, product options and option values, subscription plans and groups, payment methods | Yes | Yes | No | Yes |
| Menus and menu links, metaobjects, shipping methods | Yes, with their optional scope ("No access" otherwise) | Yes | No | Yes |
| Policies | Yes, with `read_legal_policies` | No (one by one, with review) | No | Yes |
| Theme content (7 types) | Yes, not in the totals | No | No | Yes |
| Notification templates (email, packing slip) | Yes, not in the totals | No | No | Yes |
| Custom fields of the shop, variants and other owners; market-specific translations | No | No | No | No |

Limits that stay visible in the figures:

- **URLs (handles)** are counted on their own row, not in the totals, and never machine-translated: only merchants set them. A type whose only gaps are handles still offers "Translate missing", which then skips them.
- **Custom fields of JSON, file-reference or URL type** (and other content that isn't text) are counted but neither machine-translated nor edited in Linguva; they stay missing until translated in Shopify's own editor.
- **Custom fields after the first 100 of an item** are counted, but the editor and bulk jobs read only the first 100: they can't be translated in Linguva yet.
- **Image alt text and custom fields** are never part of automatic translation. "Translate missing" on their row starts the owner's job, which also translates the owner's other missing fields.
- **Failed** shows on the item the job processed: images and custom fields translated with a failed owner keep their earlier state.
- **Images of a deleted owner** stay until the next scan of their type.
