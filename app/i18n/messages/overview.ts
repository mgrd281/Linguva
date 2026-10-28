/** Texts of the overview area. Keys start with "overview.". */
import type { Message, Translation } from "./define";

export const en = {
  "overview.banner.exhausted.heading": "This month's AI allowance is used up",
  "overview.banner.exhausted.body": "AI translation pauses until next month. Manual translation and translation memory keep working.",
  "overview.banner.high.heading": "{percent} % of this month's AI allowance used",
  "overview.banner.high.body": "Large bulk jobs may stop when the allowance runs out.",

  "overview.start.heading": "Get started",
  "overview.start.progress": "{done} of {total} steps done",
  "overview.start.progressLabel": "Setup progress",

  "overview.checklist.languageSettings": "Open language settings",
  "overview.checklist.language.label": "Add a language",
  "overview.checklist.language.detail": "Choose the languages you sell in, in Shopify's language settings.",
  "overview.checklist.consent.label": "Allow AI translation",
  "overview.checklist.consent.detail": "AI drafts are reviewed by you before anything is published.",
  "overview.checklist.consent.action": "Open settings",
  "overview.checklist.firstTranslation.label": "Publish your first translation",
  "overview.checklist.firstTranslation.detail": "Open a product, translate it with AI, check the result and publish.",
  "overview.checklist.firstTranslation.action": "Translate products",
  "overview.checklist.review.label": "Review bulk translations",
  "overview.checklist.review.labelCount": { one: "Review {count} translation", other: "Review {count} translations" },
  "overview.checklist.review.detail": "Bulk translations wait for your approval before customers see them.",
  "overview.checklist.review.action": "Open Review",
  "overview.checklist.publishLanguage.label": "Show a language to customers",
  "overview.checklist.publishLanguage.detail": "Publish the language in Shopify when its translations are ready.",

  "overview.languages.heading": "Your languages",
  "overview.languages.onlyPrimary":
    "Your store only has its primary language ({primary}). Add the languages you sell in under Settings → Languages in Shopify, then come back here.",
  "overview.languages.unknown": "unknown",
  "overview.languages.storefront": "On your storefront",
  "overview.languages.action": "Action",
  "overview.languages.hidden": "Hidden",
  "overview.languages.notMeasured": "Not measured yet",
  "overview.languages.progressLabel": "{language} translated",
  "overview.languages.translate": "Translate",
  "overview.languages.translateLabel": "Translate into {language}",
  "overview.languages.measured": "Measured {date}.",
  "overview.languages.runCoverage": "Run the coverage report to see how complete each language is.",
  "overview.languages.updateCoverage": "Update coverage report",
  "overview.languages.openCoverage": "Open coverage report",

  "overview.translate.heading": "What do you want to translate?",
  "overview.translate.content": "Pages, menus, theme and more",

  "overview.attention.heading": "Needs your attention",
  "overview.attention.drafts": { one: "{count} translation to review", other: "{count} translations to review" },
  "overview.attention.noDrafts": "Nothing waiting for review.",
  "overview.attention.jobs": { one: "{count} translation job running", other: "{count} translation jobs running" },

  "overview.usage.heading": "AI usage this month",
  "overview.usage.characters": "{used} of {limit} characters",
  "overview.usage.memoryFree": "Text reused from your translation memory is free.",

  "overview.store.languages": "{enabled} of {max} languages enabled, {published} published.",
  "overview.store.installed": "Installed {date}",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "overview.banner.exhausted.heading": "Das KI-Kontingent dieses Monats ist aufgebraucht",
  "overview.banner.exhausted.body": "Die KI-Übersetzung pausiert bis zum nächsten Monat. Manuelle Übersetzung und Übersetzungsspeicher funktionieren weiterhin.",
  "overview.banner.high.heading": "{percent} % des KI-Kontingents dieses Monats verbraucht",
  "overview.banner.high.body": "Große Massenaufträge können anhalten, wenn das Kontingent aufgebraucht ist.",

  "overview.start.heading": "Erste Schritte",
  "overview.start.progress": "{done} von {total} Schritten erledigt",
  "overview.start.progressLabel": "Fortschritt der Einrichtung",

  "overview.checklist.languageSettings": "Spracheinstellungen öffnen",
  "overview.checklist.language.label": "Sprache hinzufügen",
  "overview.checklist.language.detail": "Wähle in den Spracheinstellungen von Shopify die Sprachen aus, in denen du verkaufst.",
  "overview.checklist.consent.label": "KI-Übersetzung erlauben",
  "overview.checklist.consent.detail": "Du prüfst KI-Entwürfe, bevor etwas veröffentlicht wird.",
  "overview.checklist.consent.action": "Einstellungen öffnen",
  "overview.checklist.firstTranslation.label": "Erste Übersetzung veröffentlichen",
  "overview.checklist.firstTranslation.detail": "Öffne ein Produkt, übersetze es mit KI, prüfe das Ergebnis und veröffentliche es.",
  "overview.checklist.firstTranslation.action": "Produkte übersetzen",
  "overview.checklist.review.label": "Massenübersetzungen prüfen",
  "overview.checklist.review.labelCount": { one: "{count} Übersetzung prüfen", other: "{count} Übersetzungen prüfen" },
  "overview.checklist.review.detail": "Massenübersetzungen warten auf deine Freigabe, bevor Kunden sie sehen.",
  "overview.checklist.review.action": "„Prüfen“ öffnen",
  "overview.checklist.publishLanguage.label": "Sprache für Kunden sichtbar machen",
  "overview.checklist.publishLanguage.detail": "Veröffentliche die Sprache in Shopify, sobald ihre Übersetzungen fertig sind.",

  "overview.languages.heading": "Deine Sprachen",
  "overview.languages.onlyPrimary":
    "Dein Shop hat nur seine Hauptsprache ({primary}). Füge in Shopify unter Einstellungen → Sprachen die Sprachen hinzu, in denen du verkaufst, und komm dann hierher zurück.",
  "overview.languages.unknown": "unbekannt",
  "overview.languages.storefront": "Im Onlineshop",
  "overview.languages.action": "Aktion",
  "overview.languages.hidden": "Ausgeblendet",
  "overview.languages.notMeasured": "Noch nicht gemessen",
  "overview.languages.progressLabel": "{language} übersetzt",
  "overview.languages.translate": "Übersetzen",
  "overview.languages.translateLabel": "Übersetzen: {language}",
  "overview.languages.measured": "Gemessen: {date}.",
  "overview.languages.runCoverage": "Erstelle den Abdeckungsbericht, um zu sehen, wie vollständig jede Sprache ist.",
  "overview.languages.updateCoverage": "Abdeckungsbericht aktualisieren",
  "overview.languages.openCoverage": "Abdeckungsbericht öffnen",

  "overview.translate.heading": "Was möchtest du übersetzen?",
  "overview.translate.content": "Seiten, Menüs, Theme und mehr",

  "overview.attention.heading": "Erfordert deine Aufmerksamkeit",
  "overview.attention.drafts": { one: "{count} Übersetzung zu prüfen", other: "{count} Übersetzungen zu prüfen" },
  "overview.attention.noDrafts": "Keine Übersetzungen zu prüfen.",
  "overview.attention.jobs": { one: "{count} Übersetzungsauftrag läuft", other: "{count} Übersetzungsaufträge laufen" },

  "overview.usage.heading": "KI-Nutzung in diesem Monat",
  "overview.usage.characters": "{used} von {limit} Zeichen",
  "overview.usage.memoryFree": "Aus deinem Übersetzungsspeicher wiederverwendeter Text ist kostenlos.",

  "overview.store.languages": "{enabled} von {max} Sprachen aktiviert, {published} veröffentlicht.",
  "overview.store.installed": "Installiert am {date}",
};
