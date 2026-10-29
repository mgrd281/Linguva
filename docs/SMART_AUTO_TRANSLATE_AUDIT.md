# Smart Auto-Translate: what existed, what is new

Audit of the specification "Premium Smart Auto-Translate 10/10" against the code before this work (2026-10-29, base `42a487d`), and what each requirement is now. Status before: **verified** (worked, with a test), **partial**, **missing** or **defective** (a test or a reproduction showed a bug). Every "now" is **tested locally** only: real PostgreSQL (row-level security) and Redis, simulated Shopify, the mock translation provider. **Nothing of Smart Auto-Translate is verified on a real Shopify store yet**, and no paid DeepL call was made (see §11).

The design is in [SMART_AUTO_TRANSLATE.md](SMART_AUTO_TRANSLATE.md); the database review in [SECURITY_MODEL.md §5q](SECURITY_MODEL.md).

## 1. Detecting what needs translation

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| New content | Partial: product and collection webhooks; pages, blog posts and blogs only every 30 minutes, capped | Scheduled checks read every chosen type in full; real-time mode adds webhooks and the periodic check for pages and blogs | `smart-run.test.ts`, `smart-auto.test.ts` › periodic check |
| Changed originals | Partial | Shopify's digests per field; outdated machine output is replaced (option), people's translations never | `smart-run.test.ts` › plans while it measures |
| Removed content | Partial | Delete webhooks for products and collections, removal when a job or refresh finds a resource gone, unseen items removed at a scan's end | `coverage.test.ts`, `webhooks.test.ts` (coverage batch) |
| Missing and outdated translations | Verified | Unchanged | `needs-work.test.ts` |
| Unchanged fields cost nothing | Defective: a reused job item retranslated fields; held fields were sent again | Field-level plan; a field with a pending human draft or one removed on purpose is held | `needs-work.test.ts`, `review-protection.test.ts` |
| People's and approved translations kept | Verified | Also a person's CSV draft and a removal | `review-protection.test.ts`, `smart-run.test.ts` |
| Primary language changes | Missing | The schedule pauses (`PRIMARY_LANGUAGE`), nothing is deleted or replaced, saving the languages again continues; Shopify's primary language is never changed | `smart-auto.test.ts` › main language |
| Webhooks plus periodic scans | Defective: the periodic check could drop changes beyond its cap | Its position stops at the cap and continues next time; smart schedules measure everything | `auto-sweep.test.ts` |
| Works without the merchant's browser | Verified | The worker runs the schedule | `smart-auto.test.ts` › the scheduler |

## 2. Scheduling

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| Modes: real time, daily, weekly, custom times, manual | Partial (real time only) | All five; custom: up to 6 times on chosen weekdays | `schedule.test.ts`, `smart-auto.spec.ts` (UI) |
| Shopify's time zone shown, explicit zone | Missing | The shop's `ianaTimezone` by default, any IANA zone, validated on the server and in the database | `schedule.test.ts`, `smart-auto.test.ts` |
| Daylight saving | Partial | Wall-clock times; a time in the spring gap runs after it, the repeated autumn hour once | `schedule.test.ts`, `smart-auto.test.ts` › winter time |
| One check per store and occurrence, several workers | Missing | Unique `(shopId, occurrenceAt)`, per-shop advisory lock; 5 ticks at once give one run | `smart-auto.test.ts` › one run per occurrence |
| Persisted in PostgreSQL | Missing | `SmartAutoConfig`, `SmartAutoRun`, `SmartAutoExclusion`, with RLS | `migration-review.test.ts`, security suite |
| Worker and Redis | Partial | Tick every minute in the worker (Redis lock), measurement pages and items on the existing queues | `smart-run.test.ts` |
| No duplicate jobs or charges | Defective (usage keys could collide) | One job per run, type and language; an item once per job; a repeated page plans nothing; every provider call metered under its own key | `smart-run.test.ts` › repeated page, usage-ledger tests |
| Retries with backoff | Partial | Pages and items retry; a limit or provider stop pauses the schedule | `smart-run.test.ts` › daily budget |
| Resume after outages | Partial | One catch-up check for missed occurrences, then from now; stalled measurements continue; an interrupted run is finished by the repair | `smart-auto.test.ts` › outage, `smart-run.test.ts` › repair |
| Large catalogs, checkpoints, no gaps | Partial / defective | The measurement's cursor is the checkpoint; every page is planned in its own transaction; no cap | `smart-run.perf.test.ts`: 5,000 products × 2 languages in 31 s, median 14 ms per page |
| Changes never dropped by a cap | Defective | No cap on a smart check; the periodic check holds its position at its cap | `auto-sweep.test.ts` |
| A daily schedule runs no paid real-time translation | Missing | Webhooks and the periodic check queue nothing in scheduled modes | `smart-auto.test.ts` › scheduled mode, periodic check |

## 3. The merchant's control

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| On/off, languages, content types, fields | Partial | Settings page `/app/settings/automatic`: plan languages only, 16 types (personal-data types marked), field groups | `smart-auto.spec.ts` |
| Drafts or automatic publishing (confirmed) | Partial | Drafts by default; publishing needs the confirmation (who and when stored) and the plan | `smart-auto.spec.ts` › confirmation |
| Replace outdated machine translations | Partial | Option; people's translations are never replaced | `smart-run.test.ts` |
| Exclusions | Missing | "Don't translate automatically" in the editor, list on the settings page; covers the resource's custom fields | `smart-auto.test.ts` › editor |
| Daily and monthly budget | Partial | In the schedule's time zone; reaching one pauses until midnight or the next month | `smart-run.test.ts` › daily budget |
| Pause | Defective (queued items kept translating) | Pause stops at the next item; a merchant's pause never lifts by itself | `smart-auto.test.ts`, `smart-run.test.ts` |
| Run now | Missing | Check now: one run per click, at most every 5 minutes | `smart-auto.test.ts` › Check now |
| Last and next check, what changed and was translated | Missing / partial | Status card, next three checks, recent checks with counts, billed and reused characters | `smart-auto.spec.ts` |
| Errors and retry | Partial | Reasons in recent checks; "Retry failed items" | `smart-auto.spec.ts` |
| Safe defaults | Partial | Drafts, plan languages, five content types, outdated machine output replaced | `smart-auto.spec.ts` |

