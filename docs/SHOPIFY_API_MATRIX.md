# Shopify API Compatibility Matrix

Status: research findings, kept current. What is implemented is listed in FEATURE_STATUS.md; "VERIFIED" here means confirmed in Shopify's documentation or schema, **not** on a real store.

Research date: 2026-10-27. Sources: shopify.dev (docs search + page fetches) and the npm registry.

Legend:

- **VERIFIED**: confirmed against current shopify.dev documentation or the npm registry on the research date.
- **ASSUMPTION**: believed true but not yet confirmed. Must be verified (usually against a dev store) before we rely on it.

---

## 1. Platform baseline

| Topic | Finding | Status | Source |
|---|---|---|---|
| Latest stable Admin API | `2026-10`, released 2026-10-01, available until at least 2027-10-16 15:00 UTC | VERIFIED | shopify.dev/changelog/release-notes/2026-10 |
| Release cadence | Quarterly. Each stable version is supported for about 12 months | VERIFIED | shopify.dev/docs/api/usage/versioning |
| REST Admin API | Legacy since 2024-10-01. All new apps must use GraphQL | VERIFIED | shopify.dev/docs/api/admin-rest/usage/versioning |
| Recommended framework | Shopify CLI + React Router app template (`shopify app init`) | VERIFIED | shopify.dev/docs/apps/build/scaffold-app |
| App package | `@shopify/shopify-app-react-router` latest = `4.0.0` | VERIFIED (npm) | npm registry |
| Core API library | `@shopify/shopify-api` latest = `15.0.1` (2026-10-08) | VERIFIED (npm) | npm registry |
| Shopify CLI | `@shopify/cli` latest = `4.9.4` | VERIFIED (npm) | npm registry |
| Session storage | `@shopify/shopify-app-session-storage-prisma` latest = `11.0.1` | VERIFIED (npm) | npm registry |
| UI layer | Polaris **web components** (`<s-page>`, `<s-section>`, …), versioned under "App Home". The React `@shopify/polaris` package (13.9.5) is not the current recommendation for App Home | VERIFIED | shopify.dev/docs/api/app-home/v2.0 |
| App Bridge | Loaded from `cdn.shopify.com/shopifycloud/app-bridge.js` (always latest). Types come from `@shopify/app-bridge-types`. App Bridge is not versioned with Polaris | VERIFIED | shopify.dev/docs/api/app-home/v2.0/app-bridge-web-components |
| Authentication | `authenticate.admin(request)` validates the ID (session) token and performs **token exchange** | VERIFIED | shopify.dev/docs/apps/build/authentication-authorization/cli-app-authentication |
| Offline tokens | **Expiring offline access tokens are required for all public apps as of 2027-01-01.** The template enables `future.expiringOfflineAccessTokens: true` | VERIFIED | Shopify changelog + CLI auth docs |
| Scopes | Declared in `shopify.app.toml` `[access_scopes]`. Deploy with `shopify app deploy` | VERIFIED | CLI auth docs |
| Admin-created custom apps | New ones can no longer be created in the Shopify admin. Use Dev Dashboard or Shopify CLI apps | VERIFIED | shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps |
| Client credentials grant | `POST https://{shop}/admin/oauth/access_token` with `client_id`, `client_secret`, `grant_type=client_credentials`. Only for stores in the app's own organization. Token valid 24 h; carries the installation's granted scopes. Used only by the live tests | VERIFIED | shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant |
| `ShopPlan.partnerDevelopment` | Boolean "partner development shop". Used as the gate for live tests | VERIFIED (schema) | admin-2026-10 schema |
| Page, Article, Blog GIDs | `Page`, `Article` and `Blog` are Node types in 2026-10, so GIDs are `gid://shopify/Page/<id>` etc. | VERIFIED (schema). **ASSUMPTION** that `translatableResources(PAGE/ARTICLE/BLOG)` returns these GIDs; checked by `tests/live` |
| Product/collection mutations (2026-10) | `productCreate(product:)`, `productUpdate(product:)`, `productDelete(input:)`, `collectionCreate(collection:)`, `collectionDelete(input:)` | VERIFIED (schema, codegen) | Used only for live-test fixtures |
| Prisma | npm `latest` tag currently points to `8.0.0-rc.27` (a release candidate). The last stable line is `7.10.1` | VERIFIED (npm) | npm registry. **Decision needed**: pin a stable version (see ROADMAP, D-05) |

