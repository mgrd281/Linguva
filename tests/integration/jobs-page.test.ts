/**
 * The Jobs pages' server side against PostgreSQL (app/.server/jobs/bulk-jobs.ts,
 * stop-fix.ts, job-search.ts): the tabs' counts and the one problem rule (14
 * days, superseded by a newer active or completed job of the same type and
 * language, an uninstalled app's stop left out), every list filter and both
 * page directions, the live group's order, a row's outcomes, a job's pending
 * drafts and latest titles, the attention card's figures, what Retry
 * re-queues (never a permanent failure) and its busy answer, each stop
 * cause's fix check, and the search. Ids passed in from outside never reach
 * another shop's rows. Every time is fixed (NOW), never the clock.
 */
import { PrismaClient, type DraftStatus, type Prisma, type TranslationJob, type TranslationJobItemStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findEngineKey, markEngineKey } from "../../app/.server/credentials/store";
import {
  AUTO_REQUESTED_BY,
  jobCounts,
  jobPendingDrafts,
  jobsAttention,
  latestJobTitles,
  listActiveJobs,
  listJobsPage,
  retryJobItems,
  rowOutcomesByJob,
} from "../../app/.server/jobs/bulk-jobs";
import { searchJobIds } from "../../app/.server/jobs/job-search";
import { stopFix, stopFixContext, stopResumesAt, type StopFixBilling } from "../../app/.server/jobs/stop-fix";
import { engineConsentTokens, getConfig, resetConfigCache } from "../../app/.server/lib/config";
import { setAiConsent } from "../../app/.server/settings/shop-settings";
import { saveSmartSettings, setSmartEnabled } from "../../app/.server/smart/config";
import { loadSmartPanel } from "../../app/.server/smart/panel";
import { retrySmartRun, type SmartDeps } from "../../app/.server/smart/runs";
import type { SmartSettingsValue } from "../../app/.server/smart/validate";
import { upsertInstalledShop } from "../../app/.server/tenancy/shop-service";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { periodKey } from "../../app/.server/usage/usage-ledger";
import { stopGroup } from "../../app/lib/job-view";
import { OWN_KEY_PLAN, PLANS, type Entitlements } from "../../app/lib/plans";
import { SMART_REQUESTED_BY } from "../../app/lib/smart-auto";
import { ownerDb, resetDatabase } from "../support/db";
import { FAKE_AZURE_KEY, ownDeepLKey, ownGoogleKey } from "../support/engine-fixtures";
import { FakeShopifyStore } from "../support/fake-store";
import { seedOwnKey } from "../support/own-keys";

const app = new PrismaClient();
const SECOND = 1000;
const MIN = 60 * SECOND;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Monday, November 2, 2026, 14:09 in Berlin (CET, UTC+1). */
const NOW = new Date("2026-11-02T13:09:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ZERO = { waiting: 0, partial: 0, rejected: 0, sourceChanged: 0, cancelled: 0, retryable: 0 };

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigCache();
});
afterAll(async () => {
  await app.$disconnect();
  await ownerDb.$disconnect();
});

let seq = 0;
const newShop = async (name: string) => (await upsertInstalledShop({ shopDomain: `${name}.myshopify.com` }, app)).shop;

type JobInput = Partial<Omit<Prisma.TranslationJobUncheckedCreateInput, "shopId">>;

/** A job with exact counters and times: terminal jobs finish a minute after they start unless told otherwise. */
async function job(shopId: string, data: JobInput = {}): Promise<TranslationJob> {
  const status = data.status ?? "COMPLETED";
  const createdAt = data.createdAt ? new Date(data.createdAt) : NOW;
  const terminal = status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
  return withTenant(
    shopId,
    (tx) =>
      tx.translationJob.create({
        data: {
          resourceType: "PRODUCT",
          targetLocale: "de",
          discoveryDone: true,
          idempotencyKey: `seed-${++seq}`,
          finishedAt: terminal ? new Date(createdAt.getTime() + MIN) : null,
          ...data,
          shopId,
          status,
          createdAt,
        },
      }),
    app,
  );
}

type ItemInput = { status: TranslationJobItemStatus; code?: string | null; gid?: string; attempts?: number; finishedAt?: Date | null };

/** Items in the order given. */
async function items(shopId: string, jobId: string, seeds: ItemInput[]) {
  const gids = seeds.map((s) => s.gid ?? `gid://shopify/Product/${++seq}`);
  const created = await withTenant(
    shopId,
    (tx) =>
      tx.translationJobItem.createManyAndReturn({
        data: seeds.map((s, i) => ({
          shopId,
          jobId,
          resourceGid: gids[i]!,
          status: s.status,
          errorCode: s.code ?? null,
          attempts: s.attempts ?? 1,
          finishedAt: s.finishedAt !== undefined ? s.finishedAt : s.status === "PENDING" || s.status === "RUNNING" ? null : NOW,
        })),
      }),
    app,
  );
  return gids.map((gid) => created.find((c) => c.resourceGid === gid)!);
}

type DraftInput = { gid: string; key?: string; status?: DraftStatus; parentGid?: string | null; title?: string | null; value?: string; updatedAt?: Date; jobId?: string | null };

async function drafts(shopId: string, jobId: string | null, seeds: DraftInput[]) {
  await withTenant(
    shopId,
    (tx) =>
      tx.translationDraft.createMany({
        data: seeds.map((d) => ({
          shopId,
          jobId: d.jobId !== undefined ? d.jobId : jobId,
          resourceGid: d.gid,
          parentGid: d.parentGid ?? null,
          resourceTitle: d.title ?? null,
          locale: "de",
          key: d.key ?? "title",
          sourceDigest: "d",
          sourceValue: "Source",
          value: d.value ?? "Ziel",
          status: d.status ?? "PENDING",
          ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}),
        })),
      }),
    app,
  );
}

const jobRow = (shopId: string, id: string) => withTenant(shopId, (tx) => tx.translationJob.findUniqueOrThrow({ where: { id } }), app);
const itemRow = (shopId: string, id: string) => withTenant(shopId, (tx) => tx.translationJobItem.findUniqueOrThrow({ where: { id } }), app);
const ids = (jobs: readonly Pick<TranslationJob, "id">[]) => jobs.map((j) => j.id);

