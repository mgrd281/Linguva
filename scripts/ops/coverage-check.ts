/**
 * Coverage evidence for the dev-store checks (docs/DEV_STORE_VERIFICATION.md).
 * Reads the local development database (.env DATABASE_URL, runtime role,
 * inside the shop's tenant context); never writes, never contacts Shopify,
 * prints counts only (no store text). Build: pnpm build:ops.
 *
 *   pnpm ops:coverage-check --shop linguva-test-lab.myshopify.com [--lang de] [--type PRODUCT] [--webhooks]
 *
 * --webhooks also lists the latest webhook deliveries (topic, status, time;
 * no payload) and automatic translation jobs, for the webhook checks.
 * Prints the live figures per language, each type's scan state, the last
 * scan's duration, and checks that the counts kept with every change equal
 * the counts recomputed from the items (exit code 1 when they don't).
 */
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { loadCoverageSummary } from "../../app/.server/coverage/summary";
import { withTenant } from "../../app/.server/tenancy/with-tenant";
import { AUTO_REQUESTED_BY } from "../../app/.server/jobs/bulk-jobs";
import { byType, headlineByLocale } from "../../app/lib/coverage-view";
import { FIELD_STATES } from "../../app/lib/coverage-rules";

const { values } = parseArgs({ options: { shop: { type: "string" }, lang: { type: "string" }, type: { type: "string" }, webhooks: { type: "boolean" } } });
const shopDomain = (values.shop ?? "").trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
  console.error("--shop must be a *.myshopify.com domain");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with the project's .env)");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error(`${shopDomain} isn't installed in this database (open Linguva on the store first)`);
  const started = performance.now();
  const summary = await loadCoverageSummary(shop.id, db);
  const loadMs = Math.round(performance.now() - started);

  // Counts recomputed from the items, read-only.
  const recomputed = await withTenant(
    shop.id,
    (tx) => tx.$queryRaw<Array<{ locale: string; resourceType: string; fieldGroup: string; state: string; count: number }>>`
      SELECT i."locale", i."resourceType", split_part(fs, ':', 1) AS "fieldGroup", split_part(fs, ':', 2) AS "state", count(*)::integer AS "count"
      FROM "CoverageItem" i, unnest(i."fieldStates") AS fs
      WHERE i."shopId" = ${shop.id}::uuid
      GROUP BY 1, 2, 3, 4`,
    db,
  );
  const key = (r: { locale: string; resourceType: string; fieldGroup: string; state: string; count: number }) =>
    `${r.locale}|${r.resourceType}|${r.fieldGroup}|${r.state}|${r.count}`;
  const kept = new Set(summary.counts.map(key));
  const fresh = new Set(recomputed.map(key));
  const mismatches = [...kept].filter((k) => !fresh.has(k)).concat([...fresh].filter((k) => !kept.has(k)));

  const report = summary.report;
  const scanMs = report?.startedAt && report.finishedAt ? new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime() : null;
  console.log(`Shop ${shopDomain} · summary loaded in ${loadMs} ms`);
  console.log(
    report
      ? `Last scan: ${report.status}${report.errorCode ? ` (${report.errorCode})` : ""}, ${report.resourcesScanned} items, ${scanMs !== null ? `${Math.round(scanMs / 1000)} s` : "running"}, finished ${report.finishedAt ?? "—"}`
      : "No scan yet",
  );
  const locales = [...new Set(summary.counts.map((c) => c.locale))].filter((l) => !values.lang || l === values.lang).sort();
  const headline = headlineByLocale(summary.counts);
  for (const locale of locales) {
    const h = headline.get(locale);
    console.log(`\n${locale}: ${h?.percent ?? "—"} % (${h?.complete ?? 0} of ${h?.total ?? 0} counted fields) · ${FIELD_STATES.map((s) => `${s} ${h?.counts[s] ?? 0}`).join(", ")}`);
    for (const [type, t] of [...byType(summary.counts, locale)].sort()) {
      if (values.type && type !== values.type) continue;
      const seg = summary.segments.find((s) => s.locale === locale && s.resourceType === type);
      console.log(`  ${type.padEnd(42)} ${String(t.complete).padStart(6)} / ${String(t.total).padEnd(6)} ${FIELD_STATES.filter((s) => t.counts[s]).map((s) => `${s} ${t.counts[s]}`).join(", ")}  [${seg?.status ?? "not scanned"}]`);
    }
    const denied = summary.segments.filter((s) => s.locale === locale && s.status === "DENIED").map((s) => s.resourceType);
    if (denied.length) console.log(`  No access: ${denied.join(", ")}`);
  }
  if (values.webhooks) {
    const events = await db.webhookEvent.findMany({ where: { shopDomain }, orderBy: { receivedAt: "desc" }, take: 15 });
    console.log("\nLatest webhook deliveries:");
    for (const e of events) console.log(`  ${e.receivedAt.toISOString()}  ${e.topic.padEnd(22)} ${e.status}${e.errorCode ? ` (${e.errorCode})` : ""}`);
    if (!events.length) console.log("  none");
    const jobs = await withTenant(shop.id, (tx) => tx.translationJob.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 5 }), db);
    console.log("Latest translation jobs:");
    for (const j of jobs) {
      console.log(`  ${j.createdAt.toISOString()}  ${j.resourceType} → ${j.targetLocale}  ${j.status}  ${j.succeededItems + j.skippedItems + j.failedItems}/${j.totalItems} items${j.requestedBy === AUTO_REQUESTED_BY ? " (automatic)" : ""}`);
    }
  }
  console.log(mismatches.length ? `\n✗ Kept counts differ from the items (${mismatches.length} rows): ${mismatches.slice(0, 5).join("; ")}` : "\n✓ Kept counts equal the counts recomputed from the items");
  if (mismatches.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