## 4. Business plan only

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| Server-side entitlement | Missing | Every settings action, every tick (pause `PLAN`), every item (`PLAN_SMART`), the editor's exclusion | `smart-auto.test.ts`, `smart-auto.spec.ts` › forged requests |
| Forged requests refused | Partial | Server validation of every value, CHECK constraints in the database | `smart-auto.test.ts` › forged value, UI forged posts |
| Upsell for lower plans | Missing | A short card with the way to the Business plan | `smart-auto.spec.ts` |
| Lower plans keep basic automatic translation | Partial | Unchanged for them; on Business the smart schedule replaces it (said on the page) | `settings.spec.ts` |
| Real billing unchanged | Verified | Unchanged: no plan or charge was created or changed | — |

## 5. Cost

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| Field-level change detection, digests | Verified | Unchanged | — |
| Translation memory | Partial | Same pipeline: exact reuse costs nothing, shown per run | `smart-run.test.ts` |
| Dedupe | Defective | See §2 | — |
| Estimate before processing / before enabling | Missing | From coverage: characters of missing, failed and (when replaced) outdated fields of the chosen languages, types and field groups; an upper bound | `smart-run.test.ts` › estimate |
| Budget enforcement with automatic pause | Defective | Smart usage is metered under its own origin; budgets pause | `smart-run.test.ts` |
| Billed, reused and estimated kept apart | Defective | Billed (ledger), reused from memory, estimated (planned) shown separately | `smart-auto.spec.ts` |

## 6. Interface

Settings card with real values, the smart page (schedule picker with live next checks, scope, publishing confirmation, budgets, exclusions, activity), Polaris web components and App Bridge (save bar, toasts), English, German, French and Spanish, accessibility (axe), desktop, tablet and iPhone layouts. Smart jobs on the Jobs pages, the smart schedule on the Coverage page and its items, the Plan page. Screenshots: `docs/ui-review/smart-auto/`.

## 7. Coverage states

| State | Where |
|---|---|
| Complete, missing, outdated, draft, failed | Coverage (existing six states; a draft for an older original is no draft) |
| Skipped / excluded | Items: "Not translated automatically" |
| Waiting for the scheduled check | Items: "Waits for the next check (time, zone)" |
| Processing | Items: "Translating now"; Coverage: what the schedule translates now |
| Never a false 100 % | Only published languages read in full make up the figure; unreadable types named (coverage batch) |

## 8. Security

Tenant isolation (RLS, FORCE, one policy per new table, checked by the migration review and the runtime posture check), authenticated actions with the plan checked on the server, AI consent (pause `CONSENT`), DeepL credentials only in the server's environment, logger redaction, idempotent runs and per-shop locks, webhook HMAC, overwrite protection of people's translations, recovery after restarts, the primary language never changed, metering per call, payment methods and metaobjects marked as possibly personal data and off by default.

## 9. Tests added for this work

- Unit: `smart-auto.test.ts` (scope, schedules, pauses, validation, items waiting), `schedule.test.ts`, `needs-work.test.ts`.
- Integration: `smart-auto.test.ts` (21), `smart-run.test.ts` (9), `review-protection.test.ts` (7).
- Performance: `smart-run.perf.test.ts` (5,000 products, two languages).
- Browser: `smart-auto.spec.ts` (11, desktop and phone), screenshots on desktop, tablet and iPhone.

## 10. Limitations

- Excluding a product also excludes its custom fields, not its image alt text (coverage has no image owner).
- The estimate is an upper bound: exclusions and people's outdated translations aren't subtracted.
- Characters not sent because a text repeated within a request are not shown separately from memory reuse.
- A check reads every language and type (so the figures stay complete), also when the schedule covers fewer; for a very large store a check takes as long as reading the store at its Shopify rate.
- In real-time mode, pages, blog posts and blogs are followed by the periodic check (every 30 minutes), not instantly; Shopify has no webhooks for them.
- The delete webhooks need `shopify app deploy` before Shopify sends them.
- French and Spanish texts still need a native speaker's review.

## 11. What still prevents a production launch

1. A run on the test store (`linguva-test-lab`) with products: DEV_STORE_TEST_PLAN.md §Q, logged there.
2. Real webhooks and the worker on real events (product change in real-time mode, page change found by the periodic check).
3. A DeepL key in Railway (owner) and the owner's approval for paid calls; then a quality check of real output.
4. The Business plan in Shopify's managed pricing, set up and approved by the owner (no billing was changed).
5. `shopify app deploy` for the new webhook topics.
6. Visual baselines for the changed Settings and Plan pages from the CI render.
7. A native speaker's review of the French and Spanish texts.
8. The owner's decision on the AI consent: its text now also names automatic and scheduled translation and automatic publishing; raising `AI_CONSENT_VERSION` would ask every store to confirm again (it was not raised, so nothing stops on the stores already using Linguva).