describe("jobCounts and the problem rule", () => {
  it("counts every tab in one go; problems: 14 days, not superseded, not an uninstalled app's stop", async () => {
    const s = await newShop("counts");
    const stop = await job(s.id, { status: "FAILED", errorCode: "ENGINE_CONSENT", resourceType: "COLLECTION", targetLocale: "it", createdAt: ago(DAY) });
    // The app was uninstalled: no attention for that.
    await job(s.id, { status: "FAILED", errorCode: "SHOP_INACTIVE", resourceType: "PAGE", targetLocale: "fr", createdAt: ago(DAY) });
    const failed = await job(s.id, { status: "COMPLETED", failedItems: 3, resourceType: "PRODUCT", targetLocale: "it", createdAt: ago(2 * DAY) });
    await job(s.id, { status: "COMPLETED", failedItems: 0, resourceType: "PRODUCT", targetLocale: "fr", createdAt: ago(2 * DAY) });
    // Outside the window, and just inside it.
    await job(s.id, { status: "FAILED", errorCode: "DAILY_LIMIT", resourceType: "PAGE", targetLocale: "de", createdAt: ago(16 * DAY), finishedAt: ago(15 * DAY) });
    const edge = await job(s.id, { status: "FAILED", errorCode: "DAILY_LIMIT", resourceType: "SHOP", targetLocale: "de", createdAt: ago(15 * DAY), finishedAt: ago(14 * DAY - MIN) });
    // Superseded by a newer completed job, and by a newer active one.
    await job(s.id, { status: "FAILED", errorCode: "DAILY_LIMIT", resourceType: "ARTICLE", targetLocale: "de", createdAt: ago(3 * DAY) });
    await job(s.id, { status: "COMPLETED", resourceType: "ARTICLE", targetLocale: "de", createdAt: ago(2 * DAY) });
    await job(s.id, { status: "COMPLETED", failedItems: 2, resourceType: "BLOG", targetLocale: "de", createdAt: ago(5 * DAY) });
    await job(s.id, { status: "RUNNING", resourceType: "BLOG", targetLocale: "de", createdAt: ago(HOUR) });
    // Not superseded: a newer cancelled job, a newer stop, or a newer job of another language.
    const menu = await job(s.id, { status: "FAILED", errorCode: "QUOTA_EXCEEDED", resourceType: "MENU", targetLocale: "de", createdAt: ago(4 * DAY) });
    await job(s.id, { status: "CANCELLED", resourceType: "MENU", targetLocale: "de", createdAt: ago(3 * DAY) });
    const linkOld = await job(s.id, { status: "FAILED", errorCode: "PLAN_REQUIRED", resourceType: "LINK", targetLocale: "de", createdAt: ago(3 * DAY) });
    const linkNew = await job(s.id, { status: "FAILED", errorCode: "PLAN_REQUIRED", resourceType: "LINK", targetLocale: "de", createdAt: ago(2 * DAY) });
    await job(s.id, { status: "PENDING", resourceType: "FILTER", targetLocale: "de", createdAt: ago(MIN) });

    expect(await jobCounts(s.id, {}, NOW, app)).toEqual({ all: 15, active: 2, queued: 1, history: 13, completed: 4, cancelled: 1, problems: 6 });
    const problems = await listJobsPage(s.id, { status: "problems", now: NOW, take: 100 }, app);
    expect(ids(problems.jobs).sort()).toEqual(ids([stop, failed, edge, menu, linkOld, linkNew]).sort());
    // A day later the edge job has left the window.
    expect((await jobCounts(s.id, {}, new Date(NOW.getTime() + DAY), app)).problems).toBe(5);
    // With the list's filters (never the status).
    expect(await jobCounts(s.id, { locale: "it", status: "cancelled" }, NOW, app)).toMatchObject({ all: 2, completed: 1, problems: 2 });
    expect(await jobCounts(s.id, { types: ["MENU", "LINK", "FILTER"] }, NOW, app)).toEqual({ all: 5, active: 1, queued: 1, history: 4, completed: 0, cancelled: 1, problems: 3 });
  });
});

