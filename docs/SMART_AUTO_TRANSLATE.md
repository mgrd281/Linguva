# Smart Auto-Translate (Business plan)

Status: design, final for implementation, 2026-10-29. Owner request "Linguva — Premium Smart Auto-Translate 10/10".
Per-requirement status: `docs/FEATURE_STATUS.md` (Smart Auto-Translate). The audit of what already existed is in §12.

## 1. What it is

Smart Auto-Translate keeps a store translated by itself, on a schedule the merchant chooses:

- **Real-time**: changes are translated shortly after Shopify reports them (webhooks for products and collections; the 30-minute check for pages, blog posts and blogs). One full check a day, at a chosen time, catches everything else.
- **Daily**: one full check a day at a chosen local time ("every day at 23:00").
- **Weekly**: one full check at a chosen time on chosen weekdays.
- **Custom**: up to 6 times a day, at least an hour apart, on chosen weekdays.
- **Manual only**: no automatic checks. "Check now" still works.

A full check reads the store the way "Measure" on the Coverage page does: every translatable resource in every target language, with Shopify's per-field digests and outdated flags. It refreshes the coverage figures. Then it translates **only** the fields that are missing or outdated, and only in the merchant's scope:

- languages;
- content types;
- field groups;
- with or without images and custom fields;
- minus excluded resources.

Results become drafts for review, unless automatic publishing is explicitly enabled and confirmed.

The feature is Business-only, checked on the server. Lower plans keep the existing basic automatic translation: products, collections, pages, blog posts and blogs, shortly after they change, into chosen languages. The UI tells the two apart: "Automatic translation" for basic, "Smart schedule" with a Business badge for the new one. The two never run for the same shop at once.

## 2. Principles

1. **Never silently drop a change.** A check is a full, checkpointed read of the store, with no cap and no window that could leave a gap. A budget stop pauses: the first check after the reset finds whatever is still missing.
2. **Never pay for what didn't change.**
   - Field-level planning (`planResourceWork`): current translations are never touched.
   - Protected: translations a person wrote or approved, those another app made, and translations removed on purpose.
   - Skipped: fields with a pending, rejected or refused draft for the same source, and fields with a person's draft waiting for review.
   - Translation memory and in-request de-duplication run before the provider.
   - Every provider call is metered once, under its own key.
3. **A scheduled mode never translates in between.** In daily, weekly, custom and manual modes, product and collection webhooks only refresh coverage (free) and queue nothing paid. The 30-minute check doesn't run in these modes, so changed pages, blog posts and blogs show at the next check.
4. **Exactly one run per scheduled occurrence**, however many workers tick: a unique `(shopId, occurrenceAt)` row decides. Both places that create runs (the tick and Check now) hold the per-shop advisory lock and look for an active run first, so one run is active per shop (there is no partial unique index for it).
5. **One active job per type and language**, as for every job (§5.2): a check never translates beside a merchant's bulk job, and a real-time check never joins one.
6. **Safe defaults**:
   - off;
   - drafts;
   - own fields only (images and custom fields are opt-in);
   - personal-data-prone types (metaobjects, payment methods) out of scope;
   - the plan's allowance and the platform caps always apply on top of the merchant's own budgets.
6. **Server-side checks at every step**: entitlement, consent, languages, pause and budget when saving settings, at a tick, at run start, while planning, and for each item.

## 3. Schedule semantics (`app/lib/schedule.ts`)

