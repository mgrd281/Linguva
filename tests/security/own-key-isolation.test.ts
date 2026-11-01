/**
 * Static guards for the Own key plan's rule "never Linguva's keys"
 * (docs/AI_ENGINES.md, docs/SECURITY_MODEL.md): a shop on the plan gets its
 * provider only from shop-translation.ts, the per-shop module and the
 * credentials never reach the operator's engine keys or settings, a merchant
 * key is revealed only where a request is built or the key is encrypted, the
 * pages that only show state never decrypt, the worker's operator provider is
 * used only on the operator's path, every consent helper on a translation path
 * is given the shop's services and payer, and every consent grant names them.
 * Read from the TypeScript syntax tree, so comments never count.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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

interface Source {
  path: string;
  file: ts.SourceFile;
  /** The code without comments. */
  code: string;
}

const printer = ts.createPrinter({ removeComments: true });
const SOURCES: Source[] = [...files("app"), ...files("worker")].map((path) => {
  const text = readFileSync(join(ROOT, path), "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return { path: relative(ROOT, join(ROOT, path)), file, code: printer.printFile(file) };
});
const source = (path: string) => SOURCES.find((s) => s.path === path)!;

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** The name a call is made by: `f(…)` or `x.f(…)`. */
function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

function callsOf(src: Source, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  walk(src.file, (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === name) found.push(node);
  });
  return found;
}

const callers = (name: string) =>
  SOURCES.filter((s) => callsOf(s, name).length > 0)
    .map((s) => s.path)
    .sort();

function ancestors(node: ts.Node): ts.Node[] {
  const list: ts.Node[] = [];
  for (let at = node.parent; at; at = at.parent) list.push(at);
  return list;
}

/** The function a node is written in (its declared name), or null at module level. */
function enclosingFunction(node: ts.Node): string | null {
  for (const at of ancestors(node)) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name) return at.name.getText();
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText();
  }
  return null;
}

/** Inside the `then` branch of an `if` whose condition reads exactly `condition`. */
function insideThen(node: ts.Node, condition: string): boolean {
  let child: ts.Node = node;
  for (const at of ancestors(node)) {
    if (ts.isIfStatement(at) && at.expression.getText() === condition && at.thenStatement === child) return true;
    child = at;
  }
  return false;
}

/** An argument of a call to `name`, or of a call to it further out. */
function insideCallTo(node: ts.Node, name: string): boolean {
  return ancestors(node).some((at) => ts.isCallExpression(at) && calleeName(at) === name && at.arguments.some((arg) => arg.pos <= node.pos && node.end <= arg.end));
}

