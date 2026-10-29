import type { TranslationRevision } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ANY_SOURCE, fieldsNeedingTranslation, planResourceWork } from "../../app/.server/jobs/needs-work";

const GID = "gid://shopify/Product/1";
const content = [
  { key: "title", value: "Jacket", digest: "d1", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
  { key: "body_html", value: "<p>Warm</p>", digest: "d2", locale: "en", type: "HTML" },
  { key: "meta_title", value: "SEO", digest: "d3", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
  { key: "meta_description", value: "", digest: "d4", locale: "en", type: "MULTI_LINE_TEXT_FIELD" },
  { key: "handle", value: "jacket", digest: "d5", locale: "en", type: "URI" },
];

function revision(key: string, value: string, extra: Partial<TranslationRevision> = {}): TranslationRevision {
  return {
    id: key,
    shopId: "s",
    resourceGid: GID,
    key,
    locale: "de",
    marketGid: null,
    value,
    sourceDigest: "old",
    origin: "AI",
    provider: "mock",
    approved: false,
    actorId: null,
    restoredFromId: null,
    createdAt: new Date(),
    ...extra,
  };
}

const resource = (translations: Array<{ key: string; value: string; outdated: boolean }>) => ({
  resourceId: GID,
  content,
  translations: translations.map((t) => ({ ...t, updatedAt: null })),
});

describe("planResourceWork", () => {
  it("translates missing fields and never touches current translations", () => {
    const keys = fieldsNeedingTranslation(
      resource([
        { key: "title", value: "Jacke", outdated: false },
        { key: "meta_title", value: " ", outdated: false },
      ]),
    ).map((f) => f.key);
    // title is current, handle is manual-only, the empty source is ignored.
    expect(keys).toEqual(["body_html", "meta_title"]);
  });

  it("refreshes outdated translations that are Linguva's own unreviewed AI output", () => {
    const latest = new Map([[`${GID}|body_html`, revision("body_html", "<p>Warm DE</p>")]]);
    const plan = planResourceWork(resource([{ key: "body_html", value: "<p>Warm DE</p>", outdated: true }]), { latest });
    expect(plan.fields.map((f) => f.key)).toContain("body_html");
    expect(plan.protectedKeys).toEqual([]);
  });

  it.each([
    ["a manual revision", revision("body_html", "<p>Hand</p>", { origin: "MANUAL", approved: true })],
    ["an approved AI revision", revision("body_html", "<p>Hand</p>", { approved: true })],
    ["no Linguva revision (edited in Shopify or another app)", undefined],
    ["a revision that no longer matches the live value", revision("body_html", "<p>Other</p>")],
  ])("protects outdated translations with %s", (_label, latestRevision) => {
    const latest = new Map(latestRevision ? [[`${GID}|body_html`, latestRevision]] : []);
    const plan = planResourceWork(resource([{ key: "body_html", value: "<p>Hand</p>", outdated: true }]), { latest });
    expect(plan.fields.map((f) => f.key)).not.toContain("body_html");
    expect(plan.protectedKeys).toEqual(["body_html"]);
  });

  it("replaces protected translations only with explicit permission", () => {
    const plan = planResourceWork(resource([{ key: "body_html", value: "<p>Hand</p>", outdated: true }]), {
      overwriteProtected: true,
    });
    expect(plan.fields.map((f) => f.key)).toContain("body_html");
  });

  it("leaves fields with a pending draft for the same source to review", () => {
    const pendingDrafts = new Map([[`${GID}|body_html`, "d2"], [`${GID}|title`, "stale-digest"]]);
    const keys = fieldsNeedingTranslation(resource([]), { pendingDrafts }).map((f) => f.key);
    expect(keys).toEqual(["title", "meta_title"]);
  });

  it("leaves a field with a person's draft waiting for review, whatever its source", () => {
    const pendingDrafts = new Map([[`${GID}|title`, ANY_SOURCE]]);
    expect(fieldsNeedingTranslation(resource([]), { pendingDrafts }).map((f) => f.key)).toEqual(["body_html", "meta_title"]);
  });

  it("limits the work to chosen field groups, and can leave outdated translations as they are", () => {
    const outdated = resource([{ key: "title", value: "Jacke", outdated: true }]);
    const latest = new Map([[`${GID}|title`, revision("title", "Jacke")]]);
    expect(fieldsNeedingTranslation(outdated, { latest, onlyGroups: { groups: ["title", "seo_title"], resourceType: "PRODUCT" } }).map((f) => f.key)).toEqual(["title", "meta_title"]);
    // Kept even though it is Linguva's own unreviewed machine output, which is otherwise refreshed.
    expect(fieldsNeedingTranslation(outdated, { latest, keepOutdated: true }).map((f) => f.key)).toEqual(["body_html", "meta_title"]);
    // No groups chosen: all of them.
    expect(fieldsNeedingTranslation(outdated, { latest, onlyGroups: { groups: [], resourceType: "PRODUCT" } }).map((f) => f.key)).toEqual(["title", "body_html", "meta_title"]);
  });

  it("keeps a translation the merchant removed on purpose removed until the original changes", () => {
    const removed = revision("title", "", { origin: "MANUAL", approved: true, sourceDigest: "d1" });
    const latest = new Map([[`${GID}|title`, removed]]);
    const plan = planResourceWork(resource([]), { latest });
    expect(plan.fields.map((f) => f.key)).toEqual(["body_html", "meta_title"]);
    expect(plan.protectedKeys).toEqual(["title"]);
    // Removed for an earlier original: the new one is translated.
    const earlier = new Map([[`${GID}|title`, { ...removed, sourceDigest: "older" }]]);
    expect(fieldsNeedingTranslation(resource([]), { latest: earlier }).map((f) => f.key)).toEqual(["title", "body_html", "meta_title"]);
    // Only with explicit permission to replace protected translations.
    expect(fieldsNeedingTranslation(resource([]), { latest, overwriteProtected: true }).map((f) => f.key)).toEqual(["title", "body_html", "meta_title"]);
  });
});
