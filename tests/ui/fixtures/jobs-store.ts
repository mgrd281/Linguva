/**
 * The Jobs pages' store (`jobs` in shops.ts): one job in each state the list
 * and a job's page draw, with items whose outcomes add up to its counters,
 * and the drafts that wait for approval. Times are relative to the seed, so
 * the day groups read Today, Yesterday and earlier days. Seeded by the
 * global setup as the database owner (row-level security: the shop is set
 * for each transaction).
 */
import type { Prisma, PrismaClient, TranslationJobItemStatus } from "@prisma/client";
import { localDayStart } from "../../../app/.server/jobs/bulk-jobs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The staff member the UI tests' session tokens name (helpers.ts sessionToken): their jobs say "by you". */
export const JOBS_ACTOR = "42";

type ItemSpec = { status: TranslationJobItemStatus; code?: string | null; attempts?: number; draft?: boolean };

interface JobSpec {
  key: string;
  resourceType: string;
  targetLocale: string;
  status: "PENDING" | "DISCOVERING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  requestedBy?: string | null;
  publishMode?: "DRAFT" | "AUTO_PUBLISH";
  discoveryDone?: boolean;
  errorCode?: string | null;
  /** How long ago it started (today's jobs), or the store-zone day and hour it started (older ones: their day never shifts at midnight). */
  ago?: number;
  day?: { back: number; hour: number };
  /** How long it ran (null: still running). */
  ran?: number | null;
  charsBilled?: number;
  charsSaved?: number;
  /** Items found but not looked at yet (PENDING). */
  open?: number;
  items: ItemSpec[];
  /** The GID kind of its items. */
  gidKind: string;
}

const repeat = (count: number, item: ItemSpec): ItemSpec[] => Array.from({ length: count }, () => item);

/** The jobs, newest first. */
export const JOB_SPECS: JobSpec[] = [
  // Running, review mode: 17 wait for approval, 4 were up to date, 1 incomplete, 2 failed (one a new try can fix), 16 to do.
  {
    key: "running",
    resourceType: "PRODUCT",
    targetLocale: "fr",
    status: "RUNNING",
    requestedBy: JOBS_ACTOR,
    discoveryDone: true,
    ago: 12 * MINUTE,
    ran: null,
    charsBilled: 18_400,
    charsSaved: 2_600,
    gidKind: "Product",
    items: [
      { status: "SUCCEEDED", code: "PARTIAL" },
      { status: "FAILED", code: "PROVIDER_UNAVAILABLE", attempts: 3 },
      { status: "FAILED", code: "PROVIDER_REJECTED" },
      ...repeat(17, { status: "SUCCEEDED", code: "DRAFTED", draft: true }),
      ...repeat(4, { status: "SKIPPED", code: "UP_TO_DATE" }),
    ],
    open: 16,
  },
  // Queued a minute ago.
  { key: "queued", resourceType: "COLLECTION", targetLocale: "it", status: "PENDING", requestedBy: JOBS_ACTOR, ago: 1 * MINUTE, ran: null, gidKind: "Collection", items: [] },
  // Stopped two hours ago: AI translation isn't allowed (the store has no permission), 3 of 8 live.
  {
    key: "stopped",
    resourceType: "COLLECTION",
    targetLocale: "de",
    status: "FAILED",
    errorCode: "CONSENT_REQUIRED",
    requestedBy: JOBS_ACTOR,
    publishMode: "AUTO_PUBLISH",
    discoveryDone: true,
    ago: 2 * HOUR + 10 * MINUTE,
    ran: 10 * MINUTE,
    charsBilled: 2_100,
    gidKind: "Collection",
    items: [...repeat(3, { status: "SUCCEEDED", code: null }), ...repeat(3, { status: "CANCELLED", code: "CONSENT_REQUIRED" })],
  },
  // Stopped half an hour ago: today's AI allowance is used up; it goes on after midnight UTC.
  {
    key: "daily",
    resourceType: "PRODUCT",
    targetLocale: "es",
    status: "FAILED",
    errorCode: "DAILY_LIMIT",
    requestedBy: JOBS_ACTOR,
    publishMode: "AUTO_PUBLISH",
    discoveryDone: true,
    ago: 40 * MINUTE,
    ran: 10 * MINUTE,
    charsBilled: 9_800,
    gidKind: "Product",
    items: [...repeat(6, { status: "SUCCEEDED", code: null }), ...repeat(4, { status: "CANCELLED", code: "DAILY_LIMIT" })],
  },
  // Yesterday: pages, published, one failed for good.
  {
    key: "errors",
    resourceType: "PAGE",
    targetLocale: "fr",
    status: "COMPLETED",
    requestedBy: "7",
    publishMode: "AUTO_PUBLISH",
    discoveryDone: true,
    day: { back: 1, hour: 10 },
    ran: 4 * MINUTE,
    charsBilled: 3_200,
    gidKind: "Page",
    items: [...repeat(2, { status: "SUCCEEDED", code: null }), { status: "SKIPPED", code: "UP_TO_DATE" }, { status: "FAILED", code: "PROVIDER_REJECTED" }],
  },
  // Two days ago, automatic translation: every collection live.
  {
    key: "live",
    resourceType: "COLLECTION",
    targetLocale: "fr",
    status: "COMPLETED",
    requestedBy: "system:auto",
    publishMode: "AUTO_PUBLISH",
    discoveryDone: true,
    day: { back: 2, hour: 6 },
    ran: 6 * HOUR,
    charsBilled: 1_500,
    charsSaved: 300,
    gidKind: "Collection",
    items: repeat(2, { status: "SUCCEEDED", code: null }),
  },
  // Three days ago: a blog post no field of which passed the checks.
  {
    key: "gaps",
    resourceType: "ARTICLE",
    targetLocale: "de",
    status: "COMPLETED",
    requestedBy: JOBS_ACTOR,
    discoveryDone: true,
    day: { back: 3, hour: 11 },
    ran: 2 * MINUTE,
    charsBilled: 800,
    gidKind: "Article",
    items: [{ status: "SUCCEEDED", code: "DRAFTED" }, { status: "SUCCEEDED", code: "DRAFTED" }, { status: "SKIPPED", code: "ALL_FIELDS_REJECTED" }],
  },
  // Five days ago: cancelled with 8 of 20 done.
  {
    key: "cancelled",
    resourceType: "PRODUCT",
    targetLocale: "it",
    status: "CANCELLED",
    requestedBy: JOBS_ACTOR,
    publishMode: "AUTO_PUBLISH",
    discoveryDone: true,
    day: { back: 5, hour: 9 },
    ran: 3 * MINUTE,
    charsBilled: 4_400,
    gidKind: "Product",
    items: [...repeat(8, { status: "SUCCEEDED", code: null }), ...repeat(12, { status: "CANCELLED", code: "JOB_CANCELLED" })],
  },
  // Eight days ago: one click started products and collections together; everything was up to date.
  {
    key: "click:PRODUCT",
    resourceType: "PRODUCT",
    targetLocale: "de",
    status: "COMPLETED",
    requestedBy: JOBS_ACTOR,
    discoveryDone: true,
    day: { back: 8, hour: 9 },
    ran: 1 * MINUTE,
    gidKind: "Product",
    items: repeat(5, { status: "SKIPPED", code: "UP_TO_DATE" }),
  },
  {
    key: "click:COLLECTION",
    resourceType: "COLLECTION",
    targetLocale: "de",
    status: "COMPLETED",
    requestedBy: JOBS_ACTOR,
    discoveryDone: true,
    day: { back: 8, hour: 9 },
    ran: 1 * MINUTE,
    gidKind: "Collection",
    items: repeat(2, { status: "SKIPPED", code: "UP_TO_DATE" }),
  },
];

