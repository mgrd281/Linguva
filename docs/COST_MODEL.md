# Cost Model

Status: **Phase 0 — assumptions only.** Every provider price below is an **unverified assumption** and must be checked against current official pricing pages before any plan is published.

## 1. Inputs (to verify)

| Variable | Assumed value | Status |
|---|---|---|
| DeepL API Pro, per 1M characters | ≈ $25 (€20) + monthly base fee | ASSUMPTION |
| Premium LLM, per 1M source characters (input + output tokens, incl. prompt overhead) | $5–$40 depending on model | ASSUMPTION — benchmark in Phase 3 |
| Shopify revenue share | 0% on the first $1M lifetime, then 15% (registration conditions apply) | ASSUMPTION — verify current Partner terms |
| Infra (Railway web + worker + Postgres + Redis), staging+prod | $60–$150/month at launch | ASSUMPTION |
| Average characters per product (title + body + SEO + options) | ~2,000 | ASSUMPTION — measure on dev-store fixtures |
| Translation memory hit rate after first full pass | 20–40% for repeated specs/boilerplate | ASSUMPTION |

## 2. Unit economics per plan (100% utilization, DeepL-only worst case)

| Plan | Price | Chars | Provider cost @ $25/1M | Gross margin before infra |
|---|---|---|---|---|
| STARTER | $19 | 300k | $7.50 | ~61% |
| PRO | $59 | 1.2M | $30.00 | ~49% |
| BUSINESS | $179 | 4M | $100.00 | ~44% |
| Overage | $40/1M | — | $25.00 | ~37% |

- Real utilization is usually well below 100%, and TM hits aren't billed by the provider either, so the expected margin is higher.
- Premium LLM routing must be cost-capped per plan (BUSINESS only by default) so the margin never goes negative.
- Example scenario: 1,000 products × 2,000 chars × 5 languages = **10M characters ≈ $250 provider cost** for a first full pass. This is above every self-serve plan, so a large first pass must use overage or ENTERPRISE, and the UI must show an estimate before starting.

## 2a. Measured in phase I (local, no provider calls)

| Measure | Value | How |
|---|---|---|
| Characters sent to the AI per product, fictional demo catalog (title, HTML description, SEO title, meta description; markup and protected terms not counted) | **209** on average (8 products, 1,669 characters) | `prepareTranslation` on `tests/ui/fixtures/demo-store.ts` |
| Same products, raw source length | 223 | Sum of field lengths |
| Billed characters from DeepL, quality per language | **Not measured**: no DeepL key in this environment | `pnpm test:deepl` with a local key writes docs/quality/DEEPL_MEASUREMENT.md |
| DeepL API price per character | **Not verified**: deepl.com shows API prices only with JavaScript | Owner checks at sign-up |

What this means for the plan proposal (DeepL Pro assumed at $25 per million characters):

| Catalog type | Characters per product and language | Products per language in STARTER (300k) | Provider cost per 1,000 products and language |
|---|---|---|---|
| Short texts (like the demo catalog) | ~210 | ~1,400 | ~$5 |
| Typical descriptions (assumption above) | ~2,000 | ~150 | ~$50 |

**Recommendation:** don't publish prices until the characters per product are measured on a realistic catalog on the development store (bulk job reports already record characters per job) and DeepL's current price is confirmed. The margins in §2 hold at any catalog size because allowances are in characters, not products; what changes is how many products a plan covers, which decides whether STARTER feels generous. Translation memory and the "only missing and outdated fields" rule reduce repeat costs; first full passes of large catalogs need the cost estimate shown before every bulk job (implemented).

## 3. Guardrails

- Per-shop monthly cost cap (`Entitlement.costCapMicros`) and a global daily provider spend alert.
- Cost estimate is shown and confirmed before every bulk job.
- `ProviderUsage` feeds a per-shop gross margin view in the admin center.
