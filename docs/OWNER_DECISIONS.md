# What the owner needs to provide or decide

Everything that can be built without accounts, money or legal decisions is done or planned in the repository. The items below need the owner. They are ordered by what they unblock. Prices marked "estimate" are assumptions to confirm; nothing here has been bought or connected.

## 1. Development store: done (2026-10-28)

`linguva-test-lab.myshopify.com` in the organization "Mein Shop" is connected; Shopify CLI, PostgreSQL, Redis, migrations and preflight work, and Linguva opens embedded in the admin (your report).

**Next action (about 2 hours over one or two sessions):** follow DEV_STORE_VERIFICATION.md: update the branch and migrate (§1.1), confirm the mock provider (§1.2), create the small fictional test catalog (§2), run the read-only live check (§4.1, one command, no extra app), then the checklist (§3), and send back the results log, the live test summary and screenshots (§6). Optional later: the "Linguva live tests" app for fixture writes (§4.2) and a second dev store for the isolation check (S2).

## 2. DeepL API key (unblocks: measured translation quality and real cost per product)

**What:** a DeepL API account. DeepL API Pro and API Free can no longer be bought (DeepL help center, updated 2026-10-29).

| Plan | Price (read 2026-10-30, PRICING_DECISION.md §4) | Use |
|---|---|---|
| DeepL API Developer | Free, 1,000,000 characters in total (never reset) | Tests with the demo catalog only; check DeepL's data terms before any real store text |
| DeepL API Growth | $32.50 a month including 1,000,000 characters, then $27.50 per million (Germany: €25.00 net a month plus €22.00 per extra million; confirm VAT at checkout); at most 50,000,000 characters a month | Production, with DeepL's data processing agreement; set cost control in the DeepL account to €150 a month at launch |

**Steps:** create the account at deepl.com → API, copy the key, set it only as `DEEPL_API_KEY` in your local `.env` (keys of the free plan end in `:fx`). Never paste it into the PR or chat.

**Status (phase I):** you said a key is available for local testing, but it is **not present in the cloud environment I work in** (no `DEEPL_API_KEY`). The measurement is ready: with the key in your local environment, `pnpm test:deepl` translates the fictional demo catalog into German, French and Spanish through the real pipeline, checks a character budget first, never prints the key, and writes docs/quality/DEEPL_MEASUREMENT.md (translations for you to judge, billed characters, cost per 1,000 products). Alternatively, add the key as a secret of this cloud environment so I can run it.

**Then I can:** run a reference set (product texts with HTML, numbers, brand names) in German, French and Spanish, record quality and characters per product, and update COST_MODEL.md with measured values.

## 3. Prices and plans: decided 2026-10-30 (delegated by the owner)

Decided in [PRICING_DECISION.md](PRICING_DECISION.md) and verified the same day. The app shows these prices from `PLAN_PRICES` (`app/lib/plans.ts`); merchants are charged only once you enter exactly these plans in the Partner Dashboard.

| Handle | Monthly | Yearly | AI characters per month | Languages with AI | What the plan adds |
|---|---|---|---|---|---|
| free | $0 | — | 20,000 | 1 | Review and approve, translation memory, translating by hand in every language, AI one item at a time |
| starter | $29 | $290 (2 months free) | 300,000 | 3 | Translate whole areas at once; new and changed content translated automatically |
| pro | $99 | $990 (2 months free) | 1,200,000 | 10 | Glossary editing; optional automatic publishing |
| business | $299 | monthly only | 4,000,000 | 20 | Smart schedule (Smart Auto-Translate) |

- Trial: 7 days on Starter, Pro and Business, with at most 100,000 AI characters while it runs (the app enforces this limit). Free has no trial.
- Yearly: Starter and Pro cost 10 × the monthly price; Business is billed monthly only.
- Free stays. The allowances are unchanged. No overage charges at launch.
- Shopify's rule: a plan's price and its trial length change only in the Partner Dashboard; one store's trial extension or discount in the Dev Dashboard. The app never creates or changes a charge.

**Your steps:** create exactly these plans in the Partner Dashboard (PRICING_DECISION.md §9), check them on the dev store (DEV_STORE_TEST_PLAN.md L11–L14), then set the production values of §9 step 6, `BILLING_REQUIRED=true` last. Later price changes: Partner Dashboard, `PLAN_PRICES` and both listing languages on the same day.

**Own key plan (decided 2026-11; implemented, hidden):** `own-key`, $49 a month, monthly only, no trial, for large stores with their own DeepL, Microsoft Azure or Google Cloud key: Pro's features, 0 included characters, no Linguva character limit, and never Linguva's keys (`OWN_KEY_PLAN`, `OWN_KEY_PRICE` in `app/lib/plans.ts`). The app maps the handle regardless of the flag; `OWN_KEY_PLAN_VISIBLE=on` only shows its card on the Plan page and its texts on the website.

