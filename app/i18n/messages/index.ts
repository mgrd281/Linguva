/**
 * All interface texts, one module per area so changes stay local. Keys
 * start with the area's name ("settings.…"); a unit test checks that and
 * that no key is defined twice.
 */
import type { Message } from "./define";
import * as automatic from "./automatic";
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
import * as transfer from "./transfer";

export type { Message };

export const NAMESPACES = {
  automatic,
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
  transfer,
} as const;

const en = {
  ...automatic.en,
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
  ...transfer.en,
};

export type MessageKey = keyof typeof en;

const de: Record<MessageKey, Message> = {
  ...automatic.de,
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
  ...transfer.de,
};

const fr: Record<MessageKey, Message> = {
  ...automatic.fr,
  ...common.fr,
  ...content.fr,
  ...coverage.fr,
  ...editor.fr,
  ...glossary.fr,
  ...jobs.fr,
  ...landing.fr,
  ...languages.fr,
  ...markets.fr,
  ...memory.fr,
  ...overview.fr,
  ...plan.fr,
  ...resources.fr,
  ...review.fr,
  ...settings.fr,
  ...transfer.fr,
};

const es: Record<MessageKey, Message> = {
  ...automatic.es,
  ...common.es,
  ...content.es,
  ...coverage.es,
  ...editor.es,
  ...glossary.es,
  ...jobs.es,
  ...landing.es,
  ...languages.es,
  ...markets.es,
  ...memory.es,
  ...overview.es,
  ...plan.es,
  ...resources.es,
  ...review.es,
  ...settings.es,
  ...transfer.es,
};

export const MESSAGES: Record<"en" | "de" | "fr" | "es", Record<MessageKey, Message>> = { en, de, fr, es };
