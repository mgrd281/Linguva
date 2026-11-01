# Cost Model

Status: **prices decided on 2026-10-30** ([PRICING_DECISION.md](PRICING_DECISION.md)). The DeepL and Shopify rows were read on that date from first-party sources where possible (PRICING_DECISION.md §4, §5, §12); the owner confirms DeepL's rate at purchase. Rows marked ASSUMPTION are still unverified.

## 1. Inputs (to verify)

| Variable | Assumed value | Status |
|---|---|---|
| DeepL API Growth (API Pro can no longer be bought) | $32.50 a month including 1M characters, then **$27.50 per 1M** (Germany: €25.00 net a month, €22.00 per extra 1M). Usage limit 50M characters a month; Enterprise $25 per 1M | Read 2026-10-30 (PRICING_DECISION.md §4); verify at purchase |
| Premium LLM, per 1M source characters (input + output tokens, incl. prompt overhead) | $5–$40 depending on model | ASSUMPTION — benchmark in Phase 3 |
| Shopify fees | **2.9% processing fee on all app billing, always**; revenue share 0% on the first $1M lifetime gross (one-time $19 registration), then 15%; Regulatory Operating Fee 2% UK, 3% Italy and Spain, 5% Türkiye (by the merchant's address). The model uses 15% + 2.9% = 17.9% | Read 2026-10-30 (PRICING_DECISION.md §5.2) |
| Infra (Railway web + worker + Postgres + Redis), staging+prod | $60–$150/month at launch | ASSUMPTION |
| Average characters per product (title + body + SEO + options) | ~2,000 | ASSUMPTION — measure on dev-store fixtures |
| Translation memory hit rate after first full pass | 20–40% for repeated specs/boilerplate | ASSUMPTION |

## 2. Unit economics per plan (100% utilization, worst case)

Shopify takes 17.9% (15% + 2.9%), DeepL costs $27.50 per 1M characters, and each shop carries a fixed $0.50 (DeepL Growth's base fee above its included characters, spread over 10 shops). Margin = (price × 0.821 − DeepL − fixed share) ÷ price, before hosting (PRICING_DECISION.md §6.1). `tests/unit/plan-prices.test.ts` fails if a price or an allowance would fall below 40%.

| Plan | Price | After Shopify (× 0.821) | DeepL at full use | Fixed share | Profit | Margin |
|---|---|---|---|---|---|---|
| Starter, monthly | $29.00 | $23.81 | 300,000 × $27.50/1M = $8.25 | $0.50 | $15.06 | **51.9%** |
| Starter, yearly ($290 ÷ 12) | $24.17 | $19.84 | $8.25 | $0.50 | $11.09 | **45.9%** |
| Pro, monthly | $99.00 | $81.28 | 1,200,000 × $27.50/1M = $33.00 | $0.50 | $47.78 | **48.3%** |
| Pro, yearly ($990 ÷ 12) | $82.50 | $67.73 | $33.00 | $0.50 | $34.23 | **41.5%** |
| Business, monthly | $299.00 | $245.48 | 4,000,000 × $27.50/1M = $110.00 | $0.50 | $134.98 | **45.1%** |
| Free | $0 | — | 20,000 × $27.50/1M = $0.55 | — | −$0.55 | — |
| Overage | not offered | — | $27.50 per 1M | — | — | $40 per 1M would earn 13.3%; the floor is $65.32, so $69 if ever |

Sensitivity (each cell: the monthly price, then the yearly price ÷ 12; PRICING_DECISION.md §6.2):

| Shopify takes | Starter | Pro | Business |
|---|---|---|---|
| 2.9% (under the $1M threshold, the real case at launch) | 66.9% / 60.9% | 63.3% / 56.5% | 60.1% |
| 15% only | 54.8% / 48.8% | 51.2% / 44.4% | 48.0% |
| **15% + 2.9% (used above)** | **51.9% / 45.9%** | **48.3% / 41.5%** | **45.1%** |
| + UK fee 2% | 49.9% / 43.9% | 46.3% / 39.5% | 43.1% |
| + Italy or Spain fee 3% | 48.9% / 42.9% | 45.3% / 38.5% | 42.1% |
| + Türkiye fee 5% | 46.9% / 40.9% | 43.3% / 36.5% | 40.1% |
| Fixed share $3.25 instead of $0.50 (the whole Growth fee on 10 shops) | 42.4% / 34.5% | 45.5% / 38.2% | 44.2% |
| DeepL €26.18 = $29.14 per million (€22.00 plus 19% VAT that can't be reclaimed) | 50.2% / 43.9% | 46.3% / 39.1% | 43.0% |
| The owner's real EUR cost (€22.00 = $24.49 per million, fixed share $0.33) | 55.6% / 50.3% | 52.1% / 46.1% | 49.2% |

- Every monthly price stays at or above 40% in every row; only yearly prices fall below it, and only in these corner cases at full use for twelve months.
- The old proposal under today's costs: Starter $19 → 36.0%, Pro $59 → 25.3%, Business $179 → 20.4% (all below the 40% floor, PRICING_DECISION.md §6.3).
- One billing cycle can touch two calendar months (the allowance renews on the 1st, UTC): a first monthly cycle can get two allowances, a yearly cycle 13. No case loses money (PRICING_DECISION.md §6.4).

- Real utilization is usually well below 100%, and TM hits aren't billed by the provider either, so the expected margin is higher.
- Premium LLM routing must be cost-capped per plan (BUSINESS only by default) so the margin never goes negative.
- Example scenario: 1,000 products × 2,000 chars × 5 languages = **10M characters ≈ $275 provider cost** for a first full pass. This is above every plan's monthly allowance and there is no overage, so a large first pass spreads over months, takes a bigger plan for that month (switching down afterwards), or a private plan; the UI shows an estimate before starting.

## 2a. Measured in phase I (local, no provider calls)

| Measure | Value | How |
|---|---|---|
| Characters sent to the AI per product, fictional demo catalog (title, HTML description, SEO title, meta description; markup and protected terms not counted) | **209** on average (8 products, 1,669 characters) | `prepareTranslation` on `tests/ui/fixtures/demo-store.ts` |
| Same products, raw source length | 223 | Sum of field lengths |
| Billed characters from DeepL, quality per language | **Not measured**: no DeepL key in this environment | `pnpm test:deepl` with a local key writes docs/quality/DEEPL_MEASUREMENT.md |
| DeepL API price per character | **Not verified**: deepl.com shows API prices only with JavaScript | Owner checks at sign-up |

What this means for the plans (DeepL API Growth at $27.50 per million characters):

| Catalog type | Characters per product and language | Products per language in STARTER (300k) | Provider cost per 1,000 products and language |
|---|---|---|---|
| Short texts (like the demo catalog) | ~210 | ~1,400 | ~$6 |
| Typical descriptions (assumption above) | ~2,000 | ~150 | ~$55 |

**Recommendation:** the prices are decided with the allowances unchanged (PRICING_DECISION.md). Still measure the characters per product on a realistic catalog on the development store (bulk job reports already record characters per job), and confirm DeepL's rate at purchase; if it is higher, change the margin guard's constant in `tests/unit/plan-prices.test.ts` and revisit the prices. The margins in §2 hold at any catalog size because allowances are in characters, not products; what changes is how many products a plan covers, which decides whether STARTER feels generous. Translation memory and the "only missing and outdated fields" rule reduce repeat costs; first full passes of large catalogs need the cost estimate shown before every bulk job (implemented).

## 3. Guardrails

- Per-shop monthly cost cap (`Entitlement.costCapMicros`) and a global daily provider spend alert.
- Cost estimate is shown and confirmed before every bulk job.
- `ProviderUsage` feeds a per-shop gross margin view in the admin center.

## 4. Further engines (Microsoft Azure, Google Cloud)

Set up only after the owner's decision (docs/AI_ENGINES.md). DeepL stays first, so with DeepL configured the other engines translate only what DeepL can't (a language it doesn't offer, its limit used up, an outage).

| Engine | Rate used in estimates | Variable | What the engine bills |
|---|---|---|---|
| DeepL | 27.5 USD per million (Growth, production) | `AI_COST_USD_PER_MILLION_CHARS` (also the rate of ledger rows without an engine) | `billed_characters`; tags and context not billed |
| Microsoft Azure Translator S1 | 10 USD per million (list price; F0: 2,000,000 free a month, a hard cap) | `AI_COST_USD_PER_MILLION_CHARS_AZURE` | every code point of each text, markup included, surrogate pairs count 2 |
| Google Cloud Translation (NMT) | 20 USD per million after the free 500,000 a month | `AI_COST_USD_PER_MILLION_CHARS_GOOGLE` | every code point, markup included; an empty query counts 1 |

- **What the shop is counted is the same whatever engine answers:** DeepL's number, or for Azure and Google the text without inline codes. The estimate (ledger characters × the engine's rate, `estimatedCostByProvider` in `app/lib/plans.ts`, per engine in `pnpm ops:complimentary report`) therefore **doesn't include the markup Azure and Google bill** (`<span id="lg1">…</span>` = 22 characters per formatting code, `<img id="lx1"/>` = 15): typically a few percent on rich text.
- **Failover partials:** when an engine billed earlier batches and then failed (quota, outage), and another engine translated the request, the shop is charged only the answering engine's count; the failed engine's partial is counted in the platform counter (`PlatformUsageDay`) only, not in a shop's cost or allowance. A request where every engine failed charges the shop at most its reservation.
- **Not metered at all** (DeepL today too): a timeout or 5xx that the engine had already processed, then retried (3 retries), is billed by the engine again on each attempt.
- The Plan page's internal rate for the owner's complimentary stores is the month's effective rate: exactly DeepL's while only DeepL translated, else the blend of the engines' rates.