## 2. Translation APIs

| Operation | Finding | Status |
|---|---|---|
| `translatableResources(resourceType:)` | Paginated connection. Returns `translatableContent` entries (key, value, digest, locale, type) | VERIFIED |
| `translatableResourcesByIds` | Exists, returns a `TranslatableResourceConnection` | VERIFIED |
| `translatableResource(resourceId:)` | Single-resource read used to fetch digests before writing | VERIFIED |
| `TranslatableResource.nestedTranslatableResources` | Exists (for example, product → options) | VERIFIED |
| `translationsRegister(resourceId, translations[])` | Creates or updates translations. Each `TranslationInput` needs a `translatableContentDigest`. Optional `marketId` scopes a translation to one market (also for the default language, per the docs' product example) | VERIFIED |
| Error code for a wrong digest | `INVALID_TRANSLATABLE_CONTENT` (in the `TranslationErrorCode` enum). The fake store returns it | VERIFIED (schema). **ASSUMPTION** that this is the code returned for a stale digest; checked by `tests/live` |
| `translationsRemove(resourceId, translationKeys, locales, marketIds)` | Deletes translations. Only locales returned by `shopLocales` are valid | VERIFIED |
| `Translation.outdated` | Boolean that is true when the source changed after the translation was last updated | VERIFIED |
| `Translation.market` | `null` means the translation applies to all markets | VERIFIED |
| `LocalizableContentType` | HTML, RICH_TEXT_FIELD, INLINE_RICH_TEXT, JSON, JSON_STRING, URL/URI/LINK, LIST_*, FILE_REFERENCE, SINGLE/MULTI_LINE_TEXT_FIELD, STRING | VERIFIED. Drives which normalizer runs (see TRANSLATION_ENGINE) |
| `availableLocales`, `shopLocales`, `shopLocaleEnable`, `shopLocaleUpdate`, `shopLocaleDisable` | Exist. `availableLocales` lists the locales that can be enabled | VERIFIED (`availableLocales`). Others: ASSUMPTION on exact args, check schema at implementation |
| Locale limits | "Shops are limited to 20 enabled locales." "Shops are limited to 20 published locales." | VERIFIED |
| Primary locale | Can only be changed in the Shopify admin, not through the API | VERIFIED |
| Tags | Can't be translated | VERIFIED |
| Metafields | Only publicly accessible metafields can be translated. `METAFIELD` resource type is deprecated (use the owning resource / `METAOBJECT`) | VERIFIED |
| Handles | Translatable for PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG. If a merchant later changes a product handle, URL redirects aren't supported for language-specific URLs | VERIFIED |
| Theme content per market | Renders on the storefront only for shops whose plan includes market-specific theme customization | VERIFIED |
| App proxies | Not supported for translation | VERIFIED |
| Max input array size | 250 items for any array input (bounds the `translations` array per call) | VERIFIED |
| Bulk operations | `bulkOperationRunQuery` needs a Node connection, max 5 connections, max 2 nesting levels. `bulkOperations` query replaces `currentBulkOperation` (2026-01+) | VERIFIED (general rules). **ASSUMPTION**: whether `translatableResources` can run inside a bulk query must be tested on a dev store |
| Translation-specific webhooks | No dedicated "translation changed" webhook was found. Automatic translation uses `products/create`, `products/update`, `collections/create`, `collections/update` (`shopify.app.toml`, scope `read_products`) | Topics: VERIFIED (app config). No-translation-webhook: ASSUMPTION |
| Webhook `include_fields` | Narrows the payload; Shopify drops a delivery whose payload equals one sent shortly before, so a field that always changes (`updated_at`) must be included. Linguva requests `admin_graphql_api_id` and `updated_at` | VERIFIED (shopify.dev, "Webhooks delivery structure") |
| Webhooks caused by our own writes | Whether `translationsRegister` triggers `products/update` is not documented. If it does, the automatic check finds nothing to translate (source unchanged) and spends no AI allowance | ASSUMPTION, tested only with the fake store |

### 2.1 Translatable resource types (Admin API 2026-10, VERIFIED)

| Resource type | Translatable fields | Product scope |
|---|---|---|
| PRODUCT | title, body_html, handle, product_type, meta_title, meta_description | MVP |
| PRODUCT_OPTION / PRODUCT_OPTION_VALUE | name | MVP |
| COLLECTION | title, body_html, handle, meta_title, meta_description | MVP |
| PAGE | title, body_html, handle, meta_title, meta_description | MVP |
| BLOG | title, handle, meta_title, meta_description | MVP |
| ARTICLE | title, body_html, summary_html, handle, meta_title, meta_description | MVP |
| MEDIA_IMAGE / COLLECTION_IMAGE / ARTICLE_IMAGE | alt | Implemented in the editor, bulk jobs and the coverage report (top-level `translatableResources` per image type; ASSUMPTION for collection and blog post images until the live test). Product images: `product.media` (MediaImage ids) → `translatableResourcesByIds`. Collection and blog post images: `nestedTranslatableResources(resourceType: COLLECTION_IMAGE / ARTICLE_IMAGE)` of the parent (schema-valid; how Shopify nests them is ASSUMPTION until the live test runs) |
| Metafields (2026-10) | value | Implemented in the editor and bulk jobs for text and rich text types. `Metafield.translatable: Boolean!` on the owner's `metafields` (`HasMetafields`), then `translatableResourcesByIds`. The `METAFIELD` resource type for `translatableResources` is deprecated (VERIFIED, schema) |
| MENU / LINK | title | Phase 3 |
| FILTER | label | Phase 3 |
| METAOBJECT | depends on definition | Phase 3 |
| SHOP | meta_title, meta_description | Phase 4 (SEO) |
| SHOP_POLICY | body | Phase 3 (legal-review warning in UI) |
| ONLINE_STORE_THEME* (7 types) | dynamic keys from theme data | Phase 3 (Theme Content) |
| DELIVERY_METHOD_DEFINITION | name, description | Later |
| PAYMENT_GATEWAY | name, message, before_payment_instructions | Later |
| SELLING_PLAN / SELLING_PLAN_GROUP | name, option1-3, description | Later |
| EMAIL_TEMPLATE / PACKING_SLIP_TEMPLATE | title/body_html, body | Later. Contains Liquid, so it needs strict placeholder protection |

### 2.2 Technical Shopify limits that shape features

| Limit | Effect in Linguva | Source |
|---|---|---|
| `METAFIELD` resource type deprecated for `translatableResources` | Custom fields are found through their owner only: the editor and bulk jobs (with the option on) check each owner; the coverage report can't count them without one request per resource | VERIFIED (schema) |
| Rich text metafields are JSON (`RICH_TEXT_FIELD`) | Translated through markup and converted back; documents with node types Linguva doesn't know are left to Shopify's editor rather than guessed at | VERIFIED (type); node set per Shopify's rich text editor, unknown types refused |
| JSON, list, link and file metafields | Counted, not translated (no reliable text to translate, risk of breaking data) | Linguva decision |
| Market-specific translations (`marketId`) | Not written; all translations apply to all markets | Not implemented |
| No webhook for pages, blog posts, menus, theme content | Automatic translation covers products and collections only; other types need a bulk job or a later reconciliation | ASSUMPTION (topic list reviewed for the types Linguva uses) |
| Webhook delivery is at least once, and can be late or missed | Duplicate deliveries are suppressed by webhook id; a missed delivery means the change is translated by the next bulk job (no reconciliation yet) | VERIFIED (Shopify docs: at-least-once) |
| 20 languages per shop; primary language only in the admin | Settings and the database refuse more than 20 automatic languages | VERIFIED |

## 3. Billing

| Topic | Finding | Status |
|---|---|---|
| Default for new public apps | **Shopify App Pricing** (formerly "Managed Pricing"). Plans are defined in the Partner Dashboard, Shopify hosts the plan selection page, and the app doesn't call `appSubscriptionCreate` / `billing.request` | VERIFIED |
| Billing API | Now "Manual Pricing (Legacy)". Only for unsupported models such as one-time purchases | VERIFIED |
| Plan types | Free, monthly, yearly, monthly+yearly, usage-based. Free trials. Proration handled by Shopify | VERIFIED |
| Public plans | Up to 8 | VERIFIED |
| Private plans | Available only to selected stores (`*.myshopify.com`). Since 2026-09-21: unlimited private plans and unlimited target stores | VERIFIED |
| Billing webhooks | Shopify App Pricing sends **no** subscription webhooks (`app_subscriptions/update` is Billing API only). After plan approval Shopify redirects to the welcome link with `plan_handle`; other changes are read from the Partner API | VERIFIED (shopify.dev/docs/apps/launch/billing/shopify-app-pricing) |
| Plan testing | Dev stores of the same Partner org can select every plan at $0; a $0 private test plan exists | VERIFIED |
| Subscription state | Query `activeSubscription` in the **Partner API** (status: active, pending, cancelled, frozen). Persists beyond uninstall. Historical Events API available | VERIFIED |
| Usage charges | **App Events API**. Billing meters are defined in the Partner Dashboard and matched to an `event_handle`. Requests carry an `idempotency_key`. The blog example uses an `/app/unstable/events` path | VERIFIED (concept). **ASSUMPTION**: endpoint stability and auth method; re-check before Phase 5 |
| Dev stores | On dev stores in the same Partner org, any plan can be selected at no charge ($0 contract) | VERIFIED |
| Discounts / trial extensions | Applied per merchant from the Partner Dashboard | VERIFIED |
| App Store rule | All App Store apps must use a Shopify-provided billing solution | VERIFIED |

## 4. Rate limits

| Plan | GraphQL Admin restore rate |
|---|---|
| Standard | 100 points/s |
| Advanced | 200 points/s |
| Plus | 1,000 points/s |
| Enterprise (Commerce Components) | 2,000 points/s |

- Limits apply per app + store pair (leaky bucket). VERIFIED.
- A single query can cost at most 1,000 points. A mutation costs 10 by default. VERIFIED.
- Every response returns `extensions.cost.throttleStatus` (`currentlyAvailable`, `restoreRate`). The worker's per-shop limiter must read it. VERIFIED.

## 5. Compliance

| Requirement | Finding | Status |
|---|---|---|
| Mandatory topics | `customers/data_request`, `customers/redact`, `shop/redact`, declared as `compliance_topics` in `shopify.app.toml` | VERIFIED |
| Response | 2xx to confirm. Complete the action within 30 days. Return **401** for an invalid HMAC | VERIFIED |
| Data retention exception | If the law requires retaining data, don't complete the redaction | VERIFIED (needs legal review) |
| Security check | `shopify app security check` flags missing compliance webhooks (`MISSING_COMPLIANCE_WEBHOOKS`) | VERIFIED. Add it to CI |
| Protected customer data | Only needed if we read customer/order data. **Linguva doesn't need customer data.** Don't request those scopes | VERIFIED (requirement). The design choice is ours |

## 6. Access scopes

In use (`shopify.app.toml`): `read_products, read_content, read_online_store_pages, read_translations, write_translations, read_locales, write_locales`.

Optional (`optional_scopes`, requested at runtime with `scopes.request` and revocable by the merchant, VERIFIED shopify.dev "Manage access scopes"): `read_markets`, asked for only on the Markets page. Optional scopes must be deployed with `shopify app deploy` before they can be requested.

Markets read model (VERIFIED, 2026-10 schema via codegen): `markets { id name handle status webPresences { subfolderSuffix domain { host } defaultLocale alternateLocales rootUrls { locale url } } }`; `ShopLocale.published` tells whether a language is visible.

- No customer or order scopes.
- `read_online_store_navigation`, `read_metaobjects`, and `read_legal_policies` are added only when those resource types ship.
- Each scope must be justified in `SECURITY_MODEL.md` before it is added.
