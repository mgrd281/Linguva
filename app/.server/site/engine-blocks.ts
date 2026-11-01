/**
 * Engine blocks in the website's pages (site/*.html), pure so preflight can
 * read the files too (pages.ts serves them):
 *
 * - `<!--engine:TAG-->…<!--/engine:TAG-->` stays only for an engine id or
 *   consent token in use ("deepl", "azure", "azure-eu", …): no page names a
 *   processor the deployment doesn't use;
 * - `<!--engines:single-->…` only with DeepL alone (the texts from before
 *   engines could be combined), `<!--engines:multi-->…` otherwise;
 * - `<!--engines:several-->…` only with two or more engines (an order and a
 *   failover need more than one service; Azure or Google alone is "multi"
 *   but not "several");
 * - `<!--engines:order:en-->` / `:de` becomes the services' legal names in
 *   routing order.
 *
 * And the Own key plan's blocks (`applyOwnKeyBlocks`): `<!--ownkey-->…`
 * only with OWN_KEY_PLAN_VISIBLE=on, `<!--ownkey:off-->…` only without it.
 */
import { translate } from "../../i18n/i18n";
import { engineOfToken, type ConsentToken } from "../../lib/engines";
import { engineConsentTokens, type AppConfig } from "../lib/config";

/** The translation engines a page names: consent tokens and engine ids in use, in routing order. */
export interface PageEngines {
  tags: ReadonlySet<string>;
  order: readonly ConsentToken[];
}

/** DeepL alone: what the pages said before engines could be combined. */
export const DEEPL_ONLY: PageEngines = { tags: new Set(["deepl"]), order: ["deepl"] };

/** Engine ids and consent tokens in use, e.g. {"deepl", "azure", "azure-eu"}; mock or none → {"deepl"}. */
export function pageEngineTags(config: AppConfig): ReadonlySet<string> {
  const tokens = engineConsentTokens(config);
  return new Set([...tokens, ...tokens.map(engineOfToken)]);
}

const ENGINE_BLOCK = /<!--engine:([a-z-]+)-->([\s\S]*?)<!--\/engine:\1-->/g;

/** Keeps the engine blocks for these tags (their markers dropped) and removes the others; nested blocks too. */
function engineBlocks(html: string, tags: ReadonlySet<string>): string {
  let out = html;
  for (let previous = ""; previous !== out; ) {
    previous = out;
    out = out.replace(ENGINE_BLOCK, (_match, tag: string, inner: string) => (tags.has(tag) ? inner : ""));
  }
  return out;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The page with its engine blocks resolved for these engines. */
export function applyEngineBlocks(html: string, engines: PageEngines): string {
  const single = engines.order.length === 1 && engines.order[0] === "deepl";
  const order = (locale: "en" | "de") => engines.order.map((token) => escapeHtml(translate(locale, `common.engine.legal.${token}`))).join(" → ");
  return engineBlocks(html, engines.tags)
    .replace(/<!--engines:several-->([\s\S]*?)<!--\/engines:several-->/g, (_match, inner: string) => (engines.order.length >= 2 ? inner : ""))
    .replace(/<!--engines:single-->([\s\S]*?)<!--\/engines:single-->/g, (_match, inner: string) => (single ? inner : ""))
    .replace(/<!--engines:multi-->([\s\S]*?)<!--\/engines:multi-->/g, (_match, inner: string) => (single ? "" : inner))
    .replace(/<!--engines:order:(en|de)-->/g, (_match, locale: "en" | "de") => order(locale));
}

const OWN_KEY_BLOCK = /<!--ownkey-->([\s\S]*?)<!--\/ownkey-->/g;
const OWN_KEY_OFF_BLOCK = /<!--ownkey:off-->([\s\S]*?)<!--\/ownkey:off-->/g;

/**
 * The Own key plan's blocks (docs/PRICING_DECISION.md §9 step 11): `<!--ownkey-->…<!--/ownkey-->`
 * stays only while the plan is shown (OWN_KEY_PLAN_VISIBLE=on), `<!--ownkey:off-->…<!--/ownkey:off-->`
 * only while it isn't. Never nested in each other or in engine blocks. With the plan hidden a page
 * is byte for byte what it was before the plan existed.
 */
export function applyOwnKeyBlocks(html: string, visible: boolean): string {
  return html
    .replace(OWN_KEY_BLOCK, (_match, inner: string) => (visible ? inner : ""))
    .replace(OWN_KEY_OFF_BLOCK, (_match, inner: string) => (visible ? "" : inner));
}

/** Whether an own-key block (shown only with OWN_KEY_PLAN_VISIBLE=on) still contains an open point. */
export function ownKeyBlocksHaveOpenMarks(html: string): boolean {
  return [...html.matchAll(OWN_KEY_BLOCK)].some(([, inner]) => inner!.includes('<mark class="open">'));
}

/** Engine blocks kept for these tags that still contain an open point (`<mark class="open">`). */
export function engineBlocksWithOpenMarks(html: string, tags: ReadonlySet<string>): string[] {
  const open = new Set<string>();
  for (const [, tag, inner] of html.matchAll(ENGINE_BLOCK)) {
    if (!tags.has(tag!)) continue;
    // Only what stays: an open point inside a nested block that is removed doesn't count.
    if (engineBlocks(inner!, tags).includes('<mark class="open">')) open.add(tag!);
  }
  return [...open];
}

/**
 * The same, without DeepL's own section: it is reviewed with the rest of the
 * page (LEGAL_TEXTS_REVIEWED). An engine added beside it needs its section
 * resolved by the lawyer before its key is added.
 */
export function engineSectionsWithOpenMarks(html: string, tags: ReadonlySet<string>): string[] {
  return engineBlocksWithOpenMarks(html, tags).filter((tag) => tag !== "deepl");
}
