/** Texts of the coverage area. Keys start with "coverage.". */
import type { Message, Translation } from "./define";

export const en = {
  "coverage.page.heading": "Translation coverage",
  "coverage.intro":
    "The report checks every product and collection in each of your languages: what is translated, missing or outdated, and how search engine listings look. It only reads from Shopify and doesn't use AI.",
  "coverage.startFailed.heading": "Couldn't start",
  "coverage.startFailed.fallback": "Please reload the page and try again.",
  "coverage.lastFailed.heading": "The last report didn't finish",
  "coverage.lastFailed.fallback": "Run the report again.",
  "coverage.error.JOBS_UNAVAILABLE": "Background processing isn't configured for this app yet.",
  "coverage.error.NO_LANGUAGES": "Add a language under Settings → Languages first.",
  "coverage.error.STALLED": "The last report stopped making progress. Run it again.",
  "coverage.error.PLAN_BULK": "Bulk translation is part of paid plans. See Plan to change your plan.",
  "coverage.error.PLAN_LANGUAGE": "Your plan doesn't include this language. See Plan to change your plan.",
  "coverage.error.SCAN_FAILED": "Shopify didn't answer reliably. Run the report again later.",

  "coverage.run.first": "Run coverage report",
  "coverage.run.again": "Run the report again",
  "coverage.run.scanning": "Scanning {scanning} ({done} of {total} parts, {items} items so far)",
  "coverage.run.last": "Last report: {date}",

  "coverage.byLanguage.heading": "By language",
  "coverage.byLanguage.items": "Items",
  "coverage.byLanguage.missing": "Missing",
  "coverage.byLanguage.seo": "SEO listings",
  "coverage.byLanguage.fix": "Fix",
  "coverage.byLanguage.fields": "{percent}% ({count} fields)",
  "coverage.byLanguage.seoTranslated": "{percent}% translated",
  "coverage.byLanguage.seoToCheck": "{count} to check",
  "coverage.byLanguage.seoNone": "None set",
  "coverage.byLanguage.translateGaps": "Translate gaps",
  "coverage.byLanguage.seoOnly": "SEO only",

  "coverage.seo.heading": "Search engine listings",
  "coverage.seo.items": "items",
  "coverage.seo.noSourceTitle":
    "{language}: {count} {kind} have no SEO title in the original language, so search engines see the regular title.",
  "coverage.seo.duplicates":
    "{language}: {count} items share an SEO title with another item. Unique titles help search engines tell pages apart.",
  "coverage.seo.unpublished": "{language} isn't published, so customers and search engines don't see these translations yet.",

  "coverage.gaps.heading": "Items with the most gaps",
  "coverage.gaps.item": "Item",
  "coverage.gaps.missing": "Missing fields",
  "coverage.gaps.outdated": "Outdated fields",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "coverage.page.heading": "Übersetzungsabdeckung",
  "coverage.intro":
    "Der Bericht prüft alle Produkte und Kollektionen in jeder deiner Sprachen: was übersetzt ist, was fehlt oder veraltet ist und wie die Suchmaschinen-Einträge aussehen. Er liest nur Daten aus Shopify und verwendet keine KI.",
  "coverage.startFailed.heading": "Konnte nicht gestartet werden",
  "coverage.startFailed.fallback": "Bitte lade die Seite neu und versuche es noch einmal.",
  "coverage.lastFailed.heading": "Der letzte Bericht wurde nicht abgeschlossen",
  "coverage.lastFailed.fallback": "Erstelle den Bericht noch einmal.",
  "coverage.error.JOBS_UNAVAILABLE": "Die Hintergrundverarbeitung ist für diese App noch nicht eingerichtet.",
  "coverage.error.NO_LANGUAGES": "Füge zuerst unter „Einstellungen“ → „Sprachen“ eine Sprache hinzu.",
  "coverage.error.STALLED": "Der letzte Bericht kam nicht mehr voran. Erstelle ihn noch einmal.",
  "coverage.error.PLAN_BULK": "Massenübersetzung ist in den kostenpflichtigen Tarifen enthalten. Ändere deinen Tarif unter „Tarif“.",
  "coverage.error.PLAN_LANGUAGE": "Dein Tarif enthält diese Sprache nicht. Ändere deinen Tarif unter „Tarif“.",
  "coverage.error.SCAN_FAILED": "Shopify hat nicht zuverlässig geantwortet. Erstelle den Bericht später noch einmal.",

  "coverage.run.first": "Abdeckungsbericht erstellen",
  "coverage.run.again": "Bericht erneut erstellen",
  "coverage.run.scanning": "Wird geprüft: {scanning} ({done} von {total} Teilen, bisher {items} Einträge)",
  "coverage.run.last": "Letzter Bericht: {date}",

  "coverage.byLanguage.heading": "Nach Sprache",
  "coverage.byLanguage.items": "Einträge",
  "coverage.byLanguage.missing": "Fehlend",
  "coverage.byLanguage.seo": "SEO-Einträge",
  "coverage.byLanguage.fix": "Beheben",
  "coverage.byLanguage.fields": "{percent} % ({count} Felder)",
  "coverage.byLanguage.seoTranslated": "{percent} % übersetzt",
  "coverage.byLanguage.seoToCheck": "{count} zu prüfen",
  "coverage.byLanguage.seoNone": "Keine vorhanden",
  "coverage.byLanguage.translateGaps": "Lücken übersetzen",
  "coverage.byLanguage.seoOnly": "Nur SEO",

  "coverage.seo.heading": "Suchmaschinen-Einträge",
  "coverage.seo.items": "Einträge",
  "coverage.seo.noSourceTitle":
    "{language}: {kind} ohne SEO-Titel in der Originalsprache: {count}. Suchmaschinen sehen dort den normalen Titel.",
  "coverage.seo.duplicates":
    "{language}: {count} Einträge haben denselben SEO-Titel wie ein anderer Eintrag. Eindeutige Titel helfen Suchmaschinen, Seiten zu unterscheiden.",
  "coverage.seo.unpublished": "{language} ist nicht veröffentlicht, daher sehen Kunden und Suchmaschinen diese Übersetzungen noch nicht.",

  "coverage.gaps.heading": "Einträge mit den meisten Lücken",
  "coverage.gaps.item": "Eintrag",
  "coverage.gaps.missing": "Fehlende Felder",
  "coverage.gaps.outdated": "Veraltete Felder",
};
