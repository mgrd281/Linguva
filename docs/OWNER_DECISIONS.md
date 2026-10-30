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

These need a lawyer or a reviewed template; I can draft the technical facts (what data, where, how long) from SECURITY_MODEL.md.

## 6. Smaller decisions

| # | Decision | Suggestion |
|---|---|---|
| 6.1 | Branch protection on `main` (GitHub setting, free) | Require the CI check and a review before merging |
| 6.2 | App icon (1200 × 1200) | **Decided 2026-10-30:** the ribbon L with the A and 文 cards (docs/BRAND_ASSETS.md §1); upload `docs/brand/linguva-icon-1200.png` in the Partner Dashboard |
| 6.3 | Support address and response promise | One business day |
| 6.4 | Native speakers for the French and Spanish interface | One person per language, 2–3 hours each (I18N_REVIEW.md) |
| 6.5 | 3–5 beta merchants from your network (not your production stores) | Complimentary access for 60 days |
| 6.6 | App name in the listing | "Linguva: Translate & Review" |
| 6.7 | Merge of PR #1 | Only after your review and the dev store checks |

Nothing on this list is done automatically: no purchase, no deployment, no connection to a production store, no merge.
