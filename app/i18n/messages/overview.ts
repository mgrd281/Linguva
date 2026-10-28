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
  "overview.languages.measured": "Full scan {date}, kept up to date since.",
  "overview.languages.runCoverage": "Run the coverage report to see how complete each language is.",
  "overview.languages.updateCoverage": "See coverage details",
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
  "overview.languages.measured": "Vollständig geprüft: {date}, seitdem laufend aktualisiert.",
  "overview.languages.runCoverage": "Erstelle den Abdeckungsbericht, um zu sehen, wie vollständig jede Sprache ist.",
  "overview.languages.updateCoverage": "Abdeckung im Detail ansehen",
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

export const fr: Translation<typeof en> = {
  "overview.banner.exhausted.heading": "Le quota d'IA de ce mois-ci est épuisé",
  "overview.banner.exhausted.body": "La traduction par IA est suspendue jusqu'au mois prochain. La traduction manuelle et la mémoire de traduction continuent de fonctionner.",
  "overview.banner.high.heading": "Vous avez utilisé {percent} % du quota d'IA de ce mois-ci",
  "overview.banner.high.body": "Les tâches de traduction groupée volumineuses peuvent s'interrompre une fois le quota épuisé.",

  "overview.start.heading": "Premiers pas",
  "overview.start.progress": "Étapes terminées : {done} sur {total}",
  "overview.start.progressLabel": "Progression de la configuration",

  "overview.checklist.languageSettings": "Ouvrir les paramètres de langue",
  "overview.checklist.language.label": "Ajouter une langue",
  "overview.checklist.language.detail": "Choisissez les langues dans lesquelles vous vendez, dans les paramètres de langue de Shopify.",
  "overview.checklist.consent.label": "Autoriser la traduction par IA",
  "overview.checklist.consent.detail": "Vous révisez les brouillons IA avant toute publication.",
  "overview.checklist.consent.action": "Ouvrir les paramètres",
  "overview.checklist.firstTranslation.label": "Publier votre première traduction",
  "overview.checklist.firstTranslation.detail": "Ouvrez un produit, traduisez-le avec l'IA, vérifiez le résultat et publiez-le.",
  "overview.checklist.firstTranslation.action": "Traduire les produits",
  "overview.checklist.review.label": "Réviser les traductions groupées",
  "overview.checklist.review.labelCount": { one: "Réviser {count} traduction", other: "Réviser {count} traductions" },
  "overview.checklist.review.detail": "Les traductions groupées attendent votre approbation avant d'être visibles par les clients.",
  "overview.checklist.review.action": "Ouvrir la page Révision",
  "overview.checklist.publishLanguage.label": "Rendre une langue visible pour les clients",
  "overview.checklist.publishLanguage.detail": "Publiez la langue dans Shopify lorsque ses traductions sont prêtes.",

  "overview.languages.heading": "Vos langues",
  "overview.languages.onlyPrimary":
    "Votre boutique n'a que sa langue principale ({primary}). Ajoutez les langues dans lesquelles vous vendez dans Shopify, sous Paramètres → Langues, puis revenez ici.",
  "overview.languages.unknown": "inconnue",
  "overview.languages.storefront": "Sur votre boutique en ligne",
  "overview.languages.action": "Action",
  "overview.languages.hidden": "Masquée",
  "overview.languages.notMeasured": "Pas encore mesuré",
  "overview.languages.progressLabel": "Progression de la traduction : {language}",
  "overview.languages.translate": "Traduire",
  "overview.languages.translateLabel": "Traduire : {language}",
  "overview.languages.measured": "Analyse complète : {date}, mise à jour en continu depuis.",
  "overview.languages.runCoverage": "Générez le rapport de couverture pour savoir où en est chaque langue.",
  "overview.languages.updateCoverage": "Voir le détail de la couverture",
  "overview.languages.openCoverage": "Ouvrir le rapport de couverture",

  "overview.translate.heading": "Que voulez-vous traduire ?",
  "overview.translate.content": "Pages, menus, thème et plus encore",

  "overview.attention.heading": "Requiert votre attention",
  "overview.attention.drafts": { one: "{count} traduction à réviser", other: "{count} traductions à réviser" },
  "overview.attention.noDrafts": "Aucune traduction en attente de révision.",
  "overview.attention.jobs": { one: "{count} tâche de traduction en cours", other: "{count} tâches de traduction en cours" },

  "overview.usage.heading": "Utilisation de l'IA ce mois-ci",
  "overview.usage.characters": "{used} sur {limit} caractères",
  "overview.usage.memoryFree": "Le texte réutilisé depuis votre mémoire de traduction est gratuit.",

  "overview.store.languages": "Langues activées : {enabled} sur {max}. Publiées : {published}.",
  "overview.store.installed": "Date d'installation : {date}",
};