describe("listJobsPage", () => {
  it("filters by tab, area or exact type, who started it, the store's day and a search's ids", async () => {
    const s = await newShop("filters");
    const other = await newShop("filters-other");
    // 00:30 on Nov 2 in Berlin (still Nov 1 in UTC), and 23:30 on Nov 1 in Berlin.
    const berlinToday = await job(s.id, { createdAt: new Date("2026-11-01T23:30:00Z"), requestedBy: "42" });
    const berlinYesterday = await job(s.id, { createdAt: new Date("2026-11-01T22:30:00Z"), requestedBy: null });
    const auto = await job(s.id, { createdAt: ago(2 * HOUR), requestedBy: AUTO_REQUESTED_BY, resourceType: "COLLECTION", status: "CANCELLED", errorCode: "AUTO_OFF" });
    const smart = await job(s.id, { createdAt: ago(3 * DAY), requestedBy: SMART_REQUESTED_BY, resourceType: "MEDIA_IMAGE" });
    const team = await job(s.id, { createdAt: ago(8 * DAY), requestedBy: "77", resourceType: "PRODUCT_METAFIELD", status: "FAILED", errorCode: "DAILY_LIMIT" });
    // Oct 3, 00:30 in Berlin (CEST): within 30 days; Oct 2, 23:30: older.
    const within30 = await job(s.id, { createdAt: new Date("2026-10-02T22:30:00Z"), requestedBy: null, resourceType: "PAGE" });
    const older = await job(s.id, { createdAt: new Date("2026-10-02T21:30:00Z"), requestedBy: "42", resourceType: "PAGE" });
    const foreign = await job(other.id, { createdAt: NOW });
    const list = async (filter: Parameters<typeof listJobsPage>[1]) => ids((await listJobsPage(s.id, { now: NOW, take: 100, ...filter }, app)).jobs);

    // Tabs (newest first).
    expect(await list({ status: "history" })).toEqual(ids([auto, berlinToday, berlinYesterday, smart, team, within30, older]));
    expect(await list({ status: "completed" })).toEqual(ids([berlinToday, berlinYesterday, smart, within30, older]));
    expect(await list({ status: "cancelled" })).toEqual(ids([auto]));
    expect(await list({ status: "failed" })).toEqual(ids([team]));
    expect(await list({ status: "problems" })).toEqual(ids([team]));
    expect(await list({ status: "active" })).toEqual([]);
    // An area's types, an exact (attached) type; a type no job has is ignored.
    expect(await list({ types: ["MEDIA_IMAGE", "COLLECTION_IMAGE", "ARTICLE_IMAGE"] })).toEqual(ids([smart]));
    expect(await list({ resourceType: "PRODUCT_METAFIELD" })).toEqual(ids([team]));
    expect(await list({ types: ["SHOP_POLICY"] })).toHaveLength(7);
    // Who started it: "you" includes the team and jobs from before starters were recorded.
    expect(await list({ origin: "you" })).toEqual(ids([berlinToday, berlinYesterday, team, within30, older]));
    expect(await list({ origin: "auto" })).toEqual(ids([auto]));
    expect(await list({ origin: "smart" })).toEqual(ids([smart]));
    expect(await list({ origin: "everyone" })).toHaveLength(7);
    // The store's days: Berlin's today starts at 23:00 UTC the day before.
    expect(await list({ since: "today", timeZone: "Europe/Berlin" })).toEqual(ids([auto, berlinToday]));
    expect(await list({ since: "today", timeZone: "UTC" })).toEqual(ids([auto]));
    expect(await list({ since: "today", timeZone: "Not/AZone" })).toEqual(ids([auto]));
    expect(await list({ since: "7d", timeZone: "Europe/Berlin" })).toEqual(ids([auto, berlinToday, berlinYesterday, smart]));
    expect(await list({ since: "30d", timeZone: "Europe/Berlin" })).toEqual(ids([auto, berlinToday, berlinYesterday, smart, team, within30]));
    expect(await list({ since: "older", timeZone: "Europe/Berlin" })).toEqual(ids([older]));
    // A search's ids: only this shop's, malformed ones dropped, none found means nothing.
    expect(await list({ ids: [berlinToday.id, smart.id, foreign.id, "not-a-uuid"] })).toEqual(ids([berlinToday, smart]));
    expect(await list({ ids: [] })).toEqual([]);
    expect(await list({ ids: [foreign.id] })).toEqual([]);
    // Filters combine, and the counts agree.
    expect(await list({ origin: "you", since: "30d", timeZone: "Europe/Berlin", status: "completed" })).toEqual(ids([berlinToday, berlinYesterday, within30]));
    expect((await jobCounts(s.id, { since: "7d", timeZone: "Europe/Berlin" }, NOW, app)).all).toBe(4);
    expect((await jobCounts(s.id, { ids: [berlinToday.id, foreign.id] }, NOW, app)).all).toBe(1);
  });

  it("pages 60 jobs forward and back by keyset: nothing skipped or repeated", async () => {
    const s = await newShop("pages");
    // Pairs share a timestamp: the id breaks ties.
    await withTenant(
      s.id,
      (tx) =>
        tx.translationJob.createMany({
          data: Array.from({ length: 60 }, (_, i) => ({
            shopId: s.id,
            resourceType: "PRODUCT",
            targetLocale: i % 2 ? "de" : "fr",
            status: "COMPLETED" as const,
            idempotencyKey: `page-${i}`,
            createdAt: new Date(NOW.getTime() - Math.floor(i / 2) * MIN),
            finishedAt: NOW,
          })),
        }),
      app,
    );
    const forward: TranslationJob[][] = [];
    let page = await listJobsPage(s.id, { take: 25, now: NOW }, app);
    expect(page.prevCursor).toBeNull();
    forward.push(page.jobs);
    while (page.nextCursor) {
      page = await listJobsPage(s.id, { cursor: page.nextCursor, take: 25, now: NOW }, app);
      expect(page.prevCursor).toBe(page.jobs[0]!.id);
      forward.push(page.jobs);
    }
    expect(forward.map((p) => p.length)).toEqual([25, 25, 10]);
    const all = forward.flat();
    expect(new Set(ids(all)).size).toBe(60);
    for (let i = 1; i < all.length; i++) {
      const [a, b] = [all[i - 1]!, all[i]!];
      expect(a.createdAt.getTime() > b.createdAt.getTime() || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id)).toBe(true);
    }
    // Back from the last page: exactly the same pages.
    const back: TranslationJob[][] = [page.jobs];
    let previous = page;
    while (previous.prevCursor) {
      previous = await listJobsPage(s.id, { before: previous.prevCursor, take: 25, now: NOW }, app);
      expect(previous.nextCursor).toBe(previous.jobs.at(-1)!.id);
      back.unshift(previous.jobs);
    }
    expect(back.map(ids)).toEqual(forward.map(ids));
    // A cursor that isn't one of the shop's jobs is the first page; `after` wins over `before`.
    const other = await newShop("pages-other");
    const foreign = await job(other.id);
    expect(ids((await listJobsPage(s.id, { before: foreign.id, take: 25, now: NOW }, app)).jobs)).toEqual(ids(forward[0]!));
    expect(ids((await listJobsPage(s.id, { cursor: forward[0]!.at(-1)!.id, before: forward[2]![0]!.id, take: 25, now: NOW }, app)).jobs)).toEqual(ids(forward[1]!));
    expect((await listJobsPage(other.id, { cursor: forward[0]![3]!.id, take: 25, now: NOW }, app)).jobs.every((j) => j.shopId === other.id)).toBe(true);
  });

  it("keeps a filtered tab's pages exact both ways", async () => {
    const s = await newShop("pages-tab");
    const made: TranslationJob[] = [];
    for (let i = 0; i < 12; i++) made.push(await job(s.id, { status: i % 3 ? "COMPLETED" : "CANCELLED", resourceType: "PAGE", createdAt: ago(i * MIN) }));
    const completed = made.filter((j) => j.status === "COMPLETED");
    const first = await listJobsPage(s.id, { status: "completed", take: 5, now: NOW }, app);
    expect(ids(first.jobs)).toEqual(ids(completed.slice(0, 5)));
    const second = await listJobsPage(s.id, { status: "completed", cursor: first.nextCursor, take: 5, now: NOW }, app);
    expect(ids(second.jobs)).toEqual(ids(completed.slice(5, 8)));
    expect(second.nextCursor).toBeNull();
    const back = await listJobsPage(s.id, { status: "completed", before: second.prevCursor, take: 5, now: NOW }, app);
    expect(ids(back.jobs)).toEqual(ids(first.jobs));
    expect(back.prevCursor).toBeNull();
  });
});

describe("listActiveJobs", () => {
  it("lists the live group running first, then finding, then queued, newest first in each", async () => {
    const s = await newShop("live");
    const other = await newShop("live-other");
    const runningOld = await job(s.id, { status: "RUNNING", createdAt: ago(30 * MIN) });
    const runningNew = await job(s.id, { status: "RUNNING", resourceType: "COLLECTION", createdAt: ago(5 * MIN) });
    const finding = await job(s.id, { status: "RUNNING", discoveryDone: false, resourceType: "PAGE", createdAt: ago(MIN) });
    const discovering = await job(s.id, { status: "DISCOVERING", discoveryDone: false, resourceType: "ARTICLE", createdAt: ago(40 * MIN) });
    const queued = await job(s.id, { status: "PENDING", discoveryDone: false, resourceType: "BLOG", createdAt: ago(10 * SECOND) });
    await job(s.id, { status: "COMPLETED", resourceType: "MENU", createdAt: NOW });
    const foreign = await job(other.id, { status: "RUNNING" });

    expect(ids(await listActiveJobs(s.id, { now: NOW }, 21, app))).toEqual(ids([runningNew, runningOld, finding, discovering, queued]));
    expect(ids(await listActiveJobs(s.id, { now: NOW }, 2, app))).toEqual(ids([runningNew, runningOld]));
    expect(ids(await listActiveJobs(s.id, { types: ["PAGE", "ARTICLE"], status: "completed", now: NOW }, 21, app))).toEqual(ids([finding, discovering]));
    expect(await listActiveJobs(s.id, { ids: [foreign.id], now: NOW }, 21, app)).toEqual([]);
  });
});

