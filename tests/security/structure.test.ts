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
    // Any operation: named or anonymous, with or without variables (for example one that would
    // change the store's primary language, which Linguva never does).
    const MUTATION = /\bmutation\b\s*(\w*)\s*[({]/g;
    for (const probe of ["mutation LinguvaX { shopLocaleUpdate }", "mutation { shopLocaleUpdate }", "mutation LinguvaY($a: ID!) {"]) {
      expect([...probe.matchAll(MUTATION)]).toHaveLength(1);
    }
    const mutations = APP.flatMap((f) => [...f.text.matchAll(MUTATION)].map((m) => `${f.path}: ${m[1] || "(anonymous)"}`));
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
  // The old area lists (/app/products and the others) only redirect to the area's list in a language.
  redirectToAreaList: "app/.server/translation/resource-list.ts",
  resolveEditorContext: "app/.server/translation/resource-editor.ts",
  loadCoverageDashboard: "app/.server/coverage/dashboard.ts",
  loadCoverageItemsPage: "app/.server/coverage/dashboard.ts",
  coverageAction: "app/.server/coverage/dashboard.ts",
};
// The Shopify library's checks (authenticate.admin, authenticate.webhook, …).
const LIBRARY = { name: "authenticate", file: "app/shopify.server.ts" };
// The admin console's own check (session, role, CSRF), reviewed like the library: the only one its routes may use,
// and one no other route may use. Its sign-in page can't have a session yet and checks only that the console is on.
const ADMIN_AUTH = "app/.server/admin/auth.ts";
const ADMIN: Record<string, string> = { requireAdmin: ADMIN_AUTH };
const ADMIN_SIGN_IN = "app/routes/admin_.login.tsx";
const ADMIN_SIGN_IN_CHECKS: Record<string, string> = { ...ADMIN, requireAdminConsole: ADMIN_AUTH };
/** The console's routes: /admin and below (admin.tsx, admin.*.tsx, admin_.*.tsx and such folders). */
const isAdminRoute = (path: string) => /^app\/routes\/admin[._/]/.test(path);

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

/** A call the function waits for: awaited, returned, or the export itself (webhookAction(…)). A call left floating doesn't stop the response. */
const awaited = (call: ts.CallExpression, root: ts.Node) =>
  call === root || ts.isAwaitExpression(call.parent) || ts.isReturnStatement(call.parent) || (ts.isArrowFunction(call.parent) && call.parent.body === call);

/**
 * Whether `node` itself calls one of `allowed` (by the name it has in its file) or, unless `library` is false,
 * authenticate.*, imported from where they are defined.
 */
function callsAuthentication(node: ts.Node | null, imports: Map<string, { file: string; name: string }>, allowed: Record<string, string>, library = true) {
  return Boolean(node) && ownCalls(node!).some((call) => {
    if (!awaited(call, node!)) return false;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const imported = imports.get(callee.expression.text);
      return library && imported?.name === LIBRARY.name && imported.file === LIBRARY.file;
    }
    const imported = ts.isIdentifier(callee) ? imports.get(callee.text) : undefined;
    return Boolean(imported && allowed[imported.name] === imported.file);
  });
}

/**
 * Each exported loader and action of a route module, and whether that function authenticates the request: an
 * admin console route with requireAdmin only (its sign-in page with requireAdminConsole), any other route with
 * the Shopify library or a delegate.
 */
function routeHandlers(file: Source) {
  const source = parse(file);
  const imports = importsOf(source, file.path);
  const admin = isAdminRoute(file.path);
  const allowed = file.path === ADMIN_SIGN_IN ? ADMIN_SIGN_IN_CHECKS : admin ? ADMIN : DELEGATES;
  return exportsOf(source, ["loader", "action"]).map(({ name, node }) => ({ name, authenticates: callsAuthentication(node, imports, allowed, !admin) }));
}

