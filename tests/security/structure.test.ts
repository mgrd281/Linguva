/**
 * Structural guards: a new way to write to a store, a new Shopify
 * mutation, a page without authentication or the owner database role in
 * app code fails here until it is reviewed (docs/SECURITY_MODEL.md §5b
 * and §2). The database side of tenant isolation is checked at runtime by
 * db-posture (every shopId table: RLS, FORCE, one tenant policy).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
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

type Source = { path: string; text: string };

// Helpers that authenticate first (requireShop) and are used by thin route files, by the file defining each.
const DELEGATES: Record<string, string> = {
  requireShop: "app/.server/shopify/require-shop.ts",
  webhookAction: "app/.server/webhooks/handle.ts",
  loadResourceList: "app/.server/translation/resource-list.ts",
  runResourceListAction: "app/.server/translation/resource-list.ts",
  resolveEditorContext: "app/.server/translation/resource-editor.ts",
  loadCoverageDashboard: "app/.server/coverage/dashboard.ts",
  loadCoverageItemsPage: "app/.server/coverage/dashboard.ts",
  coverageAction: "app/.server/coverage/dashboard.ts",
};
// The Shopify library's checks (authenticate.admin, authenticate.webhook, …).
const LIBRARY = { name: "authenticate", file: "app/shopify.server.ts" };

/** Route modules as flatRoutes finds them: the files in app/routes, and a folder's route or index file. */
function routeModules(): Source[] {
  const dir = join(ROOT, "app", "routes");
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? ["route", "index"].flatMap((n) => [".ts", ".tsx", ".js", ".jsx"].map((ext) => `${entry.name}/${n}${ext}`)) : [entry.name]))
    .filter((name) => /\.(ts|tsx|js|jsx)$/.test(name) && existsSync(join(dir, name)))
    .map((name) => ({ path: `app/routes/${name}`, text: readFileSync(join(dir, name), "utf8") }));
}

const parse = (file: Source) => ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const bindingNames = (node: ts.Node): string[] =>
  ts.isIdentifier(node) ? [node.text] : ts.isBindingElement(node) ? bindingNames(node.name) : node.getChildren().flatMap(bindingNames);

/** What a module imports, by local name: the file (relative to the repository) and the name it has there. */
function importsOf(source: ts.SourceFile, path: string) {
  const imports = new Map<string, { file: string; name: string }>();
  for (const s of source.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.importClause?.isTypeOnly) continue;
    const bindings = s.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const base = join(dirname(path), s.moduleSpecifier.text);
    const file = [".ts", ".tsx"].map((ext) => base + ext).find((f) => existsSync(join(ROOT, f))) ?? base;
    for (const e of bindings.elements) if (!e.isTypeOnly) imports.set(e.name.text, { file, name: (e.propertyName ?? e.name).text });
  }
  return imports;
}

/**
 * The functions (or the expressions, such as webhookAction(…)) a module exports under `names`;
 * null when the module re-exports them from elsewhere, so they can't be checked here.
 */
function exportsOf(source: ts.SourceFile, names: string[]) {
  const local = new Map<string, ts.Node>();
  const found: Array<{ name: string; local: string | null }> = [];
  for (const s of source.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) {
      local.set(s.name.text, s);
      if (exported(s)) found.push({ name: s.name.text, local: s.name.text });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) local.set(d.name.text, d.initializer);
        if (exported(s)) for (const name of bindingNames(d.name)) found.push({ name, local: ts.isIdentifier(d.name) ? name : null });
      }
    } else if (ts.isExportDeclaration(s)) {
      if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const e of s.exportClause.elements) found.push({ name: e.name.text, local: s.moduleSpecifier ? null : (e.propertyName ?? e.name).text });
      } else {
        found.push({ name: "*", local: null });
      }
    }
  }
  const resolve = (name: string | null, seen = new Set<string>()): ts.Node | null => {
    if (!name || seen.has(name)) return null;
    seen.add(name);
    const node = local.get(name) ?? null;
    return node && ts.isIdentifier(node) ? resolve(node.text, seen) : node;
  };
  return found.filter((f) => f.name === "*" || names.includes(f.name)).map((f) => ({ name: f.name, node: resolve(f.local) }));
}

/** The calls a function makes itself; functions defined inside it may never run. */
function ownCalls(root: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (node !== root && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
}

/** Whether `node` itself calls one of `allowed` (by the name it has in its file) or authenticate.*, imported from where they are defined. */
function callsAuthentication(node: ts.Node | null, imports: Map<string, { file: string; name: string }>, allowed: Record<string, string>) {
  return Boolean(node) && ownCalls(node!).some(({ expression: callee }) => {
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const imported = imports.get(callee.expression.text);
      return imported?.name === LIBRARY.name && imported.file === LIBRARY.file;
    }
    const imported = ts.isIdentifier(callee) ? imports.get(callee.text) : undefined;
    return Boolean(imported && allowed[imported.name] === imported.file);
  });
}

