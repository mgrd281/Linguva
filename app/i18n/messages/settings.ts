/** Texts of the settings area. Keys start with "settings.". */
import type { Message, Translation } from "./define";

export const en = {
  "settings.ai.heading": "AI translation",
  "settings.ai.body":
    "When you translate with AI, the product text you select is sent to DeepL SE (Germany) for processing. Linguva sends no customer data. Every AI result is a draft until you publish it.",
  "settings.ai.since": "since {date}",
  "settings.ai.notAllowed": "Not allowed",
  "settings.ai.withdraw": "Withdraw permission",
  "settings.ai.allow": "Allow AI processing",
  "settings.ai.notConfigured.heading": "AI provider not configured",
  "settings.ai.notConfigured.body":
    "The app operator hasn't configured a translation provider yet. Manual translation works without it.",

  "settings.style.heading": "Translation style",
  "settings.style.body":
    'Choose how AI addresses your customers in each language. Applies where a language has formal and informal forms (for example German "Sie" / "du", French "vous" / "tu").',
  "settings.style.formal": "Formal",
  "settings.style.informal": "Informal",
  "settings.style.noLanguages": "Add a language in Shopify first.",
  "settings.style.storeContext.label": "About your store",
  "settings.style.storeContext.details":
    'What you sell and how you speak, for example "Outdoor clothing for families, friendly and simple." Helps AI pick the right words. Up to {max} characters; not translated.',
  "settings.style.save": "Save translation style",
  "settings.style.saved": "Saved. New AI translations use this style.",

  "settings.publish.heading": "Bulk translation publishing",
  "settings.publish.autoBadge": "Automatic publishing",
  "settings.publish.autoBody": "Bulk translations that pass the quality checks go live without review.",
  "settings.publish.autoBodySince": "Bulk translations that pass the quality checks go live without review (enabled {date}).",
  "settings.publish.reviewBadge": "Review first",
  "settings.publish.reviewBody": "Bulk translations wait in Review until you approve them.",
  "settings.publish.switchBack": "Switch back to review first",
  "settings.publish.confirm": "I understand that machine translations will be published to my storefront without my review.",
  "settings.publish.enable": "Enable automatic publishing",
  "settings.publish.planHeading": "Automatic publishing is part of the Pro and Business plans",
  "settings.publish.confirmHeading": "Please confirm",
  "settings.publish.confirmBody": "Tick the confirmation box to enable automatic publishing.",

  "settings.auto.heading": "Automatic translation",
  "settings.auto.bodyAutoPublish":
    "Translates new and changed products and collections about a minute after you save them. Only missing or outdated texts are translated, translations you wrote or approved are kept, and results follow the publishing setting above (currently: published automatically). It uses your AI allowance. Pages, blog posts and blogs are translated within about half an hour.",
  "settings.auto.bodyReview":
    "Translates new and changed products and collections about a minute after you save them. Only missing or outdated texts are translated, translations you wrote or approved are kept, and results follow the publishing setting above (currently: wait in Review). It uses your AI allowance. Pages, blog posts and blogs are translated within about half an hour.",
  "settings.auto.offBody": "Changes are translated when you start a translation.",
  "settings.auto.unavailable.heading": "Not available on this installation",
  "settings.auto.unavailable.body": "Automatic translation needs AI translation and background jobs to be set up.",
  "settings.auto.planHeading": "Automatic translation is part of the plans with bulk translation",
  "settings.auto.noLanguages": "Add a language first.",
  "settings.auto.languages": "Languages to translate automatically",
  "settings.auto.saveLanguages": "Save languages",
  "settings.auto.turnOn": "Turn on automatic translation",
  "settings.auto.turnOff": "Turn off",
  "settings.auto.consent.heading": "Allow AI translation first",
  "settings.auto.consent.body": "Automatic translation sends texts to the AI service. Allow it in the section above.",
  "settings.auto.noLanguage.heading": "Choose at least one language",
  "settings.auto.noLanguage.body": "Tick the languages new and changed content should be translated into.",
  "settings.auto.savedOn": "Products and collections you save from now on are translated about a minute later; pages, blog posts and blogs within about half an hour.",
  "settings.auto.savedOff": "Automatic translation is off.",

  "settings.memory.body":
    "Approved translations are always reused for identical text. You can also reuse unreviewed machine translations, which keeps wording consistent and avoids paying twice for the same sentence.",
  "settings.memory.approvedOnly": "Reuse approved translations only",
  "settings.memory.alsoMachine": "Also reuse machine translations",

  "settings.usage.heading": "AI usage in {month}",
  "settings.usage.progress": "AI characters used this month",
  "settings.usage.month": "{used} of {limit} AI characters used ({percent}%).",
  "settings.usage.today":
    "Today: {used} of {limit} characters (the daily limit protects against unexpected costs and resets at midnight UTC).",
  "settings.usage.notCounted":
    "Text reused from your translation memory, repeated sentences and glossary-only text aren't sent to AI and don't count towards this limit.",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "settings.ai.heading": "KI-Übersetzung",
  "settings.ai.body":
    "Wenn du mit KI übersetzt, wird der ausgewählte Produkttext zur Verarbeitung an DeepL SE (Deutschland) gesendet. Linguva sendet keine Kundendaten. Jedes KI-Ergebnis bleibt ein Entwurf, bis du es veröffentlichst.",
  "settings.ai.since": "seit {date}",
  "settings.ai.notAllowed": "Nicht erlaubt",
  "settings.ai.withdraw": "Einwilligung widerrufen",
  "settings.ai.allow": "KI-Verarbeitung erlauben",
  "settings.ai.notConfigured.heading": "KI-Anbieter nicht eingerichtet",
  "settings.ai.notConfigured.body":
    "Der Betreiber der App hat noch keinen Übersetzungsanbieter eingerichtet. Manuelles Übersetzen funktioniert auch ohne.",

  "settings.style.heading": "Übersetzungsstil",
  "settings.style.body":
    "Lege fest, wie die KI deine Kundschaft in jeder Sprache anspricht. Gilt für Sprachen mit förmlicher und informeller Anrede (zum Beispiel im Deutschen „Sie“ / „du“, im Französischen „vous“ / „tu“).",
  "settings.style.formal": "Förmlich",
  "settings.style.informal": "Informell",
  "settings.style.noLanguages": "Füge zuerst in Shopify eine Sprache hinzu.",
  "settings.style.storeContext.label": "Über deinen Shop",
  "settings.style.storeContext.details":
    "Was du verkaufst und wie du sprichst, zum Beispiel „Outdoor-Kleidung für Familien, freundlich und unkompliziert.“ Hilft der KI, die richtigen Worte zu finden. Bis zu {max} Zeichen; wird nicht übersetzt.",
  "settings.style.save": "Übersetzungsstil speichern",
  "settings.style.saved": "Gespeichert. Neue KI-Übersetzungen verwenden diesen Stil.",

  "settings.publish.heading": "Veröffentlichen von Massenübersetzungen",
  "settings.publish.autoBadge": "Automatisch veröffentlichen",
  "settings.publish.autoBody": "Massenübersetzungen, die die Qualitätsprüfungen bestehen, werden ohne deine Prüfung veröffentlicht.",
  "settings.publish.autoBodySince":
    "Massenübersetzungen, die die Qualitätsprüfungen bestehen, werden ohne deine Prüfung veröffentlicht (aktiviert am {date}).",
  "settings.publish.reviewBadge": "Erst prüfen",
  "settings.publish.reviewBody": "Massenübersetzungen warten unter „Prüfen“, bis du sie freigibst.",
  "settings.publish.switchBack": "Zurück zu „Erst prüfen“",
  "settings.publish.confirm": "Mir ist bewusst, dass maschinelle Übersetzungen ohne meine Prüfung in meinem Onlineshop veröffentlicht werden.",
  "settings.publish.enable": "Automatisches Veröffentlichen aktivieren",
  "settings.publish.planHeading": "Automatisches Veröffentlichen ist in den Tarifen Pro und Business enthalten",
  "settings.publish.confirmHeading": "Bitte bestätigen",
  "settings.publish.confirmBody": "Setze das Häkchen zur Bestätigung, um automatisches Veröffentlichen zu aktivieren.",

  "settings.auto.heading": "Automatische Übersetzung",
  "settings.auto.bodyAutoPublish":
    "Übersetzt neue und geänderte Produkte und Kollektionen etwa eine Minute, nachdem du sie gespeichert hast. Nur fehlende oder veraltete Texte werden übersetzt, von dir geschriebene oder freigegebene Übersetzungen bleiben erhalten, und die Ergebnisse folgen der Veröffentlichungseinstellung oben (derzeit: automatisch veröffentlicht). Dafür wird dein KI-Kontingent verwendet. Seiten, Blogbeiträge und Blogs werden innerhalb von etwa einer halben Stunde übersetzt.",
  "settings.auto.bodyReview":
    "Übersetzt neue und geänderte Produkte und Kollektionen etwa eine Minute, nachdem du sie gespeichert hast. Nur fehlende oder veraltete Texte werden übersetzt, von dir geschriebene oder freigegebene Übersetzungen bleiben erhalten, und die Ergebnisse folgen der Veröffentlichungseinstellung oben (derzeit: warten unter „Prüfen“). Dafür wird dein KI-Kontingent verwendet. Seiten, Blogbeiträge und Blogs werden innerhalb von etwa einer halben Stunde übersetzt.",
  "settings.auto.offBody": "Änderungen werden übersetzt, wenn du eine Übersetzung startest.",
  "settings.auto.unavailable.heading": "In dieser Installation nicht verfügbar",
  "settings.auto.unavailable.body": "Für die automatische Übersetzung müssen KI-Übersetzung und Hintergrundaufträge eingerichtet sein.",
  "settings.auto.planHeading": "Automatische Übersetzung ist in den Tarifen mit Massenübersetzung enthalten",
  "settings.auto.noLanguages": "Füge zuerst eine Sprache hinzu.",
  "settings.auto.languages": "Automatisch zu übersetzende Sprachen",
  "settings.auto.saveLanguages": "Sprachen speichern",
  "settings.auto.turnOn": "Automatische Übersetzung aktivieren",
  "settings.auto.turnOff": "Deaktivieren",
  "settings.auto.consent.heading": "Erlaube zuerst die KI-Übersetzung",
  "settings.auto.consent.body": "Die automatische Übersetzung sendet Texte an den KI-Dienst. Erlaube das im Abschnitt oben.",
  "settings.auto.noLanguage.heading": "Wähle mindestens eine Sprache",
  "settings.auto.noLanguage.body": "Wähle die Sprachen aus, in die neue und geänderte Inhalte übersetzt werden sollen.",
  "settings.auto.savedOn": "Produkte und Kollektionen, die du ab jetzt speicherst, werden etwa eine Minute später übersetzt; Seiten, Blogbeiträge und Blogs innerhalb von etwa einer halben Stunde.",
  "settings.auto.savedOff": "Die automatische Übersetzung ist deaktiviert.",

  "settings.memory.body":
    "Freigegebene Übersetzungen werden für identischen Text immer wiederverwendet. Du kannst auch ungeprüfte maschinelle Übersetzungen wiederverwenden. Das hält die Formulierungen einheitlich, und du zahlst nicht zweimal für denselben Satz.",
  "settings.memory.approvedOnly": "Nur freigegebene Übersetzungen wiederverwenden",
  "settings.memory.alsoMachine": "Auch maschinelle Übersetzungen wiederverwenden",

  "settings.usage.heading": "KI-Nutzung im {month}",
  "settings.usage.progress": "In diesem Monat verwendete KI-Zeichen",
  "settings.usage.month": "{used} von {limit} KI-Zeichen verwendet ({percent} %).",
  "settings.usage.today":
    "Heute: {used} von {limit} Zeichen (das Tageslimit schützt vor unerwarteten Kosten und wird um Mitternacht UTC zurückgesetzt).",
  "settings.usage.notCounted":
    "Text aus deinem Übersetzungsspeicher, wiederholte Sätze und Text, der nur aus Glossar-Begriffen besteht, werden nicht an die KI gesendet und zählen nicht zu diesem Limit.",
};
