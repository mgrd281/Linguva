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
| Primary language changes | Missing | The schedule pauses (`PRIMARY_LANGUAGE`) at its next check, at Check now, or at the first item read in the new language (which stops its job before anything is sent); existing translations are left as they are; saving the languages again continues; Shopify's primary language is never changed (no locale mutation, pinned by `structure.test.ts`) | `smart-auto.test.ts` › main language, new primary language; `structure.test.ts` |
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
| No duplicate jobs or charges | Defective (usage keys could collide) | One job per run, type and language; one active job per type and language beside merchants' bulk jobs too; an item once per job; a repeated page plans nothing; every provider call metered under its own key | `smart-run.test.ts` › repeated page, beside other jobs; usage-ledger tests |
| Retries with backoff | Partial | Pages and items retry; a limit or provider stop pauses the schedule | `smart-run.test.ts` › daily budget |
| Resume after outages | Partial | One catch-up check for missed occurrences, then from now; stalled measurements continue where they stopped; an interrupted run is finished by the repair; a run whose start didn't get through starts a minute later | `smart-auto.test.ts` › outage, start didn't get through; `smart-run.test.ts` › repair |
| Large catalogs, checkpoints, no gaps | Partial / defective | The measurement's cursor is the checkpoint; every page is planned in its own transaction; no cap | `smart-run.perf.test.ts`: 5,000 products × 2 languages in 31 s, median 14 ms per page |
| Changes never dropped by a cap | Defective | No cap on a smart check; the periodic check holds its position at its cap | `auto-sweep.test.ts` |
| A daily schedule runs no paid real-time translation | Missing | Webhooks and the periodic check queue nothing in scheduled modes | `smart-auto.test.ts` › scheduled mode, periodic check |

## 3. The merchant's control

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| On/off, languages, content types, fields | Partial | Settings page `/app/settings/automatic`: plan languages only, 16 types (personal-data types marked), field groups | `smart-auto.spec.ts` |
| Drafts or automatic publishing (confirmed) | Partial | Drafts by default; publishing needs the confirmation (who and when stored) and the plan | `smart-auto.spec.ts` › confirmation |
| Replace outdated machine translations | Partial | Option; people's translations are never replaced | `smart-run.test.ts` |
| Exclusions | Missing | "Leave out of the smart schedule" in the editor, list on the settings page; covers the resource's custom fields | `smart-auto.test.ts` › editor |
| Daily and monthly budget | Partial | In the schedule's time zone; reaching one pauses until midnight or the next month; a correction after midnight counts in its reservation's day | `smart-run.test.ts` › daily budget, `usage-ledger.test.ts` › reservation's window |
| Pause | Defective (queued items kept translating) | Pause stops at the next item; a merchant's pause never lifts by itself, also when the plan, consent or primary language change and change back | `smart-auto.test.ts` › keeps the merchant's own pause, `smart-run.test.ts` |
| Run now | Missing | Check now: one run per click, at most every 5 minutes | `smart-auto.test.ts` › Check now |
| Last and next check, what changed and was translated | Missing / partial | Status card, next three checks, recent checks with counts, billed and reused characters | `smart-auto.spec.ts` |
| Errors and retry | Partial | Reasons in recent checks; "Retry failed items" | `smart-auto.spec.ts` |
| Safe defaults | Partial | Drafts, plan languages, five content types, outdated machine output replaced | `smart-auto.spec.ts` |

## 4. Business plan only

| Requirement | Before | Now | Evidence |
|---|---|---|---|
| Server-side entitlement | Missing | Every settings action except turning off, pausing and removing an exclusion (they only stop work, and stay possible after a downgrade), every tick (pause `PLAN`), Check now, every real-time check and every item (`PLAN_SMART`, also before the bulk check), the editor's exclusion | `smart-auto.test.ts` › plan, Check now, webhooks; `smart-auto.spec.ts` › forged requests |
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
- Integration: `smart-auto.test.ts` (45), `smart-run.test.ts` (18), `smart-takeover.test.ts` (4), `review-protection.test.ts` (7), `usage-ledger.test.ts` (the budget window).
- Performance: `smart-run.perf.test.ts` (5,000 products, two languages).
- Browser: `smart-auto.spec.ts` (11 tests, 13 runs on desktop and phone), screenshots on desktop, tablet and iPhone.

