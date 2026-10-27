# Development store test plan

Purpose: move features from **Tested Locally** to **Verified on Shopify** (FEATURE_STATUS.md). Every case runs on a **Shopify development store** of the owner's Partner organization, never on a KARINEX or SOFTWAREFACH store and never with real customer data. Set-up and the automated live tests are described in DEV_STORE_SETUP.md.

## 0. Preparation

| # | Item |
|---|---|
| P1 | Development store (`plan.partnerDevelopment = true`) with German and Arabic enabled as additional languages, German published, Arabic unpublished at first |
| P2 | Test catalog: at least 30 products (Shopify's sample data), 3 collections with images, 2 pages, 1 blog with 2 posts with featured images. Some product images with alt text, one without |
| P3 | Two text metafield definitions on products (`custom.care`, multi-line text; `custom.subtitle`, single-line text) and one rich text definition, with values on a few products |
| P4 | Markets: the primary market plus one market (for example Germany) with a German subfolder or domain |
| P5 | App: follow SHOPIFY_CLI_SETUP.md (`pnpm config:link`, `pnpm preflight` without ✗, `pnpm dev` against the dev store, `pnpm worker:dev`). Local `.env` only, never committed |
| P6 | AI: `TRANSLATION_PROVIDER=mock` for every case except C7. A DeepL Free key only with the owner's approval |
| P7 | Billing (section L): the four plans `free`, `starter`, `pro`, `business` created in the Partner Dashboard, Partner API client with "Manage apps", the variables from `.env.example` set locally. On development stores every plan costs $0: **no real charges** |
| P8 | Run the automated live tests first: `pnpm test:live` (read-only), then `LIVE_ALLOW_WRITES=yes pnpm test:live`. Log the result in §3 |

Each case: **steps → expected result**. Record pass/fail, date and notes in §3. A failed case is fixed before anything new is built.

## 1. Test cases

### A. Install and authentication
- **A1** Install from the CLI preview link → OAuth / token exchange completes, Overview loads inside the admin, no console errors.
- **A2** Database → one `Shop` row; `Session` access and refresh tokens are encrypted (no `shpat_` / `shpua_` visible); the runtime role is `linguva_app`.
- **A3** Open the app in a second browser / another staff account → works; the audit log records that staff member's id, not a name or email.
- **A4** Reload after 24 h (expiring offline token) → still works, token refreshed.
- **A5** First open right after install (layout and page load in parallel) → no error page; one `INSTALLED` entry in `ShopInstallation` (regression of the bug fixed in 7d8de34).

### B. Languages
- **B1** Languages page → German (published) and Arabic (unpublished) listed, with the 20-language limit.
- **B2** Arabic → RTL notice in the editor.

### C. Translation editor
- **C1** Products list, German → coverage per product; pagination over 30+ products.
- **C2** Open a product → "Translate with AI" fills drafts; **nothing is published** (check in Shopify's Translate & Adapt).
- **C3** Edit a draft and publish → "saved and verified"; reload shows Shopify's value; the storefront `/de/products/…` shows it.
- **C4** Change the product title in Shopify → editor shows "Outdated"; publishing the unchanged value requires the "still correct" box.
- **C5** Collections, pages, blog posts and blogs → same flow (C2–C3) for one item each.
- **C6** HTML description with links and bold text → markup and link targets are identical to the source after translation.
- **C7** (only with an approved DeepL key) Real AI translation of 3 products into German and Arabic → quality spot check, numbers unchanged, characters counted on Settings.

### D. SEO
- **D1** Product with SEO title and description → "Search engine listing" preview and counters; a title over 60 width units shows a warning.
- **D2** "Translate SEO fields only" → only `meta_title` / `meta_description` get drafts.
- **D3** Bulk job "SEO only" on products → only SEO fields change.
- **D4** Handle: "Suggest from the translated title" → valid handle; changing an already published translated handle requires the confirmation box; the new `/de/products/<handle>` works.

### E. Bulk jobs
- **E1** Products, German, "Translate all" in review mode → job progresses, finishes; Jobs page shows counts.
- **E2** Review mode → every result is a draft in Review; storefront unchanged.
- **E3** Enable automatic publishing (with confirmation) → new job publishes; results with warnings still go to Review. Switch back → next job creates drafts only.
- **E4** Translate one field by hand in Translate & Adapt, run bulk again → that field is kept; with "also replace" it is replaced and the old value appears in the history as "Before Linguva".
- **E5** Cancel a running job → stops; "Retry" resumes only open items.
- **E6** Stop the worker during a job, start it again → job resumes without duplicate work.

### F. Translation memory
- **F1** Publish a product, then translate a second product with an identical sentence → that segment uses zero AI characters (Settings usage unchanged for it).
- **F2** Similar sentence → "Fill from memory" proposes it with a match percentage; nothing is published until "Publish".
- **F3** Memory page → entries listed; approved entries are marked.

### G. Glossary
- **G1** "Never translate: Linguva" → stays unchanged in AI results.
- **G2** "Never use" term → an AI result containing it is discarded with a message.
- **G3** CSV import with one invalid line → nothing imported, the line is named; export opens safely in a spreadsheet (no formulas).

### H. Review, history, restore, remove
- **H1** Review page → filter by language, field group and warnings; search; pagination.
- **H2** Approve some drafts → published; reject others → not drafted again by the next job.
- **H3** Editor history → an earlier version restored and live.
- **H4** After a source change → restoring the old version is refused with an explanation.
- **H5** "Remove translation" (two clicks) → storefront shows the source text; the removed value is in the history and can be restored.

### I. Images and metafields
- **I1** Product with image alt text → "Images and custom fields" lists each image with a thumbnail; "Translate missing alt text and fields with AI" fills drafts only.
- **I2** Publish alt text → the storefront image `alt` attribute on `/de/products/…` is German (check the page source).
- **I3** Collection image and blog post featured image → alt text listed and publishable (confirms the nested resource assumption).
- **I4** `custom.care` and `custom.subtitle` → listed as translatable, publishable, shown in German on the storefront where the theme displays them.
- **I5** Rich text metafield with a heading, bold text and a link → AI draft keeps heading level, bold and the link target; published value renders correctly on the storefront and in Shopify's editor (confirms the node set).
- **I7** Bulk job with "Also translate image alt text and custom fields" → drafts for alt text and custom fields appear on Review under their product.
- **I6** An image without alt text → "has no alt text" notice.

### J. Markets
- **J1** Open Markets → permission screen; "Allow reading markets" → Shopify's grant screen → back in the app with the overview.
- **J2** Each market shows its languages, addresses and published state, matching Settings → Markets.
- **J3** Arabic offered in a market while unpublished → warning "isn't published".
- **J4** Revoke the optional scope (uninstall-free: via `scopes.revoke` or the app's settings in Shopify) → page returns to the permission screen, rest of the app works.

### K. Coverage
- **K1** Run the coverage report → finishes; per-language and per-type numbers match a manual count on 5 items.
- **K2** Duplicate SEO titles and missing SEO titles in the source → reported.
- **K3** "Translate gaps" → creates a job for the missing fields only.

### L. Billing (Shopify App Pricing, $0 on development stores)
- **L1** `BILLING_REQUIRED=true`, no plan → the app sends the merchant to Shopify's plan selection page (outside the iframe).
- **L2** Select Free → welcome link → Plan page shows Free; bulk translation and glossary editing are refused with a plan message; AI only into the first language.
- **L3** Upgrade to Starter → after the welcome link bulk works, automatic publishing is refused.
- **L4** Upgrade to Pro → automatic publishing allowed; up to 10 languages.
- **L5** Downgrade back to Starter → a running job with automatic publishing creates drafts; extra languages refused for AI.
- **L6** Monthly character limit of the plan reached (lower it temporarily in `app/lib/plans.ts` on the local build) → jobs stop with "allowance used up", resumable.
- **L7** Cancel the subscription → Partner API reports none → after the 6 h cache (or the welcome link) the plan page is shown again.
- **L8** Wrong Partner API token → paying shop keeps its plan (stale state), no redirect; warning in the logs only.
- **L9** Partner Dashboard: confirm that no charge or invoice was created for the dev store.
- **L10** Owner complimentary access (BILLING_DESIGN §4), on a second dev store standing in for an own store: without a plan, `pnpm ops:complimentary grant --shop-gid …` plus the GID in `COMPLIMENTARY_SHOP_GIDS` → Plan page shows "Complimentary access", all features work, no redirect to plan selection with `BILLING_REQUIRED=true`; AI usage appears in `pnpm ops:complimentary report`; revoke → plan selection again. The first dev store (not granted) is unaffected.

### M. Cost limits
- **M1** Daily limit set low → AI refused with the daily message; resets at midnight UTC.
- **M2** Many quick AI requests from one staff member → rate-limit message with a wait time.
- **M3** Very long product description → "too much text for one request".

### N. Uninstall and compliance
- **N1** Uninstall → sessions deleted, running jobs cancelled, `Shop` marked uninstalled.
- **N2** Reinstall → works without old sessions; data handling per DATABASE_SCHEMA.md.
- **N3** `shopify app webhook trigger` for `customers/data_request`, `customers/redact`, `shop/redact` → 200, recorded; `shop/redact` deletes the shop's data.

### P. Automatic translation (webhooks)
- **P1** Settings → Automatic translation: German on. Edit a product's description and save → about a minute later an "Automatic" job appears on Jobs and a draft on Review; nothing is published while "Review first" is set.
- **P2** Save the same product three times within a minute → one check (one item), not three.
- **P3** Translate a product title by hand, then change the English title → the automatic check keeps the hand-written translation (counted as "protected kept").
- **P4** Publish a Linguva translation → if Shopify sends `products/update` for it, the check ends "up to date" and the AI usage doesn't change. Record whether the webhook arrives at all (see SHOPIFY_API_MATRIX §2).
- **P5** Turn automatic translation off → saving a product queues nothing (no new job).

### S. Security spot checks
- **S1** Change an id in a form request (another product's image or metafield GID) with the browser's dev tools → nothing is written to the other resource.
- **S2** Two dev stores (if available) → no data of one is visible in the other (memory, glossary, jobs, review, coverage).

## 1a. Already covered by automated tests (simulated Shopify)

These run in CI on every push and should pass on the dev store too; the dev store run confirms Shopify's real behaviour:

- `pnpm test:live` (dev store only): API contract (digests, outdated, error codes, handles, removal, images, metafields, markets).
- `pnpm test:ui` (Playwright, simulated Shopify): A1/A2 install and auth, B1, C1–C3, D1, H1 (content), I1–I2, L-pages, empty and error states, accessibility and phone layout (docs/UI_TESTING.md).

## 2. Beta exit criteria

The first beta can start when:

1. `pnpm test:live` passes read-only and with writes, and every case in A–N passes, or its failure is fixed or accepted by the owner in writing.
2. C7 passes with DeepL (or the chosen provider), with the owner's approval of the key and its cost.
3. Billing L1–L9 pass with the real Partner Dashboard plans, and no charge was created.
4. Hosting, backups and monitoring are set up and approved (separate from any existing production systems).
5. Privacy policy, data processing terms and the App Store listing are reviewed by the owner.

## 3. Results log

| Date | Store | Case | Result | Notes |
|---|---|---|---|---|
| — | — | — | Not run yet | No development store connected |
