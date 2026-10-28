# Competitive analysis: Linguva vs Langify and Transcy

Status: 2026-10-28. Competitor facts come from their public App Store listings, help centers and reviews, read on 2026-10-28; every fact, quote and source URL is in [research/competitors-raw.md](research/competitors-raw.md) (section numbers below as §). Linguva's column uses the statuses of [FEATURE_STATUS.md](FEATURE_STATUS.md): **everything in Linguva is Tested Locally only; nothing is Verified on Shopify yet**, and Linguva has no reviews, no install base and no "Built for Shopify" badge. Competitor features were read, not tested.

## 1. The market in one table

| | Langify | Transcy | Linguva (today) |
|---|---|---|---|
| Rating and reviews | 4.7 from 728 (§1.1) | 4.5 from 2,565, Built for Shopify (§2.1) | None (not launched) |
| Since | 2014 | 2020 | — |
| Paid plans (monthly) | $17.50, $29.95, $59.95 (§1.2) | $29, $69, $99 on the listing; $14.9 and $599 more on the website (§2.2) | Proposal: $19, $59, $179 (COST_MODEL.md; owner decision) |
| What AI use costs | Words included **once** at sign-up (10k / 50k / 200k), then packages of $0.29–0.50 per 1,000 words (§1.3) | Token wallet, about $1.20 per 1,000 words, non-refundable; product caps and monthly add-on quotas (§2.3) | Monthly character allowance per plan (300k / 1.2M / 4M), resets each month; text reused from translation memory is free |
| Engines | DeepL, Google fallback (§1.4) | OpenAI, DeepL, Gemini, Google and more; own API key (§2.4) | DeepL only; languages it covers are read from DeepL and shown per language; second engine planned (AI_ENGINES.md) |
| Automatic translation of new/changed content | **Not offered** ("will not automatically translate your store without your input", §1.4) | Rules capped by plan (10 products + 10 collections on Regional; real-time only at $99+) (§2.3, §2.4) | Products and collections by webhook; pages, blog posts, blogs and missed webhooks by a 30-minute check; **no item cap**; results wait in Review by default |
| Review / approval before publishing | Not found (§1.7) | Not found (§2.7) | **Yes**: drafts, Review page with filters and search, approve or reject; automatic publishing only after an explicit, recorded confirmation |
| Translation memory | Not found | Not found (version history only) | **Yes**, exact reuse at no cost plus fuzzy suggestions |
| Glossary | Open beta; 3 / 50 / 100 entries; not applied to existing translations (§1.4) | 20 / 200 / 500 rules; a review reports rules ignored (§2.4, §2.6) | Never translate / always translate as / never use; CSV import and export; plan-gated, no entry cap |
| Protection of human translations | Not described | "Lock translations" (§2.4) | Translations written or approved by a person are never replaced without permission; a translation written meanwhile is never overwritten (tested) |
| History and undo | Not found | 1–10 versions by plan | Revisions with restore and remove for every field |
| Image alt text | Image swap per language, breaks when the image changes (§1.4) | **Not supported** (§2.4) | **Yes**: product, collection and blog post images, in the editor and bulk |
| Custom fields (metafields) | Yes, not in bulk (§1.4) | Yes | Text, rich text, lists and links, structure and link addresses enforced; in the editor and bulk |
| Content types | Broad, plus Custom Content and third-party apps | Broad, plus third-party apps, checkout | All 30 of Shopify's translatable types (menus, theme, policies, notifications, checkout methods, …); **no third-party app content** |
| SEO | Translated handles; hreflang left to Shopify (§1.4) | Same; reviews report hreflang conflicts and ranking drops (§2.6 #5) | SEO title/description checks and preview, "SEO fields only" jobs, coverage report; uses Shopify's native translations only (no client-side rendering), so Shopify's hreflang applies |
| Import / export of translations | CSV/PO per section (§1.4) | **Not supported** (§2.4) | CSV per content type and language; imports become drafts on Review, rows with a changed original are refused (Tested locally) |
| Storefront switcher, currency, geo redirect | Switcher, currency, browser-language redirect (§1.4) | Switcher, 168 currencies, geo redirect (§2.4) | **None** (relies on Shopify's own language selector and Markets) |
| AI image text translation | No | Yes, one image at a time (§2.4) | No |
| App interface languages | 5 (§1.1) | 13 (§2.1) | 4 (EN, DE; FR and ES awaiting native review) |
| Privacy | Website policy only; DeepL/Google not named (§1.5) | Collects visitor IP/geo and 60 days of orders; providers not named (§2.1, §2.5) | No customer or order scopes (ADR-007); store text goes to DeepL only after the merchant's consent; data deleted on uninstall/redact |

## 2. What merchants complain about, and how Linguva answers it

Complaint themes come from the newest reviews of each app (§1.6, §2.6). Counts are small samples, not market statistics.

| Complaint (competitor) | Linguva's answer | Evidence in Linguva | Honest limit |
|---|---|---|---|
| Automatic translation doesn't happen or is capped (Langify §1.6 #6; Transcy §2.6 #4, the newest review on 2026-10-27) | Automatic translation without an item cap, plus a periodic check that catches missed webhooks and covers pages and blog posts | `tests/integration/auto-translate.test.ts`, `auto-sweep.test.ts` | Webhook delivery not yet seen on a real store |
| Billing surprises: tokens, forced plan changes, charges after uninstall (Transcy §2.6 #1, 9–10 of 17 negative reviews with text; Langify §1.6 #3) | A plain monthly allowance; Shopify's own billing (no wallet); memory reuse costs nothing; daily and monthly caps so a large job can't surprise | `tests/integration/billing.test.ts`, `usage-ledger.test.ts`, `ai-limits.test.ts` | Prices not set; Shopify bills, so cancellation rules are Shopify's |
| Untrustworthy machine translation, also on legal pages (Langify §1.6 #1; Transcy §2.6 #6) | Drafts first, quality checks (numbers, glossary, length, script, form of address), legal pages and Liquid templates flagged for care | `tests/unit/validate.test.ts`, `formality-check.test.ts`, content-type caution notes | DeepL quality not measured yet (no key) |
| SEO damage, changed links, leftover code (Transcy §2.6 #5) | Only Shopify's native translations API; no storefront script, nothing to leave behind; handle changes need confirmation | `tests/security/structure.test.ts` (only two write paths), handle tests | Storefront output not verified on a store |
| Slow at scale (Langify §1.6 #5; Transcy §2.6 #3) | Paged bulk jobs, fair queue between stores, Review and memory search indexed | PERFORMANCE.md (50,000 drafts, 5,000 products, 20 shops at once) | Real Shopify latency not measured |
| Glossary weak or ignored (both) | Terms enforced with codes the AI can't change; "never use" blocks the result | `tests/unit/glossary.test.ts`, `tests/integration/memory-glossary.test.ts` | — |
| Alt text not translated (Transcy) | Alt text in editor, bulk and coverage | `tests/integration/attached-resources.test.ts`, `bulk-attached.test.ts` | Nested collection/blog images unconfirmed live |
| Third-party apps and page builders not translated (Langify §1.6 #4) | **Not answered**: Linguva translates Shopify's translatable content only | — | A real gap (see §4) |

## 3. Where Linguva can win (positioning)

**"Professional translation workflow for Shopify, with safe automation and predictable cost."**

1. **Safe automation.** The only one of the three that combines automatic translation of new content with review before publishing and protection of human translations. Competitors offer either no automation (Langify) or automation without review (Transcy).
2. **Predictable monthly cost.** A monthly allowance that resets, memory reuse at no cost, caps per day and month. Competitors' biggest complaint theme is billing.
3. **Workflow depth.** Translation memory, glossary with enforcement, history and restore, Review queue, job reports. Neither competitor documents memory or review (only Weglot advertises review and collaboration, §3).
4. **Coverage of the details.** Alt text, rich-text, list and link custom fields with structure enforced, all 30 Shopify content types, SEO checks.
5. **Privacy.** No customer or order data requested; one named AI processor (DeepL).

**Target merchant first:** stores with 50–5,000 products in 2–10 languages, a German- or English-speaking team, which care about brand terms, legal correctness and SEO (DACH and EU cross-border stores). These are the merchants hurt most by unreviewed machine translation and by surprise bills.

## 4. Gaps to close, by effect on winning merchants

| # | Gap | Why it matters | Effort | Needs |
|---|---|---|---|---|
| 1 | Verified on a real store (all of the above) | Without it nothing can be claimed in the listing | Days | Store connected 2026-10-28; checks in DEV_STORE_VERIFICATION.md |
| 2 | Real DeepL quality and cost measured | Quality is the product | Days | Free DeepL API key (owner) |
| 3 | ~~Import/export of translations (CSV)~~ Done in phase I (CSV; XLIFF later) | Agencies and translators; Transcy has none, Langify per section only | — | Live check on the dev store |
| 4 | Second engine for languages DeepL lacks (and optional LLM) | DeepL covers about 30 languages; both competitors fall back to Google or LLMs | 1–2 weeks | Provider account and data processing terms (owner) |
| 5 | Third-party app and page-builder content | Most common "not translated" complaint for Langify | Large; partly impossible through Shopify's API | Research |
| 6 | Storefront language/country selector as a theme app extension | Merchants expect it; Shopify's own selector exists in most themes. Strategy: rely on it (STOREFRONT_LANGUAGE_SELECTOR.md) | 1 week, only if beta merchants need it | Dev store |
| 7 | Interface in more languages; native review of FR/ES | Transcy has 13 | Ongoing | Native speakers |
| 8 | Visual in-context editor | Nice to have; neither competitor has one documented | Large | — |

Not planned: currency conversion and geo redirects (Shopify Markets does this natively; adding it means customer data and storefront scripts, which Linguva avoids on purpose).

## 5. How to read this

- Competitor plan facts change often and their own sources disagree (§1.2, §2.2, §2.7). Re-read before quoting.
- App Store rules forbid comparisons, statistics and "the best/first/only" in the listing (App Store requirement 4.3.3). This analysis is internal; the listing (APP_STORE_LISTING.md) states Linguva's own features only.
