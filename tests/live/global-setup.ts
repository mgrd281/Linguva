/**
 * Runs once before the live tests: checks that the configured store is the
 * Partner development store, picks the target language and shares it with
 * the test files. A setup problem (missing language, wrong store, missing
 * session) prints what to do and stops the run, instead of a wall of
 * skipped or failed suites. Without live settings, the tests skip.
 */
import type { TestProject } from "vitest/node";
import { SHOP_LOCALES_QUERY } from "../../app/.server/locales/shop-locales";
import { createLiveAdmin } from "./admin-client";
import { shopFacts } from "./fixtures";
import { assertDevelopmentStore, chooseTargetLocale, LiveTestRefused, readLiveSettings, type ShopLocale } from "./guard";

declare module "vitest" {
  export interface ProvidedContext {
    liveTargetLocale: string;
  }
}

function stop(message: string): never {
  console.error(`\n✗ Live tests not started: setup incomplete\n\n${message}\n\nNothing was sent to the store except read-only checks. See docs/DEV_STORE_VERIFICATION.md §4.\n`);
  process.exit(1);
}

export default async function setup(project: TestProject) {
  let settings;
  try {
    settings = readLiveSettings();
  } catch (error) {
    if (error instanceof LiveTestRefused) stop(error.message.replace(/^Live tests refused: /, ""));
    throw error;
  }
  if (!settings) {
    console.info("Live tests are off: set LIVE_SHOPIFY_SHOP and credentials (docs/DEV_STORE_VERIFICATION.md §4). All live tests are skipped.");
    project.provide("liveTargetLocale", "de");
    return;
  }
  const admin = createLiveAdmin(settings);
  let locales: ShopLocale[];
  try {
    assertDevelopmentStore(settings, await shopFacts(admin));
    const response = await admin.graphql(SHOP_LOCALES_QUERY);
    locales = ((await response.json()) as { data: { shopLocales: ShopLocale[] } }).data.shopLocales;
  } catch (error) {
    stop(error instanceof Error ? error.message.replace(/^Live tests refused: /, "") : String(error));
  }
  const choice = chooseTargetLocale(locales, settings.targetLocale, settings.shop);
  if (!choice.ok) stop(choice.message);
  project.provide("liveTargetLocale", choice.locale);
  console.info(
    `Live tests against ${settings.shop} (Partner development store), target language ${choice.locale}${choice.published ? "" : " (unpublished)"}, ` +
      (settings.allowWrites ? "fixture writes allowed (own fixtures only)" : "read-only: Shopify mutations are refused") +
      ".",
  );
}