describe("a row's outcomes and a job's drafts", () => {
  async function seeded() {
    const s = await newShop("rows");
    const a = await job(s.id, { status: "COMPLETED" });
    const later = await job(s.id, { status: "RUNNING", resourceType: "COLLECTION" });
    const [w1, w2, partial, decided] = await items(s.id, a.id, [
      { status: "SUCCEEDED", code: "DRAFTED" },
      { status: "SUCCEEDED", code: null },
      { status: "SUCCEEDED", code: "PARTIAL" },
      { status: "SUCCEEDED", code: "DRAFTED" },
      { status: "SKIPPED", code: "ALL_FIELDS_REJECTED" },
      { status: "SKIPPED", code: "SOURCE_CHANGED" },
      { status: "SKIPPED", code: "UP_TO_DATE" },
      { status: "CANCELLED", code: "JOB_CANCELLED" },
      { status: "CANCELLED", code: "DAILY_LIMIT" },
      { status: "DEAD", code: "PROVIDER_UNAVAILABLE", attempts: 5 },
      { status: "FAILED", code: null },
      { status: "FAILED", code: "SHOPIFY_UNAVAILABLE" },
      { status: "FAILED", code: "PROVIDER_REJECTED" },
      { status: "FAILED", code: "TOO_LARGE_FOR_LIMIT" },
      { status: "PENDING", code: "PROVIDER_UNAVAILABLE" },
    ]);
    await drafts(s.id, a.id, [
      // Three fields of one item: it waits once.
      { gid: w1!.resourceGid, key: "title" },
      { gid: w1!.resourceGid, key: "body_html" },
      { gid: w1!.resourceGid, key: "meta_title" },
      // Its image's description: the item waits for it.
      { gid: "gid://shopify/MediaImage/9001", key: "alt", parentGid: w2!.resourceGid },
      // Partly translated: incomplete, never waiting.
      { gid: partial!.resourceGid, key: "title" },
      // Decided: approved, or refused.
      { gid: decided!.resourceGid, key: "title", status: "PUBLISHED" },
      { gid: decided!.resourceGid, key: "body_html", status: "REJECTED" },
      // Another job's draft for the same item.
      { gid: decided!.resourceGid, key: "meta_title", jobId: later.id },
    ]);
    return { s, a, later };
  }

  it("rowOutcomesByJob: one statement for all rows, zeros for a job without such items and for another shop's id", async () => {
    const { s, a, later } = await seeded();
    const other = await newShop("rows-other");
    const foreign = await job(other.id, { status: "COMPLETED" });
    const [theirs] = await items(other.id, foreign.id, [{ status: "SUCCEEDED", code: "DRAFTED" }, { status: "DEAD" }]);
    await drafts(other.id, foreign.id, [{ gid: theirs!.resourceGid }]);
    expect(await rowOutcomesByJob(s.id, [a.id, later.id, foreign.id, "not-a-uuid", a.id], app)).toEqual({
      [a.id]: { waiting: 2, partial: 1, rejected: 1, sourceChanged: 1, cancelled: 2, retryable: 3 },
      [later.id]: ZERO,
      [foreign.id]: ZERO,
    });
    expect(await rowOutcomesByJob(other.id, [foreign.id], app)).toEqual({ [foreign.id]: { ...ZERO, waiting: 1, retryable: 1 } });
    expect(await rowOutcomesByJob(s.id, [], app)).toEqual({});
  });

  it("jobPendingDrafts: the job's pending drafts (what Review shows for it) and the items they wait for", async () => {
    const { s, a, later } = await seeded();
    expect(await jobPendingDrafts(s.id, a.id, app)).toEqual({ translations: 5, items: 2 });
    expect(await jobPendingDrafts(s.id, later.id, app)).toEqual({ translations: 1, items: 0 });
    const other = await newShop("drafts-other");
    expect(await jobPendingDrafts(other.id, a.id, app)).toEqual({ translations: 0, items: 0 });
    expect(await jobPendingDrafts(s.id, "' OR 1=1 --", app)).toEqual({ translations: 0, items: 0 });
  });

  it("latestJobTitles: the newest title drafts (never a refused attempt), else the newest finished items", async () => {
    const s = await newShop("latest");
    const drafting = await job(s.id, { status: "RUNNING", publishMode: "DRAFT" });
    const made = await items(s.id, drafting.id, Array.from({ length: 7 }, () => ({ status: "SUCCEEDED" as const, code: "DRAFTED" })));
    await drafts(
      s.id,
      drafting.id,
      made.map((item, i) => ({
        gid: item.resourceGid,
        title: `Jacket ${i}`,
        value: `Jacke ${i}`,
        updatedAt: new Date(NOW.getTime() + i * MIN),
        status: i === 6 ? ("REJECTED" as const) : i === 5 ? ("PUBLISHED" as const) : ("PENDING" as const),
      })),
    );
    await drafts(s.id, drafting.id, [{ gid: made[0]!.resourceGid, key: "body_html", updatedAt: new Date(NOW.getTime() + HOUR) }]);
    expect(await latestJobTitles(s.id, drafting.id, app)).toEqual(
      [5, 4, 3, 2, 1].map((i) => ({ resourceGid: made[i]!.resourceGid, title: `Jacket ${i}`, translated: `Jacke ${i}` })),
    );
    // Automatic publishing without drafts: the newest finished items, named live by the page.
    const publishing = await job(s.id, { status: "RUNNING", publishMode: "AUTO_PUBLISH", resourceType: "COLLECTION" });
    const done = await items(s.id, publishing.id, [
      { status: "SUCCEEDED", finishedAt: ago(3 * MIN) },
      { status: "SUCCEEDED", finishedAt: ago(MIN) },
      { status: "SKIPPED", code: "UP_TO_DATE", finishedAt: NOW },
      { status: "PENDING" },
    ]);
    expect(await latestJobTitles(s.id, publishing.id, app)).toEqual([
      { resourceGid: done[1]!.resourceGid, title: null, translated: null },
      { resourceGid: done[0]!.resourceGid, title: null, translated: null },
    ]);
    const other = await newShop("latest-other");
    expect(await latestJobTitles(other.id, drafting.id, app)).toEqual([]);
  });
});

