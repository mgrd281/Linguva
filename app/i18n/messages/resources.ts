/** Texts of the resource lists (products, collections, pages, blog posts, blogs and other content types). Keys start with "resources.". */
import type { Message, Translation } from "./define";

export const en = {
  "resources.denied.heading": "Allow Linguva to read your {plural}",
  "resources.denied.needsScope": "To translate {plural}, Linguva needs permission to read them. It never changes the originals.",
  "resources.denied.unavailable": "Shopify doesn't allow apps to read {plural} in this store yet.",
  "resources.denied.allow": "Allow access",
  "resources.denied.back": "Back to Content",

  "resources.noLanguages.heading": "No languages to translate into",
  "resources.noLanguages.body": "Add a language under Settings → Languages in the Shopify admin to start translating your {plural}.",
  "resources.noLanguages.open": "Open language settings",

  "resources.consent.heading": "Allow AI processing to translate in bulk",
  "resources.consent.before": "Bulk translation uses AI. Allow it under ",
  "resources.consent.after": " first.",

  "resources.bulkError.heading": "Bulk translation couldn't start",
  "resources.bulkError.JOBS_UNAVAILABLE": "Background processing isn't configured for this app yet.",
  "resources.bulkError.plan": "Your plan doesn't include this. Change it in Linguva under Settings → Plan.",
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
  "resources.denied.back": "Zurück zu den Inhalten",

  "resources.noLanguages.heading": "Keine Sprachen zum Übersetzen",
  "resources.noLanguages.body": "Füge im Shopify-Adminbereich unter „Einstellungen → Sprachen“ eine Sprache hinzu, um {plural} zu übersetzen.",
  "resources.noLanguages.open": "Spracheinstellungen öffnen",

  "resources.consent.heading": "KI-Verarbeitung für Massenübersetzungen erlauben",
  "resources.consent.before": "Massenübersetzung nutzt KI. Erlaube sie zuerst unter ",
  "resources.consent.after": ".",

  "resources.bulkError.heading": "Die Massenübersetzung konnte nicht gestartet werden",
  "resources.bulkError.JOBS_UNAVAILABLE": "Die Hintergrundverarbeitung ist für diese App noch nicht eingerichtet.",
  "resources.bulkError.plan": "Dein Tarif enthält das nicht. Du kannst ihn in Linguva unter „Einstellungen“ → „Tarif“ ändern.",
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

export const fr: Translation<typeof en> = {
  "resources.denied.heading": "Autoriser Linguva à lire vos {plural}",
  "resources.denied.needsScope": "Pour traduire vos {plural}, Linguva a besoin de l'autorisation de les lire. Linguva ne modifie jamais les originaux.",
  "resources.denied.unavailable": "Shopify ne permet pas encore aux applications de lire les {plural} de cette boutique.",
  "resources.denied.allow": "Autoriser l'accès",
  "resources.denied.back": "Retour aux contenus",

  "resources.noLanguages.heading": "Aucune langue vers laquelle traduire",
  "resources.noLanguages.body": "Ajoutez une langue dans l'interface administrateur Shopify, sous Paramètres → Langues, pour commencer à traduire vos {plural}.",
  "resources.noLanguages.open": "Ouvrir les paramètres de langue",

  "resources.consent.heading": "Autoriser le traitement par IA pour la traduction groupée",
  "resources.consent.before": "La traduction groupée utilise l'IA. Autorisez-la d'abord dans ",
  "resources.consent.after": ".",

  "resources.bulkError.heading": "Impossible de lancer la traduction groupée",
  "resources.bulkError.JOBS_UNAVAILABLE": "Le traitement en arrière-plan n'est pas encore configuré pour cette application.",
  "resources.bulkError.plan": "Votre forfait n'inclut pas cette fonctionnalité. Modifiez-le dans Linguva, sous Paramètres → Forfait.",
  "resources.bulkError.generic": "Veuillez actualiser la page et réessayer.",

  "resources.plan.bulkHeading": "La traduction groupée est incluse dans les forfaits payants",
  "resources.plan.localeHeading": "Votre forfait n'inclut pas cette langue : {language}",
  "resources.plan.body": "Vous pouvez toujours traduire vos {plural} individuellement dans l'éditeur.",

  "resources.caution.legalHeading": "Textes juridiques",
  "resources.caution.legalBody":
    "Faites vérifier chaque traduction par une personne qualifiée avant de la publier. Ces textes sont traduits individuellement, avec révision.",
  "resources.caution.liquidHeading": "Modèles avec code Liquid",
  "resources.caution.liquidBody": "Seul le texte visible est traduit ; le code Liquid reste inchangé. Ces modèles sont traduits individuellement, avec révision.",

  "resources.translateInto": "Traduire en :",

  "resources.bulk.heading": "Traduire l'ensemble des {plural}",
  "resources.bulk.intro":
    "Complète les champs manquants et obsolètes avec l'IA, à l'aide de votre glossaire et de votre mémoire de traduction. Les traductions à jour ne sont jamais modifiées ; les traductions obsolètes rédigées ou approuvées par une personne sont conservées, sauf si vous autorisez leur remplacement.",
  "resources.bulk.autoPublish":
    "La publication automatique est activée : les résultats qui passent les contrôles qualité sont mis en ligne immédiatement ; les résultats avec des avertissements restent en attente dans Révision.",
  "resources.bulk.review": "Les résultats restent en attente dans Révision jusqu'à ce que vous les approuviez.",
  "resources.bulk.scopeLabel": "Champs à traduire",
  "resources.bulk.scopeAll": "Tous les champs",
  "resources.bulk.scopeSeo": "Uniquement le référencement (titre et description SEO)",
  "resources.bulk.overwrite": "Remplacer aussi les traductions obsolètes rédigées ou approuvées par une personne",
  "resources.bulk.attached": "Traduire aussi le texte alternatif des images et les champs personnalisés",
  "resources.bulk.attachedDetails":
    "Vérifie chaque élément de type « {singular} », la tâche prend donc plus de temps. Ne s'applique pas à « Uniquement le référencement ».",
  "resources.bulk.submit": "Tout traduire : {language}",

  "resources.empty.heading": "La liste des {plural} est encore vide",
  "resources.empty.body": "{label} : les éléments que vous créez dans Shopify s'affichent ici, prêts à être traduits ({language}).",
  "resources.empty.yourLanguages": "vos langues",

  "resources.table.translatedFields": "Champs traduits",
  "resources.status.partial": "Partiel",
  "resources.paging.first": "Première page",
  "resources.paging.next": "Page suivante",
};

export const es: Translation<typeof en> = {
  "resources.denied.heading": "Permitir que Linguva lea tus {plural}",
  "resources.denied.needsScope": "Para traducir tus {plural}, Linguva necesita permiso de lectura. Nunca modifica los originales.",
  "resources.denied.unavailable": "Shopify todavía no permite que las aplicaciones lean {plural} en esta tienda.",
  "resources.denied.allow": "Permitir acceso",
  "resources.denied.back": "Volver al contenido",

  "resources.noLanguages.heading": "No hay idiomas a los que traducir",
  "resources.noLanguages.body": "Agrega un idioma en Configuración → Idiomas del panel de control de Shopify para empezar a traducir tus {plural}.",
  "resources.noLanguages.open": "Abrir la configuración de idiomas",

  "resources.consent.heading": "Permitir el procesamiento con IA para la traducción masiva",
  "resources.consent.before": "La traducción masiva usa IA. Primero, permítela en ",
  "resources.consent.after": ".",

  "resources.bulkError.heading": "No se pudo iniciar la traducción masiva",
  "resources.bulkError.JOBS_UNAVAILABLE": "El procesamiento en segundo plano aún no está configurado para esta aplicación.",
  "resources.bulkError.plan": "Tu plan no incluye esta función. Cámbialo en Linguva, en Configuración → Plan.",
  "resources.bulkError.generic": "Vuelve a cargar la página e inténtalo de nuevo.",

  "resources.plan.bulkHeading": "La traducción masiva está incluida en los planes de pago",
  "resources.plan.localeHeading": "Tu plan no incluye este idioma: {language}",
  "resources.plan.body": "Aún puedes traducir tus {plural} de forma individual en el editor.",

  "resources.caution.legalHeading": "Textos legales",
  "resources.caution.legalBody":
    "Haz que una persona calificada revise cada traducción antes de publicarla. Estos textos se traducen de forma individual y con revisión.",
  "resources.caution.liquidHeading": "Plantillas con código Liquid",
  "resources.caution.liquidBody":
    "Solo se traduce el texto visible; el código Liquid se mantiene tal cual. Estas plantillas se traducen de forma individual y con revisión.",

  "resources.translateInto": "Traducir a:",

  "resources.bulk.heading": "Traducción masiva de {plural}",
  "resources.bulk.intro":
    "Completa con IA los campos que faltan y los desactualizados, usando tu glosario y tu memoria de traducción. Las traducciones al día nunca se modifican; las desactualizadas que una persona escribió o aprobó se conservan, a menos que permitas reemplazarlas.",
  "resources.bulk.autoPublish":
    "La publicación automática está activada: los resultados que superan los controles de calidad se publican de inmediato; los resultados con advertencias esperan en Revisión.",
  "resources.bulk.review": "Los resultados esperan en Revisión hasta que los apruebes.",
  "resources.bulk.scopeLabel": "Qué traducir",
  "resources.bulk.scopeAll": "Todos los campos",
  "resources.bulk.scopeSeo": "Solo listados en buscadores (título y descripción SEO)",
  "resources.bulk.overwrite": "Reemplazar también las traducciones desactualizadas que una persona escribió o aprobó",
  "resources.bulk.attached": "Traducir también el texto alternativo de las imágenes y los campos personalizados",
  "resources.bulk.attachedDetails":
    'Revisa cada elemento de tipo "{singular}", por lo que la tarea tarda más. No se aplica a "Solo listados en buscadores".',
  "resources.bulk.submit": "Traducir todo: {language}",

  "resources.empty.heading": "Todavía no hay {plural}",
  "resources.empty.body": "{label}: los elementos que agregues en Shopify aparecen aquí, listos para traducir ({language}).",
  "resources.empty.yourLanguages": "tus idiomas",

  "resources.table.translatedFields": "Campos traducidos",
  "resources.status.partial": "Parcial",
  "resources.paging.first": "Primera página",
  "resources.paging.next": "Página siguiente",
};
