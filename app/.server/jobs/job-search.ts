/**
 * The Jobs list's search: a job's reference (the start of its id, as the
 * job page shows it), or the name of a product, collection, page, blog post or
 * blog the job translated. Names are searched in Shopify (one search per kind,
 * at most five calls, each settled so a failing one only makes the result
 * partial), then the jobs are found through their items in the database
 * (TranslationJobItem (shopId, resourceGid)). Never part of a polling loader.
 */
import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { settle } from "../shopify/preview-images";
import { searchIds, SEARCHABLE_TYPES } from "../shopify/search-ids";
import { withTenant } from "../tenancy/with-tenant";
import { JOB_IDS_MAX } from "./bulk-jobs";

type Admin = Pick<AdminApiContext, "graphql">;

/** Shorter searches aren't run (the list waits for a second character). */
export const JOB_SEARCH_MIN = 2;
export const JOB_SEARCH_MAX = 100;

export interface JobSearch {
  /** The jobs found (at most JOB_IDS_MAX, newest first); null: no search (too short). */
  ids: string[] | null;
  /** A kind's name search failed: jobs of that kind may be missing. */
  partial: boolean;
  /** What matched: a reference, names, or nothing to search. */
  by: "reference" | "names" | null;
}

/**
 * The lowest and highest id starting with a reference: 6 to 32 hexadecimal
 * digits, dashes allowed (36 characters at most); null for anything else.
 */
export function referenceRange(text: string): { from: string; to: string } | null {
  if (!/^[0-9a-f-]{6,36}$/i.test(text)) return null;
  const hex = text.replace(/-/g, "").toLowerCase();
  if (hex.length < 6 || hex.length > 32) return null;
  const uuid = (digits: string) => `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
  return { from: uuid(hex.padEnd(32, "0")), to: uuid(hex.padEnd(32, "f")) };
}

/**
 * The jobs a search term finds: by reference first; a term that reads like a
 * reference but matches none (a product called "Facade") is searched by name
 * too. Only this shop's jobs, through its tenant.
 */
export async function searchJobIds(admin: Admin, shopId: string, q: string, client: PrismaClient = defaultClient): Promise<JobSearch> {
  const text = q.trim().slice(0, JOB_SEARCH_MAX);
  if ([...text].length < JOB_SEARCH_MIN) return { ids: null, partial: false, by: null };
  const range = referenceRange(text);
  if (range) {
    const rows = await withTenant(
      shopId,
      (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"::text AS "id" FROM "TranslationJob"
          WHERE "shopId" = ${shopId}::uuid AND "id" BETWEEN ${range.from}::uuid AND ${range.to}::uuid
          ORDER BY "createdAt" DESC, "id" DESC
          LIMIT ${JOB_IDS_MAX}`,
      client,
    );
    if (rows.length) return { ids: rows.map((r) => r.id), partial: false, by: "reference" };
  }
  // One title search per kind, in parallel; a failure leaves that kind out (and says so).
  const found = await Promise.all(SEARCHABLE_TYPES.map((type) => settle(shopId, "job search", searchIds(admin, type, text))));
  const partial = found.some((ids) => ids === null);
  const gids = [...new Set(found.flatMap((ids) => ids ?? []))];
  if (!gids.length) return { ids: [], partial, by: "names" };
  // The items first ((shopId, resourceGid)), then their jobs: never a probe per job of a large shop.
  const rows = await withTenant(
    shopId,
    (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        WITH found AS MATERIALIZED (
          SELECT DISTINCT i."jobId" FROM "TranslationJobItem" i
          WHERE i."shopId" = ${shopId}::uuid AND i."resourceGid" = ANY(${gids}::text[])
        )
        SELECT j."id"::text AS "id" FROM "TranslationJob" j
        JOIN found f ON f."jobId" = j."id"
        WHERE j."shopId" = ${shopId}::uuid
        ORDER BY j."createdAt" DESC, j."id" DESC
        LIMIT ${JOB_IDS_MAX}`,
    client,
  );
  return { ids: rows.map((r) => r.id), partial, by: "names" };
}
