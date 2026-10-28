# What the owner needs to provide or decide

Everything that can be built without accounts, money or legal decisions is done or planned in the repository. The items below need the owner. They are ordered by what they unblock. Prices marked "estimate" are assumptions to confirm; nothing here has been bought or connected.

## 1. Development store: done (2026-10-28)

`linguva-test-lab.myshopify.com` in the organization "Mein Shop" is connected; Shopify CLI, PostgreSQL, Redis, migrations and preflight work, and Linguva opens embedded in the admin (your report).

**Next action (about 2 hours over one or two sessions):** follow DEV_STORE_VERIFICATION.md: update the branch and migrate (§1.1), confirm the mock provider (§1.2), create the small fictional test catalog (§2), run the read-only live check (§4.1, one command, no extra app), then the checklist (§3), and send back the results log, the live test summary and screenshots (§6). Optional later: the "Linguva live tests" app for fixture writes (§4.2) and a second dev store for the isolation check (S2).

## 2. DeepL API key (unblocks: measured translation quality and real cost per product)

**What:** a DeepL API account. DeepL's developer documentation confirms a free API plan and paid ("Pro") plans; the amounts below come from third-party pages and must be checked at sign-up.

| Plan | What third-party pages say (estimate, verify) | Use |
|---|---|---|
| DeepL API Free | about 500,000 characters per month, no fee | Tests with the demo catalog only: some sources say texts on the free plan may be used by DeepL, so **never real store data** |
| DeepL API Pro | about $5.49 per month plus about $25 per million characters | Production, with DeepL's data processing agreement |

**Steps:** create the account at deepl.com → API, copy the key, set it only as `DEEPL_API_KEY` in your local `.env` (keys of the free plan end in `:fx`). Never paste it into the PR or chat.

**Status (phase I):** you said a key is available for local testing, but it is **not present in the cloud environment I work in** (no `DEEPL_API_KEY`). The measurement is ready: with the key in your local environment, `pnpm test:deepl` translates the fictional demo catalog into German, French and Spanish through the real pipeline, checks a character budget first, never prints the key, and writes docs/quality/DEEPL_MEASUREMENT.md (translations for you to judge, billed characters, cost per 1,000 products). Alternatively, add the key as a secret of this cloud environment so I can run it.

**Then I can:** run a reference set (product texts with HTML, numbers, brand names) in German, French and Spanish, record quality and characters per product, and update COST_MODEL.md with measured values.

## 3. Prices and plans (unblocks: billing tests and the listing's pricing section)

Plans are configured in the Partner Dashboard (Shopify App Pricing); the app reads the plan handle. **Proposal** (the handles must match `app/lib/plans.ts`):

| Handle | Proposed price | AI characters per month | Languages | Bulk and automatic translation | Glossary, automatic publishing |
|---|---|---|---|---|---|
| free | $0 | 20,000 | 1 | No | No |
| starter | $19 | 300,000 | 3 | Yes | No |
| pro | $59 | 1,200,000 | 10 | Yes | Yes |
| business | $179 | 4,000,000 | 20 | Yes | Yes |

- Text reused from translation memory doesn't count. A character allowance of 300,000 is roughly 50,000 words.
- Competitor anchors (COMPETITIVE_ANALYSIS.md): Langify $17.50–59.95 with words included only once; Transcy $29–99 plus tokens.
- Proposed trial: 14 days on paid plans; annual plans with two months free.
- Margins at full use, DeepL only, before hosting: about 44–61% (COST_MODEL.md §2, assumptions).

**Decide:** prices, trial length, annual discount, and whether the free plan stays (it helps installs; it costs at most 20,000 characters per store per month, roughly $0.50 at Pro rates).

## 4. Hosting and running costs (unblocks: production, monitoring)

Staging on Railway is prepared (docs/RAILWAY_STAGING.md): what to click, the variables, and which steps need your approval (§9). Production for KARINEX follows after staging is verified.

The app needs a web process, a worker process, PostgreSQL 16 and Redis 7, plus backups.

| Item | Estimate per month | Note |
|---|---|---|
| Web + worker + PostgreSQL + Redis (for example on Railway, Render or Fly.io), staging and production | $60–150 | COST_MODEL.md assumption; check the provider's current prices |
| Database backups | Included or $5–20 | Daily backups, tested restore |
| Error tracking and uptime alerts | $0 at launch (free tiers) | Sentry or similar; no store content in events |
| Domain and email for support | $1–10 | |
| DeepL API Pro | $5.49 base + usage | Usage is covered by plan prices |

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
| 6.2 | App icon (1200 × 1200, no text) | A simple mark in two colours |
| 6.3 | Support address and response promise | One business day |
| 6.4 | Native speakers for the French and Spanish interface | One person per language, 2–3 hours each (I18N_REVIEW.md) |
| 6.5 | 3–5 beta merchants from your network (not your production stores) | Complimentary access for 60 days |
| 6.6 | App name in the listing | "Linguva: Translate & Review" |
| 6.7 | Merge of PR #1 | Only after your review and the dev store checks |

Nothing on this list is done automatically: no purchase, no deployment, no connection to a production store, no merge.