## 10. Limitations

- Excluding a product also excludes its custom fields, not its image alt text: the scan records no owner for images (Shopify lists them on their own), so the owner rules don't reach them. For the same reason, a check's own image job and a real-time job that includes images can translate the same alt text when both run at the same moment.
- The estimate is an upper bound: exclusions and people's outdated translations aren't subtracted. A store measured before this version shows "Measure coverage again" until its next measurement (the character counts are new).
- Characters not sent because a text repeated within a request are not shown separately from memory reuse.
- A check reads every language and type (so the figures stay complete), also when the schedule covers fewer; for a very large store a check takes as long as reading the store at its Shopify rate.
- In real-time mode, pages, blog posts and blogs are followed by the periodic check (every 30 minutes), not instantly; Shopify has no webhooks for them.
- The delete webhooks need `shopify app deploy` before Shopify sends them.
- French and Spanish texts still need a native speaker's review.
- A merchant's bulk job that includes images and custom fields, started while a check's own image or custom-field job is active, can translate the same image or field a second time when both run at the same moment (one after the other, the second finds it done). The other way round, the check leaves them to the merchant's job.
- A real-time change that arrives while a check's job for its type and language is active joins that job; its images and custom fields then wait for the next check.
- Exclusions work for products, collections, pages, blog posts and blogs (the types with an editor); the other schedulable types can only be left out as a whole type.
- In real-time mode, changes are followed between full checks for products and collections (webhooks) and pages, blog posts and blogs (the 30-minute check); the other chosen types wait for the daily full check.
- A run interrupted by an outage continues where it stopped; what it had already read before the outage is read again at the next check, not at once.
- The estimate follows the saved settings; a changed scope shows its figure once saved.
- The worker's tick wrapper and its Redis lock aren't covered by a test (the smart tests call the tick and the processors directly); the test-store run (§11) is where they run for real.

## 11. What still prevents a production launch

1. A run on the test store (`linguva-test-lab`) with products: DEV_STORE_TEST_PLAN.md §Q, logged there.
2. Real webhooks and the worker on real events (product change in real-time mode, page change found by the periodic check).
3. A DeepL key in Railway (owner) and the owner's approval for paid calls; then a quality check of real output.
4. The Business plan in Shopify's managed pricing, set up and approved by the owner (no billing was changed).
5. `shopify app deploy` for the new webhook topics.
6. A native speaker's review of the French and Spanish texts.
7. The owner's decision on the AI consent: its text now also names automatic and scheduled translation and automatic publishing; raising `AI_CONSENT_VERSION` would ask every store to confirm again (it was not raised, so nothing stops on the stores already using Linguva).

## 12. Independent review before the launch

A separate review of the smart backend (all of `42a487d..HEAD`) reproduced each problem below against PostgreSQL with the mock provider. Each is fixed, and each fix has a test that fails without it.

