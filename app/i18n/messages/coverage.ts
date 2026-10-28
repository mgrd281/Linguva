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

export const fr: Translation<typeof en> = {
  "coverage.page.heading": "Couverture de traduction",
  "coverage.intro":
    "Le rapport vérifie chaque produit et chaque collection dans chacune de vos langues : ce qui est traduit, manquant ou obsolète, et l'aspect du référencement. Il se contente de lire les données de Shopify et n'utilise pas l'IA.",
  "coverage.startFailed.heading": "Impossible de lancer le rapport",
  "coverage.startFailed.fallback": "Veuillez actualiser la page et réessayer.",
  "coverage.lastFailed.heading": "Le dernier rapport ne s'est pas terminé",
  "coverage.lastFailed.fallback": "Générez à nouveau le rapport.",
  "coverage.error.JOBS_UNAVAILABLE": "Le traitement en arrière-plan n'est pas encore configuré pour cette application.",
  "coverage.error.NO_LANGUAGES": "Ajoutez d'abord une langue dans Paramètres → Langues.",
  "coverage.error.STALLED": "Le dernier rapport n'avançait plus. Générez-le à nouveau.",
  "coverage.error.PLAN_BULK": "La traduction groupée est incluse dans les forfaits payants. Consultez la page Forfait pour changer de forfait.",
  "coverage.error.PLAN_LANGUAGE": "Votre forfait n'inclut pas cette langue. Consultez la page Forfait pour changer de forfait.",
  "coverage.error.SCAN_FAILED": "Shopify n'a pas répondu de manière fiable. Générez à nouveau le rapport plus tard.",

  "coverage.run.first": "Générer le rapport de couverture",
  "coverage.run.again": "Générer à nouveau le rapport",
  "coverage.run.scanning": "Analyse en cours : {scanning} ({done} sur {total} parties, {items} éléments pour l'instant)",
  "coverage.run.last": "Dernier rapport : {date}",

  "coverage.byLanguage.heading": "Par langue",
  "coverage.byLanguage.items": "Éléments",
  "coverage.byLanguage.missing": "Manquants",
  "coverage.byLanguage.seo": "Référencement",
  "coverage.byLanguage.fix": "Corriger",
  "coverage.byLanguage.fields": "{percent} % ({count} champs)",
  "coverage.byLanguage.seoTranslated": "{percent} % traduit",
  "coverage.byLanguage.seoToCheck": "{count} à vérifier",
  "coverage.byLanguage.seoNone": "Non défini",
  "coverage.byLanguage.translateGaps": "Combler les lacunes",
  "coverage.byLanguage.seoOnly": "SEO uniquement",

  "coverage.seo.heading": "Référencement",
  "coverage.seo.items": "éléments",
  "coverage.seo.noSourceTitle":
    "{language} : {count} {kind} n'ont pas de titre SEO dans la langue d'origine, les moteurs de recherche voient donc le titre normal.",
  "coverage.seo.duplicates":
    "{language} : {count} éléments ont le même titre SEO qu'un autre élément. Des titres uniques aident les moteurs de recherche à distinguer les pages.",
  "coverage.seo.unpublished": "{language} : langue non publiée. Les clients et les moteurs de recherche ne voient pas encore ces traductions.",

  "coverage.gaps.heading": "Éléments présentant le plus de lacunes",
  "coverage.gaps.item": "Élément",
  "coverage.gaps.missing": "Champs manquants",
  "coverage.gaps.outdated": "Champs obsolètes",
};

export const es: Translation<typeof en> = {
  "coverage.page.heading": "Cobertura de traducción",
  "coverage.intro":
    "El informe revisa cada producto y colección en cada uno de tus idiomas: qué está traducido, qué falta o está desactualizado y cómo se ven los listados en buscadores. Solo lee datos de Shopify y no usa IA.",
  "coverage.startFailed.heading": "No se pudo iniciar el informe",
  "coverage.startFailed.fallback": "Vuelve a cargar la página e inténtalo de nuevo.",
  "coverage.lastFailed.heading": "El último informe no terminó",
  "coverage.lastFailed.fallback": "Vuelve a generar el informe.",
  "coverage.error.JOBS_UNAVAILABLE": "El procesamiento en segundo plano aún no está configurado para esta aplicación.",
  "coverage.error.NO_LANGUAGES": "Primero agrega un idioma en Configuración → Idiomas.",
  "coverage.error.STALLED": "El último informe dejó de avanzar. Vuelve a generarlo.",
  "coverage.error.PLAN_BULK": "La traducción masiva está incluida en los planes de pago. Ve a Plan para cambiar de plan.",
  "coverage.error.PLAN_LANGUAGE": "Tu plan no incluye este idioma. Ve a Plan para cambiar de plan.",
  "coverage.error.SCAN_FAILED": "Shopify no respondió de forma fiable. Vuelve a generar el informe más tarde.",

  "coverage.run.first": "Generar informe de cobertura",
  "coverage.run.again": "Volver a generar el informe",
  "coverage.run.scanning": "Analizando {scanning} ({done} de {total} partes, {items} elementos hasta ahora)",
  "coverage.run.last": "Último informe: {date}",

  "coverage.byLanguage.heading": "Por idioma",
  "coverage.byLanguage.items": "Elementos",
  "coverage.byLanguage.missing": "Faltantes",
  "coverage.byLanguage.seo": "Listados SEO",
  "coverage.byLanguage.fix": "Corregir",
  "coverage.byLanguage.fields": "{percent} % ({count} campos)",
  "coverage.byLanguage.seoTranslated": "{percent} % traducido",
  "coverage.byLanguage.seoToCheck": "{count} por revisar",
  "coverage.byLanguage.seoNone": "Sin definir",
  "coverage.byLanguage.translateGaps": "Traducir lo pendiente",
  "coverage.byLanguage.seoOnly": "Solo SEO",

  "coverage.seo.heading": "Listados en buscadores",
  "coverage.seo.items": "elementos",
  "coverage.seo.noSourceTitle":
    "{language}: {count} {kind} no tienen título SEO en el idioma original, así que los buscadores ven el título normal.",
  "coverage.seo.duplicates":
    "{language}: {count} elementos comparten el título SEO con otro elemento. Los títulos únicos ayudan a los buscadores a distinguir las páginas.",
  "coverage.seo.unpublished": "{language}: idioma no publicado. Los clientes y los buscadores aún no ven estas traducciones.",

  "coverage.gaps.heading": "Elementos con más campos pendientes",
  "coverage.gaps.item": "Elemento",
  "coverage.gaps.missing": "Campos faltantes",
  "coverage.gaps.outdated": "Campos desactualizados",
};