describe("jobsAttention", () => {
  it("uses the problem rule: stops newest first, failed items of completed jobs only, what a new try can fix", async () => {
    const s = await newShop("attention");
    const types = ["MENU", "LINK", "FILTER", "SHOP", "METAOBJECT"];
    const stops: TranslationJob[] = [];
    for (const [i, type] of types.entries()) {
      stops.push(await job(s.id, { status: "FAILED", errorCode: "DAILY_LIMIT", resourceType: type, createdAt: ago((i + 1) * HOUR + MIN), finishedAt: ago((i + 1) * HOUR) }));
    }
    // Still running: its failures show on its own row and page, not here.
    const running = await job(s.id, { status: "RUNNING", failedItems: 4, resourceType: "PRODUCT", targetLocale: "fr" });
    await items(s.id, running.id, [{ status: "FAILED" }, { status: "DEAD" }, { status: "FAILED" }, { status: "FAILED" }]);
    const italian = await job(s.id, { status: "COMPLETED", failedItems: 3, resourceType: "PRODUCT", targetLocale: "it", finishedAt: ago(2 * HOUR) });
    await items(s.id, italian.id, [{ status: "FAILED", code: "PROVIDER_REJECTED" }, { status: "DEAD", code: "PROVIDER_UNAVAILABLE" }, { status: "FAILED", code: "SHOPIFY_QUERY_ERROR" }]);
    const spanish = await job(s.id, { status: "COMPLETED", failedItems: 2, resourceType: "PRODUCT", targetLocale: "es", finishedAt: ago(HOUR) });
    await items(s.id, spanish.id, [{ status: "DEAD", code: "PROVIDER_UNAVAILABLE" }, { status: "FAILED", code: null }]);
    // Superseded by a newer completed job of its type and language.
    await job(s.id, { status: "COMPLETED", failedItems: 5, resourceType: "PAGE", targetLocale: "de", createdAt: ago(3 * DAY) });
    await job(s.id, { status: "COMPLETED", resourceType: "PAGE", targetLocale: "de", createdAt: ago(2 * DAY) });

    const attention = await jobsAttention(s.id, NOW, app);
    expect(attention.stops.count).toBe(5);
    expect(ids(attention.stops.jobs)).toEqual(ids(stops.slice(0, 4)));
    expect(ids(attention.failed.jobs)).toEqual(ids([spanish, italian]));
    expect(attention.failed).toMatchObject({ count: 5, retryable: 3, jobCount: 2, sameKind: true });
    // The tab's count is the same rule.
    expect((await jobCounts(s.id, {}, NOW, app)).problems).toBe(attention.stops.count + attention.failed.jobCount);

    // Another kind: no longer one kind, and not every failed item can be retried.
    await job(s.id, { status: "COMPLETED", failedItems: 1, resourceType: "COLLECTION", targetLocale: "de", finishedAt: ago(10 * MIN) });
    expect((await jobsAttention(s.id, NOW, app)).failed).toMatchObject({ count: 6, retryable: 3, jobCount: 3, sameKind: false });
    // Nothing calls for attention in another shop.
    const other = await newShop("attention-other");
    expect(await jobsAttention(other.id, NOW, app)).toEqual({ stops: { count: 0, jobs: [] }, failed: { count: 0, retryable: 0, jobCount: 0, jobs: [], sameKind: false } });
  });
});

describe("retryJobItems", () => {
  it("re-queues only what a new try can fix; a permanent failure stays failed and counted", async () => {
    const s = await newShop("retry");
    const done = await job(s.id, { status: "COMPLETED", totalItems: 4, succeededItems: 1, failedItems: 3 });
    const [dead, noCode, refused] = await items(s.id, done.id, [
      { status: "DEAD", code: "PROVIDER_UNAVAILABLE", attempts: 5 },
      { status: "FAILED", code: null },
      { status: "FAILED", code: "PROVIDER_REJECTED" },
      { status: "SUCCEEDED" },
    ]);
    const result = await retryJobItems(s.id, done.id, app);
    expect(result.itemIds.sort()).toEqual([dead!.id, noCode!.id].sort());
    expect(result).toMatchObject({ rediscover: false });
    expect(result).not.toHaveProperty("busy");
    expect(await jobRow(s.id, done.id)).toMatchObject({ status: "RUNNING", failedItems: 1, finishedAt: null });
    expect(await itemRow(s.id, refused!.id)).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_REJECTED" });
    expect(await itemRow(s.id, dead!.id)).toMatchObject({ status: "PENDING", errorCode: null });

    // Only permanent failures: nothing to try, the job stays as it is.
    const permanent = await job(s.id, { status: "COMPLETED", resourceType: "COLLECTION", totalItems: 2, failedItems: 2 });
    await items(s.id, permanent.id, [{ status: "FAILED", code: "TOO_LARGE_FOR_LIMIT" }, { status: "FAILED", code: "SHOPIFY_QUERY_ERROR" }]);
    expect(await retryJobItems(s.id, permanent.id, app)).toEqual({ itemIds: [], rediscover: false });
    expect(await jobRow(s.id, permanent.id)).toMatchObject({ status: "COMPLETED", failedItems: 2 });
  });

  it("resumes a stopped job: its cancelled and retryable items go again, a permanent failure stays", async () => {
    const s = await newShop("resume");
    const stopped = await job(s.id, { status: "FAILED", errorCode: "ENGINE_CONSENT", resourceType: "COLLECTION", targetLocale: "it", totalItems: 5, succeededItems: 1, skippedItems: 2, failedItems: 2 });
    const [first, second, dead, permanent] = await items(s.id, stopped.id, [
      { status: "CANCELLED", code: "ENGINE_CONSENT" },
      { status: "CANCELLED", code: "ENGINE_CONSENT" },
      { status: "DEAD", code: "SHOPIFY_UNAVAILABLE" },
      { status: "FAILED", code: "TOO_LARGE_FOR_LIMIT" },
      { status: "SUCCEEDED" },
    ]);
    const result = await retryJobItems(s.id, stopped.id, app);
    expect(result.itemIds.sort()).toEqual([first!.id, second!.id, dead!.id].sort());
    expect(await jobRow(s.id, stopped.id)).toMatchObject({ status: "RUNNING", errorCode: null, skippedItems: 0, failedItems: 1 });
    expect(await itemRow(s.id, permanent!.id)).toMatchObject({ status: "FAILED", errorCode: "TOO_LARGE_FOR_LIMIT" });
  });

  it("is busy while another job of the same type and language is active, naming it; another shop's job is left alone", async () => {
    const s = await newShop("busy");
    const old = await job(s.id, { status: "COMPLETED", failedItems: 1, createdAt: ago(DAY) });
    const [dead] = await items(s.id, old.id, [{ status: "DEAD", code: "PROVIDER_UNAVAILABLE" }]);
    const active = await job(s.id, { status: "RUNNING", createdAt: ago(MIN) });
    expect(await retryJobItems(s.id, old.id, app)).toEqual({ itemIds: [], rediscover: false, busy: true, busyJobId: active.id });
    expect(await itemRow(s.id, dead!.id)).toMatchObject({ status: "DEAD" });
    const other = await newShop("busy-other");
    expect(await retryJobItems(other.id, old.id, app)).toEqual({ itemIds: [], rediscover: false });
  });

  it("the smart page's retry goes through the same rule", async () => {
    const { shop } = await upsertInstalledShop({ shopDomain: "smart-retry.myshopify.com" }, app);
    await setAiConsent({ shopId: shop.id, granted: true, actorId: null }, app);
    const store = new FakeShopifyStore(2);
    const deps: SmartDeps = { prisma: app, adminFor: async () => store.asAdmin(), billingFor: async () => ({ configured: true, entitlements: PLANS.business }), aiAvailable: true };
    expect(await saveSmartSettings({ shopId: shop.id, actorId: "7", value: schedule(), version: 0, primaryLocale: "en", now: NOW }, app)).not.toBeNull();
    expect((await setSmartEnabled({ shopId: shop.id, actorId: "7", enabled: true, now: NOW }, app)).ok).toBe(true);
    const { run, dead, refused } = await withTenant(
      shop.id,
      async (tx) => {
        const run = await tx.smartAutoRun.create({ data: { shopId: shop.id, trigger: "MANUAL", status: "COMPLETED", locales: ["de"], resourceTypes: ["PRODUCT"], fieldGroups: [], idempotencyKey: "retry-run" } });
        const made = await tx.translationJob.create({
          data: { shopId: shop.id, resourceType: "PRODUCT", targetLocale: "de", requestedBy: SMART_REQUESTED_BY, idempotencyKey: "retry-job", status: "COMPLETED", discoveryDone: true, totalItems: 2, failedItems: 2, smartRunId: run.id, finishedAt: NOW },
        });
        const dead = await tx.translationJobItem.create({ data: { shopId: shop.id, jobId: made.id, resourceGid: "gid://shopify/Product/1", status: "DEAD", errorCode: "PROVIDER_UNAVAILABLE" } });
        const refused = await tx.translationJobItem.create({ data: { shopId: shop.id, jobId: made.id, resourceGid: "gid://shopify/Product/2", status: "FAILED", errorCode: "PROVIDER_REJECTED" } });
        return { run, dead, refused };
      },
      app,
    );
    // The smart page knows what its Retry sends again: one of the two failed items.
    const panel = await loadSmartPanel(shop.id, { entitled: true, consent: true, available: true, allowed: ["de"], shopTimeZone: "Europe/Berlin", now: NOW }, app);
    expect(panel.runs[0]).toMatchObject({ id: run.id, failed: 2, retryable: 1 });
    expect(panel.runs[0]!.jobs).toEqual([expect.objectContaining({ failed: 2, retryable: 1 })]);
    const queued: string[] = [];
    expect(await retrySmartRun(deps, { id: shop.id, shopDomain: shop.shopDomain }, run.id, async (itemIds) => void queued.push(...itemIds), NOW)).toEqual({ ok: true, count: 1 });
    expect(queued).toEqual([dead.id]);
    expect(await itemRow(shop.id, refused.id)).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_REJECTED" });
  });
});