| # | Problem found | Fix | Test |
|---|---|---|---|
| 1 | High: a merchant's pause was replaced by a system pause (plan, consent, primary language), which then lifted by itself and paid checks resumed | A cause never replaces the merchant's pause; only a pause for that cause lifts with it | `smart-auto.test.ts` › keeps the merchant's own pause |
| 2 | High: a check's job could hold the same products as a merchant's active bulk job (translated and billed twice when both ran at once); a real-time check joined the bulk job, outside the smart budget, fields and publishing | One active job per type and language for checks too (the same lock); automatic jobs are taken over, others keep their resources; a real-time check waits for a job that isn't the schedule's | `smart-run.test.ts` › beside other jobs (5 tests) |
| 3 | Medium: a reservation released or settled just after midnight made the new day's smart budget start below zero | Settle and release rows carry the reservation's time | `usage-ledger.test.ts` › reservation's window |
| 4 | Medium: a Check now (or a scheduled run) whose start didn't get through stayed QUEUED, for ever in manual mode | The tick comes back within a minute and starts it | `smart-auto.test.ts` › start didn't get through (2 tests) |
| 5 | Medium: an item left waiting in a stopped job hid its product from every later check | Only items of active jobs count as busy | `smart-run.test.ts` › stopped job left waiting |
| 6 | Medium-low: stores measured before this version saw "up to 0 characters" | "Measure coverage again" until the next measurement | `smart-run.test.ts` › newest one is older |
| 7 | Low: items followed the settings as planned, not as they are (a type or field groups taken out, real time switched off, a language removed from the store, a new primary language, a product excluded after its custom fields were planned) | Every item checks the current settings, languages, primary language and the owner's exclusion | `smart-auto.test.ts` › items of smart jobs (5 tests) |
| 8 | Low: Retry on the Jobs page started a full bulk discovery on a check's job | A check's job never rediscovers | `smart-auto.test.ts` › retried from the Jobs page |
| 9 | Low: "last complete check" was set for checks that left part of their scope (a type not readable, pages read while paused, a run started while paused) | Such a run finishes as `PARTIAL`; a waiting run that was paused is skipped | `smart-run.test.ts` › read while paused, waited |
| 10 | Low: after a downgrade, basic automatic translation couldn't be turned on (the smart schedule stayed on, and lower plans have no card to turn it off) | Turning basic on turns the schedule off on a plan without it | `smart-auto.spec.ts` › after a move to a plan without the smart schedule (also checks the schedule is off) |
| 11 | Docs: a partial unique index for "one active run", a billing check after an hour, coverage of pages and blogs between scheduled checks | The design says what the code does: the lock, 6 hours, the next check | — |

