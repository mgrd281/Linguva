/**
 * Structural guards: a new way to write to a store, a new Shopify
 * mutation, a page without authentication or the owner database role in
 * app code fails here until it is reviewed (docs/SECURITY_MODEL.md §5b
 * and §2). The database side of tenant isolation is checked at runtime by
 * db-posture (every shopId table: RLS, FORCE, one tenant policy).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === "types" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const APP = [...files("app"), ...files("worker")].map((path) => ({ path: relative(ROOT, join(ROOT, path)), text: readFileSync(join(ROOT, path), "utf8") }));

const callers = (fn: string) =>
  APP.filter((f) => new RegExp(`\\b${fn}\\(`).test(f.text) && !new RegExp(`export (async )?function ${fn}\\(`).test(f.text))
    .map((f) => f.path)
    .sort();

describe("every way to write to a store is known and reviewed", () => {
  it("only two functions call Shopify's translation mutations", () => {
    expect(callers("registerTranslations")).toEqual(["app/.server/translation/product-translation-service.ts"]);
    expect(callers("removeTranslations")).toEqual(["app/.server/translation/history.ts"]);
  });

  it("saving translations happens only in the four reviewed paths", () => {
    // processors: automatic publishing (merchant's explicit setting, plan, no warnings, translation unchanged);
    // history: restore an earlier version (merchant, in the editor);
    // resource-editor: merchant saves in the editor;
    // drafts: merchant approves drafts on Review (translation unchanged since the draft).
    expect(callers("saveResourceTranslations")).toEqual([
      "app/.server/jobs/processors.ts",
      "app/.server/review/drafts.ts",
      "app/.server/translation/history.ts",
      "app/.server/translation/resource-editor.ts",
    ]);
    expect(callers("removeTranslation")).toEqual(["app/.server/translation/resource-editor.ts"]);
  });

  it("the app sends no other Shopify mutations", () => {
    const mutations = APP.flatMap((f) => [...f.text.matchAll(/mutation\s+(\w+)\s*\(/g)].map((m) => `${f.path}: ${m[1]}`));
    expect(mutations.sort()).toEqual([
      "app/.server/shopify/translations-api.ts: LinguvaTranslationsRegister",
      "app/.server/shopify/translations-api.ts: LinguvaTranslationsRemove",
    ]);
  });
});

describe("every page and webhook authenticates", () => {
  // Helpers that authenticate first (requireShop) and are used by thin route files.
  const DELEGATES = /\b(requireShop|webhookAction|authenticate\.\w+|loadResourceList|runResourceListAction|resolveEditorContext)\(/;
  const routes = APP.filter((f) => /^app\/routes\/(app\.|webhooks\.)/.test(f.path) && /export const (loader|action)\b/.test(f.text));

  it.each(routes.map((r) => [r.path, r] as const))("%s", (_path, route) => {
    expect(DELEGATES.test(route.text)).toBe(true);
  });

  it("the delegates authenticate", () => {
    const source = (path: string) => APP.find((f) => f.path === path)!.text;
    expect(source("app/.server/translation/resource-list.ts").match(/await requireShop\(request\)/g)).toHaveLength(2);
    expect(source("app/.server/translation/resource-editor.ts")).toMatch(/export async function resolveEditorContext[\s\S]*?await requireShop\(request\)/);
  });
});

describe("the app never uses the owner database role", () => {
  it("app and worker code don't reference the owner role or its connection", () => {
    const hits = APP.filter((f) => /linguva_owner|DATABASE_OWNER_URL|OWNER_DATABASE_URL/.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });
});