const schedule = (over: Partial<SmartSettingsValue> = {}): SmartSettingsValue => ({
  mode: "daily",
  timeZone: "Europe/Berlin",
  times: [23 * 60],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  locales: ["de"],
  resourceTypes: ["PRODUCT", "COLLECTION"],
  fieldGroups: [],
  includeAttached: false,
  publishMode: "DRAFT",
  replaceOutdatedMachine: true,
  dailyBudget: null,
  monthlyBudget: null,
  ...over,
});

const billed = (entitlements: Entitlements): StopFixBilling => ({ configured: true, entitlements });

/** The check for a job's stop with a fresh context (each loads once). */
async function fixed(shopId: string, stopped: TranslationJob, billing: StopFixBilling, options: { now?: Date; config?: ReturnType<typeof getConfig> } = {}) {
  return stopFix(stopGroup(stopped.errorCode), stopFixContext({ shopId, billing, now: options.now ?? NOW, client: app, ...(options.config ? { config: options.config } : {}) })(stopped));
}

async function usage(shopId: string, chars: number, at: Date, origin: "smart" | null = null) {
  await withTenant(
    shopId,
    (tx) => tx.usageLedger.create({ data: { shopId, periodKey: periodKey(at), kind: "RESERVE", chars, provider: "mock", idempotencyKey: `usage-${++seq}`, origin, createdAt: at } }),
    app,
  );
}