describe("every page and webhook authenticates", () => {
  // Routes anyone may call, reviewed: the website (home, pricing, imprint and privacy pages: static site pages,
  // no Redis, Shopify or cookies; home and pricing read only the list prices from the PlanPrice table, cached,
  // falling back to the defaults), the app's privacy policy and support page (static, no database either, 404
  // unless PUBLIC_PAGES=on), Shopify's login and the health checks.
  const PUBLIC = [
    "app/routes/_index/route.tsx",
    "app/routes/preise.tsx",
    "app/routes/impressum.tsx",
    "app/routes/datenschutz.tsx",
    "app/routes/privacy.tsx",
    "app/routes/support.tsx",
    "app/routes/auth.login/route.tsx",
    "app/routes/healthz.tsx",
    "app/routes/healthz_.worker.tsx",
  ];
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
      const delegate = exportsOf(source, [name]).find((e) => e.name === name);
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
    // Nor one in a function that may never run, one nobody waits for, or a function of the same name that isn't the reviewed one.
    expect(check(`${using}export const action = async ({ request }) => { const later = () => requireShop(request); return null; };`)).toEqual(["action: false"]);
    expect(check(`${using}export const loader = async ({ request }) => { requireShop(request); return null; };`)).toEqual(["loader: false"]);
    expect(check(`const requireShop = (r) => r;\nexport const loader = ({ request }) => requireShop(request);`)).toEqual(["loader: false"]);
    // Renamed locally: followed. Re-exported from elsewhere, or destructured: can't be checked here, so refused.
    expect(check(`${using}const handler = ({ request }) => requireShop(request);\nexport { handler as action };`)).toEqual(["action: true"]);
    expect(check(`export { loader } from "./other";`)).toEqual(["loader: false"]);
    expect(check(`export const { action } = routes;`)).toEqual(["action: false"]);
    expect(check(`export * from "./other";`)).toEqual(["*: false"]);
  });

  describe("the admin console", () => {
    const check = (path: string, text: string) => routeHandlers({ path, text }).map((h) => `${h.name}: ${h.authenticates}`);
    const admin = `import { requireAdmin, requireAdminConsole } from "../.server/admin/auth";\n`;
    const shopify = `import { requireShop } from "../.server/shopify/require-shop";\nimport { authenticate } from "../shopify.server";\n`;

    it("its routes authenticate with requireAdmin, and only with it (the check isn't vacuous)", () => {
      expect(check("app/routes/admin.probe.tsx", `${admin}export const loader = async ({ request }) => { await requireAdmin(request); return null; };`)).toEqual([
        "loader: true",
      ]);
      expect(check("app/routes/admin.tsx", `${admin}export async function action({ request }) { return requireAdmin(request, "prices"); }`)).toEqual(["action: true"]);
      // A merchant's Shopify session is no admin session.
      expect(check("app/routes/admin.probe.tsx", `${shopify}export const loader = ({ request }) => requireShop(request);`)).toEqual(["loader: false"]);
      expect(check("app/routes/admin_.probe.tsx", `${shopify}export const loader = ({ request }) => authenticate.admin(request);`)).toEqual(["loader: false"]);
      // Only the sign-in page may do with the console check alone.
      expect(check("app/routes/admin.probe.tsx", `${admin}export const loader = ({ request }) => requireAdminConsole(request);`)).toEqual(["loader: false"]);
      expect(check(ADMIN_SIGN_IN, `${admin}export const loader = ({ request }) => requireAdminConsole(request);`)).toEqual(["loader: true"]);
      // The same rules as elsewhere: not floating, not nested, not a look-alike, not re-exported.
      expect(check("app/routes/admin.probe.tsx", `${admin}export const loader = async ({ request }) => { requireAdmin(request); return null; };`)).toEqual(["loader: false"]);
      expect(check("app/routes/admin.probe.tsx", `${admin}export const action = async ({ request }) => { const later = () => requireAdmin(request); return null; };`)).toEqual([
        "action: false",
      ]);
      expect(check("app/routes/admin.probe.tsx", `const requireAdmin = (r) => r;\nexport const loader = ({ request }) => requireAdmin(request);`)).toEqual(["loader: false"]);
      expect(check("app/routes/admin.probe.tsx", `export { loader } from "./other";`)).toEqual(["loader: false"]);
    });

    it("no other route authenticates with it", () => {
      expect(check("app/routes/app.probe.tsx", `${admin}export const loader = ({ request }) => requireAdmin(request);`)).toEqual(["loader: false"]);
      expect(check("app/routes/adminx.tsx", `${admin}export const loader = ({ request }) => requireAdmin(request);`)).toEqual(["loader: false"]);
      // Sessions and sign-in belong to the console's routes (the website may read list prices from app/.server/admin).
      const AUTH_FILES = [ADMIN_AUTH, "app/.server/admin/session.ts", "app/.server/admin/login.ts"];
      const outside = modules
        .filter((m) => !isAdminRoute(m.path))
        .flatMap((m) => [...importsOf(parse(m), m.path).entries()].filter(([, i]) => AUTH_FILES.includes(i.file)).map(([name]) => `${m.path}: ${name}`));
      expect(outside).toEqual([]);
    });

    it("its routes' own Responses carry the console's headers: adminRedirect and adminResponse, never react-router's redirects or a bare Response", () => {
      // React Router answers with a loader's or action's Response as it is, past entry.server's headers: a redirect
      // thrown on a page request, and everything a route without a page (a resource route) returns or throws.
      const unheaded = (file: Source) => {
        const source = parse(file);
        const page =
          source.statements.some((s) => ts.isExportAssignment(s) || (exported(s) && (ts.getModifiers(s as ts.HasModifiers) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))) ||
          exportsOf(source, ["ErrorBoundary"]).length > 0;
        const found: string[] = [];
        for (const s of source.statements) {
          if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== "react-router" || s.importClause?.isTypeOnly) continue;
          const bindings = s.importClause?.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) found.push("* as react-router");
          if (!bindings || !ts.isNamedImports(bindings)) continue;
          for (const e of bindings.elements) {
            const name = (e.propertyName ?? e.name).text;
            // data() is rendered into a page (entry.server's headers); a resource route answers with it as it is.
            if (!e.isTypeOnly && (["redirect", "redirectDocument", "replace"].includes(name) || (!page && name === "data"))) found.push(name);
          }
        }
        ts.forEachChild(source, function visit(node) {
          if (ts.isNewExpression(node) && node.expression.getText() === "Response") found.push("new Response");
          if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "Response") found.push(node.getText());
          ts.forEachChild(node, visit);
        });
        return found.map((f) => `${file.path}: ${f}`);
      };
      // The check isn't vacuous.
      const probe = (text: string, path = "app/routes/admin.probe.tsx") => unheaded({ path, text }).map((f) => f.slice(path.length + 2));
      expect(probe(`import { redirect as go, data } from "react-router";\nexport const loader = () => { throw go("/admin"); };\nexport default function P() { return null; }`)).toEqual(["redirect"]);
      expect(probe(`import { data } from "react-router";\nexport const action = () => data({}, { status: 400 });`)).toEqual(["data"]);
      expect(probe(`export const loader = () => new Response(null, { status: 302 });\nexport const action = () => Response.json({});`)).toEqual(["new Response", "Response.json"]);
      expect(probe(`import { adminRedirect } from "../.server/lib/security-headers";\nexport const loader = ({ request }) => { throw adminRedirect(request, "/admin"); };`)).toEqual([]);
      expect(modules.filter((m) => isAdminRoute(m.path)).flatMap(unheaded)).toEqual([]);
    });

    it("its authentication root checks the console, the session and every write", () => {
      const text = readFileSync(join(ROOT, ADMIN_AUTH), "utf8");
      const source = parse({ path: ADMIN_AUTH, text });
      const imports = importsOf(source, ADMIN_AUTH);
      const fn = (name: string) => exportsOf(source, [name]).find((e) => e.name === name)?.node ?? null;
      const local = (name: string) => {
        const node = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
        return node && ts.isFunctionDeclaration(node) ? node : null;
      };
      const awaitedCalls = (node: ts.Node | null) =>
        node ? ownCalls(node).filter((c) => awaited(c, node) && ts.isIdentifier(c.expression)).map((c) => (c.expression as ts.Identifier).text) : [];
      expect(awaitedCalls(fn("requireAdmin"))).toEqual(expect.arrayContaining(["requireAdminConsole", "readSession", "submittedCsrfToken"]));
      expect(imports.get("readSession")).toEqual({ file: "app/.server/admin/session.ts", name: "readSession" });
      // The console check is synchronous and comes first: off means 404 before any database access.
      const consoleCheck = fn("requireAdminConsole");
      expect(consoleCheck && ownCalls(consoleCheck).map((c) => c.expression.getText())).toEqual(["adminConsoleAvailable", "notFound"]);
      expect(local("adminConsoleAvailable")?.getText()).toMatch(/config\.ADMIN_CONSOLE !== "on"\) return false/);
      expect(text.indexOf("await requireAdminConsole(request);")).toBeLessThan(text.indexOf("await readSession(request)"));
    });
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