export const es: Translation<typeof en> = {
  "overview.banner.exhausted.heading": "La cuota de IA de este mes está agotada",
  "overview.banner.exhausted.body": "La traducción con IA queda en pausa hasta el próximo mes. La traducción manual y la memoria de traducción siguen funcionando.",
  "overview.banner.high.heading": "Has usado el {percent} % de la cuota de IA de este mes",
  "overview.banner.high.body": "Las tareas de traducción masiva grandes pueden detenerse cuando se agote la cuota.",

  "overview.start.heading": "Primeros pasos",
  "overview.start.progress": "{done} de {total} pasos completados",
  "overview.start.progressLabel": "Progreso de la configuración",

  "overview.checklist.languageSettings": "Abrir la configuración de idiomas",
  "overview.checklist.language.label": "Agregar un idioma",
  "overview.checklist.language.detail": "Elige los idiomas en los que vendes en la configuración de idiomas de Shopify.",
  "overview.checklist.consent.label": "Permitir la traducción con IA",
  "overview.checklist.consent.detail": "Revisas los borradores de IA antes de que se publique nada.",
  "overview.checklist.consent.action": "Abrir la configuración",
  "overview.checklist.firstTranslation.label": "Publicar tu primera traducción",
  "overview.checklist.firstTranslation.detail": "Abre un producto, tradúcelo con IA, revisa el resultado y publícalo.",
  "overview.checklist.firstTranslation.action": "Traducir productos",
  "overview.checklist.review.label": "Revisar las traducciones masivas",
  "overview.checklist.review.labelCount": { one: "Revisar {count} traducción", other: "Revisar {count} traducciones" },
  "overview.checklist.review.detail": "Las traducciones masivas esperan tu aprobación antes de que los clientes las vean.",
  "overview.checklist.review.action": "Abrir Revisión",
  "overview.checklist.publishLanguage.label": "Mostrar un idioma a los clientes",
  "overview.checklist.publishLanguage.detail": "Publica el idioma en Shopify cuando sus traducciones estén listas.",

  "overview.languages.heading": "Tus idiomas",
  "overview.languages.onlyPrimary":
    "Tu tienda solo tiene su idioma principal ({primary}). Agrega los idiomas en los que vendes en Configuración → Idiomas de Shopify y luego vuelve aquí.",
  "overview.languages.unknown": "desconocido",
  "overview.languages.storefront": "En tu tienda online",
  "overview.languages.action": "Acción",
  "overview.languages.hidden": "Oculto",
  "overview.languages.notMeasured": "Aún sin medir",
  "overview.languages.progressLabel": "Progreso de la traducción: {language}",
  "overview.languages.translate": "Traducir",
  "overview.languages.translateLabel": "Traducir: {language}",
  "overview.languages.measured": "Análisis completo: {date}, actualizado continuamente desde entonces.",
  "overview.languages.runCoverage": "Genera el informe de cobertura para ver el avance de cada idioma.",
  "overview.languages.updateCoverage": "Ver el detalle de la cobertura",
  "overview.languages.openCoverage": "Abrir el informe de cobertura",

  "overview.translate.heading": "¿Qué quieres traducir?",
  "overview.translate.content": "Páginas, menús, tema y más",

  "overview.attention.heading": "Requiere tu atención",
  "overview.attention.drafts": { one: "{count} traducción por revisar", other: "{count} traducciones por revisar" },
  "overview.attention.noDrafts": "No hay nada pendiente de revisión.",
  "overview.attention.jobs": { one: "{count} tarea de traducción en curso", other: "{count} tareas de traducción en curso" },

  "overview.usage.heading": "Uso de IA este mes",
  "overview.usage.characters": "{used} de {limit} caracteres",
  "overview.usage.memoryFree": "El texto reutilizado de tu memoria de traducción es gratis.",

  "overview.store.languages": "Idiomas activados: {enabled} de {max}. Publicados: {published}.",
  "overview.store.installed": "Fecha de instalación: {date}",
};