/** Each exported loader and action of a route module, and whether that function authenticates the request. */
function routeHandlers(file: Source) {
  const source = parse(file);
  const imports = importsOf(source, file.path);
  return exportsOf(source, ["loader", "action"]).map(({ name, node }) => ({ name, authenticates: callsAuthentication(node, imports, DELEGATES) }));
}

describe("every page and webhook authenticates", () => {
  // Routes anyone may call, reviewed: the landing page, Shopify's login form and the health checks.
  const PUBLIC = ["app/routes/_index/route.tsx", "app/routes/auth.login/route.tsx", "app/routes/healthz.tsx", "app/routes/healthz_.worker.tsx"];
  const modules = routeModules();
  const routes = modules.filter((r) => !PUBLIC.includes(r.path) && routeHandlers(r).length > 0);

  // React Router runs a child route's action without the parent's loader: each loader and action authenticates itself.
  it.each(routes.map((r) => [r.path, r] as const))("%s", (_path, route) => {
    expect(routeHandlers(route).filter((h) => !h.authenticates)).toEqual([]);
  });

  it("only the reviewed public routes skip authentication", () => {
    expect(modules.map((m) => m.path)).toEqual(expect.arrayContaining(PUBLIC));
    expect(routes.length).toBeGreaterThan(30);
  });

  it("the delegates authenticate", () => {
    for (const [name, path] of Object.entries(DELEGATES)) {
      const source = parse({ path, text: readFileSync(join(ROOT, path), "utf8") });
      const [delegate] = exportsOf(source, [name]);
      // webhookAction returns the route's action: that function authenticates.
      const returned: ts.Node[] = [];
      if (delegate?.node) {
        ts.forEachChild(delegate.node, function visit(node) {
          if (ts.isFunctionLike(node)) return;
          if (ts.isReturnStatement(node) && node.expression && ts.isFunctionLike(node.expression)) returned.push(node.expression);
          ts.forEachChild(node, visit);
        });
      }
      const imports = importsOf(source, path);
      const authenticates = [delegate?.node ?? null, ...returned].some((fn) => callsAuthentication(fn, imports, { requireShop: DELEGATES.requireShop! }));
      expect(authenticates, `${path}: ${name}`).toBe(true);
    }
  });

  it("checks each exported loader and action, whatever its form (the check isn't vacuous)", () => {
    const check = (text: string) => routeHandlers({ path: "app/routes/app.probe.tsx", text }).map((h) => `${h.name}: ${h.authenticates}`);
    const using = `import { requireShop } from "../.server/shopify/require-shop";\n`;
    expect(check(`${using}export const loader = async ({ request }) => { await requireShop(request); return null; };`)).toEqual(["loader: true"]);
    expect(check(`${using}export async function loader({ request }) { return requireShop(request); }`)).toEqual(["loader: true"]);
    // A call elsewhere in the file isn't enough.
    expect(check(`${using}export async function loader() { return null; }\nexport function action({ request }) { return requireShop(request); }`)).toEqual([
      "loader: false",
      "action: true",
    ]);
    // Nor one in a function that may never run, or in a function of the same name that isn't the reviewed one.
    expect(check(`${using}export const action = async ({ request }) => { const later = () => requireShop(request); return null; };`)).toEqual(["action: false"]);
    expect(check(`const requireShop = (r) => r;\nexport const loader = ({ request }) => requireShop(request);`)).toEqual(["loader: false"]);
    // Renamed locally: followed. Re-exported from elsewhere, or destructured: can't be checked here, so refused.
    expect(check(`${using}const handler = ({ request }) => requireShop(request);\nexport { handler as action };`)).toEqual(["action: true"]);
    expect(check(`export { loader } from "./other";`)).toEqual(["loader: false"]);
    expect(check(`export const { action } = routes;`)).toEqual(["action: false"]);
    expect(check(`export * from "./other";`)).toEqual(["*: false"]);
  });
});

describe("the app never uses the owner database role", () => {
  const OWNER = /linguva_owner|DATABASE_OWNER_URL|OWNER_DATABASE_URL|MIGRATION_DATABASE_URL/;
  // Lines that name the owner role's connection without connecting with it, each reviewed. Migrations
  // and the operator tools (scripts/) run as their own processes with the owner role.
  const REVIEWED = [
    // The web process removes the variable from its environment at start (entry.server).
    "app/.server/lib/config.ts: delete env.MIGRATION_DATABASE_URL;",
    // The embedded worker's environment never contains it either.
    "app/.server/jobs/embedded-worker.ts: delete child.MIGRATION_DATABASE_URL;",
    // Documentation: grants are written by the operator tool, with the owner role.
    "app/.server/billing/complimentary.ts: * be a connection with the owner role (MIGRATION_DATABASE_URL).",
  ];

  it("app and worker code don't reference the owner role or its connection", () => {
    const hits = APP.flatMap((f) => f.text.split("\n").filter((line) => OWNER.test(line)).map((line) => `${f.path}: ${line.trim()}`));
    expect(hits.sort()).toEqual([...REVIEWED].sort());
  });
});
