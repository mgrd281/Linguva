# App Store submission: every field, its value and the order

The Partner Dashboard form for the **public** app "Linguva" (not "Linguva KARINEX", which is a custom app and can't be listed: docs/RAILWAY_STAGING.md §10). Values come from the files named here; nothing is submitted until the owner does it (O-steps below). Requirements read again on shopify.dev on 2026-10-31.

Placeholders: `PUBLIC-APP-DOMAIN` is the public app's address (owner, O8); `SUPPORT-EMAIL` is the support mailbox (owner, O5; today shop@softwarekey.de).

## 1. Order

1. **Before the form** (code and owner): the public app exists (O2), is deployed (O8) with `PUBLIC_PAGES=on` and `LEGAL_TEXTS_REVIEWED=yes` after the lawyer (O7), the four plans exist (O9), and the dev-store test passed (O11).
2. **App setup** (§2): icon, URLs, contacts, protected customer data, compliance webhooks (deployed by `shopify app deploy --config public`).
3. **Listing, English first, then German** (§3): texts, category, languages, images, pricing content.
4. **Reviewer material** (§4): testing instructions and the screencast from docs/SUBMISSION_DEMO.md.
5. **Checks** (§5): the automated checks on the review page, `shopify app security check`, optionally Shopify's AI self-review. Fix every finding before submitting.
6. **Visibility and submit** (§6).

## 2. App setup

| Field | Value | Source |
|---|---|---|
| App name | Linguva | `deploy/shopify/shopify.app.public.toml` |
| App URL | `https://PUBLIC-APP-DOMAIN` | the same toml (`application_url`) |
| Redirect URL | `https://PUBLIC-APP-DOMAIN/auth/callback` | the same toml |
| Access scopes | `read_products, read_content, read_online_store_pages, read_translations, write_translations, read_locales`; optional: `read_markets, read_online_store_navigation, read_metaobjects, read_themes, read_legal_policies, read_shipping` | `shopify.app.toml`; why each one: SECURITY_MODEL.md §1a |
| Compliance webhooks | `customers/data_request`, `customers/redact`, `shop/redact` (in the toml, deployed with the app) | `app/.server/privacy/compliance.ts`; docs/LEGAL_FACTS.md |
| App icon | `docs/brand/linguva-icon-1200.png` (1200 × 1200) | BRAND_ASSETS.md §1 |
| Protected customer data | **Opt out**: Linguva requests no customer or order data | docs/LEGAL_FACTS.md |
| Emergency developer contact | email and phone of the owner | Owner (O12) |
| API contact email | an address without the word "Shopify" | Owner (O12) |
| Review contact email | a mailbox the owner reads; allow mail from `noreply@shopify.com` | Owner (O12) |

## 3. Listing

| Field | Value | Source |
|---|---|---|
| Name and subtitle | "Linguva: Translate & Review"; subtitle in EN and DE | APP_STORE_LISTING.md "Name and card" |
| App introduction (≤ 100) | EN and DE | APP_STORE_LISTING.md |
| App details (≤ 500) | EN and DE | APP_STORE_LISTING.md |
| Features (≤ 80 each) | rows 1–10, EN and DE | APP_STORE_LISTING.md "Feature list" |
| Search terms (≤ 5) | EN and DE | APP_STORE_LISTING.md |
| Category | **Store design → Internationalization → Currency and translation** (confirm the wording in the form) | APP_STORE_LISTING.md "Categories and languages" |
| Languages | English, German (French and Spanish only after a native speaker's review) | APP_STORE_LISTING.md; I18N_REVIEW.md |
| Integrations | none | APP_STORE_LISTING.md |
| Sales channel requirement | none required | APP_STORE_LISTING.md |
| Screenshots (desktop) | six of `docs/app-store/screenshots/`, in the recommended order 4, 10, 2, 9, 6, 5, each with its alt text | APP_STORE_LISTING.md "Screenshots" |
| Screenshot (mobile) | `8-mobile-editor.png` | the same |
| Feature image | `docs/app-store/feature-image-en.png` (English listing), `feature-image-de.png` (German), with alt texts | APP_STORE_LISTING.md "Feature media" |
| Privacy policy URL | `https://PUBLIC-APP-DOMAIN/privacy` | `site/privacy.html` (needs `PUBLIC_PAGES=on`) |
| FAQ URL | `https://PUBLIC-APP-DOMAIN/support#faq` | `site/support.html` |
| Support email | `SUPPORT-EMAIL` | Owner (O5) |
| Website | not needed; the website at `/` can be added once it has a real domain | site/README.md |
| Pricing content | display names and top features per plan, EN and DE | APP_STORE_LISTING.md "Pricing details"; plans themselves: PRICING_DECISION.md §9 (O9) |

No image shows a price or the Plan page (requirements 4.2.2, 4.2.3; checked by `tests/unit/app-store-listing.test.ts`).

## 4. Reviewer material

- **Testing instructions:** docs/SUBMISSION_DEMO.md §2, with the placeholders filled in. No credentials: login is Shopify's.
- **Screencast:** about 4 minutes, English, following docs/SUBMISSION_DEMO.md §1 (owner, O13).
- **Plan for the reviewer:** Business, so every listed feature is unlocked; reviewers can choose plans at no charge (PRICING_DECISION.md §5.1 and §9 step 2).

## 5. Checks before submitting

- The automated checks on the app's review page (authenticates right after install, goes to the app UI after install, uninstall and reinstall work, current App Bridge). With `BILLING_REQUIRED=true` the first open goes to Shopify's plan page; watch "Redirects to app UI directly after install" (O10).
- `shopify app security check` on the owner's machine. Prepared in the code: no wildcard `frame-ancestors` (STATIC_FRAME_ANCESTORS), no unused scope (SCOPE_OVER_REQUEST: `write_locales` removed), compliance webhooks, no unauthenticated app routes (`tests/security/structure.test.ts`).
- Optionally Shopify's AI self-review in the submission flow.
- Fix every finding first: Shopify doesn't take a resubmission while issues are open, and repeated failing submissions lead to a waiting period.

## 6. Visibility and submit

Limited visibility (only people with the link can install) suits the first 3 to 5 merchants; full visibility can follow later. Then submit (O15). Review takes days to weeks.

## Owner steps (O1–O16)

| Step | What | Done in the code |
|---|---|---|
| O1 | Where the public app runs: a separate Railway project (recommended) | RAILWAY_STAGING.md §10 explains why and lists the variables |
| O2 | Create the public app (public distribution), identity verification, note client ID, handle, app ID; trademark search | `deploy/shopify/shopify.app.public.toml` |
| O3 | DeepL API plan, cost control, data processing agreement; key into production only | — |
| O4 | Partner API client ("Manage apps") | — |
| O5 | Legal data (already on `/impressum`) and the support mailbox and reply time | `/support` shows shop@softwarekey.de and two working days, marked as open |
| O6 | Approve merging this branch | — |
| O7 | Lawyer: `site/privacy.html`, `site/support.html`, imprint; terms and a data processing agreement for merchants; then `LEGAL_TEXTS_REVIEWED=yes` | docs/LEGAL_FACTS.md lists the open questions |
| O8 | Deploy the public app with the §10 variables; `shopify app deploy --config public`; no public database or Redis proxy (also remove KARINEX's) | RAILWAY_STAGING.md §10 |
| O9 | The four plans exactly as PRICING_DECISION.md §9 | — |
| O10 | Decide `BILLING_REQUIRED`, set it last | — |
| O11 | Test on the dev store (DEV_STORE_TEST_PLAN.md) | — |
| O12 | Fill in this form; contacts; protected customer data opt-out | this document |
| O13 | Record the screencast | docs/SUBMISSION_DEMO.md §1 |
| O14 | Run Shopify's checks | §5 |
| O15 | Visibility and submit | §6 |
| O16 | KARINEX: move to the public app with complimentary access, or keep its custom app; register for the reduced revenue share | PRICING_DECISION.md §9 step 7 |
