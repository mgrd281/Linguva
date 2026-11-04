import { createHash } from "node:crypto";

import homeHtml from "../../../site/index.html?raw";
import privacyHtml from "../../../site/datenschutz.html?raw";
import imprintHtml from "../../../site/impressum.html?raw";
import pricingHtml from "../../../site/preise.html?raw";
import appPrivacyHtml from "../../../site/privacy.html?raw";
import supportHtml from "../../../site/support.html?raw";
import { engineConsentTokens, getConfig, type AppConfig } from "../lib/config";
import { formatUsd, monthsFree, sharedMonthsFree, yearlyHandles } from "../../lib/plan-prices";
import { DEFAULT_PRICES, OWN_KEY, type KnownPriceHandle, type PriceTable } from "../../lib/plans";
import { planName } from "../../lib/plan-view";
import { applyEngineBlocks, applyOwnKeyBlocks, DEEPL_ONLY, engineSectionsWithOpenMarks, ownKeyBlocksHaveOpenMarks, pageEngineTags, type PageEngines } from "./engine-blocks";

export { applyOwnKeyBlocks, engineBlocksWithOpenMarks, pageEngineTags, type PageEngines } from "./engine-blocks";

// The marketing website (site/) served by the app on its public address.
const ASSETS = import.meta.glob<string>("../../../site/assets/*", { query: "?url", import: "default", eager: true });
const ASSET_URLS = new Map(Object.entries(ASSETS).map(([path, url]) => [path.split("/").pop()!, url]));

function render(html: string): string {
  return html
    .replace(/(src|href)="assets\/([^"]+)"/g, (match, attr: string, file: string) => {
      const url = ASSET_URLS.get(file);
      // (Unit tests load stylesheets as an empty URL: only a missing file fails.)
      if (url === undefined) throw new Error(`site asset missing: ${file}`);
      return `${attr}="${url}"`;
    })
    .replace(/href="index\.html(#[^"]*)?"/g, (_match, hash?: string) => `href="/${hash ?? ""}"`)
    .replace(/href="(preise|impressum|datenschutz|privacy|support)\.html(#[^"]*)?"/g, (_match, page: string, hash?: string) => `href="/${page}${hash ?? ""}"`);
}

function scriptHashes(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);
}

const PAGES = {
  home: render(homeHtml),
  pricing: render(pricingHtml),
  imprint: render(imprintHtml),
  privacy: render(privacyHtml),
  appPrivacy: render(appPrivacyHtml),
  support: render(supportHtml),
};
export type SitePage = keyof typeof PAGES;
const SCRIPTS = [...new Set(Object.values(PAGES).flatMap(scriptHashes))].join(" ");

// The app's own privacy policy and the support page exist only with
// PUBLIC_PAGES=on; until then they answer 404 and no page links to them.
export const PUBLIC_ONLY: ReadonlySet<SitePage> = new Set(["appPrivacy", "support"]);

/** A price as the website writes it: "29&nbsp;$", "9,99&nbsp;$", "1.290&nbsp;$" (German, as formatUsd("de")). */
function siteUsd(amount: number): string {
  return formatUsd("de", amount).replace(/\u00A0/g, "&nbsp;");
}

const months = (count: number) => `${count} ${count === 1 ? "Monat" : "Monate"} gratis`;
const PRICE_HANDLE = /^(starter|pro|business|own-key)$/;

/** One marker's text for the price table (`ownKeyPlan`: the Own key plan is on the page, so "ab" counts its price too). */
function priceText(key: string, prices: PriceTable, ownKeyPlan: boolean): string {
  const [kind, handle = ""] = key.split(":");
  if (kind === "from") {
    const paid = (["starter", "pro", "business", ...(ownKeyPlan ? [OWN_KEY] : [])] as const).map((h) => prices[h].monthlyUsd);
    return siteUsd(Math.min(...paid));
  }
  if (kind === "yearly-row") {
    const yearly = yearlyHandles(prices);
    if (yearly.length === 0) return "";
    const plans = new Intl.ListFormat("de-DE", { type: "conjunction" }).format(yearly.map(planName));
    const shared = sharedMonthsFree(prices);
    return `<span class="rd">${plans} auch jährlich${shared ? `: ${months(shared)}` : ""}</span>`;
  }
  if (!PRICE_HANDLE.test(handle)) throw new Error(`site price marker unknown: ${key}`);
  const { monthlyUsd, yearlyUsd } = prices[handle as Exclude<KnownPriceHandle, "free">];
  if (kind === "month") return siteUsd(monthlyUsd);
  if (kind === "year") {
    if (yearlyUsd === null) return "Nur monatlich";
    const free = monthsFree(handle === OWN_KEY ? OWN_KEY : (handle as "starter" | "pro" | "business"), prices);
    return `oder ${siteUsd(yearlyUsd)} / Jahr${free ? ` <span class="tag">${months(free)}</span>` : ""}`;
  }
  if (kind === "term") return yearlyUsd === null ? `${siteUsd(monthlyUsd)} im Monat, nur monatlich` : `${siteUsd(monthlyUsd)} im Monat oder ${siteUsd(yearlyUsd)} im Jahr`;
  throw new Error(`site price marker unknown: ${key}`);
}

/**
 * The list prices in the website's markers: `<!--price:KEY-->today's text<!--/price-->` becomes
 * the table's text without the marker. Keys: `month:<plan>` (the monthly price), `year:<plan>` (the
 * card's yearly line: "oder 290 $ / Jahr" with the months free, or "Nur monatlich"), `yearly-row`
 * (the table's "Starter und Pro auch jährlich: 2 Monate gratis", gone without a yearly price),
 * `term:own-key` (Own key's note) and `from` (the home page's "ab 29 $"). With the defaults, the
 * page is exactly the text between the markers (the static image, site/Dockerfile, keeps that).
 */
