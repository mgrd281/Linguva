# 30-day launch plan

Goal of the first 30 days: **prove that merchants who install Linguva publish real translations and keep paying**, collect the first honest reviews, and learn which listing message works. Positioning and target merchants: COMPETITIVE_ANALYSIS.md §3.

Rules for the plan: only free channels unless the owner approves a budget; no fake or incentivised reviews (Shopify forbids them); no claims in the listing beyond what is Verified on Shopify; numbers below are **targets to check against, not forecasts**.

## 0. Gate: before day 1 (owner and development)

Launch starts only when all of these are true. Owner items are detailed in OWNER_DECISIONS.md.

| # | Gate | Who | Status |
|---|---|---|---|
| G1 | Core flows Verified on Shopify on a development store (DEV_STORE_TEST_PLAN.md: install, editor, bulk, Review, automatic translation, billing in test mode, uninstall) | Development, after the owner provides the store | Open |
| G2 | DeepL quality checked on a reference set in DE/FR/ES | Development, after the owner provides a key | Open |
| G3 | Prices and trial configured in the Partner Dashboard | Owner | Open |
| G4 | Hosting with backups, monitoring and error alerts; the app's posture check passing in production | Owner (decision, account) + development | Open |
| G5 | Privacy policy, terms, data processing agreement, imprint published | Owner (legal) | Open |
| G6 | Listing submitted and approved by Shopify's app review (takes days to weeks; plan for it) | Owner submits, development answers review findings | Open |
| G7 | Support: an address, a reply-within-one-business-day promise, a short FAQ | Owner | Open |

## 1. Week 1 (days 1–7): closed beta with 3–5 merchants

- Invite 3–5 friendly merchants from the target group (DACH or EU stores, 50–5,000 products, 2+ languages). Give them complimentary access (built in, audited) for 60 days in exchange for a 20-minute call; reviews are **asked for neutrally after real use, never traded for access**.
- Watch each one: install → first language → first AI translation → first approval in Review → first bulk job. Write down every place they hesitate.
- Daily: error logs, job failures, AI cost per store against the caps, support questions.
- Fix only what blocks the first published translation; collect the rest.
- Exit: at least 3 of 5 published translations in their store and none had a translation overwritten or a billing surprise.

## 2. Week 2 (days 8–14): public listing and organic reach

**App Store listing** (APP_STORE_LISTING.md):
- Go live with English and German; add French and Spanish once a native speaker has read them.
- Lead with the Review queue screenshot: "approve before it goes live" is the clearest difference to the apps merchants complain about.
- Search terms: translation, multilingual, language translate, translation review, glossary. Check the listing's traffic and install rate in the Partner Dashboard every 2–3 days; change one thing at a time (subtitle, first screenshot), never several.

**Free channels:**
- Website with a German and an English help center: setup guides, "how to translate a Shopify store safely", glossary and SEO guides. Comparisons with named competitors belong here only if they are factual and dated, never in the listing.
- Shopify Community forum and merchant groups: answer translation questions helpfully; mention Linguva only where it answers the question.
- Shopify partner agencies in DACH that build multilingual stores: offer them a free agency workspace on their client dev stores.
- LinkedIn posts by the owner: one practical tip per post (for example "why machine translation changed our product's numbers").

## 3. Week 3 (days 15–21): activation and conversion

Already in the app: guided start checklist, usage warnings before limits, plan selection on Shopify's page, drafts that wait in Review.

- **Activation target:** at least 40% of installs publish a translation within 3 days. If lower, look at where they stop (Overview checklist steps) and fix that step first.
- **Conversion to paid:** the free plan (1 language, small AI allowance) shows value; the paid plans unlock more languages, bulk jobs and automatic translation. Prompt the upgrade at the moment of need (second language, "Translate all", automatic translation), which the plan gating already does, and nowhere else.
- **Trial:** 14 days on paid plans (Shopify's free trial in the Partner Dashboard), so merchants can translate their catalog once before paying.
- **Do not** add pop-ups, email sequences or discounts in this phase: the target group distrusts aggressive upselling (competitors' billing complaints).

## 4. Week 4 (days 22–30): reviews, learning, next steps

- Ask active merchants (published translations, no open support issue) for an honest review through Shopify's review link, once.
- Review the numbers against the targets below and decide: listing message, plan limits, which gap from COMPETITIVE_ANALYSIS.md §4 to close next (import/export and a second engine are the likely candidates).
- Check the current "Built for Shopify" criteria (installs, reviews, performance) and plan the steps; don't claim it before Shopify grants it.

## 5. Targets for day 30 (to compare against, not promises)

| Measure | Where it comes from | Target |
|---|---|---|
| Installs | Partner Dashboard | 30–60 |
| Activation (published a translation within 3 days) | App database (count of shops with a revision; no personal data) | ≥ 40% |
| Trial → paid | Partner Dashboard | ≥ 20% of trials |
| Uninstalls within 7 days | Partner Dashboard | ≤ 30% |
| Reviews | App Store | ≥ 5, average ≥ 4.5 |
| Support first reply | Support inbox | ≤ 1 business day |
| Incidents with overwritten translations or wrong charges | Logs and support | 0 |

The activation count needs a small internal report (shops with at least one published translation by date). It reads only counts, no store content; build it before launch (half a day).

## 6. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Shopify's app review asks for changes | Launch slips | Submit early, fix quickly; the code already follows App Store requirements (session tokens, compliance webhooks, no customer data) |
| DeepL quality weak for a language | Bad first impression | Drafts wait in Review by default; quality checks; second engine planned |
| Real Shopify behaviour differs from the simulation | Bugs at launch | Gate G1; live tests in the repository |
| Costs per store higher than planned | Margin | Monthly and daily caps per store, platform-wide cap, cost report |
| Few installs | Slow learning | Agencies and help-center content; paid App Store ads only with the owner's budget |
