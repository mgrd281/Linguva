# Linguva pricing decision

- **Status:** **final**. Decided on 2026-10-30 and verified the same day by a second, independent check (§13). The owner delegated the decision ("Mach du selber jetzt Preise").
  - The app shows these prices.
  - Merchants are charged only after the owner enters exactly these plans in the Partner Dashboard (§9).
- **Machine-readable copy:** `PLAN_PRICES`, `TRIAL_DAYS` and `TRIAL_AI_CHARS` in `app/lib/plans.ts`, pinned by `tests/unit/plan-prices.test.ts`. The decision's `pricing.json` (cited below) is kept with the design files outside the repository. The app's `PLAN_PRICES`, the Partner Dashboard and the App Store listing must all show exactly these values.
- **Sources:** every external number below was read on **2026-10-30** at the URL given (§12). The verification re-read the important sources and found them first-hand where possible (§13.1). Repository facts come from HEAD `f4761e7`, before the decision was implemented.
- **In this repository:** a copy of the decision, with repository paths. *SPEC-plan* is the Plan page's design specification (Tarif v2), kept with the design boards outside the repository.
  - Implemented since `f4761e7`: §10.1 (prices in `app/lib/plans.ts`), §10.2 (the trial allowance in `app/.server/billing/subscription.ts`; the trial note next to the smart budgets; automatic translation and the smart schedule stopped at the trial's allowance pause only until the trial ends, `app/.server/jobs/queues.ts`), §10.3 (the Plan page, `app/routes/app.plan.tsx` and `app/components/plan/`), §10.4 (`.env.example` and a warning at start-up, not a refusal) and §10.5 (`tests/unit/plan-prices.test.ts`). Status: Implemented, Tested Locally; nothing is verified on Shopify yet.
  - Still to do by the owner: §9 (the plans in the Partner Dashboard), then the check on the dev store (DEV_STORE_TEST_PLAN.md §L).

---

## 1. Decision

| Handle | Monthly | Yearly | AI characters per month | Languages with AI | What the plan adds |
|---|---|---|---|---|---|
| `free` | **$0** | — | 20,000 | 1 | Review and approve, translation memory, translating by hand in every language, AI one item at a time |
| `starter` | **$29** | **$290** (2 months free) | 300,000 | 3 | Translate whole areas at once (bulk); new and changed content translated automatically |
| `pro` | **$99** | **$990** (2 months free) | 1,200,000 | 10 | Glossary editing; optional automatic publishing |
| `business` | **$299** | monthly only | 4,000,000 | 20 | Smart schedule (Smart Auto-Translate) |

- **Own key (decided 2026-11):** $49 a month, monthly only, for large stores with their own DeepL, Microsoft Azure or Google Cloud key; Pro's features, 0 included characters, no Linguva character limit, never Linguva's keys. Hidden until `OWN_KEY_PLAN_VISIBLE=on`. Not part of the ladder above (`OWN_KEY_PLAN`, `OWN_KEY_PRICE` in `app/lib/plans.ts`); the owner creates it in §9 step 11.
- **Trial:** 7 days on Starter, Pro and Business. While the trial runs, AI translation is limited to **100,000 characters**.
  - This needs a new trial allowance in the app (§10.2). Today's code gives a trialing store its plan's full allowance.
  - Until the trial allowance ships, the trial is 0 days.
  - Free has no trial; it doesn't need one.
- **Free plan:** stays.
- **Allowances:** unchanged. `PLANS` in `app/lib/plans.ts` stays as it is.
- **Yearly:** Starter and Pro cost 10 × the monthly price. Business has no yearly price at launch.
  - A private yearly plan can be offered on request once real usage is known.
  - Its handle must first be mapped in `app/lib/plans.ts` (§9 step 4).
- **In the app:** prices come from `PLAN_PRICES`, formatted in USD for each language. There is no monthly/yearly switch and no "popular" badge (§10.3).
- **Daily caps at billing launch:**
  - `AI_DAILY_CHAR_LIMIT=1000000`. Each shop gets min(1,000,000, its allowance) per UTC day.
  - `AI_PLATFORM_DAILY_CHAR_LIMIT=3000000`.
  - Details in §8.
- **Margin at 100% use**, worst case (DeepL $27.50 per million characters; Shopify 15% revenue share plus the 2.9% processing fee):

  | Plan | Monthly price | Yearly price, per month |
  |---|---|---|
  | Starter | 51.9% | 45.9% |
  | Pro | 48.3% | 41.5% |
  | Business | 45.1% | — |

  These figures are per UTC calendar month at a steady state. The edge cases where one billing cycle covers more than one month's allowance are in §6.4.

- **No overage charges** at launch.

## 2. The decision in one paragraph

The old proposal was $19 / $59 / $179. It assumed DeepL API Pro at $25 per million characters and no Shopify fees. Both assumptions are now wrong:

- DeepL no longer sells API Pro. New customers get **API Growth**: $32.50 a month including 1 million characters, then **$27.50 per million**.
  - A German account pays €25.00 net a month and €22.00 per extra million.
  - DeepL's own help center and pricing page confirm this (§4).
- Shopify charges a **2.9% processing fee on all app billing**. The 15% revenue share comes on top after the first $1M.

Re-run with these costs, the old prices give 36% / 25% / 20% margin at full use. All three fall below the 40% floor (§6.3).

The allowances stay, so the prices have to rise. The new ladder is **$29 / $99 / $299**:

- **Starter $29** costs the same as Transcy Regional ($29), Langify Growth ($29.95) and T Lab Business ($29.99).
- **Pro $99** costs the same as Transcy's top listed plan.
- **Business $299** is above every competitor's *listed* top plan. It sits in the range of their high-volume website tiers: LangShop Enterprise $250, Weglot Advanced $329, Transcy Global $599.

Each step costs about 3× more and gives 3–4× the characters, more languages and one more feature. The price per million characters falls from $96.67 to $82.50 to $74.75. Linguva is not the cheapest per word; apps built on Google or LLM engines include far more words (§7.2). It competes on DeepL quality, review before publishing, free reuse from translation memory, and an allowance that renews every month.

## 3. Rationale

### 3.1 What one AI character costs, and the price floor that follows

- **DeepL.** Each character in the allowance is a character DeepL bills.
  - The ledger settles with DeepL's `billed_characters` (`app/.server/providers/deepl.ts:185, 225`; `processors.ts:643`). DeepL doesn't bill XML tags (`tag_handling: "xml"`) or the `context` text.
  - So 100% use of an allowance costs allowance × DeepL's rate.
  - One small leak: if DeepL bills a request but its answer is lost and the app retries, DeepL bills twice but the ledger counts once.
  - Worst-case rate: **$27.50 per million** (DeepL's USD rate card, §4).
- **Shopify, worst case: 17.9% of the price.** That is the 15% revenue share plus the 2.9% processing fee. The processing fee applies to all billing, even under the $1M threshold (§5.2). The task named 15% as the worst case; leaving out the 2.9% would overstate every margin, so it is included. The country fees (UK 2%, Italy and Spain 3%, Türkiye 5%) are shown as sensitivity in §6.2.
- **DeepL's monthly fee, spread across shops.**
  - Growth costs $32.50 a month and includes 1,000,000 characters. At the extra-character rate those characters are worth $27.50.
  - The model counts every character at $27.50, as if none were included. That leaves a fixed **$5.00 a month**, spread over 10 paying shops: **$0.50 per shop**.
  - Whenever total usage is at least 1M characters a month, this equals the real DeepL bill exactly. Below that, the bill is the flat $32.50: a launch cost of at most $27.50 above the model.
  - A harsher variant puts the whole $32.50 on 10 shops ($3.25 each), which counts the included characters twice. It is shown in §6.2.
- **Price floor for 40% margin:** price ≥ (allowance × $27.50 / 1M + $0.50) / (1 − 0.179 − 0.40).

  | Plan | Floor |
  |---|---|
  | Starter | $20.78 |
  | Pro | $79.57 |
  | Business | $262.47 |

  With two months free on a yearly plan, the yearly price ÷ 12 must also clear this floor:

  | Plan | Monthly price must be at least |
  |---|---|
  | Starter | $24.94 |
  | Pro | $95.49 |
  | Business | $314.96 |

### 3.2 Why $29, $99 and $299

| Step | Price | Price step | Characters | Character step | Languages with AI | Adds | Price per 1M characters |
|---|---|---|---|---|---|---|---|
| Free | $0 | — | 20,000 | — | 1 | Review, memory, manual everywhere, AI one by one | — |
| Starter | $29 | — | 300,000 | ×15 | 3 | Bulk, automatic translation of new content | $96.67 |
| Pro | $99 | ×3.4 | 1,200,000 | ×4 | 10 | Glossary, automatic publishing | $82.50 |
| Business | $299 | ×3.0 | 4,000,000 | ×3.3 | 20 | Smart schedule | $74.75 |

- **Normal price points.** $29, $99 and $299 are classic App Store prices. Each sits next to a competitor price (§7.1).
- **Clear step-up.** Every step adds characters, languages and one feature. The price per million characters falls at each step, so the bigger plan is always the better rate.
- **Starter $29, not $24 or $25.**
  - $24 clears the monthly floor ($20.78), but "two months free" would then fall to 38.4%.
  - $25 clears the yearly floor only by 0.1 point.
  - $29 keeps both comfortably above 40% (51.9% monthly, 45.9% yearly) and matches the most common 3-language price in the market.
- **Pro $99, not $89.**
  - $89 passes monthly (44.5%), but its yearly price with two months free falls to 36.9%.
  - $99 keeps "two months free" at 41.5%, is the same as Transcy Cross-Border, and is a round step to Business.
- **Business $299, not $249 or $279.**
  - $249 fails the floor (37.7%).
  - $279 passes (42.5%) but leaves no buffer for the country fees.
  - $299 stays at 40.1% even for a merchant in Türkiye (5% fee).
  - $329 would allow two months free, but it would remove Business's per-character discount over Pro ($82.25 vs $82.50 per million).

### 3.3 Yearly: two months free on Starter and Pro, Business monthly only

- **Starter and Pro.** Two months free is what Weglot, LangShop, T Lab and GTranslate show ("save 17%"); Transcy shows 20–21%. Starter at $290 and Pro at $990 keep 45.9% and 41.5% at full use.
- **Business.** $2,990 a year (two months free) would be 37.8%, below the floor. One month free ($3,289, 41.8%) would mean a different discount on one plan. So Business is monthly only at launch.
- **A big store that wants a yearly invoice** can get a private plan: Managed Pricing allows unlimited private plans (§5.1). Price it once that store's real use is known.
  - The app gives Free's limits to any handle other than `free`, `starter`, `pro` and `business` (`entitlementsFor` in `app/lib/plans.ts`).
  - So the private plan's handle (for example `business-yearly`) must first be mapped to Business's entitlements in code.
- **Usage after the first pass** is usually far below 100%. A yearly Business discount can be reconsidered after three months of measured usage.
  - At the owner's real EUR cost (€22.00 per million = $24.49), $2,990 a year would keep **42.7%** at full use.
  - The floor would hold up to EUR/USD ≈ 1.19 (today 1.113). The USD rate card stays the basis until real usage is measured.

### 3.4 Trial: 7 days, limited to 100,000 AI characters

- **The risk: a free first pass.**
  - A translation app delivers most of its value in the first pass, and the translations stay in Shopify after uninstall.
  - Without a limit, a 7-day Business trial could translate 4,000,000 characters ($110 of DeepL). With the 1M daily cap and a trial that spans a month boundary, it could reach 7,000,000 ($192.50). The store could then uninstall without ever paying.
  - Shopify tracks trial days over 180 days, so reinstalling doesn't restart a trial (§5.1). One trial per store is still enough to lose money on every non-converting large store.
- **Why a trial at all.** Merchants want to test bulk and automatic translation on their own catalog before paying, and those aren't in Free. The App Store also shows "Free trial available". Most competitors offer a trial: 7 days (Transcy, EA), 14 (Weglot, LangShop, Translingo), 15 (GTranslate), 3 (Langwill). Langify lists none, and T Lab doesn't state one.
- **Why 100,000 characters.**
  - That covers about 50 typical products (about 2,000 characters each, COST_MODEL §1) or about 480 short ones (the demo catalog averages 209 characters) into one language.
  - At most **$2.75 per trial store**, or $5.50 if the trial spans two calendar months.
- **Why 7 days.** It is enough to judge quality and the review flow. With the cap, a longer trial costs nothing more, but it would make a convinced merchant wait longer for the full allowance.
- **Shopify's listing rules** say pricing must include "free trial time and charge details" (4.2.1). So the trial allowance goes into each paid plan's top features (§10.3) and onto the Plan page.
  - No App Store requirement forbids limiting usage during a trial; the verification looked for one (§13.1).
  - The limit must be disclosed, which the top features do.
- **In the app, say "up to 7 days".** Shopify subtracts trial days a store already used in the last 180 days, so a returning store may have fewer left. The docs don't say what happens to the trial when a store switches plans. So:
  - Show the trial line only while the store has no paid subscription.
  - During a trial, show the real end date from `trialEndsAt` (§10.3).
- **Fallback:** if the trial allowance isn't shipped when billing goes live, enter **0** trial days in the Partner Dashboard and set `TRIAL_DAYS = 0`. Do not run a full-allowance trial.

### 3.5 Free stays

- **Cost:** at most 20,000 characters per store per month, i.e. **$0.55**.
- **No bulk:** Free translates one item at a time, so full use is rare.
- **Installs:** "Free plan available" helps installs, and Free is where merchants learn the review workflow.
- **Total exposure:** bounded by the platform cap (§8). 1,000 free stores at full use would cost $550 a month.

### 3.6 Allowances stay

- The numbers 20k / 300k / 1.2M / 4M already appear in `PLANS`, the Plan page spec and artboards, and many tests: `tests/unit/billing.test.ts`, `tests/integration/{billing,ai-limits,usage-metering,complimentary}.test.ts`, `tests/ui/fixtures/shops.ts` and others.
- The margin floor is met by price, so there is no strong reason to change them.
- Keeping them also keeps the task's requirement that a Business store can use 4,000,000 characters a month.

## 4. DeepL API price (USD and EUR)

| Item | Value | Source (seen 2026-10-30) |
|---|---|---|
| Plans offered now | Developer (free, 1,000,000 characters in total, never reset), Growth, Enterprise. **API Pro and API Free can no longer be purchased**; existing subscriptions keep working | **First-party:** support.deepl.com "DeepL API plans" (updated 2026-10-29), read through the help center's JSON API. deepl.com/en/pro-api lists only the offers "Developer", "Growth" and "Enterprise API" |
| Growth, what's included | Monthly billing: **1,000,000 characters a month**. Yearly billing: 12,000,000 a year. Above that, usage is charged at the pricing page's rate. Tags aren't billed with `tag_handling` xml/html; `context` isn't billed | **First-party:** support.deepl.com "Usage count and billing in DeepL API" (edited 2026-04-23); developers.deepl.com `/v2/translate` reference |
| Growth, EUR (Germany, the owner's country) | **€29.75 a month** on monthly billing, €285.60 a year on yearly billing. DeepL notes "VAT is included in the price", so that is €25.00 / €20.00 net a month. Extra characters: **€22.00 per million** | **First-party:** the price list embedded in deepl.com/en/pro-api (`api-growth`: `basePrice` 2975 / 28560, `usageBasedPrice` 2200 per 1,000,000; `userCountry` DE). Matches the flexprice.io capture of 2026-09-22 |
| Growth, USD | **$32.50 a month** on monthly billing, $26 a month ($312 a year, 12M characters) on yearly billing. Extra characters **$27.50 per million** (Enterprise: $25) | AWS Marketplace listing by DeepL ($312 for 12 months, 12M characters; "$27.5" and "$25" per 1M). The $32.50 monthly figure is third-party only (flexprice.io, eesel.ai): deepl.com shows USD prices only to visitors outside the euro area |
| Enterprise | $15,000 for 12 months including 600,000,000 characters (= $25 per million) | AWS Marketplace |
| Usage limit on Growth | **50,000,000 characters per month** | **First-party:** both help-center articles above |
| Spending guard | Monthly cost control and key-level usage limits on Pro, Growth and Enterprise. Once the limit is reached, "the DeepL API will not process any further translation requests until the end of the billing period". The pricing page describes it as a limit on the "maximum monthly usage-based costs" | **First-party:** support.deepl.com "API usage and cost control" (edited 2026-04-23); deepl.com pricing texts |
| EUR/USD | 1 EUR = 1.113 USD (ECB, 2026-10-29). €22.00 per million = $24.49; €25.00 = $27.83 | ECB daily XML |

How this is used:

- The model uses the **USD rate of $27.50 per million**. That covers both cases:
  - **A USD account** pays exactly this.
  - **The owner's German account** pays €22.00 per million, which is $24.49 today. That is about 11% below the model, and the model stays conservative until EUR/USD passes 1.25.
- **VAT is open.** DeepL doesn't say whether the €22.00 includes VAT. For a VAT-registered business, VAT is reclaimable, so the net rate is at most €22.00. The exception is a Kleinunternehmer, who cannot reclaim VAT: if €22.00 is net, such an owner pays €26.18 = $29.14 per million. §6.2 shows that row.
- **Legacy API Pro.** If the owner already holds an API Pro subscription, it keeps working. Check its current rates in the DeepL account.

**Caveat:** the API price table on deepl.com is drawn by JavaScript, and the help-center pages block automated browsers. The verification therefore read DeepL's own data another way: the price list embedded in the pricing page and the help center's JSON API (§13.1). The owner still confirms the rate at checkout. If it is higher, change the margin guard's constant (§10.5) and revisit the prices.

## 5. Shopify rules

### 5.1 Managed Pricing (Shopify App Pricing)

| Rule | Value | Source |
|---|---|---|
| Public plans | Up to **8** public plans plus unlimited private plans (previously 4; raised 2026-07-09) | shopify.dev managed pricing; community.shopify.dev announcement |
| Free plan | Allowed. A plan shows to merchants only once it has a display name and top features in the merchant's language | shopify.dev setup-subscription-charges |
| Billing types | Free, monthly, yearly, or monthly with a yearly option. Merchants can switch between monthly and yearly prices. Usage charges are monthly only | shopify.dev managed pricing |
| Currency | **USD only**. Merchants billed in another currency see the prices as estimates in their billing currency, and are charged the converted amount | shopify.dev managed pricing |
| Plan changes | Upgrades take effect at once, with a prorated charge (Shopify staff on the developer forum). A downgrade from a paid plan to a free plan waits until the end of the paid plan's cycle (official docs); forum answers say downgrades between paid plans wait too. The app shows a waiting change through `pendingPlanHandle` | shopify.dev setup-subscription-charges; community.shopify.dev |
| Uninstall | Shopify cancels the subscription. The merchant gets no automatic refund for the rest of the cycle, so a paid first month is paid in full | shopify.dev `appSubscriptionCancel` (prorating is off by default); forum reports |
| App Review | Reviewers can select existing plans at no charge. Shopify fixed the plan switching that blocked reviews earlier in 2026 (staff reply, 2026-07-12), so "Free for partners and developers" is not needed for review | community.shopify.dev App Pricing update (2026-07-09) and review thread |
| Trial | Set per plan ("Free trial duration"). Trial days are tracked over **180 days** across reinstalls. If trial periods change later, days already used are subtracted. One store's trial can be extended by up to 60 days. No discount can be applied while a trial runs | shopify.dev offer-free-trials |
| Plan handle | Defined by you when the plan is created (since 2025-04-01). Handles persist across plan edits. The docs don't say a handle can be edited later | shopify.dev changelog |
| Welcome link | Set per plan; the merchant lands there after approving | shopify.dev managed pricing |
| Development stores | Stores in the same Partner organization can test every plan free. Other partners' dev stores get only free plans, plus paid plans marked "Free for partners and developers" | shopify.dev managed pricing; setup-subscription-charges |
| Usage-based pricing | Supported (App Events, up to 5 meters per plan). **Usage caps aren't supported**, so a merchant can't set a spending cap | shopify.dev managed pricing |

### 5.2 Revenue share and fees in 2026

| Term | Value | Source |
|---|---|---|
| Standard rate | You keep 100% of the first **$1,000,000 lifetime** gross app revenue, counted from 2025-01-01, and 85% above that (15% share) | shopify.dev revenue-share |
| Conditions | Standard rate only if prior-year App Store earnings are under $20M and gross company revenue is under $100M; otherwise 15% on everything. Eligibility is reassessed every year. A **one-time $19 registration** per Partner account is required. All associated developer accounts must be linked, and their revenue is combined | shopify.dev revenue-share |
| Basis | Gross sales; **refunds are not taken into account**; all your apps count together | shopify.dev revenue-share |
| Processing fee | **2.9% on all billing**, plus applicable sales tax, charged separately from the revenue share | shopify.dev revenue-share |
| Regulatory Operating Fee | By merchant business address: **UK 2%, Italy 3%, Spain 3%, Türkiye 5%** | help.shopify.com partners sales-taxes |

### 5.3 Showing prices in the app

- **1.2:** all charges go through Shopify App Pricing or the Billing API. **1.2.3:** merchants change plans without contacting support. Both are met: Shopify hosts the plan page.
- **4.2.1:** "Ensure your pricing information includes all pricing options such as, free trial time and charge details." So the trial and its 100,000 allowance go into the plan texts.
- **4.2.2 / 4.2.3:** no prices in images, the icon or the logo.
  - None of today's App Store screenshots (`tests/ui/app-store-screenshots.spec.ts`: products, editor, review, glossary, settings, overview, language page) shows `/app/plan`.
  - Keep it that way: never add the Plan page or any price to a listing image.
- **1.2.1 for Own key:** Linguva's only charge is the $49 a month through Shopify App Pricing. The translation fees are not app charges: DeepL, Microsoft or Google bill them under the merchant's own contract and account with them. Linguva never collects, marks up or resells them and stores no engine billing data. The plan's pricing content discloses them (§9 step 11: the additional-charges text).
- **4.3.3:** no "the best", no stats and no unsubstantiated claims in the listing. The pricing texts in §10.3 state plan facts only.
- **No written rule** was found saying that prices inside the app must match the listing. App Review applies it in practice:
  - App Review quoted on Shopify's community: "The pricing plans listed in your app are not references on your app listing", and every charge and the free trial time "must be included in the pricing section".
  - A 2026 forum thread reports a reviewer asking that all plans in the product match the listing.
  - **Rule for Linguva:** the Partner Dashboard is the source of truth, and the app's `PLAN_PRICES` must equal it, including the trial. The listing's plan texts must say the same.

## 6. Margins

### 6.1 At 100% use, worst case (Shopify 17.9%, DeepL $27.50 per 1M, fixed share $0.50)

| Plan | Price | After Shopify (× 0.821) | DeepL at full use | Fixed share | Profit | Margin |
|---|---|---|---|---|---|---|
| Starter, monthly | $29.00 | $23.81 | 300,000 × $27.50/1M = $8.25 | $0.50 | $15.06 | **51.9%** |
| Starter, yearly ($290 ÷ 12) | $24.17 | $19.84 | $8.25 | $0.50 | $11.09 | **45.9%** |
| Pro, monthly | $99.00 | $81.28 | 1,200,000 × $27.50/1M = $33.00 | $0.50 | $47.78 | **48.3%** |
| Pro, yearly ($990 ÷ 12) | $82.50 | $67.73 | $33.00 | $0.50 | $34.23 | **41.5%** |
| Business, monthly | $299.00 | $245.48 | 4,000,000 × $27.50/1M = $110.00 | $0.50 | $134.98 | **45.1%** |
| Free | $0 | — | 20,000 × $27.50/1M = $0.55 | — | −$0.55 | — |

Margin = (price × 0.821 − DeepL − fixed share) ÷ price. Hosting (COST_MODEL §1: $60–150 a month) is a platform cost and is not included, as in COST_MODEL §2.

### 6.2 Sensitivity

Each cell is the monthly price, then the yearly price ÷ 12.

| Shopify takes | Starter | Pro | Business |
|---|---|---|---|
| 2.9% (under the $1M threshold, the real case at launch) | 66.9% / 60.9% | 63.3% / 56.5% | 60.1% |
| 15% only (the task's wording) | 54.8% / 48.8% | 51.2% / 44.4% | 48.0% |
| **15% + 2.9% (used above)** | **51.9% / 45.9%** | **48.3% / 41.5%** | **45.1%** |
| + UK fee 2% | 49.9% / 43.9% | 46.3% / 39.5% | 43.1% |
| + Italy or Spain fee 3% | 48.9% / 42.9% | 45.3% / 38.5% | 42.1% |
| + Türkiye fee 5% | 46.9% / 40.9% | 43.3% / 36.5% | 40.1% |
| Fixed share $3.25 instead of $0.50 (the whole Growth fee on 10 shops) | 42.4% / 34.5% | 45.5% / 38.2% | 44.2% |
| DeepL €26.18 = $29.14 per million (€22.00 plus 19% VAT that can't be reclaimed) | 50.2% / 43.9% | 46.3% / 39.1% | 43.0% |
| The owner's real EUR cost (€22.00 = $24.49 per million, fixed share $0.33) | 55.6% / 50.3% | 52.1% / 46.1% | 49.2% |

- **Every monthly price stays at or above 40% in every row.**
- **Below 40%:** only yearly prices fall below 40%:
  - Yearly Pro does in three rows: the four countries with a fee (39.5% / 38.5% / 36.5%), the harsh fixed share (38.2%) and VAT that can't be reclaimed (39.1%).
  - Yearly Starter does only under the harsh fixed share (34.5%). That row counts the included characters twice, so it overstates the cost. The real fixed share rises above $0.50 only while fewer than 10 stores pay.
- All of these assume full use every month for twelve months. They are accepted as corner cases.

### 6.3 The old proposal under today's costs (same worst case)

| Plan | Old price | Margin |
|---|---|---|
| Starter | $19 | 36.0% |
| Pro | $59 | 25.3% |
| Business | $179 | 20.4% |

The proposed $40 per extra million characters (BILLING_DESIGN §2, COST_MODEL §2) would now earn **13.3%**. The floor for overage is $65.32 per million.

### 6.4 Calendar month versus billing cycle (corner cases)

The allowance renews on the 1st of each UTC calendar month (`periodKey` in `app/.server/usage/usage-ledger.ts`). Shopify bills in 30-day cycles (and 365-day cycles for yearly plans) that start on the day the merchant subscribes. Over time, a store gets at most about one allowance per cycle paid. But one cycle can touch two calendar months:

| Case | What can happen | Worst-case margin (17.9%) | At 2.9% (before $1M) |
|---|---|---|---|
| First monthly cycle, subscribed late in the month, cancelled after one cycle | Two allowances for one payment. Starter 600,000 characters in 2 days; Pro 2,400,000 in 4 days; Business 8,000,000 in 8 days (the 1M daily cap) | Starter 21.8%, Pro 14.4%, Business 8.2% | 36.8%, 29.4%, 23.2% |
| Yearly cycle | A 365-day cycle touches 13 calendar months | Starter 42.9%, Pro 38.1% | 57.9%, 53.1% |

- **No case loses money.** The cycle is paid up front, and an uninstall doesn't refund it (§5.1).
- **Accepted for launch.** It works like a welcome bonus for a first pass.
- **Watch for it:** check the ledger for stores whose first cycle used more than 1.5 × their allowance.
- **Possible later fix:** count the allowance per billing cycle (`currentPeriodEnd`) instead of per calendar month. That changes the Plan page's "new AI characters on the 1st" text and many tests, so it isn't part of this decision.

## 7. Competitors and positioning

### 7.1 What competing apps charge

All read on 2026-10-30 from the Shopify App Store listing unless a website is named. All charges are in USD. The verification re-opened these and found them as written (§13.1):

- Langify: listing, pricing page and word packages
- Transcy: listing and website
- Weglot: listing and website
- T Lab: listing
- LangShop: website

The other rows were not re-opened.

| App | Rating (reviews) | Free plan | Paid plans per month (yearly) | What a plan includes | Trial |
|---|---|---|---|---|---|
| Langify | 4.7 (728) | Yes, 5 languages, manual | $17.50, $29.95, $59.95 (no yearly) | 20 languages. Machine-translation words **once at sign-up**: 10,000 / 50,000 / 200,000. Extra words in one-time packages; Premium: 200,000 for $69.99, 500,000 for $149.99, 1,000,000 for $289.99 | None listed |
| Transcy | 4.5 (2,564), Built for Shopify | Yes, 1 language, 1 currency | $29 ($276), $69 ($660), $99 ($948). Website adds $14.9 and **$599** ($5,748) | 3 / 15 / 50 languages; 200 / 300 / 1,500 products. AI tokens 300 / 500 / 1,000 on the website; words "Unlimited" | 7 days |
| Weglot | 4.5 (827) | Yes, 1 language, 2,000 words | $17 ($170), $32 ($320), $87 ($870). Website adds **$329** ($3,290) and $769 | 1 / 3 / 5 languages; 10,000 / 50,000 / 200,000 words, a **total that doesn't renew**. Advanced: 10 languages, 1,000,000 words | 14 days |
| LangShop | 4.5 (473), Built for Shopify | Yes, 1 language, 50 products | $10 ($100), $40 ($400), $75 ($750). Website adds $120, **$250**, $500 | 10 / 15 / 20 languages; 250 / 2,000 / 5,000 products; words unlimited | 14 days |
| T Lab | 5.0 (1,037), Built for Shopify | Yes, AI for 1 language, 500 products, **with bulk AI translation and a glossary** | $11.99 ($119.90), $29.99 ($299.90), $59.99 ($599.90) | AI for 5 / 10 / 20 languages; 3,000 / 7,000 products. Premium: unlimited AI **with your own DeepL / Google / ChatGPT key** | Not stated |
| GTranslate | 4.7 (678) | Yes, all languages, unlimited machine translation | $12 ($120), $25 ($250), $35 ($350) | 1 language / all languages / + URL translation; words unlimited | 15 days |
| Translate & Adapt (Shopify) | 4.4 (1,395) | Free only | — | Translations by Shopify for up to 2 languages, or 8 in select countries | — |
| Langwill | 4.6 (635), Built for Shopify | Yes, 5,000 words | $9.99, $19.99, $49.99 (no yearly) | **Monthly** words: 30,000 / 80,000 / 300,000; 10 / 20 / 20 languages; $9.99 per extra 30,000 words | 3 days |
| EA AI Language Translate | 4.8 (119), Built for Shopify | Dev stores | $9.99 (live Google), $24.99, $49.99 | **1,000,000 / 4,000,000 words a month**, 5 / 20 languages | 7 days (Live Translate) |
| Translingo | — (0) | Yes, 50,000 characters once | $9.90 ($94.80), $29.90 ($286.80) | 500,000 / 5,000,000 characters a month via its own engine, then $12 / $8 per million; own API key possible | 14 days |
| Deep Shop Translate | 5.0 (2), launched 2026-05-15 | Free to install, 100,000 free tokens | Pay as you go (tokens) | Review queue and glossary (the closest concept to Linguva) | Tokens only |

### 7.2 Honest positioning (internal; the listing may not compare apps)

**Where Linguva costs more:**

- Apps built on Google or LLM engines include far more volume. EA gives 1,000,000 words a month for $24.99. Langwill gives 300,000 words a month for $49.99. Translingo gives 5,000,000 characters for $29.90. GTranslate and LangShop are "unlimited".
- **T Lab is the sharpest comparison.** It has a 5.0 rating from 1,037 reviews.
  - Its Free plan already includes bulk AI translation and a glossary, for 500 products into 1 language.
  - Its $29.99 plan covers 7,000 products in 10 languages.
  - At the same $29, Linguva Starter covers about 150 typical products (2,000 characters each) into one language, or about 50 products into its 3 languages, each month.
  - Linguva can't match that volume on DeepL at a 40% margin (§3.1). It has to win on quality and control instead.
- In words (about 6 characters per word, the repository's own conversion), Linguva gives about 50,000 words a month for $29, 200,000 for $99 and 667,000 for $299. That is DeepL volume, and it is the expensive part of the product.

**Where Linguva costs the same or less:**

- At equal **monthly** DeepL-class volume, Langify Premium costs about $129.94 a month for 200,000 words: $59.95 plus a $69.99 package, since its included words come once. That compares with Linguva Pro at $99.
- 700,000 words at Langify cost about $279.93 ($59.95 + $149.99 + $69.99). That compares with Linguva Business at $299 for about 667,000 words.
- T Lab Premium ($59.99) is unlimited only with the merchant's own engine key, so the merchant pays DeepL separately: about $38 a month for 1.2M characters on DeepL Growth ($32.50 including 1M, plus 0.2M × $27.50). That makes about $98 in total, against Linguva Pro's $99.
- Weglot's word limits never renew; Linguva's renew every month.

**What Linguva sells instead of volume:**

- Every AI draft is reviewed before it goes live.
- Text reused from translation memory costs nothing.
- The glossary is enforced.
- Translations written by a person are never replaced without permission.
- Coverage is shown per language and area.
- There is no product cap and no token wallet.

**What to tell merchants, on the Plan page and in support:**

- "Big first pass? Take a bigger plan for that month and switch down afterwards."
- An upgrade takes effect at once, with a prorated charge. A downgrade takes effect at the end of the billing cycle (§5.1). The AI allowance renews on the 1st of each month (UTC), whatever the billing date.

## 8. Daily caps when billing goes live

| Limit | Setting | What it allows | Worst-case cost |
|---|---|---|---|
| Per shop per UTC day | `AI_DAILY_CHAR_LIMIT=1000000`. Today's code applies min(this, the plan's allowance) (`app/.server/billing/billing.ts:40`, `app/.server/jobs/processors.ts:363`), so no code change is needed | Free 20,000, Starter 300,000 (a whole month in one day), Pro 1,000,000 (1.2M in 2 days), Business 1,000,000 (**4,000,000 in 4 days**) | ≤ **$27.50** per shop per day. Per month, at most the allowance: $0.55 / $8.25 / $33 / $110 |
| Trial allowance (new, §10.2) | 100,000 per month while a trial runs; the daily cap becomes min(1M, 100k) | Testing bulk on about 50 typical products into one language | ≤ **$2.75** per trial store ($5.50 if the trial spans two months) |
| Platform per UTC day | `AI_PLATFORM_DAILY_CHAR_LIMIT=3000000` | Three stores at the 1,000,000 daily cap on the same day, or two of them plus 1,000,000 for every other store | ≤ **$82.50** per day, less than one Business subscription's net revenue ($245.48). At most $2,475 over 30 days in theory; DeepL Growth's 50M monthly limit (confirmed, §4) caps the bill at $32.50 + 49 × $27.50 = $1,380 |

- **The current default must not go live.** `AI_PLATFORM_DAILY_CHAR_LIMIT` defaults to 100,000. A single Starter first pass (300,000) would stop every store with "The app's AI translation limit for today is reached". A Business store could never use its 4,000,000.
- **When to raise the platform cap:** raise it when any day in the last 7 reaches 70% of it, or when `PLATFORM_LIMIT` appears in a job.
  - Target: max(3,000,000; 3 × the sum of paying shops' monthly allowances ÷ 30), rounded up to whole millions.
  - Example: 10 Business, 20 Pro and 50 Starter stores → 3 × 79,000,000 ÷ 30 = 7.9M → **8,000,000**.
  - Keep it at least 3× the per-shop cap, so one first pass never blocks other stores.
- **When to move off DeepL Growth:** when total monthly usage approaches 40,000,000 characters (80% of Growth's 50M limit), move to DeepL Enterprise, which costs $25 per million on AWS.
- **Outer guard in the DeepL account:** set cost control to **€150 a month at launch**.
  - DeepL's pricing page calls it a limit on the "maximum monthly usage-based costs". Then €150 buys about **7.8M characters**: the 1M included plus €150 ÷ €22 per million.
  - If the account counts the €25 base fee in, it buys about 6.7M. Check which in the account, and size the limit by the smaller figure.
  - Sizing rule: keep the limit at least (sum of paying stores' allowances + 20,000 × free stores − 1,000,000) × €22 per million, plus 25%. Raise it before the stores' combined allowances could exceed it.
  - Once it is reached, DeepL refuses every request until the end of DeepL's billing period, and the app reports an AI error to every store. Treat it as a backstop, not a throttle.
- **Optional later improvement:** bulk jobs stopped by `DAILY_LIMIT` must be resumed by hand ("Resume the job tomorrow"). A Business first pass would need three resumes. An automatic resume after midnight UTC would remove that friction; the smart schedule already continues by itself.

## 9. Step by step for the owner: create exactly these plans (Partner Dashboard, Managed Pricing)

Do nothing here before steps 0 and 1 are done. Nothing in this section has been done for you.

0. **Before you start:**
   - The app's listing draft exists.
   - The trial allowance (§10.2) is deployed. Until then, enter 0 trial days in step 2, and keep `TRIAL_DAYS = 0` in the app. Changing to 7 later is allowed; Shopify subtracts days already used.
   - DeepL API Growth is bought (monthly billing to start), and cost control is set to €150.
1. **Open the pricing settings:**
   - Path: Partner Dashboard → **App distribution** → Linguva → **Distribution** → **Shopify App Store listing** → **Manage listing** → **Published languages** → English → **Edit** → **Pricing content** → **Manage** → **Settings**.
   - Set Pricing method to **Shopify App Pricing** and Default billing frequency to **Monthly**. Save.
2. **Create the public plans:** under **Public plans**, click **Add**. Create them in this order (Free, Starter, Pro, Business), so the plan page lists them in price order. Forum reports say that page uses creation order.

   | Plan handle (type exactly, lowercase) | Billing | Monthly charge | Yearly charge | Free trial duration | Free for partners and developers | Welcome link |
   |---|---|---|---|---|---|---|
   | `free` | Free | — | — | — | may stay on (free anyway) | `/app/welcome` |
   | `starter` | Monthly with a yearly option | 29.00 | 290.00 | 7 | **off** | `/app/welcome` |
   | `pro` | Monthly with a yearly option | 99.00 | 990.00 | 7 | **off** | `/app/welcome` |
   | `business` | Monthly | 299.00 | — | 7 | **off** | `/app/welcome` |

   - No row for Own key here: it is created in step 11, after the four plans are live.
   - Check each handle before you click **Save**. The app maps only `free`, `starter`, `pro` and `business` (`app/lib/plans.ts`), and the Own key handles of step 11 (`OWN_KEY_HANDLES`). Any other handle gets Free's limits and a warning in the log.
   - The docs don't say a handle can be edited later. If one is wrong, replace that plan before any merchant subscribes.
   - Leave "Free for partners and developers" **off** on paid plans. Otherwise any partner's development store could use Business's 4,000,000 characters a month for free.
   - App Review doesn't need that option: reviewers can select existing plans at no charge (§5.1). If a reviewer still reports that they can't switch plans, answer them in the review thread instead of turning the option on.
3. **Add a description in every published language:** Published languages → Edit (English, then German) → Pricing content. For each plan, enter the **Display name** (Free / Starter / Pro / Business) and the **Top features** from §10.3, then Save.
   - A plan without a description in a language is not shown to merchants in that language.
   - Keep each feature under about 80 characters. The editor shows its own limit.
4. **No other public plans and no private plans at launch** (besides Own key, step 11, and its private test plan, deleted after the test). Later, a yearly Business plan can be created as a private plan for a store that asks.
   - Before you create it, its handle (for example `business-yearly`) must be mapped to Business's entitlements in `app/lib/plans.ts`, and that code deployed.
   - Otherwise the store pays for Business and gets Free's limits, because `entitlementsFor` gives Free's limits to unknown handles.
5. **Test on `linguva-test-lab`:** your organization's development store, where every plan is free to test.
   - Open `https://admin.shopify.com/store/linguva-test-lab/charges/<app-handle>/pricing_plans`.
   - Check the four plans, $29 / $99 / $299, "7-day free trial", and the yearly toggle: Starter $290 and Pro $990. Also check how Business, which is monthly only, appears with "yearly" selected.
   - Compare every price with the app's Plan page (`PLAN_PRICES`) in English and German.
   - Choose Starter. You should land on `/app/welcome`, and Linguva's Plan page should show Starter, the trial badge and the 100,000 trial allowance.
   - Then switch to Pro, Business and Free; the app must follow each change. Record the results in DEV_STORE_TEST_PLAN §L.
6. **Production settings:** set these once step 5 passes, and set `BILLING_REQUIRED` last.
   - `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN` (secret), `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`
   - `AI_DAILY_CHAR_LIMIT=1000000`
   - `AI_PLATFORM_DAILY_CHAR_LIMIT=3000000`
   - `AI_COST_USD_PER_MILLION_CHARS=27.5`
   - `BILLING_REQUIRED=true`
7. **Revenue share:** register for the 0% share on the first $1M (one-time $19 per Partner account, shopify.dev revenue-share page). Link any associated developer accounts.
8. **Changing a price later:** change the Partner Dashboard, `PLAN_PRICES` and both listing languages on the same day. Read Shopify's current rules on price changes for existing subscribers before you change a live plan.

Later, once steps 0–8 are done and the four plans are live:

11. **The Own key plan** (`own-key`, $49 a month, monthly only, no trial; in the app `OWN_KEY_PLAN`, `OWN_KEY_PRICE`, `OWN_KEY_HANDLES`, `OWN_KEY_PLAN_VISIBLE`). Rule: Shopify shows a public plan to merchants (its plan selection page and the App Store listing) only once it has a display name and top features in the merchant's language (§5.1). The env flag hides only Linguva's own texts. So the plan's pricing content and the flag go on **together, in one sitting**, and the full test runs before anything is public, on a private plan.
    0. **Precondition:** steps 0–6 above are done: Free, Starter, Pro and Business are live, the `SHOPIFY_PARTNER_*` settings are set in production, and `linguva-test-lab`'s Plan page shows a real plan (not "billing off"). Without billing every shop is UNMETERED on Linguva's engines, so an Own key subscriber would translate at Linguva's cost; production refuses `OWN_KEY_PLAN_VISIBLE=on` without the Partner settings (`app/.server/lib/config.ts`).
    1. Merge and deploy. `OWN_KEY_PLAN_VISIBLE` stays unset (off). Production is unchanged for every store.
    2. Lawyer: resolve the own-key open points in privacy.html (EN and DE) before the flag goes on with `PUBLIC_PAGES=on` (docs/LEGAL_FACTS.md, open question 9).
    3. **Private test plan.** Partner Dashboard → Managed Pricing → **Private plans** → Add: handle **`own-key-test`** (if the editor refuses the hyphen, `ownkeytest`; both are mapped, `OWN_KEY_HANDLES`), Billing **Monthly**, **49.00**, no trial, "Free for partners and developers" **off**, Welcome link **`/app/welcome`**, available only to `linguva-test-lab` (UNCONFIRMED: the exact way the editor restricts a private plan to one store; development stores of the owner's organization test every plan free, §5.1).
    4. **Test on `linguva-test-lab`** with the private plan (production app; staging and development refuse real keys): choose it → `/app/welcome` → the welcome banner says "Add your DeepL, Microsoft Azure or Google Cloud key", the Plan page shows "Own key", $49, no trial, primary "Add your key". Settings: add the owner's own DeepL API Free key (`…:fx`, with a low cost limit in the DeepL account); only the last four characters show; allow AI translation (own-key notice). Translate one product in the editor and run one small bulk job; the owner's DeepL usage rises, Linguva's does not; the Plan page shows "Through your keys this calendar month"; the Overview shows no "used up" banner. Then DEV_STORE_TEST_PLAN L15–L20. Remove the key; the editor says "Add your translation key". Switch the dev store back to Free. Record the results in DEV_STORE_TEST_PLAN §L. Then delete or archive the private plan.
    5. **Public plan without content.** Public plans → **Add** (after Business): handle **`own-key`** (type exactly; if refused, `ownkey`, which is mapped too), Billing **Monthly**, **49.00**, no yearly charge, Free trial duration **empty**, "Free for partners and developers" **off**, Welcome link **`/app/welcome`**. Enter **no display name and no top features in any language**: merchants can't see it yet.
    6. **One sitting, in this order:** (a) pricing content in English and German: Display name **Own key**, top features and the additional-charges text from `docs/APP_STORE_LISTING.md` (Own key block); (b) set `OWN_KEY_PLAN_VISIBLE=on` in Railway production and redeploy; (c) check the Plan page card, `/preise`, Shopify's plan page on `linguva-test-lab` (five plans; how the yearly toggle shows the monthly-only plan, DEV_STORE_TEST_PLAN L11) and, with `PUBLIC_PAGES=on`, the privacy and support pages.
    7. **Rollback:** delete the pricing content of `own-key` in both languages (the plan disappears for merchants), set the flag off and redeploy. Existing subscribers keep their entitlements (handles are mapped regardless of the flag).
    8. Price changes later: Partner Dashboard, `OWN_KEY_PRICE` and both listing languages on the same day.

## 10. What the app and the docs must change

### 10.1 `app/lib/plans.ts`: prices next to the entitlements

`PLANS` stays unchanged. Add:

```ts
/**
 * Plan prices in USD. They must equal the plans in the Partner Dashboard
 * (Shopify App Pricing) and the listing's pricing texts; Shopify's plan page
 * is authoritative. docs/BILLING_DESIGN.md §2 has the table.
 */
export const PLAN_PRICES = {
  free: { monthlyUsd: 0, yearlyUsd: null },
  starter: { monthlyUsd: 29, yearlyUsd: 290 },
  pro: { monthlyUsd: 99, yearlyUsd: 990 },
  business: { monthlyUsd: 299, yearlyUsd: null },
} as const satisfies Record<PlanHandle, { monthlyUsd: number; yearlyUsd: number | null }>;

/**
 * Free trial on paid plans: must equal "Free trial duration" in the Partner
 * Dashboard (0 there means 0 here, and no trial text anywhere), and the AI
 * allowance while a trial runs.
 */
export const TRIAL_DAYS = 7;
export const TRIAL_AI_CHARS = 100_000;
```

- `PLAN_PRICES` mirrors the Partner Dashboard by hand. Nothing reads prices from Shopify, so the dev-store check in §9 step 5 compares them.
- Set `TRIAL_DAYS = 0` until the trial allowance (§10.2) is live and the Partner Dashboard has 7 days.
- The `satisfies Record<PlanHandle, …>` makes the compiler fail if a plan is missing a price.

### 10.2 Trial allowance (required before billing goes live)

**Code:** in `app/.server/billing/subscription.ts` `statusFrom(...)`:

- When the cached row's `trialEndsAt` is later than now (pass `deps.now`), set `monthlyChars = Math.min(resolved.monthlyChars, TRIAL_AI_CHARS)`.
- Expose `trialEndsAt` (or `inTrial`) on `BillingStatus`.

Because entitlements feed every limit, this one change reaches:

- `aiLimitsFor` (editor, Plan, Settings)
- the worker (`app/.server/jobs/processors.ts:362` reads `billing.entitlements.monthlyChars`)
- the smart budgets (`app/.server/smart/validate.ts:144`)

The comparison uses the current time against the cached `trialEndsAt`. So the full allowance starts exactly when the trial ends, even while the cached row is up to 6 hours old.

The 6-hour cache matters in one case: when the owner extends a store's trial in the Dev Dashboard. The cached `trialEndsAt` then stays at the old date for up to 6 hours, and the store gets its full allowance early in that time. "Refresh" on the Plan page or the welcome link forces a new check. That is acceptable.

Side effects to test:

- Smart Auto-Translate budgets are checked against `monthlyChars` (`app/.server/smart/validate.ts:144`). During a trial, a budget above 100,000 is refused as `BUDGET`. Say so next to the budget fields while a trial runs.
- The editor's "remaining" figure uses the same limit, so it shows 100,000 during a trial. That is correct.

**Tests:**

- Unit (`tests/unit/billing.test.ts`): a future `trialEndsAt` gives 100,000; a past one gives the plan's allowance; no trial gives the plan's allowance.
- Integration (`tests/integration/billing.test.ts` or `ai-limits.test.ts`):
  - During a trial, editor AI is refused with `QUOTA_EXCEEDED` above 100,000, and a bulk job stops there.
  - Once the clock passes `trialEndsAt`, the full allowance applies without a refresh.
- UI (`tests/ui/plan.spec.ts`, fixture `planTrial` from SPEC-plan §11): the hero shows the trial allowance and the date the full allowance starts.

### 10.3 Plan page (Tarif v2) and listing texts

**Price slot (SPEC-plan §3.4 item 3)** renders `PLAN_PRICES` with:

```ts
new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 })
```

- Set both fraction digits. Older engines throw a `RangeError` when only `maximumFractionDigits: 0` is given for USD.
- Expected output (checked on Node 22.22, ICU 77.1), with U+00A0 before the symbol:
  - en-US: `$29`
  - de-DE: `29 $`
  - fr-FR: `29 $US`
  - es-ES: `29 US$`
- fr and es mark the US dollar by themselves. In de, the footnote says USD.

**Display rules (binding for Tarif v2):**

1. **One source.** Every price, yearly price and trial figure comes from `PLAN_PRICES`, `TRIAL_DAYS` and `TRIAL_AI_CHARS`.
   - Never type them into copy or UI tests: UI tests import the constants.
   - Only `tests/unit/plan-prices.test.ts` writes the values out, on purpose (§10.5).
2. **Free shows the word** (Free / Kostenlos / Gratuit / Gratis), never "$0".
3. **No monthly/yearly switch.** Business has no yearly price, and Free has none either.
   - Starter and Pro show their yearly price as a second line under the monthly price. Business shows no yearly line.
   - Never invent a yearly price for Business or Free.
   - If a switch is wanted anyway, Business must keep showing "$299 / month" with "billed monthly" when "yearly" is chosen.
4. **Savings are stated exactly once and exactly:** "2 months free", which is true because yearly = 10 × monthly. No percentages, no strikethrough or "was" prices, no urgency.
5. **No popularity claims.** No "popular", "most chosen", "best value" or "recommended" badge: there is no data behind any of them.
   - A suggested plan may appear only if it is computed from the store's own data and says why. For example: "Fits your store: Pro — you have 6 languages".
6. **The trial text must be true:**
   - Show the trial line only if `TRIAL_DAYS > 0` and the trial allowance (§10.2) is live, and only while the store has no paid subscription.
   - Word it "up to", because Shopify subtracts trial days the store used in the last 180 days.
   - During a trial, the hero shows `trialEndsAt` and the 100,000 allowance.
7. **The hero never shows what this store pays.** A store may keep an older price after a price change; Shopify's charge history is authoritative. The cards show today's list prices.
8. **Never convert currencies.** Shopify shows estimates in the merchant's billing currency on its own page.
9. **The plan button stays the only way to change plans**, and it links to Shopify's page (SPEC-plan §2.1). A price on the card is display only.

| Element | en | de |
|---|---|---|
| Price | $29 / month | 29 $ / Monat |
| Free | Free | Kostenlos |
| Yearly line (Starter, Pro) | or $290 / year: 2 months free | oder 290 $ / Jahr: 2 Monate geschenkt |
| Trial line (paid plans, store without a paid plan) | Up to 7 days free, with 100,000 AI characters | Bis zu 7 Tage kostenlos testen, mit 100.000 KI-Zeichen |
| Hero during a trial | Trial until {date}: 100,000 AI characters. After that: {limit} a month. | Testphase bis {date}: 100.000 KI-Zeichen. Danach: {limit} pro Monat. |
| Footnote under the cards | Prices in USD, billed by Shopify. Shopify may show an estimate in your currency; taxes may apply. | Preise in USD, abgerechnet über Shopify. Shopify zeigt eventuell einen Schätzwert in deiner Währung; Steuern können hinzukommen. |

- fr and es: price `29 $US / mois` and `29 US$ / mes`. Their texts follow the en column.
- Add the keys in en, de, fr and es. Mark fr and es for native review in `docs/I18N_REVIEW.md`.
- In SPEC-plan, revise rule §2.2 ("No price … in the UI"), §13's first bullet and Owner question 1 (the answer: show prices from `PLAN_PRICES`). Appendix C already started this.
- **Replace the Tarif v2 placeholders.** The Tarif v2 boards' data (`design/work-v2/tarif_data_v2.py`, outside the repository) and SPEC-plan Appendix C still use $19 / $59 / $179, a yearly price on every plan ("Du sparst 118 $ im Jahr", a yearly switch) and a 14-day trial. Use this document's values:
  - no Business yearly price, so no switch
  - "2 months free" instead of a savings amount
  - up to 7 days, with 100,000 AI characters
- `tests/ui/plan.spec.ts` does not exist yet at HEAD; the Tarif work creates it (SPEC-plan §11). It asserts:
  - the four prices in en and de
  - the two yearly lines
  - no yearly line on Business
  - the trial line only for a store without a paid plan, and none when `TRIAL_DAYS` is 0
  - no badge text matching /popular|beliebt|empfohlen|recommended/i

**Listing pricing texts:** Display name plus Top features, to enter in step 3 and to copy into `docs/APP_STORE_LISTING.md` under a new "Pricing details" heading. Add a line under the plans: "AI characters are the characters DeepL translates for you, spaces included. Text reused from your translation memory doesn't count. New allowance on the 1st of every month (UTC)." In German: „KI-Zeichen sind die Zeichen, die DeepL für dich übersetzt, Leerzeichen inklusive. Text aus deinem Übersetzungsspeicher zählt nicht. Neues Kontingent am 1. jedes Monats (UTC)."

| Plan | Top features (en) | Top features (de) |
|---|---|---|
| Free | 20,000 AI characters a month (DeepL) · AI translation into 1 language · Review and approve every draft · Translation memory: reused text is free · Translate by hand into every language | 20.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 1 Sprache · Jeden Entwurf prüfen und freigeben · Übersetzungsspeicher: Wiederverwendetes kostet nichts · Selbst übersetzen in jeder Sprache |
| Starter | 300,000 AI characters a month (DeepL) · AI translation into 3 languages · Translate whole areas at once · New and changed content translated automatically · 7-day trial with 100,000 AI characters | 300.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 3 Sprachen · Ganze Bereiche auf einmal übersetzen · Neue und geänderte Inhalte automatisch übersetzen · 7 Tage testen, mit 100.000 KI-Zeichen |
| Pro | 1,200,000 AI characters a month (DeepL) · AI translation into 10 languages · Glossary for brand names and fixed terms · Optional automatic publishing; texts with warnings wait · Everything in Starter; 7-day trial with 100,000 AI characters | 1.200.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 10 Sprachen · Glossar für Markennamen und feste Begriffe · Automatisch veröffentlichen, wenn du willst; Texte mit Hinweis warten · Alles aus Starter; 7 Tage testen, mit 100.000 KI-Zeichen |
| Business | 4,000,000 AI characters a month (DeepL) · AI translation into 20 languages · Smart schedule: your whole store on your timetable, with budgets · Everything in Pro · 7-day trial with 100,000 AI characters | 4.000.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 20 Sprachen · Intelligenter Zeitplan: ganzer Shop nach deinem Zeitplan, mit Budgets · Alles aus Pro · 7 Tage testen, mit 100.000 KI-Zeichen |

- Keep features 9 and 10 of the listing out until the dev-store checks pass, as APP_STORE_LISTING already says.
- The trial line only goes in once §10.2 has been verified on the dev store.

### 10.4 Configuration

- **Production environment:** the three values in §9 step 6.
- **Code defaults stay safe for development:** the platform cap stays at 100,000 and `AI_COST_USD_PER_MILLION_CHARS` at 25.
  - Changing the cost default to 27.5 would also require `tests/integration/complimentary.test.ts:181` (`costPerMillion: 25`) and `scripts/ops/complimentary.ts:66`.
  - Prefer the environment variable.
- **`.env.example`:** add a comment with the production values.
- **Optional guard:** a config refine that `BILLING_REQUIRED=true` needs `AI_PLATFORM_DAILY_CHAR_LIMIT` of at least 1,000,000, plus a case in `tests/unit/config.test.ts`. Then billing can't go live with the 100,000 default.

### 10.5 Tests

Add `tests/unit/plan-prices.test.ts`:

- `PLAN_PRICES` keys equal `PLANS` keys.
- Free is 0 / null.
- Monthly prices rise strictly with the plans.
- Where a yearly price exists, it equals 10 × monthly.
- **Margin guard:** for every paid plan and each of its prices (monthly, and yearly ÷ 12), (price × 0.821 − `monthlyChars` × 27.5 / 1,000,000 − 0.50) ÷ price ≥ 0.40.
  - Put the constants in the test with a comment pointing to this document and COST_MODEL §2.
  - A later change to an allowance or a price can then no longer break the floor silently.
- **Pinned values:** the test pins `PLAN_PRICES` to 0/null, 29/290, 99/990 and 299/null, and `TRIAL_DAYS` to 7 (or 0), `TRIAL_AI_CHARS` to 100,000. A price change then has to touch the test too, which is the reminder to change the Partner Dashboard on the same day.
- **Formatting:** the price formatter gives `$29`, `29 $`, `29 $US` and `29 US$` (with U+00A0) for en, de, fr and es, and Free gives the word.

Because no allowance changes, no existing allowance test changes.

Own key plan (2026-11), additions only (the pinned cases of the four plans are unchanged): `tests/unit/plan-prices.test.ts` (`OWN_KEY_PRICE` pinned at 49 / null with the same margin formula, `trialDaysFor` 0) and `billing.test.ts` (`OWN_KEY_HANDLES` pinned to the six handles, `OWN_KEY_PLAN`) gained cases; new files `tests/unit/own-key-plan.test.ts` (Plan page card, hero, table note, FAQ), `own-keys-card.test.ts`, `own-key-formats.test.ts`, `own-key-checker.test.ts`, `own-key-cipher.test.ts`, `own-key-codes.test.ts`, `own-key-errors.test.ts`, `own-key-messages.test.ts`, `key-check-limits.test.ts`, `auto-pause.test.ts`, `secret.test.ts`, `shop-translation.test.ts`, `public-pages-own-key.test.ts`; integration `engine-credentials.test.ts`, `engine-key-maintenance.test.ts`, `own-key-translation.test.ts`, `editor-own-key.test.ts`, `own-key-consent.test.ts`, `own-key-auto-translate.test.ts`, `own-key-language-page.test.ts`, `own-key-pages.test.ts`, `own-key-plan-overview.test.ts`, `settings-own-keys.test.ts`; security `engine-credentials-security.test.ts`, `own-key-isolation.test.ts`, `credentials-structure.test.ts`; UI `tests/ui/own-keys.spec.ts`.

### 10.6 Docs

| File | Change |
|---|---|
| `docs/OWNER_DECISIONS.md` §3 | Replace the proposal with §1's table, marked "Decided 2026-10-30 (delegated by the owner)". Add the trial with its 100,000 allowance, the yearly rule, Free stays, and the Partner Dashboard steps (link here) |
| `docs/OWNER_DECISIONS.md` §2 and §4 | DeepL API Pro is no longer sold; buy **API Growth**: $32.50 a month including 1M characters, then $27.50 per million (€25 net plus €22 per million). §4's DeepL row: same; add cost control at €150 |
| `docs/COST_MODEL.md` §1 | DeepL row: Growth rates as in §4 (verify at purchase). Shopify row: 2.9% processing fee always, 15% after $1M lifetime, Regulatory Operating Fee 2–5% in UK / IT / ES / TR |
| `docs/COST_MODEL.md` §2 | Replace the table with §6.1, and add §6.2's sensitivity and §6.3's old-proposal row. Overage row: "$40 per 1M would earn 13.3%; not offered; the floor is $65.32, so $69 if ever" |
| `docs/BILLING_DESIGN.md` §2 | Prices $0 / $29 / $99 / $299. "Yearly option ≈ 2 months free" becomes "Starter and Pro: 10 × monthly; Business monthly only". Add the trial (7 days, 100,000) and "overage not at launch: Managed Pricing has no usage caps". **Also replace the outdated Features column with what the code enforces:** translation memory and SEO fields are in every plan; Starter adds bulk and automatic translation; Pro adds glossary editing and automatic publishing; Business adds the smart schedule. There is no "premium AI routing, analytics, priority queue". The ENTERPRISE private-plan row needs its handle mapped in `plans.ts` (§9 step 4). §1a: add `PLAN_PRICES` and the trial allowance rows. §4: the cost default note (27.5) |
| `docs/APP_STORE_LISTING.md` | New "Pricing details" section with §10.3's texts. "Still needed": pricing decided, entered by the owner |
| `docs/COMPETITIVE_ANALYSIS.md` §1 | Paid plans row: Linguva $29 / $99 / $299. Add Langwill, EA, Translingo and Deep Shop Translate to the "other apps" notes |
| `docs/SECURITY_MODEL.md` §5a | Production values of the daily and platform caps and the raise rule (§8) |
| `docs/FEATURE_STATUS.md`, `CHANGELOG.md` | The trial allowance and the prices on the Plan page (Implemented / Tested Locally) |

## 11. Risks

| # | Risk | What reduces it |
|---|---|---|
| 1 | DeepL's rate could change, or differ at checkout. The EUR prices and plan terms are now confirmed first-party (§4, §13.1). What remains open: whether €22.00 includes VAT, and the USD monthly $32.50, which is third-party only | The owner's EUR cost ($24.49 per million) is 11% below the model's $27.50. The owner confirms at checkout. If the rate is higher, change the margin guard's constant (§10.5) and revisit the prices |
| 2 | DeepL Growth's limit of 50M characters a month (confirmed) | Watch the monthly total; move to Enterprise from 40M (§8) |
| 3 | A trial used as a free first pass | 100,000 trial allowance (§10.2). Without it, trial = 0 days |
| 4 | A convinced merchant must wait up to 7 days for the full allowance | The Plan page says so. The owner can give one store a private plan without a trial; its handle must be mapped first (§9 step 4) |
| 5 | Price perception: LLM- and Google-based apps include from about 3× (Langwill) to about 40× (EA) more words per dollar. T Lab (5.0 from 1,037 reviews) even has bulk AI and a glossary in its Free plan (§7.2) | Position on DeepL quality, review before publishing and free memory reuse (§7.2). Watch install → paid conversion for 60 days. Later options: a cheaper second engine (AI_ENGINES.md) or "bring your own DeepL key" for large stores |
| 6 | Business ($299) is above every listed competitor plan, so few will choose it | It exists for large first passes. Merchants can step up for one month and back down. Review after 90 days |
| 7 | Yearly lock-in: a DeepL price rise can't reach yearly subscribers for up to 12 months; yearly Pro is 41.5% at full use (36.5–39.5% in countries with the fee) | Business has no yearly price. Real use after the first pass is far below 100%. Re-check yearly prices against DeepL every quarter |
| 8 | The Partner Dashboard, `PLAN_PRICES` and the listing drift apart, or the trial text stays after the trial is set to 0 days. App Review then rejects, or merchants are misled | Change all three on the same day (§9 step 8). The plan-prices test pins `PLAN_PRICES` and `TRIAL_DAYS`; the dev-store check compares them with Shopify's page (§9 step 5); the trial line needs `TRIAL_DAYS > 0` (§10.3) |
| 9 | Shopify fees: 2.9% always, 15% after $1M, 2–5% country fees, refunds still count toward the gross | All modelled in §6.2. Register for the 0% tier ($19) before the first sale |
| 10 | Daily cap friction: a Business first pass pauses three times at 1M a day | The smart schedule continues automatically. Optional automatic resume for bulk jobs (§8). The platform cap is raised by rule |
| 11 | Development stores: a paid plan marked free for partners would give Business away | Leave the option off on paid plans (§9 step 2) |
| 12 | Plan languages are the first N by English name; a paying merchant may find this arbitrary | Owner question 2 in SPEC-plan stays open. The page explains the rule. Letting merchants choose would raise perceived value at $29 |
| 13 | Usage-based overage has no merchant cap in Managed Pricing | Not offered at launch. If ever, at least $69 per extra million and only with an in-app cap |
| 14 | Taxes: VAT / sales tax on app sales for a German developer is not modelled. If the owner can't reclaim German VAT (Kleinunternehmer), DeepL's usage could cost €26.18 per million, and yearly Pro would fall to 39.1% at full use (§6.2) | Shopify charges tax separately. Confirm the reverse-charge handling, and whether DeepL's VAT is reclaimable, with the tax adviser before the first payout |
| 15 | Currency: DeepL bills in EUR, Shopify pays out in USD (the bank's conversion fee is not modelled) | The model uses DeepL's USD rate ($27.50), which stays conservative up to EUR/USD 1.25 (today 1.113) |
| 16 | Calendar month versus billing cycle: a first monthly cycle can get two allowances, and a yearly cycle 13 (§6.4) | Never a loss (Business 8.2% at worst). Watch the ledger for first cycles above 1.5 × the allowance. Counting per billing cycle is a possible later change |
| 17 | A private or renamed plan handle gets Free's limits (`entitlementsFor`) | Map every new handle in `app/lib/plans.ts` and deploy before creating the plan (§9 step 4) |

## 12. Sources (all seen 2026-10-30)

Competitors:

- Langify: https://apps.shopify.com/langify · https://lp.langify-app.com/en/pricing · https://support.langify-app.com/support/solutions/articles/11000128762-word-packages
- Transcy: https://apps.shopify.com/transcy-multiple-languages · https://transcy.io/pricing
- Weglot: https://apps.shopify.com/weglot · https://www.weglot.com/pricing
- LangShop: https://apps.shopify.com/langshop · https://langshop.io/pricing
- T Lab: https://apps.shopify.com/content-translation
- GTranslate: https://apps.shopify.com/multilingual-shop-by-gtranslate
- Translate & Adapt: https://apps.shopify.com/translate-and-adapt
- Langwill: https://apps.shopify.com/localiser
- EA AI Language Translate: https://apps.shopify.com/ea-auto-translate-language
- Translingo: https://apps.shopify.com/translingo
- Deep Shop Translate: https://apps.shopify.com/deep-shop-translate

DeepL and the exchange rate:

- https://www.deepl.com/en/pro-api: first-party. The visible table needs JavaScript; the price list embedded in the page was read for Germany (§13.1)
- https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans: first-party, read as https://support.deepl.com/api/v2/help_center/en-us/articles/360021200939.json
- https://support.deepl.com/hc/en-us/articles/360020685720-Usage-count-and-billing-in-DeepL-API: first-party, read as …/articles/360020685720.json
- https://support.deepl.com/hc/en-us/articles/360020685580-API-usage-and-cost-control: first-party, read as …/articles/360020685580.json
- https://developers.deepl.com/api-reference/translate (`context` isn't billed)
- https://aws.amazon.com/marketplace/pp/prodview-2fii5e2hmuneo (seller DeepL)
- https://flexprice.io/pricing-index/deepl-translator (capture of deepl.com/en/pro, 2026-09-22)
- https://www.eesel.ai/blog/deepl-pricing (edited 2026-06-05)
- https://developers.deepl.com/docs/resources/release-notes
- ECB: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml (rate of 2026-10-29)

Shopify:

- https://shopify.dev/docs/apps/launch/distribution/revenue-share
- https://help.shopify.com/partners/getting-started/sales-taxes
- https://shopify.dev/docs/apps/launch/billing/managed-pricing
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-subscription-charges
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials
- https://shopify.dev/changelog/new-planhandle-field-managed-pricing
- https://community.shopify.dev/t/app-pricing-update-more-plans-no-charge-plan-testing-and-expanded-app-events/35932
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://community.shopify.com/t/app-review-confused-about-pricing-details-in-listing/15404
- https://community.shopify.dev/t/need-clarification-clarification-on-listing-add-on-pricing-vs-all-plans-in-shopify-app-store/20919 (search excerpt; rate-limited)
- https://community.shopify.dev/t/updated-app-review-process-with-shopify-app-pricing/34444 (App Review and plan switching; staff reply 2026-07-12)
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCancel (prorated credit only when asked for)

Repository (HEAD `f4761e7`):

- Code: `app/lib/plans.ts`, `app/.server/billing/{billing,subscription,partner-api,complimentary}.ts`, `app/.server/lib/config.ts`, `app/.server/usage/usage-ledger.ts`, `app/.server/jobs/{processors,auto-translate,auto-sweep}.ts`, `app/.server/providers/deepl.ts`, `app/.server/smart/validate.ts`, `app/.server/translation/{resource-editor,resource-list,translation-context}.ts`, `app/routes/{app.glossary,app.welcome,app.plan}.tsx`, `app/i18n/i18n.ts`, `worker/index.ts`
- Tests: `tests/ui/app-store-screenshots.spec.ts`, `tests/integration/complimentary.test.ts`, `scripts/ops/complimentary.ts`, `.env.example`
- Docs: `docs/{OWNER_DECISIONS,COST_MODEL,BILLING_DESIGN,COMPETITIVE_ANALYSIS,APP_STORE_LISTING,SECURITY_MODEL}.md`, `docs/research/competitors-raw.md`
- Design (outside the repository): SPEC-plan (with Appendix C), `design/work-v2/tarif_data_v2.py`

## 13. Verification

A second, independent check on 2026-10-30, made before the prices go into the app. It was adversarial: it re-opened the sources and recomputed every figure. Research only: no sign-ups, purchases, Shopify changes or repository changes.

**Result: the decision stands, and the status is now final.**

- Prices: $0 / $29 / $99 / $299.
- Yearly: $290 and $990; Business monthly only.
- Trial: 7 days, limited to 100,000 AI characters (0 days until that limit ships).
- Free stays, and the allowances are unchanged.

The corrections concern evidence, figures, wording and the display rules (§13.5), not prices.

### 13.1 Sources re-opened

| Source | What it says now | Effect |
|---|---|---|
| deepl.com/en/pro-api. The visible table needs JavaScript, so the price list embedded in the page was read; the page saw the visitor as Germany (`userCountry` DE) | `api-growth`: €29.75 a month, €285.60 a year (20% saving), "VAT is included in the price"; €22.00 per 1,000,000 characters. The API offers listed are only Developer, Growth and Enterprise API | EUR prices **confirmed first-party** (they were a third-party capture) |
| support.deepl.com "DeepL API plans", updated 2026-10-29. The HTML page answers automated browsers with a challenge, so the help center's JSON API was read instead | API Free and API Pro "can no longer be purchased"; Developer 1M characters in total; Growth has cost control, key limits, and monthly usage limits of 50 million characters | **Confirmed first-party** (it was a search excerpt) |
| support.deepl.com "Usage count and billing in DeepL API", edited 2026-04-23 | Growth monthly includes 1 million characters, yearly 12 million; usage above is charged at the pricing page's rate; tags aren't billed with `tag_handling` xml | 1M included **confirmed**; tags not billed (new) |
| support.deepl.com "API usage and cost control"; DeepL pricing texts | The limit stops all requests until the end of the billing period; the pricing page calls it a limit on "usage-based costs" | §8 cost-control figure corrected |
| developers.deepl.com `/v2/translate` | "Characters included in the context parameter will not be counted toward billing" | Added to §3.1 |
| AWS Marketplace, seller DeepL | Growth $312 for 12 months incl. 12M characters; $27.5 per extra million; Enterprise $15,000 incl. 600M | Confirmed. USD monthly $32.50 stays third-party only |
| ECB daily rates | 1.113 on 2026-10-29 | Confirmed |
| shopify.dev revenue share | Quoted word for word: first $1,000,000 lifetime at 0% (from 2025-01-01), then 15%; $19 registration; gross, refunds not considered; "All billing is subject to a 2.9% processing fee" | Confirmed; 17.9% worst case stands |
| help.shopify.com Regulatory Operating Fee | UK 2%, Italy 3%, Spain 3%, Türkiye 5% on public app sales, by merchant address | Confirmed |
| shopify.dev managed pricing | 8 public plans, unlimited private; trial per plan; "Merchants can always toggle between monthly and yearly prices"; USD only, converted for other billing currencies; dev-store rules; usage caps not supported | Confirmed; the conversion sentence was added to §5.1 |
| shopify.dev plan editor (setup-subscription-charges) | Billing options free / monthly / yearly / monthly with a yearly option; trial days; "Free for partners and developers"; a plan shows only with a description in the merchant's language; a downgrade to free waits until the end of the cycle | Confirmed. A monthly-only Business next to monthly-with-yearly plans is allowed |
| shopify.dev free trials | 180-day tracking; changed trials subtract used days; extension up to 60 days; no discount during a trial; nothing on plan switches | Confirmed. In-app wording is now "up to 7 days" |
| shopify.dev changelog 2025-04-01 | Own plan handles, stable across edits; nothing on renaming | Confirmed |
| App Store requirements | 1.2, 1.2.3, 4.2.1–4.2.3, 4.3.3 as quoted. No rule on usage limits during a trial, on badges, or on in-app prices matching the listing | Confirmed. The trial cap is allowed if disclosed |
| Developer forum: App Review and App Pricing | Reviewers' plan switching was fixed (Shopify staff, 2026-07-12) | New: the "Free for partners" option stays off (§9) |
| Competitors | Langify (listing, pricing page, word packages), Transcy (listing and website, incl. Global $599), Weglot (listing and website, incl. Advanced $329, "does not renew"), LangShop website ($120 / $250 / $500, yearly 10×), T Lab listing | All prices and allowances as written. New: T Lab's Free plan has bulk AI and a glossary |

**Not re-opened:**

- Competitors: GTranslate, Translate & Adapt, Langwill, EA, Translingo, Deep Shop Translate, and the LangShop listing.
- DeepL: the flexprice and eesel captures, and the release notes.
- Shopify community: the 2026-07-09 pricing post (rate-limited) and the two older App Review threads.

### 13.2 Figures recomputed

Every figure in §1, §3, §6, §7.2 and §8 was recomputed from the inputs, with Shopify at 17.9%, DeepL at $27.50 per million and a fixed $0.50 per shop:

- floors, monthly and yearly margins, every sensitivity row and the old proposal;
- overage, price per million and plan steps;
- trial and cap exposure, the Langify and T Lab comparisons, and the platform-cap example.

All match, except:

- **Pro yearly floor:** $95.49, not $95.48 (33.50 ÷ 0.421 × 1.2).
- **Sensitivity summary:** it said only yearly Pro falls below 40%. Yearly Starter also does, under the harsh $3.25 fixed share (34.5%).
- **Platform cap:** "Three Business first passes with room for everyone else" was wrong. Three stores at the 1M daily cap use the whole 3M.
- **Cost control:** €150 buys about 7.8M characters if it limits usage-based costs only, as DeepL's page says (it was 6.7M).

New rows:

- VAT that can't be reclaimed: yearly Pro 39.1% (§6.2).
- The owner's real EUR cost: every margin 3.7–4.6 points higher (§6.2).
- Calendar month versus billing cycle (§6.4).

The plan steps check out: price ×3.41 and ×3.02 for characters ×4 and ×3.33. The price per million falls from $96.67 to $82.50 to $74.75. Each step adds languages and a feature.

### 13.3 Consistency with the app (HEAD `f4761e7`)

- **Entitlements:** `PLANS` equals `pricing.json`: 20k/1, 300k/3/bulk, 1.2M/10/bulk + glossary + auto-publish, 4M/20/+ smart. Each feature named in §1 and in the listing texts is enforced in the code:
  - bulk: `app/.server/translation/resource-list.ts:101`, `app/.server/jobs/processors.ts:308`
  - automatic translation of new content, gated by bulk: `app/.server/jobs/auto-translate.ts:218`
  - glossary editing: `app/routes/app.glossary.tsx:68`. Glossary rules that already exist apply on every plan.
  - auto-publish, which holds back results with warnings: `app/.server/jobs/processors.ts:400–407`
  - smart schedule: `app/.server/jobs/processors.ts:307`
  - languages: `allowedTargetLocales`
- **Limits:**
  - The monthly allowance is per UTC calendar month (`periodKey`), so §6.4 was added.
  - The daily cap is min(`AI_DAILY_CHAR_LIMIT`, allowance) on pages (`app/.server/billing/billing.ts:40`) and in the worker (`app/.server/jobs/processors.ts:363`; the worker passes the raw env value).
  - The platform default is 100,000 (`app/.server/lib/config.ts:78`) and the cost default 25 (`app/.server/lib/config.ts:107`). The atomic platform counter is in `app/.server/usage/usage-ledger.ts:66–73`.
- **Trial:** today a Shopify trial gets the full plan allowance; `trialEndsAt` is cached but unused. So the 100,000 trial allowance is a required code change (§10.2), and without it the trial is 0 days. The note on the 6-hour cache was corrected, and the Smart-budget side effect was added.
- **Handles:** unknown handles get Free (`entitlementsFor`). A private yearly Business plan therefore needs a mapping in code first; added to §3.3, §9 and §11.
- **Code references:** every line reference cited in §3.1, §8 and §10 was opened and is correct. `tests/integration/complimentary.test.ts:181` and `scripts/ops/complimentary.ts:66` use 25 as written.
- **Wrong claim fixed:** `tests/ui/plan.spec.ts` does not exist yet; the Tarif work creates it.

### 13.4 Display in the app

- **Prices** come only from `PLAN_PRICES`, `TRIAL_DAYS` and `TRIAL_AI_CHARS`, which are kept by hand and must equal the Partner Dashboard. A pinning test and a dev-store comparison were added.
- **Formatting** was checked on Node 22.22 (ICU 77.1): `$29` / `29 $` / `29 $US` / `29 US$` with U+00A0. The formatter now sets both fraction digits.
- **No "popular" claims:** none in this decision. The Tarif v1 rule "no empfohlen/beliebt badge" stays. A v2 suggestion is allowed only from the store's own data. A test guards the badge words.
- **Trial text:** it is shown only if `TRIAL_DAYS > 0`, the trial allowance is live, and the store has no paid subscription. It says "up to 7 days", and during a trial the hero shows the real end date.
- **Yearly:** there is no switch, because Business has no yearly price. The Tarif v2 placeholders ($19 / $59 / $179, a yearly price on every plan, 14 days) must be replaced (§10.3).
- **Listing images:** none of the App Store screenshots shows a price. They must stay that way.
- **Listing texts:** every top feature is 69 characters or fewer.

### 13.5 What changed

In `PRICING_DECISION.md`:

- **Status and §1:** the status is final. The trial needs the code change. A private plan needs a handle mapping. Pointers to the display rules and the corner cases were added.
- **§2–§4:** the DeepL evidence is now first-party (EUR prices, the end of API Pro, 1M included, the 50M limit, tags and `context` not billed). VAT and Kleinunternehmer were added to §4. The Pro yearly floor is now $95.49.
- **§3.3–§3.4:** the private-plan mapping; the yearly Business revisit at EUR cost (42.7%); trial wording and its legality.
- **§5:** downgrade timing, uninstall without refund, App Review access, and the exact screenshot finding.
- **§6:** the sensitivity summary is corrected, with VAT and EUR rows added. §6.4 on calendar month versus billing cycle is new.
- **§7:** the re-checked rows are marked, and T Lab's Free bulk AI is added with the volume comparison. The plan-change advice is now precise.
- **§8:** the platform-cap description, the cost-control figure and a sizing rule.
- **§9:** App Review needs no "Free for partners"; a private plan needs a mapping; the dev-store step compares in-app prices.
- **§10:** the `TRIAL_DAYS` rule; the cache note and the Smart-budget side effect; nine binding display rules; Intl options; fr/es formats; trial copy "up to 7 days"; the v2 placeholders to replace; the planned `plan.spec.ts`; the pinning and formatting tests; BILLING_DESIGN §2's outdated Features column.
- **§11:** risk 1 is updated. Risks 2, 4, 5, 8, 14 and 15 are sharpened. Risks 16 (calendar month versus cycle) and 17 (handles) are new.
- **§12:** the first-party DeepL URLs, the App Review thread, `appSubscriptionCancel`, and the repository files checked.
- **§13:** this section.

In `pricing.json`:

- `status` is now `final`, with `finalizedOn` and `effective` added.
- New objects: `trial`, `pricePerMillionCharsUsd`, `display` and `verification`.
- Yearly margins and their basis are added to `marginsAtFullUse`.
- `dailyCaps.perShopDailyRule` now covers the platform-cap wording and calendar months.
- The private-plan mapping is added to the `yearly` rule.
- Three first-party DeepL sources and the DeepL API reference are new; the old search-excerpt entries are replaced. The App Review thread is new.
- `rechecked` flags show which sources were re-opened.

Prices, allowances, the trial length and the yearly rule are unchanged.
