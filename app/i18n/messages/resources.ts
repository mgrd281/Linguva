/** Texts of the resource lists (products, collections, pages, blog posts, blogs and other content types). Keys start with "resources.". */
import type { Message, Translation } from "./define";

export const en = {
  "resources.denied.heading": "Allow Linguva to read your {plural}",
  "resources.denied.needsScope": "To translate {plural}, Linguva needs permission to read them. It never changes the originals.",
  "resources.denied.unavailable": "Shopify doesn't allow apps to read {plural} in this store yet.",
  "resources.denied.allow": "Allow access",
  "resources.denied.back": "Back to all content",

  "resources.noLanguages.heading": "No languages to translate into",
  "resources.noLanguages.body": "Add a language under Settings → Languages in the Shopify admin to start translating your {plural}.",
  "resources.noLanguages.open": "Open language settings",

  "resources.consent.heading": "Allow AI processing to translate in bulk",
  "resources.consent.before": "Bulk translation uses AI. Allow it under ",
  "resources.consent.after": " first.",

  "resources.bulkError.heading": "Bulk translation couldn't start",
  "resources.bulkError.JOBS_UNAVAILABLE": "Background processing isn't configured for this app yet.",
  "resources.bulkError.plan": "Your plan doesn't include this. See Plan to change it.",
  "resources.bulkError.generic": "Please reload the page and try again.",

  "resources.plan.bulkHeading": "Bulk translation is part of paid plans",
  "resources.plan.localeHeading": "Your plan doesn't include {language}",
  "resources.plan.body": "You can still translate {plural} one by one in the editor.",

  "resources.caution.legalHeading": "Legal texts",
  "resources.caution.legalBody":
    "Have every translation checked by someone qualified before publishing. They are translated one by one, with review.",
  "resources.caution.liquidHeading": "Templates with Liquid code",
  "resources.caution.liquidBody": "Only visible text is translated; Liquid code is kept as is. They are translated one by one, with review.",

  "resources.translateInto": "Translate into:",

  "resources.bulk.heading": "Translate all {plural}",
  "resources.bulk.intro":
    "Fills in missing and outdated fields with AI, using your glossary and translation memory. Up-to-date translations are never touched; outdated ones that a person wrote or approved are kept unless you allow replacing them.",
  "resources.bulk.autoPublish":
    "Automatic publishing is on: results that pass the quality checks go live immediately; results with warnings wait in Review.",
  "resources.bulk.review": "Results wait in Review until you approve them.",
  "resources.bulk.scopeLabel": "What to translate",
  "resources.bulk.scopeAll": "All fields",
  "resources.bulk.scopeSeo": "Only search engine listings (SEO title and description)",
  "resources.bulk.overwrite": "Also replace outdated translations that a person wrote or approved",
  "resources.bulk.attached": "Also translate image alt text and custom fields",
  "resources.bulk.attachedDetails": 'Checks every {singular}, so the job takes longer. Not used for "Only search engine listings".',
  "resources.bulk.submit": "Translate all into {language}",

  "resources.empty.heading": "No {plural} yet",
  "resources.empty.body": "{label} you create in Shopify appear here, ready to translate into {language}.",
  "resources.empty.yourLanguages": "your languages",

  "resources.table.translatedFields": "Translated fields",
  "resources.status.partial": "Partial",
  "resources.paging.first": "First page",
  "resources.paging.next": "Next page",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "resources.denied.heading": "Linguva braucht Lesezugriff auf {plural}",
  "resources.denied.needsScope": "Um {plural} zu übersetzen, braucht Linguva die Berechtigung, sie zu lesen. Die Originale werden nie geändert.",
  "resources.denied.unavailable": "Shopify erlaubt Apps in diesem Shop noch nicht, {plural} zu lesen.",
  "resources.denied.allow": "Zugriff erlauben",
  "resources.denied.back": "Zurück zu „Alle Inhalte“",

  "resources.noLanguages.heading": "Keine Sprachen zum Übersetzen",
  "resources.noLanguages.body": "Füge im Shopify-Adminbereich unter „Einstellungen → Sprachen“ eine Sprache hinzu, um {plural} zu übersetzen.",
  "resources.noLanguages.open": "Spracheinstellungen öffnen",

  "resources.consent.heading": "KI-Verarbeitung für Massenübersetzungen erlauben",
  "resources.consent.before": "Massenübersetzung nutzt KI. Erlaube sie zuerst unter ",
  "resources.consent.after": ".",

  "resources.bulkError.heading": "Die Massenübersetzung konnte nicht gestartet werden",
  "resources.bulkError.JOBS_UNAVAILABLE": "Die Hintergrundverarbeitung ist für diese App noch nicht eingerichtet.",
  "resources.bulkError.plan": "Dein Tarif enthält das nicht. Du kannst ihn unter „Tarif“ ändern.",
  "resources.bulkError.generic": "Bitte lade die Seite neu und versuche es noch einmal.",

  "resources.plan.bulkHeading": "Massenübersetzung ist in den kostenpflichtigen Tarifen enthalten",
  "resources.plan.localeHeading": "Dein Tarif enthält {language} nicht",
  "resources.plan.body": "Du kannst {plural} weiterhin einzeln im Editor übersetzen.",

  "resources.caution.legalHeading": "Rechtstexte",
  "resources.caution.legalBody":
    "Lass jede Übersetzung vor dem Veröffentlichen von einer qualifizierten Person prüfen. Sie werden einzeln und mit Prüfung übersetzt.",
  "resources.caution.liquidHeading": "Vorlagen mit Liquid-Code",
  "resources.caution.liquidBody": "Nur sichtbarer Text wird übersetzt; Liquid-Code bleibt unverändert. Sie werden einzeln und mit Prüfung übersetzt.",

  "resources.translateInto": "Übersetzen in:",

  "resources.bulk.heading": "Alle {plural} übersetzen",
  "resources.bulk.intro":
    "Füllt fehlende und veraltete Felder mit KI aus und nutzt dabei dein Glossar und deinen Übersetzungsspeicher. Aktuelle Übersetzungen bleiben unangetastet; veraltete, die eine Person geschrieben oder freigegeben hat, bleiben erhalten, außer du erlaubst, sie zu ersetzen.",
  "resources.bulk.autoPublish":
    "Automatisches Veröffentlichen ist an: Ergebnisse, die die Qualitätsprüfungen bestehen, gehen sofort live; Ergebnisse mit Warnungen warten unter „Prüfen“.",
  "resources.bulk.review": "Die Ergebnisse warten unter „Prüfen“, bis du sie freigibst.",
  "resources.bulk.scopeLabel": "Was übersetzt wird",
  "resources.bulk.scopeAll": "Alle Felder",
  "resources.bulk.scopeSeo": "Nur Suchmaschinen-Einträge (SEO-Titel und SEO-Beschreibung)",
  "resources.bulk.overwrite": "Auch veraltete Übersetzungen ersetzen, die eine Person geschrieben oder freigegeben hat",
  "resources.bulk.attached": "Auch Alt-Texte von Bildern und benutzerdefinierte Felder übersetzen",
  "resources.bulk.attachedDetails":
    "Prüft jeden Eintrag vom Typ „{singular}“, daher dauert der Auftrag länger. Gilt nicht für „Nur Suchmaschinen-Einträge“.",
  "resources.bulk.submit": "Alle in {language} übersetzen",

  "resources.empty.heading": "Noch keine {plural}",
  "resources.empty.body": "{label}, die du in Shopify erstellst, erscheinen hier – bereit zur Übersetzung in {language}.",
  "resources.empty.yourLanguages": "deine Sprachen",

  "resources.table.translatedFields": "Übersetzte Felder",
  "resources.status.partial": "Teilweise",
  "resources.paging.first": "Erste Seite",
  "resources.paging.next": "Nächste Seite",
};
