/** Texts of the glossary area. Keys start with "glossary.". */
import type { Message, Translation } from "./define";

export const en = {
  "glossary.exportCsv": "Export CSV",

  "glossary.add.heading": "Add a term",
  "glossary.add.submit": "Add term",
  "glossary.add.failed": "Term not added",
  "glossary.field.rule": "Rule",
  "glossary.field.term": "Term",
  "glossary.field.translation": "Translation",
  "glossary.field.translationDetails": "Only for “Always translate as”.",
  "glossary.field.market": "Only in one market (optional)",
  "glossary.field.marketDetails": "Leave empty for all markets. Otherwise the market number shown on the Markets page.",
  "glossary.field.caseSensitive": "Match upper and lower case exactly",
  "glossary.option.DO_NOT_TRANSLATE": "Never translate (brands, product names, SKUs)",
  "glossary.option.PREFERRED": "Always translate as…",
  "glossary.option.FORBIDDEN": "Never use this wording in translations",

  "glossary.rule.DO_NOT_TRANSLATE": "Never translate",
  "glossary.rule.PREFERRED": "Always translate as",
  "glossary.rule.FORBIDDEN": "Never use",

  "glossary.terms.heading": "Terms ({count})",
  "glossary.terms.empty": "No terms yet. Add your brand and product names so they are never translated.",
  "glossary.terms.market": "Market",
  "glossary.terms.actions": "Actions",

  "glossary.import.heading": "Import from CSV",
  "glossary.import.columns":
    "Columns: rule, term, translation, target_locale, market, case_sensitive, notes. Rules: DO_NOT_TRANSLATE, PREFERRED, FORBIDDEN. Nothing is imported if any row is invalid.",
  "glossary.import.file": "CSV file",
  "glossary.import.paste": "…or paste CSV",
  "glossary.import.replaceAll": "Replace all existing terms",
  "glossary.import.submit": "Import",
  "glossary.import.rejected": "Import rejected",
  "glossary.import.line": "Line {line}: {message}",
  "glossary.import.complete": "Import complete",
  "glossary.import.count": { one: "{count} term imported.", other: "{count} terms imported." },
  "glossary.import.failed": "Import failed",

  "glossary.error.notOnPlan": "The glossary is part of the Pro and Business plans. See Plan to change your plan.",
  "glossary.error.uploadTooLarge": "The upload is larger than 1 MB.",
  "glossary.error.fileTooLarge": "The file is larger than 1 MB.",
  "glossary.error.csvTooLarge": "The CSV is larger than 1 MB.",
  "glossary.error.limit": "A shop can have at most {max} glossary terms",
  "glossary.error.unknownAction": "Unknown action",

  "glossary.csv.unterminated": "Unterminated quoted field",
  "glossary.csv.empty": "The file is empty",
  "glossary.csv.header": "Header must include at least: rule, term",
  "glossary.csv.tooManyRows": "At most {max} rows",

  "glossary.issue.locale": "{field}: must be a locale code such as de or pt-BR, or empty",
  "glossary.issue.market": "{field}: must be a market number from the Markets page, or empty",
  "glossary.issue.requiredForPreferred": "{field}: is required for preferred terms",
  "glossary.issue.invalidOption": "{field}: Invalid option: expected one of {options}",
  "glossary.issue.tooShort": "{field}: Too small: expected string to have >={min} characters",
  "glossary.issue.tooLong": "{field}: Too big: expected string to have <={max} characters",
  "glossary.issue.other": "{detail}",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "glossary.exportCsv": "CSV exportieren",

  "glossary.add.heading": "Begriff hinzufügen",
  "glossary.add.submit": "Begriff hinzufügen",
  "glossary.add.failed": "Begriff nicht hinzugefügt",
  "glossary.field.rule": "Regel",
  "glossary.field.term": "Begriff",
  "glossary.field.translation": "Übersetzung",
  "glossary.field.translationDetails": "Nur für „Immer übersetzen als“.",
  "glossary.field.market": "Nur in einem Markt (optional)",
  "glossary.field.marketDetails": "Für alle Märkte leer lassen. Sonst die Marktnummer, die auf der Seite „Märkte“ angezeigt wird.",
  "glossary.field.caseSensitive": "Groß- und Kleinschreibung genau beachten",
  "glossary.option.DO_NOT_TRANSLATE": "Nie übersetzen (Marken, Produktnamen, Artikelnummern)",
  "glossary.option.PREFERRED": "Immer übersetzen als …",
  "glossary.option.FORBIDDEN": "Diese Formulierung in Übersetzungen nie verwenden",

  "glossary.rule.DO_NOT_TRANSLATE": "Nie übersetzen",
  "glossary.rule.PREFERRED": "Immer übersetzen als",
  "glossary.rule.FORBIDDEN": "Nie verwenden",

  "glossary.terms.heading": "Begriffe ({count})",
  "glossary.terms.empty": "Noch keine Begriffe. Füge deine Marken- und Produktnamen hinzu, damit sie nie übersetzt werden.",
  "glossary.terms.market": "Markt",
  "glossary.terms.actions": "Aktionen",

  "glossary.import.heading": "Aus CSV importieren",
  "glossary.import.columns":
    "Spalten: rule, term, translation, target_locale, market, case_sensitive, notes. Regeln: DO_NOT_TRANSLATE, PREFERRED, FORBIDDEN. Es wird nichts importiert, wenn eine Zeile ungültig ist.",
  "glossary.import.file": "CSV-Datei",
  "glossary.import.paste": "… oder CSV einfügen",
  "glossary.import.replaceAll": "Alle vorhandenen Begriffe ersetzen",
  "glossary.import.submit": "Importieren",
  "glossary.import.rejected": "Import abgelehnt",
  "glossary.import.line": "Zeile {line}: {message}",
  "glossary.import.complete": "Import abgeschlossen",
  "glossary.import.count": { one: "{count} Begriff importiert.", other: "{count} Begriffe importiert." },
  "glossary.import.failed": "Import fehlgeschlagen",

  "glossary.error.notOnPlan": "Das Glossar ist in den Tarifen Pro und Business enthalten. Unter „Tarif“ kannst du deinen Tarif ändern.",
  "glossary.error.uploadTooLarge": "Der Upload ist größer als 1 MB.",
  "glossary.error.fileTooLarge": "Die Datei ist größer als 1 MB.",
  "glossary.error.csvTooLarge": "Der CSV-Text ist größer als 1 MB.",
  "glossary.error.limit": "Ein Shop kann höchstens {max} Glossar-Begriffe haben",
  "glossary.error.unknownAction": "Unbekannte Aktion",

  "glossary.csv.unterminated": "Ein Feld in Anführungszeichen wird nicht geschlossen",
  "glossary.csv.empty": "Die Datei ist leer",
  "glossary.csv.header": "Die Kopfzeile muss mindestens diese Spalten enthalten: rule, term",
  "glossary.csv.tooManyRows": "Höchstens {max} Zeilen",

  "glossary.issue.locale": "{field}: muss ein Sprachcode wie de oder pt-BR sein oder leer bleiben",
  "glossary.issue.market": "{field}: muss eine Marktnummer von der Seite „Märkte“ sein oder leer bleiben",
  "glossary.issue.requiredForPreferred": "{field}: ist für bevorzugte Begriffe (PREFERRED) erforderlich",
  "glossary.issue.invalidOption": "{field}: Ungültiger Wert, erwartet wird einer von {options}",
  "glossary.issue.tooShort": "{field}: Zu kurz, mindestens {min} Zeichen erwartet",
  "glossary.issue.tooLong": "{field}: Zu lang, höchstens {max} Zeichen erlaubt",
  "glossary.issue.other": "{detail}",
};