describe("stopFix: whether a stop's cause is fixed", () => {
  it("consent: fixed once the shop allows AI translation", async () => {
    const s = await newShop("fix-consent");
    const stopped = await job(s.id, { status: "FAILED", errorCode: "CONSENT_REQUIRED" });
    expect(await fixed(s.id, stopped, billed(PLANS.pro))).toBe(false);
    await setAiConsent({ shopId: s.id, granted: true, actorId: "7" }, app);
    expect(await fixed(s.id, stopped, billed(PLANS.pro))).toBe(true);
  });

  it("engine consent: fixed once an allowed engine serves the language", async () => {
    const s = await newShop("fix-engine");
    // Allowed while DeepL was the only engine; then Azure was added (fictional keys, fake language lists).
    vi.stubEnv("DEEPL_API_KEY", "fictional-deepl-key:fx");
    resetConfigCache();
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: "7" }, app)).toBe("saved");
    vi.stubEnv("AZURE_TRANSLATOR_KEY", FAKE_AZURE_KEY);
    vi.stubEnv("AZURE_TRANSLATOR_REGION", "westeurope");
    resetConfigCache();
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api-free.deepl.com" && url.pathname === "/v2/languages") return Response.json([{ language: "FR" }]);
      if (url.hostname === "api.cognitive.microsofttranslator.com" && url.pathname === "/languages") return Response.json({ translation: { de: { name: "German" }, fr: { name: "French" } } });
      throw new Error(`unexpected request ${url.hostname}${url.pathname}`);
    });
    const german = await job(s.id, { status: "FAILED", errorCode: "ENGINE_CONSENT", targetLocale: "de" });
    const french = await job(s.id, { status: "FAILED", errorCode: "ENGINE_CONSENT", targetLocale: "fr", resourceType: "COLLECTION" });
    // Only Azure serves German, and the shop hasn't allowed it; DeepL (allowed) serves French.
    expect(await fixed(s.id, german, billed(PLANS.pro))).toBe(false);
    expect(await fixed(s.id, french, billed(PLANS.pro))).toBe(true);
    expect(await setAiConsent({ shopId: s.id, granted: true, actorId: "7", shown: engineConsentTokens(getConfig()) }, app)).toBe("saved");
    expect(await fixed(s.id, german, billed(PLANS.pro))).toBe(true);
  });

  it("plans: fixed once the plan includes bulk translation, or the smart schedule", async () => {
    const s = await newShop("fix-plan");
    const bulk = await job(s.id, { status: "FAILED", errorCode: "PLAN_REQUIRED" });
    const smart = await job(s.id, { status: "FAILED", errorCode: "PLAN_SMART", requestedBy: SMART_REQUESTED_BY, resourceType: "COLLECTION" });
    expect(await fixed(s.id, bulk, billed(PLANS.free))).toBe(false);
    expect(await fixed(s.id, bulk, billed(PLANS.starter))).toBe(true);
    expect(await fixed(s.id, smart, billed(PLANS.pro))).toBe(false);
    expect(await fixed(s.id, smart, billed(PLANS.business))).toBe(true);
  });

  it("Linguva's allowances: today's after midnight UTC or with a bigger limit, the month's with a bigger plan or a new month", async () => {
    const s = await newShop("fix-usage");
    const config = { ...getConfig(), AI_DAILY_CHAR_LIMIT: 1_000 };
    const daily = await job(s.id, { status: "FAILED", errorCode: "DAILY_LIMIT", finishedAt: ago(HOUR) });
    await usage(s.id, 400, ago(DAY));
    await usage(s.id, 1_000, ago(2 * HOUR));
    expect(await fixed(s.id, daily, billed(PLANS.starter), { config })).toBe(false);
    // After midnight UTC: today's characters start from nothing.
    expect(await fixed(s.id, daily, billed(PLANS.starter), { config, now: new Date("2026-11-03T00:05:00Z") })).toBe(true);
    expect(await fixed(s.id, daily, billed(PLANS.starter), { config: { ...config, AI_DAILY_CHAR_LIMIT: 5_000 } })).toBe(true);
    // The own keys pay: no allowance of Linguva's applies.
    expect(await fixed(s.id, daily, billed(OWN_KEY_PLAN), { config })).toBe(true);

    const monthly = await job(s.id, { status: "FAILED", errorCode: "QUOTA_EXCEEDED", resourceType: "COLLECTION" });
    await usage(s.id, PLANS.starter.monthlyChars, ago(HOUR));
    expect(await fixed(s.id, monthly, billed(PLANS.starter))).toBe(false);
    expect(await fixed(s.id, monthly, billed(PLANS.pro))).toBe(true);
    expect(await fixed(s.id, monthly, billed(PLANS.starter), { now: new Date("2026-12-01T00:05:00Z") })).toBe(true);

    // The app's limit for all shops renews at midnight UTC.
    const platform = await job(s.id, { status: "FAILED", errorCode: "PLATFORM_LIMIT", resourceType: "PAGE", finishedAt: ago(HOUR) });
    expect(await fixed(s.id, platform, billed(PLANS.pro))).toBe(false);
    expect(await fixed(s.id, platform, billed(PLANS.pro), { now: new Date("2026-11-03T00:01:00Z") })).toBe(true);

    expect(stopResumesAt("DAILY_LIMIT", NOW)).toEqual(new Date("2026-11-03T00:00:00Z"));
    expect(stopResumesAt("PLATFORM_LIMIT", NOW)).toEqual(new Date("2026-11-03T00:00:00Z"));
    expect(stopResumesAt("QUOTA_EXCEEDED", NOW)).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(stopResumesAt("ENGINE_CONSENT", NOW)).toBeNull();
  });

  it("the smart budgets: a new window in the schedule's zone, a raised budget or none; the primary language once saved", async () => {
    const s = await newShop("fix-smart");
    await saveSmartSettings({ shopId: s.id, actorId: "7", value: schedule({ dailyBudget: 1_000, monthlyBudget: 2_000 }), version: 0, primaryLocale: "en", now: NOW }, app);
    const daily = await job(s.id, { status: "FAILED", errorCode: "SMART_BUDGET_DAILY", requestedBy: SMART_REQUESTED_BY });
    const monthly = await job(s.id, { status: "FAILED", errorCode: "SMART_BUDGET_MONTHLY", requestedBy: SMART_REQUESTED_BY, resourceType: "COLLECTION" });
    await usage(s.id, 2_000, ago(HOUR), "smart");
    expect(await fixed(s.id, daily, billed(PLANS.business))).toBe(false);
    expect(await fixed(s.id, monthly, billed(PLANS.business))).toBe(false);
    // 23:30 UTC is already the next day in Berlin: a new daily window, the same month.
    expect(await fixed(s.id, daily, billed(PLANS.business), { now: new Date("2026-11-02T23:30:00Z") })).toBe(true);
    expect(await fixed(s.id, monthly, billed(PLANS.business), { now: new Date("2026-11-02T23:30:00Z") })).toBe(false);
    // Nov 30, 23:30 UTC is December in Berlin.
    expect(await fixed(s.id, monthly, billed(PLANS.business), { now: new Date("2026-11-30T23:30:00Z") })).toBe(true);
    // A raised budget.
    await saveSmartSettings({ shopId: s.id, actorId: "7", value: schedule({ dailyBudget: 5_000, monthlyBudget: 9_000 }), version: 1, primaryLocale: "en", now: NOW }, app);
    expect(await fixed(s.id, daily, billed(PLANS.business))).toBe(true);
    expect(await fixed(s.id, monthly, billed(PLANS.business))).toBe(true);

    // The store's primary language became German after the languages were saved with English.
    await withTenant(
      s.id,
      (tx) =>
        tx.shopLocale.createMany({
          data: [
            { shopId: s.id, locale: "de", name: "German", primary: true, published: true, syncedAt: NOW },
            { shopId: s.id, locale: "en", name: "English", primary: false, published: true, syncedAt: NOW },
          ],
        }),
      app,
    );
    const primary = await job(s.id, { status: "FAILED", errorCode: "PRIMARY_LANGUAGE", requestedBy: SMART_REQUESTED_BY, resourceType: "PAGE" });
    expect(await fixed(s.id, primary, billed(PLANS.business))).toBe(false);
    await saveSmartSettings({ shopId: s.id, actorId: "7", value: schedule({ locales: ["en"] }), version: 2, primaryLocale: "de", now: NOW }, app);
    expect(await fixed(s.id, primary, billed(PLANS.business))).toBe(true);
  });

  it("own keys: a usable key, the key accepted again or its quota back, or another key accepted since the stop", async () => {
    const s = await newShop("fix-keys");
    const own = billed(OWN_KEY_PLAN);
    const missing = await job(s.id, { status: "FAILED", errorCode: "OWN_KEY_MISSING" });
    expect(await fixed(s.id, missing, own)).toBe(false);
    // On a plan with Linguva's AI, no key is needed.
    expect(await fixed(s.id, missing, billed(PLANS.pro))).toBe(true);
    await seedOwnKey(s.id, { engine: "deepl", apiKey: ownDeepLKey(1) }, { client: app });
    expect(await fixed(s.id, missing, own)).toBe(true);

    const key = (await findEngineKey(s.id, "deepl", app))!;
    const ref = { id: key.id, shopId: s.id, keyVersion: key.keyVersion };
    const refused = await job(s.id, { status: "FAILED", errorCode: "OWN_KEY_AUTH_DEEPL", resourceType: "COLLECTION", finishedAt: new Date(Date.now() - HOUR) });
    await markEngineKey(ref, { status: "REFUSED", lastErrorCode: "OWN_KEY_AUTH_DEEPL", lastErrorAt: new Date() }, app);
    expect(await fixed(s.id, refused, own)).toBe(false);
    await markEngineKey(ref, { status: "OK", lastErrorCode: null, lastErrorAt: null }, app);
    expect(await fixed(s.id, refused, own)).toBe(true);

    const usedUp = await job(s.id, { status: "FAILED", errorCode: "OWN_KEY_QUOTA_DEEPL", resourceType: "PAGE", finishedAt: new Date(Date.now() + HOUR) });
    await markEngineKey(ref, { status: "QUOTA", lastErrorCode: "OWN_KEY_QUOTA_DEEPL", lastErrorAt: new Date() }, app);
    expect(await fixed(s.id, usedUp, own)).toBe(false);
    // A Google key accepted before the stop doesn't count; one accepted after it does.
    await seedOwnKey(s.id, { engine: "google", apiKey: ownGoogleKey(1) }, { client: app });
    expect(await fixed(s.id, usedUp, own)).toBe(false);
    const later = await job(s.id, { status: "FAILED", errorCode: "OWN_KEY_QUOTA_DEEPL", resourceType: "ARTICLE", finishedAt: new Date(Date.now() - HOUR) });
    expect(await fixed(s.id, later, own)).toBe(true);
  });

  it("has no cheap check for reopening the app, Shopify's list, the operator's engines or an unknown cause", async () => {
    const s = await newShop("fix-none");
    const types = ["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG", "SHOP", "MENU"];
    for (const [i, code] of ["SHOP_AUTH", "DISCOVERY_FAILED", "PROVIDER_AUTH", "AI_NOT_CONFIGURED", "SHOP_INACTIVE", "SOMETHING_NEW", null].entries()) {
      const stopped = await job(s.id, { status: "FAILED", errorCode: code, resourceType: types[i]! });
      expect(await fixed(s.id, stopped, billed(PLANS.pro)), String(code)).toBeNull();
    }
  });

  it("says nothing (null) when a check can't be made, never breaking the page", async () => {
    const s = await newShop("fix-error");
    const stopped = await job(s.id, { status: "FAILED", errorCode: "CONSENT_REQUIRED" });
    const context = stopFixContext({ shopId: s.id, billing: billed(PLANS.pro), now: NOW, client: app })(stopped);
    expect(await stopFix("CONSENT_REQUIRED", { ...context, settings: () => Promise.reject(new Error("database is down")) })).toBeNull();
  });

  it("shares one context's reads between the stops of a page", async () => {
    const s = await newShop("fix-shared");
    const context = stopFixContext({ shopId: s.id, billing: billed(PLANS.pro), now: NOW, client: app });
    const first = await job(s.id, { status: "FAILED", errorCode: "CONSENT_REQUIRED" });
    const second = await job(s.id, { status: "FAILED", errorCode: "CONSENT_REQUIRED", resourceType: "COLLECTION" });
    const a = context(first);
    const b = context(second);
    expect(a.settings).toBe(b.settings);
    expect(await Promise.all([stopFix("CONSENT_REQUIRED", a), stopFix("CONSENT_REQUIRED", b)])).toEqual([false, false]);
  });
});