A second review (the documentation's claims against the code, the interface on desktop and phone, the four languages, and the tests named as evidence) added these, also fixed:

| # | Problem found | Fix | Test |
|---|---|---|---|
| 12 | Blocker: the editor's exclusion checkbox sent nothing (React 18 sends no `onChange` for a web component) | The checkbox submits on its input event (the same for the CSV export's options); a refusal is shown; worded for the smart schedule | `smart-auto.spec.ts` › left out from its editor |
| 13 | Refusals of Turn on, Check now, Retry and Remove were dropped once the form was saved; Turn on was offered without AI consent | Each refusal next to its buttons, on the page and on Settings; Turn on says why it can't | — (not asserted in the browser) |
| 14 | The save bar didn't come back after the first save | Cleared once per save | `smart-auto.spec.ts` › setting it up |
| 15 | "Retry failed" while paused or off (the items were cancelled again) | Offered and accepted only while on | — |
| 16 | Settings showed bulk translation's publishing, never the schedule's own | The card shows how its results go out | `smart-auto.spec.ts` › Settings shows the smart schedule |
| 17 | "On" and a next check while no worker runs; pauses for the plan or consent shown after their cause was gone; next checks while paused | One state for every page: waiting while background jobs aren't running, such a pause over once its cause is (lifted within 15 minutes, also in manual mode), next checks only while on | `smart-auto.test.ts` (unit) › the state every page shows; (integration) › when the tick looks again |
| 18 | Coverage ignored that state, the selected language and the pause reason | The Coverage header uses the same state and says when the language isn't in the schedule; items wait only while it's on | — |
| 19 | The estimate counted languages and types never measured as 0 | No figure until every chosen language and type was read | `smart-run.test.ts` › estimate |
| 20 | On a plan without bulk translation, smart items stopped as `PLAN_REQUIRED` without pausing | `PLAN_SMART` first; both pause | `smart-auto.test.ts` › also on a plan without bulk translation |
| 21 | In real time, a skipped check moved the 30-minute check past changes it never read | Only a completed check moves it | `smart-auto.test.ts` › periodic check |
| 22 | Texts: the AI consent in German and French said the output is sent to DeepL; the check and the Review page had the same word in German and Spanish; plurals and other wording | Corrected (a native speaker's review is still a launch blocker) | `i18n.test.ts` |
| 23 | Tests missing for automatic publishing, memory reuse, turning off with work in flight, coalescing, the monthly budget and the provider pause, paused and downgraded webhooks | Added | `smart-auto.test.ts` |

A third review checked the fix commit itself (`691d8a5..e8b8b4d`): each finding was reproduced against PostgreSQL, then put to two or three skeptical reviewers. 18 of 22 held. 17 are fixed here, each with a test; one (row 33) is documented as a limitation. Undoing the fix for the tick's hint, the check across jobs, the copy of the shop's languages or the current settings makes its tests fail.

| # | Problem found | Fix | Test |
|---|---|---|---|
| 24 | Major: a pause for the plan or consent set by a stopped item, or by Check now, got no 15-minute recheck (in manual mode none at all), while every page already showed "On" | One function computes the tick's hint for every write of the schedule; giving consent lifts a consent pause at once | `smart-auto.test.ts` › when the tick looks again (4 tests); Check now › lifts a pause for consent |
| 25 | Major: saving the settings or resuming erased the one-minute recheck: in manual mode a waiting run never started and Check now answered "active" for ever | The same function: a waiting run keeps its recheck | `smart-auto.test.ts` › keep the minute's recheck |
| 26 | Major: a check taking over the day's real-time job never translated a product whose real-time item had ended earlier, and still counted as complete | The check gets a job of its own; the automatic job's waiting items move there, its history stays its own | `smart-takeover.test.ts` › translates what the real-time job had finished |
| 27 | Major: the same for a merchant's bulk job taking over a real-time job | The same handover | `smart-takeover.test.ts` › translates every product that needs it |
| 28 | Minor: a check's billed, reused and failed figures included the taken-over job's earlier work | Follows from the handover: the run's job has only its own counts | `smart-takeover.test.ts` › counts only what it translated itself |
| 29 | Minor: Retry was refused as "not on" under an "On" badge (a pause whose cause was gone) | Retry lifts such a pause first, like Check now | `smart-auto.test.ts` › Retry agrees with the page |
| 30 | Minor: the real-time periodic check moved past a check that ended `PARTIAL` | Only a check without a code moves it | `smart-auto.test.ts` › doesn't move past a check that left part of its scope |
| 31 | Minor: a chosen type without access made every check `PARTIAL` for ever ("the next check takes it") | Not a gap; the smart page names the type with "Allow access" | `smart-run.test.ts` › chosen type without access |
| 32 | Minor: a stale copy of the shop's languages (up to 5 minutes, marked fresh) cancelled a language added a moment ago, and paused again after the merchant saved the languages for a new primary language | A copy is never "fresh"; a change is confirmed with Shopify before cancelling or pausing | `smart-auto.test.ts` › added a moment ago; read before the merchant saved them |
| 33 | Minor: owner rules never reached images | Documented in §10 (the scan has no image owner) | — |
| 34 | Major (tests): a new test depended on the real date and would fail from 2026-10-29 22:00 UTC on | The run's time is set to the simulated one | `smart-auto.test.ts` › start didn't get through |
| 35 | Tests: the `PLAN_SMART` order, the `PLAN_REQUIRED` pause and the current-settings checks for images and outdated output had no failing test; rows 13, 14, 16 and 10 named tests that didn't assert them | Tests added (plan without bulk translation, images and outdated output, save bar, publishing, the schedule off after a downgrade); row 13 marked untested | see the rows |
| 36 | Docs: test counts in §9 and the worker-tick claim in §10 | Corrected | — |
