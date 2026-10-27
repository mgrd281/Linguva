/**
 * All interface texts, one module per area so changes stay local. Keys
 * start with the area's name ("settings.…"); a unit test checks that and
 * that no key is defined twice.
 */
import type { Message } from "./define";
import * as common from "./common";
import * as content from "./content";
import * as coverage from "./coverage";
import * as editor from "./editor";
import * as glossary from "./glossary";
import * as jobs from "./jobs";
import * as landing from "./landing";
import * as languages from "./languages";
import * as markets from "./markets";
import * as memory from "./memory";
import * as overview from "./overview";
import * as plan from "./plan";
import * as resources from "./resources";
import * as review from "./review";
import * as settings from "./settings";

export type { Message };

export const NAMESPACES = {
  common,
  content,
  coverage,
  editor,
  glossary,
  jobs,
  landing,
  languages,
  markets,
  memory,
  overview,
  plan,
  resources,
  review,
  settings,
} as const;

const en = {
  ...common.en,
  ...content.en,
  ...coverage.en,
  ...editor.en,
  ...glossary.en,
  ...jobs.en,
  ...landing.en,
  ...languages.en,
  ...markets.en,
  ...memory.en,
  ...overview.en,
  ...plan.en,
  ...resources.en,
  ...review.en,
  ...settings.en,
};

export type MessageKey = keyof typeof en;

const de: Record<MessageKey, Message> = {
  ...common.de,
  ...content.de,
  ...coverage.de,
  ...editor.de,
  ...glossary.de,
  ...jobs.de,
  ...landing.de,
  ...languages.de,
  ...markets.de,
  ...memory.de,
  ...overview.de,
  ...plan.de,
  ...resources.de,
  ...review.de,
  ...settings.de,
};

export const MESSAGES: Record<"en" | "de", Record<MessageKey, Message>> = { en, de };