- Check times are wall-clock times in the schedule's IANA time zone. The default is the shop's own (`shop.ianaTimezone` from the Admin API); the merchant can choose another.
- Zones are stored canonically: `canonicalTimeZone` refuses offsets ("+05:30"), abbreviations ("EST") and unknown names. It keeps one spelling per zone, and keeps the shop's own zone as Shopify spells it ("Asia/Kolkata", where Intl says "Asia/Calcutta").
- **Daylight saving.**
  - A local time skipped by a jump runs the same distance after the jump: 02:30 becomes 03:30 when 02:00 jumps to 03:00 (Temporal's "compatible" rule).
  - A local time that exists twice runs once, the first time.
- `nextOccurrence(spec, after)` returns the first instant strictly after `after`. The stored `nextRunAt` is always an occurrence of the current spec.
- **Real-time mode** has a daily full check at `times[0]` (default 03:00 local); webhooks do the rest.
- **Missed occurrences** (the worker was down): a tick that finds `nextRunAt` in the past creates **one** run for that occurrence. The next occurrence is then computed from *now*, so a three-day outage causes one catch-up check, not three.
- **Budgets** count per local day and local month in the schedule's time zone (`startOfLocalDay`, `startOfLocalMonth`).

## 4. Data model (migration `20261105090000_smart_auto`)

New tenant tables:
- `ENABLE` + `FORCE ROW LEVEL SECURITY`, and exactly one policy, `tenant_isolation`, on `"shopId" = NULLIF(current_setting('app.shop_id', true), '')::uuid`;
- an FK to `Shop` `ON DELETE CASCADE`;
- guarded grants: `SELECT, INSERT, UPDATE`, plus `DELETE` only where the feature deletes; never `ALL` or `TRUNCATE`;
- CHECK constraints;
- the review section `SECURITY_MODEL.md` §5q.

### `SmartAutoConfig` (one row per shop, PK `shopId`)

| Group | Columns |
|---|---|
| State | `enabled` (false) |
| Schedule | `mode` (CHECK in the five modes), `timeZone` (≤ 64), `times Int[]` (0–1439, ≤ 6), `weekdays Int[]` (1–7) |
| Scope | `locales`; `resourceTypes` (default PRODUCT, COLLECTION, PAGE, ARTICLE, BLOG); `fieldGroups` (empty = all but URL handles); `includeAttached` (false) |
| Publishing | `publishMode` (`DRAFT` default) + `publishConfirmedAt/By`; `replaceOutdatedMachine` (true) |
| Budgets | `dailyBudget`, `monthlyBudget` (characters; null = only the plan's limits) |
| Pause | `pausedAt`, `pauseReason`, `pausedUntil` (budget pauses lift by themselves) |
| Bookkeeping | `nextRunAt`, `lastRunAt`, `lastSuccessAt`; `primaryLocale` (snapshot: a change pauses); `version` (optimistic concurrency of the form); `updatedBy`; `createdAt`, `updatedAt` |

### `SmartAutoRun` (activity; append-only, kept 90 days, purged per shop)

- `trigger`: SCHEDULED or MANUAL. `occurrenceAt`, unique per shop when set. `requestedBy`.
- `status`: QUEUED, WAITING (a merchant's measurement is running), RUNNING, COMPLETED, FAILED, CANCELLED, SKIPPED.
- `skipReason` / `errorCode`.
- Scope snapshot: locales, types, groups, includeAttached, publishMode, replaceOutdatedMachine.
- `coverageReportId` (no FK: reports are pruned).
- Counters:
  - `resourcesChecked`: read by the scan;
  - `resourcesChanged`: needing work in scope;
  - `fieldsDetected`;
  - `charsEstimated`: source characters planned;
  - `itemsQueued`;
  - `excludedSkipped`.
- `scanFinishedAt`, `startedAt`, `finishedAt`, `createdAt`.
- Partial unique index: one run per shop in QUEUED, WAITING or RUNNING.

### `SmartAutoExclusion`

`(shopId, resourceGid)` PK, plus `resourceType`, `createdBy` and `createdAt`.

### Columns on existing tables (they inherit their table's RLS)

- `TranslationJob`:
  - `smartRunId` (nullable, FK `ON DELETE SET NULL`);
  - `fieldGroups String[]` (empty = all);
  - `replaceOutdatedMachine Boolean @default(true)`.
  - Smart jobs have `requestedBy = 'system:smart'`.
- `CoverageReport.smartRunId`: a smart report plans translation while it reads.
- `UsageLedger.origin` (nullable, `'smart'`). It is copied to the settle and release rows, so a day's or month's smart spend is a sum.
- `CoverageItem.sourceChars Int[]`: the length of each counted original, in `sourceKeys` order, and `CoverageCount.chars BigInt`: their sum per language, type, field group and state, kept with every count change and rebuilt with the counts after a scan. Numbers only, no text. They drive the estimate before anything is sent.
- `Shop.smartNextRunAt` (indexed): a due index for the tick, outside RLS.
  - The runtime role can write `Shop` for any shop, so the column is only a hint.
  - The tick re-reads the config under RLS.
  - It writes `Shop` only by the tenant's own id, in the same transaction as the config.

## 5. Runtime

### 5.1 Tick

Every 60 s the worker runs the tick, as its other periodic work: one worker per minute takes the Redis lock `smart-tick-lock`, and a second one (a deploy overlap) would still start each occurrence once (unique occurrence, per-shop advisory lock). Before deciding, the tick finishes runs whose measurement ended without finishing them (`repairSmartRuns`, also in the 5-minute sweep).

A run's start comes after the commit that created it, so the shop's hint is at most a minute away while a run is QUEUED or WAITING: should the start not get through (a database timeout, a restart), the next tick starts it, also in manual mode, where no schedule would bring the tick back. One function computes the hint for every write of the schedule (the tick, saving, turning on or off, pausing for a stop, resuming, Check now): the next scheduled check, a minute while a run waits or hasn't started, and 15 minutes while paused for the plan or consent, so such a pause lifts soon after its cause, also in manual mode; giving consent lifts a consent pause at once. Saving or resuming never drops a recheck. A run that waited and was paused meanwhile is recorded as SKIPPED (`PAUSED`) instead of started. Each tick:

1. Lists up to 100 ACTIVE `Shop` rows with `smartNextRunAt <= now` (oldest first). It also starts WAITING runs whose blocking measurement has finished.
2. **Outside any transaction**, per shop, it reads the facts:
   - the plan (`getBillingStatus`: the cached subscription, read from Shopify again after 6 hours, `SUBSCRIPTION_TTL_MS`, and after a plan change);
   - AI consent;
   - the provider;
   - the shop's languages (`currentShopLocales`).
3. In a tenant transaction with `pg_advisory_xact_lock(hashtextextended('smart:'||shopId, 0))`, it re-reads the config. If the config is no longer due, it fixes the hint and stops. Otherwise it decides:
   - the merchant's own pause stays as it is: a cause below never replaces it (it would lift with the cause), and it skips the checks anyway;
   - not entitled → pause `PLAN`;
   - no consent → pause `CONSENT`;
   - no provider → SKIPPED run `AI_NOT_CONFIGURED`;
   - primary language changed → pause `PRIMARY_LANGUAGE`;
   - paused → SKIPPED run `PAUSED`;
   - a run already active → SKIPPED run `COALESCED`;
   - otherwise → insert `SmartAutoRun(SCHEDULED, occurrenceAt = nextRunAt)` with `ON CONFLICT DO NOTHING`.
   In every case it advances `nextRunAt` and `Shop.smartNextRunAt` to `nextOccurrence(spec, now)`.
4. After the commit it starts the new run (§5.2).

### 5.2 A run: one full measurement that plans translation while it reads

**Start.**
- `createCoverageReport` runs for all target languages and every coverage type, with `smartRunId`, so the Overview's "newest completed measurement" keeps its meaning.
- If the merchant's own measurement is running, the run is WAITING and starts once that measurement ends (tick).

**Planning per page.** `runCoveragePage` reads a page of one segment (type × language). For a smart report it then plans that page, **before** its transaction, from the read data:
- the language must be in the run's scope;
- the coverage type must be in scope (own types, plus image and custom-field types when `includeAttached` is on);
- excluded resources are skipped;
- `planResourceWork` runs with `latestRevisions`, `pendingDraftDigests`, the run's `fieldGroups` and `keepOutdatedMachine`;
- a resource that already has a PENDING or RUNNING item in another **active** job for the same language is skipped (it is handled there); a custom field also when its owner has one in a job that includes them (images not yet: the scan records no owner for them, see the limitations). Leftovers of a stopped job don't count.

**Items per exact resource.**
- Each resource that needs work gets an item for its own GID, also an image or a metafield.
- The item goes into the run's job for (coverage type, language), with idempotency key `smart:<runId>:<type>:<locale>`.
- Attached content needs no owner lookup. Its "failed" overlay works per resource, too.

**One active job per type and language.** The run's job is found or created under the lock every job creation takes (`job:<shop>:<type>:<locale>`, as `createBulkJob` and real-time checks), so the rule holds for smart checks too:
- an automatic job (basic, or the smart schedule's real-time one) for the type and language hands over to the run's new job: its items that haven't started move there and run once under the run's rules; what it did earlier stays its own (the run counts and translates only its own work, also a resource the automatic job finished earlier that day). It completes once its running items are done, which keep their resources busy meanwhile;
- any other active job (a merchant's bulk job, another run's) keeps the type and language, as does a merchant's job that includes the images and custom fields of their owner: the run plans nothing for them, and its counts say what it translated itself. The next check picks up whatever is left;
- once the run's own job was stopped (Jobs page, a limit), nothing more is added to it.

A merchant's bulk request takes over from a real-time job like from a basic automatic one: a new bulk job with its own rules, the waiting items moved over. It answers with a check's job while one is active. While an automatic job finishes its running items beside the job that took over, a change of a resource waiting or running in either never gets a second item.

**Writes, atomic with the checkpoint.** Inside the page's transaction:
- the job as above, and the items (unique per job and resource);
- increment the job's total and the run's counters.

A repeated page job can't double-count, because the checkpoint advance is conditional.

**After the commit**, the items are queued (`CoverageDeps.smart.onItems`). If the process dies before that, `requeueStalledItems` re-queues PENDING items that have no live queue job.

**Jobs and the scan.**
- Smart jobs are created with `discoveryDone = false` while their run's scan goes on. The report's last page sets `discoveryDone = true` on all of the run's jobs and completes the empty ones.
- `requeueStalledDiscovery` ignores smart jobs: they have no discovery chain.

**Finish.** The run is COMPLETED when its report has finished and all of its jobs have; `lastSuccessAt` ("last complete check") is set then, unless part of its scope wasn't planned: a type in scope that couldn't be read (skipped after its retries) or pages read while paused. Such a run finishes with `PARTIAL`, and the next check takes the rest; the real-time periodic check doesn't move past it. A chosen type Linguva has no access to (an optional permission) isn't a gap: nothing of it can be read or translated, the estimate counts it the same way, and the smart page names it with "Allow access". The check runs at the report's last page and whenever a smart job completes. A failed report makes the run FAILED, while items already queued finish.

**Retry** on the Jobs page resumes a check's job without a discovery of its own: its run's measurement fills it.

**Run now** creates a MANUAL run the same way, idempotent through the form's key, with a cooldown of one per 5 minutes.

**Pause** stops planning; the run's pending items are cancelled with `PAUSED`. **Turn off** does the same, clears the schedule and keeps the settings.

### 5.3 Items of smart jobs (`processItem`)

Every item checks the settings as they are now, not as they were when it was planned:
- the `smartAuto` entitlement — missing: the job stops with `PLAN_SMART` and the config pauses with `PLAN`;
- the config is enabled and not paused — otherwise the item is CANCELLED `PAUSED` or `SMART_OFF`;
- the language is still chosen, the type is still in scope, the field groups still share one, and a real-time item's schedule is still real time — otherwise `OUT_OF_SCOPE` (the next check follows the settings);
- the language is still in the store and within the plan's languages (`currentShopLocales`; a copy minutes old that lacks it is confirmed with Shopify first) — otherwise `LANGUAGE_GONE`, before anything is sent;
- the resource isn't excluded, nor (a custom field) its owner — otherwise SKIPPED `EXCLUDED`;
- after the read: the resource's source language is the primary language the settings were saved with — otherwise the job stops with `PRIMARY_LANGUAGE` and the config pauses until the languages are saved again.

Planning:
- `onlyGroups`: the job's field groups narrowed to the current ones;
- `keepOutdatedMachine` (`!replaceOutdatedMachine`, of the job or the current settings) leaves every outdated translation in place, Linguva's own unreviewed machine output included;
- image and custom-field items translate only their editable fields (`isEditableAttachedField`); a real-time item includes them only while the settings still do.

Publishing needs all of the following:
- the job's AUTO_PUBLISH snapshot;
- the config's AUTO_PUBLISH with `publishConfirmedAt`;
- the `autoPublish` entitlement.

Results with warnings always go to Review.

Usage is reserved with `origin 'smart'` and the run's budgets (§5.4).

### 5.4 Budgets and pauses

`reserveUsage` takes an optional `budget: { origin, daily?: { limit, since }, monthly?: { limit, since } }`. Under the existing per-shop advisory lock, it sums the `origin = 'smart'` rows since the local day or month start. If the reservation would exceed a budget, it throws `QuotaExceededError` with scope `smartDaily` or `smartMonthly`. A reservation's settle and release rows carry the reservation's time, so a correction just after midnight (or the 1st) counts in the window it belongs to and never gives the new one room it doesn't have; the shop's daily cap counts the same way.

| Stop | Pause reason | Lifts |
|---|---|---|
| smart daily budget | `BUDGET_DAILY` | next local midnight |
| smart monthly budget | `BUDGET_MONTHLY` | first day of the next local month |
| plan allowance (`QUOTA_EXCEEDED`) | `PLAN_ALLOWANCE` | next UTC month |
| `DAILY_LIMIT` / `PLATFORM_LIMIT` | `DAILY_CAP` | next UTC midnight |
| provider not configured, auth or quota | `PROVIDER` | after 1 hour (re-checked) |
| not entitled | `PLAN` | when the plan includes it again |
| no consent | `CONSENT` | when consent is given again |
| primary language changed | `PRIMARY_LANGUAGE` | the merchant reviews the languages |

- While paused, scheduled occurrences record SKIPPED runs, so the activity shows them.
- The first check after a pause lifts translates whatever is still missing.

### 5.5 Real-time mode

- Webhooks (products, collections) and the 30-minute check (pages, blog posts, blogs) go through the same check basic automatic translation uses (`createAutoItems`), with the smart profile:
  - the config's languages within the plan;
  - its types, field groups, `includeAttached`, publish mode and outdated-machine choice;
  - exclusions;
  - pause and budgets;
  - `requestedBy 'system:smart'`, and a daily real-time job per (type, language) in the schedule's time zone.
- In every other smart mode they queue nothing paid.
- A real-time check joins only the smart schedule's own jobs; while another job is active for the type and language (a merchant's bulk job), it waits for it, so the smart budgets, fields and publishing always hold.
- Turning the smart config on turns basic automatic translation off. The routing refuses to run both. On a plan without the smart schedule (a downgrade), turning basic automatic translation on turns the smart schedule off.

### 5.6 Languages and the primary language

- At every tick, run start, real-time check and smart item, the worker reads the shop's languages (`currentShopLocales`, at most every 5 minutes per process). Targets that are gone or became primary are not translated (the stored choice stays, so a restored language comes back).
- A primary language different from the config's snapshot pauses with `PRIMARY_LANGUAGE`, and a banner asks the merchant to review the languages. Nothing is deleted or replaced.
- Shopify's primary language is never changed: the app sends no locale mutation, and `structure.test.ts` pins this.
- `processItem` refuses a target equal to the resource's source language (`SAME_LANGUAGE`).

### 5.7 Estimates and preview

- **Before enabling:** the preview sums `CoverageCount.chars` over the selected scope (languages, types, field groups; missing and failed fields, and outdated ones when they are replaced; never handles) from the newest measurement and refreshes. Exclusions and people's outdated translations aren't subtracted, so it is an upper bound, labelled "up to … characters before translation memory". Without a measurement, the panel offers "Measure first"; when the newest one is older than the character counts (made before this version), it says "Measure again" rather than showing a figure that would be too low.
- **During a run:** `charsEstimated` is the sum of the planned source characters.
- **After a run**, three figures, each shown as what it is:
  - billed characters (sent to the provider, from the ledger and the job totals);
  - characters reused from translation memory (`charsSaved`) and memory hits;
  - characters not sent because the same text repeated in the request (de-duplication).

  Nothing is called "saved money" or "free".

## 6. Settings UI

### 6.1 Settings → Automatic translation section

**Business:** a status card with a status preview built from real values:
- the state: On, Paused (with the reason) or Off;
- languages;
- schedule;
- next check (local time and zone);
- last successful check;
- changes detected and fields translated in the last run;
- items translating now;
- estimated characters waiting.

Actions: Turn on/off, Pause/Resume, Check now, and Change schedule and options.

**Other plans:** the existing basic toggle, plus a calm Business card that explains the smart schedule and links to the Plan page.

**One pure function** builds the effective state (plan, stored setting, consent, provider and queues, worker heartbeat, pause, languages). Settings, the smart page and the Coverage header all use it.

### 6.2 Page `/app/settings/automatic` (Business; route `app.settings_.automatic.tsx`)

- **Schedule.**
  - Mode (radio choices).
  - Time (24 h, 15-minute steps, `s-select`).
  - Weekdays (multiple choices).
  - Custom times: up to 6 selects.
  - Time zone (the shop's zone first, then Intl's list).
  - The next three checks, computed in the loader.
- **Scope.** Languages (the plan's languages; others named with an upsell), content types, fields (all, or chosen groups), and images and custom fields on or off.
- **Publishing.** Drafts (recommended), or publish automatically. The latter needs a confirmation modal and the `autoPublish` entitlement, and records who and when.
- **Outdated machine translations:** replace or keep.
- **Budgets** per day and per month, next to the plan's allowance and today's and this month's smart spend.
- **Exclusions:** a list with remove buttons. A resource is excluded from its editor ("Leave out of the smart schedule").
- **Cost preview.**
- **Recent activity:** the last 20 runs with their counters and errors, "Retry failed", and links to the jobs.
- **Form handling:** the form carries `version`; a stale one is refused ("changed meanwhile, reload"). The save bar appears for unsaved changes.
- **Standards:** Polaris web components and App Bridge (toasts, save bar, modal); one primary action per section; every text in en, de, fr and es; axe-clean; no sideways scrolling at 412 px; touch targets of 24 px or more.

## 7. Coverage integration

- The Coverage page header for a language: "Smart schedule checks this language — next check today at 23:00 (Europe/Berlin)", or "paused (…)".
- Per language and type, as overlays:
  - fields waiting for the next check (missing or outdated in the smart scope, machine-translatable);
  - items translating now (PENDING or RUNNING items of smart jobs);
  - excluded resources.
- These are overlays on the existing figures, never extra percentages. A completed measurement remains the only source of a percentage, and "all translated" is never claimed while anything is unread, denied or failed.

## 8. Security

- New tables under RLS as in §4. `SmartAutoRun` has no merchant text: only ids, codes, counts and times.
- Every action re-authenticates (`requireShop`) and re-checks entitlement and consent. Loaders have no side effects.
- Every form field is validated on the server:
  - the schedule via `normaliseSchedule` (mode, canonical zone, times, weekdays);
  - locales against the shop's current non-primary languages and the plan's language limit;
  - types against the smart type list (personal-data-prone types only on explicit opt-in);
  - field groups against `FIELD_GROUPS` minus `url`;
  - budgets as integers from 1 to the plan's monthly allowance;
  - exclusion GIDs via `kindOfGid`;
  - automatic publishing only with the entitlement and an explicit confirmation.

  A stale `version` is refused.
- Queue payloads hold ids only (zod `.strict()`). Job ids contain the shop or run id and never `:`.
- Webhooks stay HMAC-verified by the Shopify library.
- Audit log entries (ids and codes only) record enable, disable, pause, resume, run now, schedule, scope, publishing, budgets and exclusions. System pauses use actor type SYSTEM.
- No customer or order scopes. Liquid, e-mails, URLs and placeholders are masked before the provider. Handles, URLs, files and JSON are never machine-translated.
- **Staff:** like every setting, Smart is controlled by any staff member with access to the app. Automatic publishing needs an explicit confirmation and records who gave it.

## 9. Failure and recovery

| Failure | Behaviour |
|---|---|
| Worker restart during a run | Coverage stall repair re-queues the page (10 min); PENDING items without a queue job are re-queued; the run continues |
| Two workers tick at the same time | One job per slot (job scheduler); a unique occurrence row under the per-shop advisory lock; one active run per shop |
| A run's start doesn't get through | The hint brings the tick back within a minute; it starts the QUEUED run (also in manual mode, also after a save or resume) |
| A merchant's bulk job for the same type and language | The check leaves it to that job; a real-time check waits for it (§5.2, §5.5) |
| Shopify 5xx or throttling | Retried with backoff; throttling waits without spending an attempt; a type that keeps failing is skipped and shown as "not fully read" |
| Provider down | Item retries, then DEAD; the run shows failed items with "Retry failed" |
| Budget or cap reached | Job stopped, config paused with the reason, resumes by itself (§5.4) |
| Plan downgraded | The next tick or item sees no `smartAuto`: paused with PLAN (a merchant's own pause stays); basic automatic translation stays available on the lower plan, and turning it on turns the smart schedule off |
| Primary language changed | Paused, banner, nothing deleted (§5.6) |
| Uninstall | Runs and jobs cancelled, the due hint cleared, the config kept but turned off, so a reinstall never resumes checks or publishing without the merchant; `shop/redact` deletes everything |

## 10. Implementation order

1. **Entitlement.** `smartAuto` in `Entitlements` and `PLANS` (Business; UNMETERED and complimentary inherit it), copied in `statusFrom`.
2. **Migration and services.** The tables and columns, the config service with validation, version and audit, the exclusions, and the shop time zone query.
3. **Runtime.** Budgets in the ledger, then the tick, runs, the planning hook, finishing runs, and the `processItem` checks; then the worker wiring.
4. **Real-time.** The routing, and basic automatic translation turned off while Smart is on.
5. **UI.** The Settings card, the upsell, the smart page, the Jobs badges and the Coverage header, in four languages.
6. **Tests, screenshots and documentation** (§11).

## 11. Tests

- **Unit:**
  - schedule, time zones and DST (`tests/unit/schedule.test.ts`);
  - the config validator;
  - the effective state;
  - planning options;
  - the preview sums;
  - budget windows;
  - the message catalogues.
- **Integration (PostgreSQL + Redis):**
  - one run per occurrence across concurrent ticks;
  - one catch-up run after downtime;
  - DST occurrences end to end;
  - a run translates only missing and outdated fields in scope; it respects exclusions, field groups and protection, and creates drafts unless publishing is confirmed;
  - budgets pause and resume;
  - turning it off stops processing and cancels pending items;
  - a webhook in daily mode queues nothing paid;
  - real-time mode routes to the smart path;
  - a primary-language change pauses;
  - worker restart recovery;
  - each provider call is metered once;
  - a downgrade stops the run.
- **Security:**
  - entitlement on every action and in the worker;
  - forged form fields refused, with nothing written;
  - tenant isolation of the new tables;
  - forged queue payloads;
  - no merchant text in the new rows.
- **Performance:** a run over a 5,000-product catalog in bounded pages, with items only for what changed.
- **UI (Playwright, desktop, tablet and phone):**
  - the Business card, the smart page with the schedule picker, preview and activity;
  - the upsell for lower plans;
  - pause, resume and Check now;
  - the confirmation modal;
  - axe and keyboard use;
  - screenshots in `docs/ui-review/smart-auto/`.

## 12. Audit of what existed (2026-10-29)

Seven reviewers checked the existing code requirement by requirement. The audit table is in `docs/FEATURE_STATUS.md` (Smart Auto-Translate). The defects found in the existing pipeline were fixed before the smart scheduler builds on it, each with a test that fails without the fix:

- **Metering:** a usage key reused across runs of one item; billed DeepL batches released after a later batch failed.
- **Queue:** a failed automatic check blocking that resource for 14 days; broken discovery chains never repaired; unlocked requeues and an unconditional item claim; rate-limit waits counted as attempts.
- **Languages and limits:**
  - the plan's language limit not applied to automatic translation;
  - removed or primary languages still translated;
  - a limit stop creating a failed job per change instead of pausing;
  - Turn off not stopping queued items.
- **The 30-minute check:** dropping changes beyond 500 per type; one shop's error stopping it for all shops; ignoring the shared Shopify budget.
- **Protection:**
  - fields refused by the checks billed again on every check;
  - Review approving or rejecting a draft that a later run had replaced;
  - translations removed on purpose re-created;
  - a person's CSV drafts overwritten by machine drafts.
- **Coverage:**
  - false 100 % for unmeasured languages and unreadable types;
  - drafts hidden behind a stale "complete";
  - refreshes skipped during scans;
  - deletions and removed languages kept.
- **Security guard rails:**
  - migration and posture checks that missed isolation-weakening DDL;
  - an auth guard that missed `export async function` routes;
  - secrets not redacted from logs;
  - a replayable `shop/redact`.
