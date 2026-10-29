# Smart Auto-Translate (Business plan)

Status: design, 2026-10-29. Owner request "Linguva — Premium Smart Auto-Translate 10/10".
Implementation status per requirement: `docs/FEATURE_STATUS.md`; audit of what existed: §11.

## 1. What it is

Smart Auto-Translate keeps a store translated by itself, on a schedule the merchant chooses:

- **Real-time**: changes are translated shortly after Shopify reports them, plus one full check a day at a chosen time (for content Shopify sends no webhook for).
- **Daily**: one full check per day at a chosen local time ("every day at 23:00").
- **Weekly**: one full check at a chosen time on chosen weekdays.
- **Custom**: up to 6 times a day, at least an hour apart, on chosen weekdays.
- **Manual only**: no automatic checks; "Check now" still works.

A check reads the store the way "Measure" on the Coverage page does (every translatable resource, every target language, Shopify's per-field digests and outdated flags), refreshes the coverage figures, and translates **only** the fields that are missing or outdated, in the scope the merchant chose: languages, content types, field groups, with images and custom fields or without, minus excluded resources. Translations become drafts for review unless automatic publishing is explicitly enabled and confirmed.

It's Business-only. Lower plans keep the existing basic automatic translation, which translates products, collections, pages, blog posts and blogs shortly after they change, into chosen languages. The two are told apart in the UI ("Translate changes automatically" vs. "Smart schedule, Business"), and never run for the same shop at once.

## 2. Principles

1. **Never silently drop a change.** A check is a full, checkpointed read of the selected scope. It has no cap and no window that could leave a gap. A budget stop pauses: the next check after the reset finds whatever is still missing.
2. **Never pay for what didn't change.** Field-level planning (`planResourceWork`): current translations are never touched; translations a person wrote or approved, or that another app made, are protected; fields with a pending or rejected draft for the same source are skipped. Translation memory and in-request de-duplication run before the provider. Every provider call is metered once, under its own key.
3. **A daily schedule never translates in between.** In daily, weekly, custom and manual modes, webhooks and the 30-minute sweep only refresh coverage (free) and queue nothing paid.
4. **Exactly one run per scheduled occurrence**, however many workers tick: a unique `(shopId, occurrenceAt)` row decides.
5. **Safe defaults**: off; drafts; no replacing of protected translations; the plan's allowance and the platform caps always apply on top of the merchant's own budgets.
6. **Server-side entitlement** at every step: saving settings, creating a run, each scan step, each item.

## 3. Schedule semantics (`app/lib/schedule.ts`)

- Check times are wall-clock times in the schedule's IANA time zone. The default is the shop's own (`shop.ianaTimezone` from the Admin API), and the merchant can choose another.
- **Daylight saving.** A local time skipped by a jump runs the same distance after the jump: 02:30 becomes 03:30 when 02:00 jumps to 03:00 (Temporal's "compatible" rule). A local time that exists twice runs once, the first time.
- `nextOccurrence(spec, after)` gives the first instant strictly after `after`. The stored `nextRunAt` is always an occurrence of the current spec.
- **Missed occurrences** (the worker was down): when a tick finds `nextRunAt` in the past, it creates **one** run keyed by that occurrence. The next occurrence is then computed from *now*, so an outage of three days causes one catch-up check, not three.
- **Budgets** count per local day and local month in the schedule's time zone (`startOfLocalDay`, `startOfLocalMonth`).

## 4. Data model (migration `…_smart_auto`)

All new tables are tenant tables: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_isolation` on `shop_id = current_setting('app.shop_id')`, grants for the runtime role, a `SECURITY_MODEL.md` change-review section, and `tests/unit/migration-review.test.ts` passing.

- `SmartAutoConfig` (one per shop): `enabled`, `mode`, `timeZone`, `times Int[]` (minutes after local midnight), `weekdays Int[]` (ISO 1–7), `locales`, `resourceTypes`, `fieldGroups` (empty = all but URL handles), `includeAttached`, `publishMode` + `publishConfirmedAt/By`, `replaceOutdatedMachine`, `dailyBudget`, `monthlyBudget` (characters, null = no limit beyond the plan), `pausedAt`, `pauseReason`, `pausedUntil` (budget pauses lift by themselves), `nextRunAt`, `lastSuccessAt`, `primaryLocale` (a snapshot used to notice a change), `version` (optimistic concurrency for the settings form).
- `SmartAutoRun` (append-only activity, kept 90 days): `trigger` (SCHEDULED, MANUAL, REALTIME_DAILY), `occurrenceAt` (unique per shop when set), `status` (QUEUED, WAITING, RUNNING, COMPLETED, FAILED, CANCELLED, SKIPPED), `skipReason`, a snapshot of the scope, `coverageReportId`, counters (`resourcesChecked`, `resourcesChanged`, `fieldsDetected`, `charsEstimated`, `itemsQueued`, `excludedSkipped`), `errorCode`, timestamps.
- `SmartAutoExclusion`: `(shopId, resourceGid)` primary key, `resourceType`, `createdBy`, `createdAt`.
- `TranslationJob`: new nullable `smartRunId`; `fieldGroups String[]` (empty = all); `replaceOutdatedMachine Boolean @default(true)`. Smart jobs have `requestedBy = 'system:smart'`.
- `UsageLedger`: new nullable `origin` (`'smart'`), copied to the settle and release rows, so smart spend per local day and month is a sum.
- `CoverageItem`: new `pendingChars Int @default(0)`: the characters of machine-translatable fields that are missing or outdated. This gives an estimate before anything is sent.
- `Shop`: new nullable `smartNextRunAt` (indexed), a due index for the tick outside RLS. It mirrors `SmartAutoConfig.nextRunAt` and is written in the same transaction.

## 5. Runtime

### 5.1 Tick

A BullMQ job scheduler `smart-tick` (`upsertJobScheduler`, every 60 s) on a new queue `translation-smart`. It is idempotent: N workers produce one job per slot. Each tick:

1. Lists `Shop` rows that are ACTIVE with `smartNextRunAt <= now` (the due index), plus shops whose budget pause has expired.
2. For each shop, opens a tenant transaction with `pg_advisory_xact_lock('smart:<shop>')` and re-reads the config. If it is no longer due, it does nothing.
3. Checks, in this order: entitlement (`smartAuto`), consent, provider, primary language (§5.6), pause, and the daily or monthly budget. A failed check either pauses with a reason or records a SKIPPED run.
4. If a run is already active, the occurrence is coalesced: no second run, and the next occurrence is computed.
5. Otherwise it inserts `SmartAutoRun(occurrenceAt = nextRunAt)` with `ON CONFLICT DO NOTHING`, then advances `nextRunAt` and `Shop.smartNextRunAt` to `nextOccurrence(spec, now)`. After the commit it starts the run (§5.2).

### 5.2 Run = a full measurement plus translation of the selected scope

- A run starts a coverage report through the existing `createCoverageReport`. It covers all target languages and all coverage types, so the Overview's "newest completed measurement" keeps its meaning, and the report has `smartRunId` set. If a measurement the merchant started is already under way, the run is WAITING and starts when that measurement ends (the tick re-checks).
- `runCoveragePage` is unchanged for normal reports. For a smart report, after the page commits, a hook plans each resource of the page with `planResourceWork`. The resource must be in the run's languages and types, not excluded, and only the selected field groups count; `replaceOutdatedMachine` also applies. Attached types (images, custom fields) queue their owner, with `includeAttached`.
- Each resource that needs work gets an item in the run's job for (owner type, language). The job is created on first use with `requestedBy 'system:smart'` and `smartRunId`, a snapshot of the publish mode and field groups, and the same `job:<shop>:<type>:<locale>` advisory lock as bulk jobs. The items go through the unchanged item pipeline.
- The run counters are updated in the same transaction as the page.
- Checkpointing, stall repair, skipping after retries, denied scopes and the reconciliation of deleted resources (`finishSegmentTx`) are the coverage report's. A smart report finishes like any report. The run is COMPLETED when its report completes and every item has finished; `lastSuccessAt` is set then.
- **Run now** creates a MANUAL run the same way.
- **Pause** stops queueing; the run's pending items are cancelled with reason PAUSED. **Turn off** does the same and clears the schedule.

### 5.3 Item processing for smart jobs

- `processItem` re-checks the `smartAuto` entitlement. If it is missing, the job stops with `PLAN_SMART` and the config is paused.
- `planResourceWork` gets two new options: `onlyGroups`, the field groups through `fieldGroupOf`, and `keepOutdatedMachine` (`replaceOutdatedMachine = false`), which leaves every outdated translation in place, Linguva's own unreviewed machine output included.
- Publishing: `autoPublish = job.publishMode AUTO_PUBLISH && entitlements.autoPublish && config.publishConfirmedAt`. Results with warnings always go to Review.

### 5.4 Budgets and pauses

- `reserveUsage` gets an optional `budget: { origin, daily?: { limit, since }, monthly?: { limit, since } }`. Under the existing per-shop advisory lock, it sums `origin = 'smart'` rows since the local day or month start. If the reservation would exceed the budget, it throws `QuotaExceededError('smart-daily' | 'smart-monthly')`.
- A smart job stopped by a budget or a cap pauses the config:

  | Stop | Pause reason | Lifts |
  |---|---|---|
  | `SMART_BUDGET_DAILY` | `BUDGET_DAILY` | next local midnight |
  | `SMART_BUDGET_MONTHLY` | `BUDGET_MONTHLY` | next local month |
  | `QUOTA_EXCEEDED` (plan allowance) | `PLAN_ALLOWANCE` | next month (UTC) |
  | `DAILY_LIMIT` / `PLATFORM_LIMIT` | `DAILY_CAP` | next UTC midnight |
  | Provider missing or auth | `PROVIDER` | manual resume |

- While paused, scheduled occurrences record SKIPPED runs, so the activity shows them. The first check after the pause lifts translates whatever is still missing.

### 5.5 Real-time mode (Business)

- Webhooks (products, collections) and the 30-minute sweep (pages, blog posts, blogs) route a Business shop with an enabled smart config in REALTIME mode to the smart path: the same check as basic automatic translation, but with the smart scope, exclusions, budgets and publish settings, and `requestedBy 'system:smart'`.
- In every other smart mode they queue nothing paid.
- Basic automatic translation (`ShopSettings.autoTranslateNew`) is switched off when the smart config is enabled. The routing also refuses to run both.

### 5.6 Languages and the primary language

- At every run start and real-time check, the worker reads the shop's languages (`fetchAndSyncShopLocales` with the offline session). Targets that are gone, or that became primary, are dropped, and an audit entry is written.
- When the primary language differs from the config's snapshot, the config is paused with `PRIMARY_LANGUAGE` and a banner asks the merchant to review the languages. Nothing is deleted or replaced, and Shopify's primary language is never changed (the app sends no locale mutation; `structure.test.ts` pins this).
- `processItem` refuses a target equal to the resource's source language.

### 5.7 Estimates and preview

- **Before enabling:** the preview sums `CoverageItem.pendingChars` over the selected scope, minus exclusions, from the newest measurement. It is labelled "up to … characters, before translation memory". If no measurement exists yet, the panel offers "Measure first".
- **During a run:** `charsEstimated` is the sum of the planned source lengths.
- **After a run:** billed characters (sent to the provider, from the ledger and the job totals), characters reused from memory (`charsSaved`) and memory hits, each shown as what it is. Nothing is called "saved money" or "free".

## 6. Settings UI

- **Settings → Automatic translation section.**
  - Business: a status card ("Automatic translation: On / Paused / Off") with the preview block: languages, schedule, next check, last successful check, changed fields detected, translation status, estimated characters. Its actions are Turn on/off, Pause/Resume, Check now, and Change schedule and options.
  - Other plans: the existing basic toggle, renamed, and a calm Business card explaining the smart schedule with a link to the Plan page.
- **`/app/automatic` page (Business).**
  - Schedule:
    - a segmented mode picker;
    - a time field (24 h, 15-minute steps);
    - weekday chips;
    - a time zone select (the shop's zone first) with the next three checks shown live.
  - Scope: languages (checkboxes), content types, and fields (all, or chosen groups), with images and custom fields on or off.
  - Publishing: drafts (recommended), or publish automatically. The latter needs a confirmation modal and the `autoPublish` entitlement.
  - Outdated machine translations: replace or keep.
  - Budgets per day and per month, with the plan's allowance and today's and this month's smart spend.
  - Exclusions: a list with remove buttons. A resource is added from its editor ("Don't translate automatically").
  - Cost preview.
  - Recent activity: the last 20 runs, with "Retry failed" and links to the jobs.
- Polaris web components only, one primary action per section, every text in en/de/fr/es, axe-clean, no sideways scrolling on phones.

## 7. Coverage integration

- The Coverage page header for the selected language: "Automatic translation checks this language — next check today 23:00", or "paused (…)".
- Counts of fields waiting for the next check (missing or outdated in the smart scope), items being translated now (pending or running items of smart jobs), and resources excluded.
- These are overlays on the existing figures, never extra percentages. A measurement remains the only source of a percentage.

## 8. Security

- New tables under RLS as in §4.
- Every action re-authenticates (`requireShop`) and re-checks entitlement and consent.
- Every form field is validated:
  - schedule via `normaliseSchedule`;
  - locales against the shop's current non-primary languages and the plan's language limit;
  - types against `SUPPORTED_BULK_RESOURCE_TYPES`;
  - field groups against `FIELD_GROUPS`;
  - budgets as integers in a bounded range;
  - exclusion GIDs via `kindOfGid`.
- The settings form carries `version`; a stale form is refused with "changed meanwhile".
- Queue payloads hold ids only (zod strict). Webhooks stay HMAC-verified by the Shopify library.
- No customer or order scopes. Liquid, e-mails, URLs and placeholders are masked before the provider. Handles, URLs, files and JSON are never machine-translated.

## 9. Failure and recovery

| Failure | Behaviour |
|---|---|
| Worker restart during a run | Coverage stall repair re-queues the page (10 min); queue job ids make items idempotent; the run continues |
| Two workers tick at the same time | One job per slot (job scheduler); a unique occurrence row, under the per-shop advisory lock |
| Shopify 5xx or throttling | Retried with backoff; throttling waits without spending an attempt; a type that keeps failing is skipped and shown as "not fully read" |
| Provider down | Item retries, then DEAD; the run shows failed items with "Retry failed" |
| Budget or cap reached | Job stopped, config paused with the reason, resumes by itself (§5.4) |
| Plan downgraded | The next tick or item sees no `smartAuto`: paused with PLAN; basic automatic translation stays available on the lower plan |
| Primary language changed | Paused, banner, nothing deleted (§5.6) |
| Uninstall | Runs cancelled with the shop's jobs; config kept until `shop/redact` deletes everything |

## 10. Tests

- **Unit:** schedule, timezones and DST (`tests/unit/schedule.test.ts`); settings validation; planning options; preview sums; message catalogues.
- **Integration (PostgreSQL + Redis):**
  - a tick creates one run per occurrence across concurrent ticks;
  - one catch-up run after downtime;
  - DST occurrences end to end;
  - a run translates only missing and outdated fields, respects exclusions, field groups and protection, and creates drafts unless publishing is confirmed;
  - budgets pause and resume;
  - turning it off stops future processing and cancels pending items;
  - a webhook in daily mode queues nothing paid;
  - real-time mode routes to the smart path;
  - a primary-language change pauses;
  - worker restart recovery (stall repair);
  - each provider call is metered once.
- **Security:** entitlement on every action and in the worker; forged form fields; tenant isolation of the new tables; no smart run for a lower plan.
- **Performance:** a run over a 5,000-product catalog in bounded pages, with items only for what changed.
- **UI (Playwright, desktop and mobile):**
  - the Business panel, schedule picker, preview and activity;
  - the upsell for lower plans;
  - pause, resume and check now;
  - axe;
  - screenshots in `docs/ui-review/smart-auto/`.

## 11. Audit of what existed (2026-10-29)

Seven reviewers checked the existing code requirement by requirement. The full table is in `docs/FEATURE_STATUS.md` §Smart Auto-Translate. The defects found in the existing pipeline are fixed before the smart scheduler builds on it:

- the usage key reused across runs of one item, so later provider calls were unmetered and skipped the caps;
- a failed automatic check blocking that resource for 14 days;
- rejected fields billed again on every check;
- the plan's language limit not applied to automatic translation;
- removed or primary languages still translated;
- the sweep dropping changes beyond 500 per type;
- a failed automatic job created for every change while a limit blocks;
- broken discovery chains never repaired;
- unlocked requeues and an unconditional item claim;
- rate-limit waits counted as attempts;
- Review approving a draft row that a later run had replaced;
- removed translations re-created;
- human CSV drafts overwritten by machine drafts.