export function applyPrices(html: string, prices: PriceTable = DEFAULT_PRICES, ownKeyPlan = false): string {
  return html.replace(/<!--price:([a-z:-]+)-->[\s\S]*?<!--\/price-->/g, (_match, key: string) => priceText(key, prices, ownKeyPlan));
}

/**
 * A page as served. Engine blocks first: `<!--engine:TAG-->…` stays only for
 * an engine (or engine and data location) in use, `<!--engines:single-->…`
 * only with DeepL alone, `<!--engines:multi-->…` otherwise,
 * `<!--engines:several-->…` only with two or more engines, and
 * `<!--engines:order:en|de-->` becomes the services' legal names in routing
 * order; so an open point in an unused engine's block never shows the draft
 * notice. Then the Own key plan's blocks: `<!--ownkey-->…<!--/ownkey-->`
 * only with OWN_KEY_PLAN_VISIBLE=on (`ownKeyPlan`), `<!--ownkey:off-->…`
 * only without it; an open point in a hidden block never shows the draft
 * notice either. `<!--public-->…<!--/public-->` (links to the gated pages) stays
 * only with PUBLIC_PAGES=on. `<!--draft-->…<!--/draft-->` (the draft notice)
 * stays until LEGAL_TEXTS_REVIEWED=yes and no open point
 * (`<mark class="open">`) is left in the page. The list prices go into
 * their markers last (applyPrices; the defaults unless `prices` is given).
 */
export function pageHtml(
  html: string,
  {
    publicPages,
    reviewed,
    engines = DEEPL_ONLY,
    ownKeyPlan = false,
    prices = DEFAULT_PRICES,
  }: { publicPages: boolean; reviewed: boolean; engines?: PageEngines; ownKeyPlan?: boolean; prices?: PriceTable },
): string {
  const withEngines = applyPrices(applyOwnKeyBlocks(applyEngineBlocks(html, engines), ownKeyPlan), prices, ownKeyPlan);
  const draft = !reviewed || withEngines.includes('<mark class="open">');
  return withEngines
    .replace(/<!--public-->([\s\S]*?)<!--\/public-->/g, (_match, inner: string) => (publicPages ? inner : ""))
    .replace(/<!--draft-->([\s\S]*?)<!--\/draft-->/g, (_match, inner: string) => (draft ? inner : ""));
}

/** The engines a page names: from the full configuration; a partial one (tests) names DeepL alone. */
function pageEngines(config: SiteConfig): PageEngines {
  if (config.TRANSLATION_PROVIDER === undefined) return DEEPL_ONLY;
  const full = config as AppConfig;
  return { tags: pageEngineTags(full), order: engineConsentTokens(full) };
}

type SiteConfig = Pick<AppConfig, "PUBLIC_PAGES" | "LEGAL_TEXTS_REVIEWED"> & Partial<AppConfig>;

const CSP = [
  "default-src 'none'",
  "img-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  `script-src ${SCRIPTS}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The raw page files (preflight reads the app's privacy policy for open points in engine blocks). */
export function siteSource(page: SitePage): string {
  return PAGES[page];
}

/**
 * Engines added beside DeepL whose section of the app's privacy policy still
 * has open points (the lawyer resolves them before the key is added). DeepL's
 * section is reviewed with the rest of the page (LEGAL_TEXTS_REVIEWED).
 */
export function openEngineSections(config: AppConfig, html: string = PAGES.appPrivacy): string[] {
  return engineSectionsWithOpenMarks(html, pageEngineTags(config));
}

/** Whether the privacy page's Own key section (shown with OWN_KEY_PLAN_VISIBLE=on) still has open points. */
export function openOwnKeySection(html: string = PAGES.appPrivacy): boolean {
  return ownKeyBlocksHaveOpenMarks(html);
}

/**
 * Advice at start (never fatal): with PUBLIC_PAGES=on, an engine section with open points, or the
 * Own key section while the plan is shown, shows the draft notice.
 */
export function siteConfigWarnings(config: AppConfig): string[] {
  if (config.PUBLIC_PAGES !== "on") return [];
  const warnings = openEngineSections(config).map((tag) => `PUBLIC_PAGES=on: the privacy page's ${tag} section still has open points, so the draft notice shows on it`);
  if (config.OWN_KEY_PLAN_VISIBLE === "on" && openOwnKeySection()) {
    warnings.push("OWN_KEY_PLAN_VISIBLE=on and PUBLIC_PAGES=on: the privacy page's own-key section still has open points, so the draft notice shows on it");
  }
  return warnings;
}

/**
 * `prices`: the list prices for the home and pricing pages (their routes read getPriceTable, cached;
 * the defaults when absent). The page itself reads no database, Redis or Shopify and sets no cookie.
 */
export function sitePage(
  request: Request,
  page: SitePage,
  config: SiteConfig = getConfig(),
  prices: PriceTable = DEFAULT_PRICES,
): Response {
  const publicPages = config.PUBLIC_PAGES === "on";
  if (PUBLIC_ONLY.has(page) && !publicPages) {
    throw new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const html = pageHtml(PAGES[page], {
    publicPages,
    reviewed: config.LEGAL_TEXTS_REVIEWED === "yes",
    engines: pageEngines(config),
    ownKeyPlan: config.OWN_KEY_PLAN_VISIBLE === "on",
    prices,
  });
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // A preview for the owner until the legal pages and a real domain exist.
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "public, max-age=300",
  });
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  if (process.env.NODE_ENV === "production" && https) headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(request.method === "HEAD" ? null : html, { headers });
}