const location = (src: Source, node: ts.Node) => `${src.path}:${src.file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

const CREDENTIALS = SOURCES.filter((s) => s.path.startsWith("app/.server/credentials/"));
const SHOP_TRANSLATION = source("app/.server/providers/shop-translation.ts");

describe("an Own key shop never reaches Linguva's engine keys", () => {
  it("only the reviewed modules build the operator's provider", () => {
    // index.ts defines it; shop-translation.ts uses it on the operator's branch only; the worker builds it
    // once for operator shops; the smart modules are reached only with smartAuto, which Own key never has.
    expect(callers("getTranslationProvider").filter((path) => path !== "app/.server/providers/index.ts")).toEqual([
      "app/.server/providers/shop-translation.ts",
      "app/.server/smart/panel.ts",
      "app/.server/smart/plan.ts",
      "app/routes/app.settings_.automatic.tsx",
      "worker/index.ts",
    ]);
    // In shop-translation.ts: only where a shop without own keys is answered.
    for (const call of callsOf(SHOP_TRANSLATION, "getTranslationProvider")) {
      expect(insideCallTo(call, "operatorTranslation"), location(SHOP_TRANSLATION, call)).toBe(true);
    }
  });

  it("the per-shop module and the credentials never import or name the operator's engine settings", () => {
    const OPERATOR_IMPORTS = new Set(["routedEngines", "deeplApiKeys", "azureTranslatorSettings", "googleTranslateSettings"]);
    const OPERATOR_NAMES = /DEEPL_API_URL|DEEPL_API_KEY|AZURE_TRANSLATOR_|GOOGLE_TRANSLATE_|process\.env/;
    const offending: string[] = [];
    for (const src of [SHOP_TRANSLATION, ...CREDENTIALS]) {
      walk(src.file, (node) => {
        if (ts.isImportSpecifier(node) && OPERATOR_IMPORTS.has((node.propertyName ?? node.name).text)) offending.push(`${src.path}: ${node.getText()}`);
      });
      const named = OPERATOR_NAMES.exec(src.code);
      if (named) offending.push(`${src.path}: ${named[0]}`);
    }
    expect(offending).toEqual([]);
    expect(CREDENTIALS.length).toBeGreaterThan(5);
  });

  it("the credentials write nothing to the console", () => {
    expect(CREDENTIALS.filter((s) => /\bconsole\./.test(s.code)).map((s) => s.path)).toEqual([]);
  });

  it("a merchant key is revealed only where an outgoing request is built or the key is encrypted", () => {
    const revealing = SOURCES.filter((s) => callsOf(s, "reveal").some((call) => call.arguments.length === 0)).map((s) => s.path).sort();
    expect(revealing).toEqual([
      "app/.server/credentials/checker.ts",
      "app/.server/credentials/deepl-quota.ts",
      "app/.server/credentials/store.ts",
      "app/.server/providers/shop-translation.ts",
    ]);
    // In shop-translation.ts: only inside the SealedProvider's constructor.
    for (const call of callsOf(SHOP_TRANSLATION, "reveal")) {
      const ctor = ancestors(call).find(ts.isConstructorDeclaration);
      expect(ctor && ts.isClassDeclaration(ctor.parent) ? ctor.parent.name?.text : null, location(SHOP_TRANSLATION, call)).toBe("SealedProvider");
    }
  });

  it("pages that only show state never decrypt a key", () => {
    const opening = SOURCES.flatMap((s) => callsOf(s, "openShopTranslation").map((call) => ({ src: s, call })));
    expect(opening.length).toBeGreaterThan(0);
    const NEVER = ["app/routes/app._index.tsx", "app/.server/billing/plan-page.ts", "app/.server/translation/resource-list.ts", "app/.server/coverage/dashboard.ts", "app/.server/overview/overview.ts"];
    for (const { src, call } of opening) {
      expect(NEVER.includes(src.path), location(src, call)).toBe(false);
      // The editor: never in its context or loader, only in the AI actions.
      if (src.path === "app/.server/translation/resource-editor.ts") expect(enclosingFunction(call), location(src, call)).toBe("runEditorAction");
    }
  });

  it("the worker uses its operator provider only on the operator's path", () => {
    const processors = source("app/.server/jobs/processors.ts");
    const uses: string[] = [];
    walk(processors.file, (node) => {
      if (!ts.isPropertyAccessExpression(node) || node.getText() !== "deps.provider") return;
      const operator = insideCallTo(node, "operatorTranslation");
      const guard = ts.isPrefixUnaryExpression(node.parent) && ts.isIfStatement(node.parent.parent) && node.parent.parent.expression.getText() === "!deps.provider";
      if (!operator && !guard) uses.push(location(processors, node));
    });
    expect(uses).toEqual([]);
  });

  it("consent helpers get the shop's services and payer on every translation path", () => {
    const HELPERS = ["hasCurrentAiConsent", "consentedEngines", "textConsentTokens", "missingConsent"];
    const defaults: string[] = [];
    for (const src of SOURCES) {
      if (src.path === "app/.server/settings/shop-settings.ts") continue;
      for (const name of HELPERS) {
        for (const call of callsOf(src, name)) {
          if (call.arguments.length !== 1) continue;
          // Reviewed: Smart Auto-Translate (only with smartAuto, never on Own key) and its page.
          if (src.path.startsWith("app/.server/smart/") || src.path === "app/routes/app.settings_.automatic.tsx") continue;
          // The sweep's smart branch.
          if (src.path === "app/.server/jobs/auto-sweep.ts" && insideThen(call, "smart?.enabled")) continue;
          // processItem's operator branch (by construction only for shops without own keys).
          if (src.path === "app/.server/jobs/processors.ts" && insideThen(call, "!usesOwnKeys(billing?.entitlements)")) continue;
          // The Overview's operator card (the operator's own stores and engines).
          if (src.path === "app/routes/app._index.tsx" && insideCallTo(call, "operatorEngines")) continue;
          defaults.push(`${location(src, call)} ${call.getText()}`);
        }
      }
    }
    expect(defaults).toEqual([]);
  });

  it("every consent grant in app/ and worker/ names the services and their payer", () => {
    const grants = SOURCES.filter((s) => s.path !== "app/.server/settings/shop-settings.ts").flatMap((s) => callsOf(s, "setAiConsent").map((call) => ({ src: s, call })));
    // The Settings permission card and the editor's consent banner.
    expect(grants.map(({ src }) => src.path).sort()).toEqual(["app/.server/translation/resource-editor.ts", "app/routes/app.settings.tsx"]);
    for (const { src, call } of grants) {
      const input = call.arguments[0];
      const named = input && ts.isObjectLiteralExpression(input) && input.properties.some((p) => p.name?.getText() === "consent");
      expect(named, location(src, call)).toBe(true);
    }
  });

  it("the worker gives processItem the shop's own keys (never the operator's provider) for an Own key shop", () => {
    const worker = source("worker/index.ts");
    expect(callsOf(worker, "ownKeyTranslation")).toHaveLength(1);
    const processors = source("app/.server/jobs/processors.ts");
    // Without the dependency an own-key shop has no provider: fail closed.
    expect(processors.code).toMatch(/if \(deps\.ownKeyTranslation\)\s*return deps\.ownKeyTranslation\(shopId, settings\);\s*return \{ payer: "merchant", provider: null/);
  });
});