describe("searchJobIds", () => {
  const REF = "7f3a2c10-0000-4000-8000-000000000010";

  async function searchable() {
    const s = await newShop("search");
    const store = new FakeShopifyStore(3).addContent(2);
    store.setField("gid://shopify/Product/3", "title", "Facade lamp");
    const products = await job(s.id, { id: REF, resourceType: "PRODUCT", createdAt: ago(2 * HOUR) });
    await items(s.id, products.id, [{ status: "SUCCEEDED", gid: "gid://shopify/Product/2" }]);
    const pages = await job(s.id, { id: "11111111-0000-4000-8000-000000000001", resourceType: "PAGE", createdAt: ago(HOUR) });
    await items(s.id, pages.id, [{ status: "SUCCEEDED", gid: "gid://shopify/Page/1" }]);
    const lamp = await job(s.id, { id: "22222222-0000-4000-8000-000000000002", resourceType: "PRODUCT", targetLocale: "fr", createdAt: ago(3 * HOUR) });
    await items(s.id, lamp.id, [{ status: "FAILED", gid: "gid://shopify/Product/3" }]);
    // Another shop's job for the same product.
    const other = await newShop("search-other");
    const foreign = await job(other.id, { id: "33333333-0000-4000-8000-000000000003" });
    await items(other.id, foreign.id, [{ status: "SUCCEEDED", gid: "gid://shopify/Product/2" }]);
    return { s, store, products, pages, lamp, foreign };
  }

  it("finds jobs by a product's or page's name through their items, in at most five Shopify calls", async () => {
    const { s, store, products, pages } = await searchable();
    expect(await searchJobIds(store.asAdmin(), s.id, "Product 2", app)).toEqual({ ids: [products.id], partial: false, by: "names" });
    expect(store.calls.filter((c) => c.startsWith("LinguvaSearch"))).toHaveLength(5);
    expect(await searchJobIds(store.asAdmin(), s.id, "about", app)).toEqual({ ids: [pages.id], partial: false, by: "names" });
    expect(await searchJobIds(store.asAdmin(), s.id, "nothing like it", app)).toEqual({ ids: [], partial: false, by: "names" });
  });

  it("finds a job by its reference (the start of its id, dashes allowed), without asking Shopify", async () => {
    const { s, store, products, lamp, foreign } = await searchable();
    expect(await searchJobIds(store.asAdmin(), s.id, "7f3a2c10", app)).toEqual({ ids: [products.id], partial: false, by: "reference" });
    expect(await searchJobIds(store.asAdmin(), s.id, " 7F3A2C10-0000 ", app)).toEqual({ ids: [products.id], partial: false, by: "reference" });
    expect(await searchJobIds(store.asAdmin(), s.id, REF, app)).toEqual({ ids: [products.id], partial: false, by: "reference" });
    expect(store.calls).toEqual([]);
    // Another shop's reference finds nothing here; a name that looks like a reference is searched by name.
    expect(await searchJobIds(store.asAdmin(), s.id, foreign.id.slice(0, 8), app)).toEqual({ ids: [], partial: false, by: "names" });
    expect(await searchJobIds(store.asAdmin(), s.id, "facade", app)).toEqual({ ids: [lamp.id], partial: false, by: "names" });
  });

  it("says when a kind's search failed, and searches nothing below two characters", async () => {
    const { s, store, products } = await searchable();
    const failing = {
      graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
        if (query.includes("LinguvaSearchPages")) throw new Error("Shopify is down");
        return store.graphql(query, options);
      },
    } as unknown as ReturnType<FakeShopifyStore["asAdmin"]>;
    expect(await searchJobIds(failing, s.id, "about", app)).toEqual({ ids: [], partial: true, by: "names" });
    expect(await searchJobIds(failing, s.id, "Product 2", app)).toEqual({ ids: [products.id], partial: true, by: "names" });
    const calls = store.calls.length;
    expect(await searchJobIds(store.asAdmin(), s.id, " a ", app)).toEqual({ ids: null, partial: false, by: null });
    expect(store.calls).toHaveLength(calls);
  });
});