**Your steps for Own key** (PRICING_DECISION.md §9 step 11, only after the four plans and billing are live):
1. Precondition: the four plans are live and the `SHOPIFY_PARTNER_*` settings are set in production (production refuses `OWN_KEY_PLAN_VISIBLE=on` without them). Merge and deploy with the flag unset.
2. The lawyer resolves the own-key open points in the privacy page (docs/LEGAL_FACTS.md, open question 9).
3. Create the private test plan `own-key-test` ($49 monthly, no trial, welcome link `/app/welcome`) for `linguva-test-lab`, and test it there with your own DeepL API Free key with a low cost limit (DEV_STORE_TEST_PLAN.md L15–L20). Then delete or archive it.
4. Create the public plan `own-key` with no display name and no top features (merchants can't see it yet).
5. In one sitting: enter its pricing content in English and German from APP_STORE_LISTING.md (Own key block), set `OWN_KEY_PLAN_VISIBLE=on` in production and redeploy, then check the Plan page, `/preise` and Shopify's plan page.
6. Rollback: delete the pricing content, set the flag off and redeploy; subscribers keep their entitlements.

## 4. Hosting and running costs (unblocks: production, monitoring)

Staging on Railway is prepared (docs/RAILWAY_STAGING.md): what to click, the variables, and which steps need your approval (§9). Production for KARINEX follows after staging is verified.

The app needs a web process, a worker process, PostgreSQL 16 and Redis 7, plus backups.

| Item | Estimate per month | Note |
|---|---|---|
| Web + worker + PostgreSQL + Redis (for example on Railway, Render or Fly.io), staging and production | $60–150 | COST_MODEL.md assumption; check the provider's current prices |
| Database backups | Included or $5–20 | Daily backups, tested restore |
| Error tracking and uptime alerts | $0 at launch (free tiers) | Sentry or similar; no store content in events |
| Domain and email for support | $1–10 | |
| DeepL API Growth | $32.50 including 1M characters, then $27.50 per million (€25 net + €22 per million) | Usage is covered by plan prices; cost control in the DeepL account at €150 a month at launch |

**Decide:** provider and region (EU recommended for GDPR), who receives alerts. **Then I can:** add the deployment configuration and the production checks (posture check, migrations, secrets) without deploying anything until you approve.

## 5. Legal texts (unblocks: App Store submission)

- Privacy policy (required by Shopify), naming DeepL as the processor of store texts and the hosting provider.
- Terms of service, and a data processing agreement for merchants (GDPR, Art. 28).
- Imprint (Impressum) for a German business.

These need a lawyer or a reviewed template.

**Prepared (2026-11-01):**

- The imprint and the website's privacy page are online at `/impressum` and `/datenschutz` (from your Softwarekey legal notice).
- The app's privacy policy (`/privacy`, English and German) and a support page with FAQ (`/support#faq`) are drafted from the facts in docs/LEGAL_FACTS.md. Open points for the lawyer are marked in the pages and listed in LEGAL_FACTS.md: your role for store content and the data processing agreement for merchants, legal bases, the safeguard for US hosting (Railway), DeepL's terms, retention of audit entries, the host's logs and backups.
- They are off by default (`PUBLIC_PAGES=off`: 404). After the lawyer's review: set `LEGAL_TEXTS_REVIEWED=yes` and `PUBLIC_PAGES=on`; production refuses `PUBLIC_PAGES=on` without the review.
- Terms of service and the data processing agreement for merchants are not written yet.
- Terms of service: the store is the customer of the translation service whose key it adds and is responsible for that service's charges and its account; Linguva sets no character limit on own keys. (Own key plan; O7 in docs/APP_STORE_SUBMISSION.md.)

The submission steps, in order: docs/APP_STORE_SUBMISSION.md (O1–O16).

## 6. Smaller decisions

| # | Decision | Suggestion |
|---|---|---|
| 6.1 | Branch protection on `main` (GitHub setting, free) | Require the CI check and a review before merging |
| 6.2 | App icon (1200 × 1200) | **Decided 2026-10-30:** the ribbon L with the A and 文 cards (docs/BRAND_ASSETS.md §1); upload `docs/brand/linguva-icon-1200.png` in the Partner Dashboard |
| 6.3 | Support address and response promise | `/support` says shop@softwarekey.de and two working days, marked as open until you confirm (O5) |
| 6.4 | Native speakers for the French and Spanish interface | One person per language, 2–3 hours each (I18N_REVIEW.md) |
| 6.5 | 3–5 beta merchants from your network (not your production stores) | Complimentary access for 60 days |
| 6.6 | App name in the listing | "Linguva: Translate & Review" |
| 6.7 | Merge of PR #1 | Only after your review and the dev store checks |
| 6.8 | Plan page: which languages does a plan's AI cover? The first ones by their English names, or the ones the merchant picks? | Today: the first N by English name (a Starter store with Danish, Dutch, French and German gets no AI for German); the Plan page explains the rule and names the language outside the plan |
| 6.9 | Content page: a "Translate" button on every area tile? | Today: a tile opens its area's list, where "Translate" starts the AI after a short confirmation. One click more, but one place with one set of buttons |
| 6.10 | Content page: for content Shopify doesn't let apps read (payment methods, for example), keep the hint to Shopify's own translation app, or only say that Linguva can't read it? | Today: the hint shows; the app's name "Translate & Adapt" appears only on English pages |
| 6.11 | Content page: a tile with content added since the last count, or not counted completely, says "count the store again", but the page shows no count button then. Add a notice with "Count again" (new texts in four languages), or change the tile's words? | Today: only the words; "Count store again" on the Overview counts the store |
| 6.12 | Review: a button that approves everything waiting at once, across pages? It would publish texts nobody has looked at | Today: at most one page (about 50 texts, never more than 100), after a question. Keep it |
| 6.13 | Review: reject after a question, or at once with "Undo" for a few seconds? Undo means a rejected text could come back, which changes the rule that Linguva doesn't translate a rejected original again | Today: a question first ("This can't be undone") |
| 6.14 | Review on a phone: put the language label above each text box, so rendered texts (descriptions, pages) line up with plain ones? Today the label sits inside the box, 12 px further from a rendered text | Today: inside the box. The change needs a new artboard |
| 6.15 | Plan page on a wide screen: show "Fits your store" as a band at the top of its card instead of a badge? Cards without a badge keep an empty strip of about 28 px under their icon | Today: a badge, and the strip stays |

Nothing on this list is done automatically: no purchase, no deployment, no connection to a production store, no merge.