/** The fixtures' store zone (FakeShopifyStore's ianaTimezone). */
const STORE_ZONE = "Europe/Berlin";

function startOf(spec: JobSpec, now: Date): Date {
  if (spec.day) return new Date(localDayStart(now, STORE_ZONE, spec.day.back).getTime() + spec.day.hour * HOUR);
  return new Date(now.getTime() - (spec.ago ?? 0));
}

/** The seeded jobs' ids by key (the specs open their pages). */
export type SeededJobs = Record<string, string>;

export async function seedJobsStore(owner: PrismaClient, shopId: string, now = new Date()): Promise<SeededJobs> {
  const ids: SeededJobs = {};
  for (const spec of JOB_SPECS) {
    ids[spec.key] = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.shop_id', ${shopId}, true)`;
      // The click's second job started a second after its first (newest first: it lists first).
      const created = new Date(startOf(spec, now).getTime() + (spec.key === "click:COLLECTION" ? -1_000 : 0));
      const finished = spec.ran != null ? new Date(created.getTime() + spec.ran) : null;
      const count = (status: TranslationJobItemStatus) => spec.items.filter((i) => i.status === status).length;
      const job = await tx.translationJob.create({
        data: {
          shopId,
          resourceType: spec.resourceType,
          targetLocale: spec.targetLocale,
          status: spec.status,
          requestedBy: spec.requestedBy ?? null,
          idempotencyKey: `ui-jobs-${spec.key}`,
          publishMode: spec.publishMode ?? "DRAFT",
          discoveryDone: spec.discoveryDone ?? false,
          errorCode: spec.errorCode ?? null,
          totalItems: spec.items.length + (spec.open ?? 0),
          succeededItems: count("SUCCEEDED"),
          // The skipped counter also counts cancelled items.
          skippedItems: count("SKIPPED") + count("CANCELLED"),
          failedItems: count("FAILED") + count("DEAD"),
          charsBilled: spec.charsBilled ?? 0,
          charsSaved: spec.charsSaved ?? 0,
          createdAt: created,
          startedAt: spec.status === "PENDING" ? null : created,
          finishedAt: finished,
          updatedAt: finished ?? now,
        },
      });
      const items: Prisma.TranslationJobItemCreateManyInput[] = [];
      const drafts: Prisma.TranslationDraftCreateManyInput[] = [];
      spec.items.forEach((item, i) => {
        const resourceGid = `gid://shopify/${spec.gidKind}/${i + 1}`;
        items.push({
          shopId,
          jobId: job.id,
          resourceGid,
          status: item.status,
          errorCode: item.code ?? null,
          attempts: item.attempts ?? 1,
          finishedAt: finished ?? now,
        });
        if (item.draft) {
          drafts.push({
            shopId,
            jobId: job.id,
            resourceGid,
            locale: spec.targetLocale,
            key: "title",
            sourceDigest: `ui-jobs-${spec.key}-${i}`,
            sourceValue: `Item ${i + 1}`,
            value: `Article ${i + 1}`,
            status: "PENDING",
          });
        }
      });
      for (let i = 0; i < (spec.open ?? 0); i++) {
        items.push({ shopId, jobId: job.id, resourceGid: `gid://shopify/${spec.gidKind}/${spec.items.length + i + 1}`, status: "PENDING", attempts: 0 });
      }
      if (items.length) await tx.translationJobItem.createMany({ data: items });
      if (drafts.length) await tx.translationDraft.createMany({ data: drafts });
      return job.id;
    });
  }
  return ids;
}
