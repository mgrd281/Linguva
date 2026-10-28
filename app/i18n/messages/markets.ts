/** Texts of the markets area. Keys start with "markets.". */
import type { Message, Translation } from "./define";

export const en = {
  "markets.access.heading": "See your languages per market",
  "markets.access.body":
    "Linguva can show which languages each of your markets offers, under which web address, and what stops customers from seeing your translations. For this, Linguva needs permission to read your markets. It never changes them.",
  "markets.access.allow": "Allow reading markets",

  "markets.checks.heading": "Checks",
  "markets.checks.none": "No problems found",
  "markets.checks.allOffered": "Every published language is offered in a market.",
  "markets.checks.coverageBefore": "How complete each language is: see",
  "markets.checks.coverageLink": "Coverage",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} offers {language}, but the language isn't published, so customers see the default language. Publish it under Languages.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "{language} is published, but no active market offers it, so no storefront address serves it. Add it to a market in Shopify.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "{language} is offered in a market, but your plan doesn't include AI translation into it.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} has no domain or subfolder of its own; customers reach it through your primary domain and the country selector.",

  "markets.market.active": "Active",
  "markets.market.status.DRAFT": "draft",
  "markets.market.number": "Market number {id} (for glossary terms)",
  "markets.market.primaryDomain": "Uses your primary domain.",
  "markets.market.address": "Address",
  "markets.market.default": "default",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "markets.access.heading": "Deine Sprachen pro Markt ansehen",
  "markets.access.body":
    "Linguva kann zeigen, welche Sprachen jeder deiner Märkte anbietet, unter welcher Webadresse und was Kunden daran hindert, deine Übersetzungen zu sehen. Dafür braucht Linguva die Berechtigung, deine Märkte zu lesen. Linguva ändert sie nie.",
  "markets.access.allow": "Lesen der Märkte erlauben",

  "markets.checks.heading": "Prüfungen",
  "markets.checks.none": "Keine Probleme gefunden",
  "markets.checks.allOffered": "Jede veröffentlichte Sprache wird in einem Markt angeboten.",
  "markets.checks.coverageBefore": "Wie vollständig jede Sprache ist, siehst du unter",
  "markets.checks.coverageLink": "Abdeckung",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} bietet {language} an, aber die Sprache ist nicht veröffentlicht, daher sehen Kunden die Standardsprache. Veröffentliche sie unter „Sprachen“.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "{language} ist veröffentlicht, wird aber von keinem aktiven Markt angeboten und ist daher unter keiner Shop-Adresse erreichbar. Füge die Sprache in Shopify einem Markt hinzu.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "{language} wird in einem Markt angeboten, aber dein Tarif enthält keine KI-Übersetzung in diese Sprache.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} hat keine eigene Domain und keinen eigenen Unterordner; Kunden erreichen den Markt über deine Hauptdomain und die Länderauswahl.",

  "markets.market.active": "Aktiv",
  "markets.market.status.DRAFT": "Entwurf",
  "markets.market.number": "Marktnummer {id} (für Glossarbegriffe)",
  "markets.market.primaryDomain": "Verwendet deine Hauptdomain.",
  "markets.market.address": "Adresse",
  "markets.market.default": "Standard",
};
