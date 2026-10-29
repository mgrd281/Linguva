/** Texts of the settings area. Keys start with "settings.". */
import type { Message, Translation } from "./define";

export const en = {
  "settings.ai.heading": "AI translation",
  "settings.ai.body":
    "When Linguva translates with AI (when you ask it to, or automatically once you turn automatic translation or the smart schedule on), the store texts it translates are sent to DeepL SE (Germany) for processing. Linguva sends no customer data. AI results are drafts until you publish them, unless you turn on automatic publishing.",
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
  "settings.auto.outsidePlan": {
    one: "{languages} isn't among your plan's languages.",
    other: "{languages} aren't among your plan's languages.",
  },
  "settings.auto.planLanguage.heading": "Your plan includes fewer languages",
  "settings.auto.planLanguage.body": "Automatic translation works in the languages your plan includes.",
  "settings.auto.paused.heading": "Automatic translation is paused",
  "settings.auto.paused.DAILY_LIMIT": "Today's AI allowance is used up. It continues by itself after {date}, with everything changed meanwhile.",
  "settings.auto.paused.PLATFORM_LIMIT": "The app's AI limit for today is reached. It continues by itself after {date}, with everything changed meanwhile.",
  "settings.auto.paused.QUOTA_EXCEEDED": "This month's AI allowance is used up. It continues by itself after {date}, with everything changed meanwhile.",
  "settings.auto.paused.PROVIDER": "AI translation isn't available right now. Linguva tries again after {date}; nothing changed meanwhile is lost.",
  "settings.auto.noActiveLanguages": "None of the chosen languages can be translated now. Choose languages below.",
  "settings.auto.waitingConsent.heading": "Automatic translation is waiting for your permission",
  "settings.auto.waitingConsent.body": "AI translation isn't allowed at the moment, so nothing is sent. Allow it in the section above, and changes made meanwhile are translated then.",

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

  "settings.tools.heading": "Tools",
  "settings.tools.languages.detail": "Which languages customers see, and which ones AI can translate",
  "settings.tools.markets.label": "Countries & markets",
  "settings.tools.markets.detail": "Which language customers read in each country",
  "settings.tools.coverage.label": "Coverage in detail",
  "settings.tools.coverage.detail": "Every figure by content type and field",
  "settings.tools.glossary.detail": "Brand names and fixed terms the AI sticks to",
  "settings.tools.memory.detail": "Translations Linguva reuses for free",
  "settings.tools.transfer.detail": "Translations as a CSV file, for translators and spreadsheets",
  "settings.tools.plan.detail": "Your plan and this month's AI characters",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "settings.ai.heading": "KI-Übersetzung",
  "settings.ai.body":
    "Wenn Linguva mit KI übersetzt (wenn du es anstößt, oder automatisch, sobald du die automatische Übersetzung oder den intelligenten Zeitplan einschaltest), werden die zu übersetzenden Texte deines Shops zur Verarbeitung an DeepL SE (Deutschland) gesendet. Linguva sendet keine Kundendaten. KI-Ergebnisse bleiben Entwürfe, bis du sie veröffentlichst, außer du schaltest das automatische Veröffentlichen ein.",
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
  "settings.auto.outsidePlan": {
    one: "{languages} gehört nicht zu den Sprachen deines Tarifs.",
    other: "{languages} gehören nicht zu den Sprachen deines Tarifs.",
  },
  "settings.auto.planLanguage.heading": "Dein Tarif umfasst weniger Sprachen",
  "settings.auto.planLanguage.body": "Die automatische Übersetzung arbeitet in den Sprachen, die dein Tarif umfasst.",
  "settings.auto.paused.heading": "Die automatische Übersetzung ist pausiert",
  "settings.auto.paused.DAILY_LIMIT": "Das KI-Kontingent für heute ist aufgebraucht. Sie läuft nach {date} von selbst weiter, mit allem, was sich inzwischen geändert hat.",
  "settings.auto.paused.PLATFORM_LIMIT": "Das KI-Limit der App für heute ist erreicht. Sie läuft nach {date} von selbst weiter, mit allem, was sich inzwischen geändert hat.",
  "settings.auto.paused.QUOTA_EXCEEDED": "Das KI-Kontingent dieses Monats ist aufgebraucht. Sie läuft nach {date} von selbst weiter, mit allem, was sich inzwischen geändert hat.",
  "settings.auto.paused.PROVIDER": "Die KI-Übersetzung ist gerade nicht verfügbar. Linguva versucht es nach {date} erneut; nichts, was sich inzwischen ändert, geht verloren.",
  "settings.auto.noActiveLanguages": "Keine der gewählten Sprachen kann gerade übersetzt werden. Wähle unten Sprachen aus.",
  "settings.auto.waitingConsent.heading": "Die automatische Übersetzung wartet auf deine Erlaubnis",
  "settings.auto.waitingConsent.body": "Die KI-Übersetzung ist gerade nicht erlaubt, deshalb wird nichts gesendet. Erlaube sie im Abschnitt oben; was sich inzwischen ändert, wird dann übersetzt.",

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

  "settings.tools.heading": "Werkzeuge",
  "settings.tools.languages.detail": "Welche Sprachen Kunden sehen und welche die KI übersetzen kann",
  "settings.tools.markets.label": "Länder & Märkte",
  "settings.tools.markets.detail": "Welche Sprache Kunden in jedem Land lesen",
  "settings.tools.coverage.label": "Abdeckung im Detail",
  "settings.tools.coverage.detail": "Alle Zahlen nach Inhaltsart und Feld",
  "settings.tools.glossary.detail": "Markennamen und feste Begriffe, an die sich die KI hält",
  "settings.tools.memory.detail": "Übersetzungen, die Linguva kostenlos wiederverwendet",
  "settings.tools.transfer.detail": "Übersetzungen als CSV-Datei, für Übersetzer und Tabellen",
  "settings.tools.plan.detail": "Dein Tarif und deine KI-Zeichen in diesem Monat",
};

export const fr: Translation<typeof en> = {
  "settings.ai.heading": "Traduction par IA",
  "settings.ai.body":
    "Lorsque Linguva traduit avec l'IA (à votre demande, ou automatiquement une fois la traduction automatique ou la planification intelligente activée), les textes de la boutique qu'il traduit sont envoyés à DeepL SE (Allemagne) pour traitement. Linguva n'envoie aucune donnée client. Les résultats de l'IA restent des brouillons tant que vous ne les publiez pas, sauf si vous activez la publication automatique.",
  "settings.ai.since": "depuis le {date}",
  "settings.ai.notAllowed": "Non autorisé",
  "settings.ai.withdraw": "Retirer l'autorisation",
  "settings.ai.allow": "Autoriser le traitement par IA",
  "settings.ai.notConfigured.heading": "Fournisseur d'IA non configuré",
  "settings.ai.notConfigured.body":
    "L'opérateur de l'application n'a pas encore configuré de fournisseur de traduction. La traduction manuelle reste possible sans fournisseur.",

  "settings.style.heading": "Style de traduction",
  "settings.style.body":
    "Choisissez comment l'IA s'adresse à vos clients dans chaque langue. S'applique aux langues qui ont une forme formelle et une forme informelle (par exemple « Sie » / « du » en allemand, « vous » / « tu » en français).",
  "settings.style.formal": "Formel",
  "settings.style.informal": "Informel",
  "settings.style.noLanguages": "Ajoutez d'abord une langue dans Shopify.",
  "settings.style.storeContext.label": "À propos de votre boutique",
  "settings.style.storeContext.details":
    "Ce que vous vendez et votre façon de vous exprimer, par exemple « Vêtements outdoor pour toute la famille, ton amical et simple. » Aide l'IA à choisir les bons mots. {max} caractères maximum ; non traduit.",
  "settings.style.save": "Enregistrer le style de traduction",
  "settings.style.saved": "Enregistré. Les nouvelles traductions par IA utilisent ce style.",

  "settings.publish.heading": "Publication des traductions groupées",
  "settings.publish.autoBadge": "Publication automatique",
  "settings.publish.autoBody": "Les traductions groupées qui passent les contrôles qualité sont mises en ligne sans révision.",
  "settings.publish.autoBodySince":
    "Les traductions groupées qui passent les contrôles qualité sont mises en ligne sans révision (activée le {date}).",
  "settings.publish.reviewBadge": "Révision préalable",
  "settings.publish.reviewBody": "Les traductions groupées restent en attente dans Révision jusqu'à ce que vous les approuviez.",
  "settings.publish.switchBack": "Revenir à la révision préalable",
  "settings.publish.confirm":
    "Je comprends que des traductions automatiques seront publiées sur ma boutique en ligne sans que je les aie révisées.",
  "settings.publish.enable": "Activer la publication automatique",
  "settings.publish.planHeading": "La publication automatique est incluse dans les forfaits Pro et Business",
  "settings.publish.confirmHeading": "Veuillez confirmer",
  "settings.publish.confirmBody": "Cochez la case de confirmation pour activer la publication automatique.",

  "settings.auto.heading": "Traduction automatique",
  "settings.auto.bodyAutoPublish":
    "Traduit les produits et collections nouveaux ou modifiés environ une minute après leur enregistrement. Seuls les textes manquants ou obsolètes sont traduits, les traductions que vous avez rédigées ou approuvées sont conservées, et les résultats suivent le paramètre de publication ci-dessus (actuellement : publiés automatiquement). Cette fonctionnalité utilise votre quota d'IA. Les pages, articles de blog et blogs sont traduits dans un délai d'environ une demi-heure.",
  "settings.auto.bodyReview":
    "Traduit les produits et collections nouveaux ou modifiés environ une minute après leur enregistrement. Seuls les textes manquants ou obsolètes sont traduits, les traductions que vous avez rédigées ou approuvées sont conservées, et les résultats suivent le paramètre de publication ci-dessus (actuellement : en attente dans Révision). Cette fonctionnalité utilise votre quota d'IA. Les pages, articles de blog et blogs sont traduits dans un délai d'environ une demi-heure.",
  "settings.auto.offBody": "Les modifications sont traduites lorsque vous lancez une traduction.",
  "settings.auto.unavailable.heading": "Non disponible sur cette installation",
  "settings.auto.unavailable.body":
    "La traduction automatique nécessite que la traduction par IA et les tâches en arrière-plan soient configurées.",
  "settings.auto.planHeading": "La traduction automatique est incluse dans les forfaits avec traduction groupée",
  "settings.auto.noLanguages": "Ajoutez d'abord une langue.",
  "settings.auto.languages": "Langues à traduire automatiquement",
  "settings.auto.saveLanguages": "Enregistrer les langues",
  "settings.auto.turnOn": "Activer la traduction automatique",
  "settings.auto.turnOff": "Désactiver",
  "settings.auto.consent.heading": "Autorisez d'abord la traduction par IA",
  "settings.auto.consent.body":
    "La traduction automatique envoie des textes au service d'IA. Donnez votre autorisation dans la section ci-dessus.",
  "settings.auto.noLanguage.heading": "Choisissez au moins une langue",
  "settings.auto.noLanguage.body": "Cochez les langues dans lesquelles les contenus nouveaux ou modifiés doivent être traduits.",
  "settings.auto.savedOn":
    "Les produits et collections que vous enregistrez à partir de maintenant sont traduits environ une minute plus tard ; les pages, articles de blog et blogs dans un délai d'environ une demi-heure.",
  "settings.auto.savedOff": "La traduction automatique est désactivée.",
  "settings.auto.outsidePlan": {
    one: "Votre forfait n'inclut pas {languages}.",
    other: "Votre forfait n'inclut pas {languages}.",
  },
  "settings.auto.planLanguage.heading": "Votre forfait inclut moins de langues",
  "settings.auto.planLanguage.body": "La traduction automatique fonctionne dans les langues incluses dans votre forfait.",
  "settings.auto.paused.heading": "La traduction automatique est en pause",
  "settings.auto.paused.DAILY_LIMIT": "Le quota d'IA d'aujourd'hui est épuisé. Elle reprend d'elle-même après le {date}, avec tout ce qui a changé entre-temps.",
  "settings.auto.paused.PLATFORM_LIMIT": "La limite d'IA de l'application pour aujourd'hui est atteinte. Elle reprend d'elle-même après le {date}, avec tout ce qui a changé entre-temps.",
  "settings.auto.paused.QUOTA_EXCEEDED": "Le quota d'IA de ce mois-ci est épuisé. Elle reprend d'elle-même après le {date}, avec tout ce qui a changé entre-temps.",
  "settings.auto.paused.PROVIDER": "La traduction par IA n'est pas disponible pour le moment. Linguva réessaie après le {date} ; rien de ce qui change entre-temps n'est perdu.",
  "settings.auto.noActiveLanguages": "Aucune des langues choisies ne peut être traduite pour le moment. Choisissez des langues ci-dessous.",
  "settings.auto.waitingConsent.heading": "La traduction automatique attend votre autorisation",
  "settings.auto.waitingConsent.body": "La traduction par IA n'est pas autorisée pour le moment, donc rien n'est envoyé. Autorisez-la dans la section ci-dessus ; ce qui change entre-temps sera alors traduit.",

  "settings.memory.body":
    "Les traductions approuvées sont toujours réutilisées pour un texte identique. Vous pouvez aussi réutiliser les traductions automatiques non révisées : la formulation reste cohérente et vous ne payez pas deux fois la même phrase.",
  "settings.memory.approvedOnly": "Réutiliser uniquement les traductions approuvées",
  "settings.memory.alsoMachine": "Réutiliser aussi les traductions automatiques",

  "settings.usage.heading": "Utilisation de l'IA en {month}",
  "settings.usage.progress": "Caractères d'IA utilisés ce mois-ci",
  "settings.usage.month": "{used} sur {limit} caractères d'IA utilisés ({percent} %).",
  "settings.usage.today":
    "Aujourd'hui : {used} sur {limit} caractères (la limite quotidienne protège contre les coûts imprévus et est réinitialisée à minuit UTC).",
  "settings.usage.notCounted":
    "Le texte réutilisé depuis votre mémoire de traduction, les phrases répétées et le texte composé uniquement de termes du glossaire ne sont pas envoyés à l'IA et ne comptent pas dans cette limite.",

  "settings.tools.heading": "Outils",
  "settings.tools.languages.detail": "Les langues que voient vos clients et celles que l'IA peut traduire",
  "settings.tools.markets.label": "Pays et marchés",
  "settings.tools.markets.detail": "La langue que lisent vos clients dans chaque pays",
  "settings.tools.coverage.label": "Couverture en détail",
  "settings.tools.coverage.detail": "Tous les chiffres par type de contenu et par champ",
  "settings.tools.glossary.detail": "Les noms de marque et les termes fixes que l'IA respecte",
  "settings.tools.memory.detail": "Les traductions que Linguva réutilise gratuitement",
  "settings.tools.transfer.detail": "Les traductions en fichier CSV, pour les traducteurs et les tableurs",
  "settings.tools.plan.detail": "Votre forfait et vos caractères d'IA de ce mois-ci",
};

export const es: Translation<typeof en> = {
  "settings.ai.heading": "Traducción con IA",
  "settings.ai.body":
    "Cuando Linguva traduce con IA (cuando tú lo pides, o automáticamente una vez que activas la traducción automática o la programación inteligente), los textos de la tienda que traduce se envían a DeepL SE (Alemania) para su procesamiento. Linguva no envía datos de clientes. Los resultados de IA son borradores hasta que los publiques, salvo que actives la publicación automática.",
  "settings.ai.since": "desde el {date}",
  "settings.ai.notAllowed": "No permitido",
  "settings.ai.withdraw": "Retirar el permiso",
  "settings.ai.allow": "Permitir el procesamiento con IA",
  "settings.ai.notConfigured.heading": "Proveedor de IA no configurado",
  "settings.ai.notConfigured.body":
    "El operador de la aplicación aún no ha configurado un proveedor de traducción. La traducción manual funciona sin él.",

  "settings.style.heading": "Estilo de traducción",
  "settings.style.body":
    'Elige cómo se dirige la IA a tus clientes en cada idioma. Se aplica a los idiomas que tienen formas formales e informales (por ejemplo, "Sie" / "du" en alemán, "vous" / "tu" en francés).',
  "settings.style.formal": "Formal",
  "settings.style.informal": "Informal",
  "settings.style.noLanguages": "Primero agrega un idioma en Shopify.",
  "settings.style.storeContext.label": "Acerca de tu tienda",
  "settings.style.storeContext.details":
    'Lo que vendes y cómo te expresas, por ejemplo, "Ropa outdoor para toda la familia, con un tono cercano y sencillo". Ayuda a la IA a elegir las palabras adecuadas. Hasta {max} caracteres; no se traduce.',
  "settings.style.save": "Guardar el estilo de traducción",
  "settings.style.saved": "Guardado. Las nuevas traducciones con IA usan este estilo.",

  "settings.publish.heading": "Publicación de traducciones masivas",
  "settings.publish.autoBadge": "Publicación automática",
  "settings.publish.autoBody": "Las traducciones masivas que superan los controles de calidad se publican sin revisión.",
  "settings.publish.autoBodySince": "Las traducciones masivas que superan los controles de calidad se publican sin revisión (activada el {date}).",
  "settings.publish.reviewBadge": "Revisión previa",
  "settings.publish.reviewBody": "Las traducciones masivas esperan en Revisión hasta que las apruebes.",
  "settings.publish.switchBack": "Volver a la revisión previa",
  "settings.publish.confirm": "Entiendo que las traducciones automáticas se publicarán en mi tienda online sin mi revisión.",
  "settings.publish.enable": "Activar la publicación automática",
  "settings.publish.planHeading": "La publicación automática está incluida en los planes Pro y Business",
  "settings.publish.confirmHeading": "Se requiere confirmación",
  "settings.publish.confirmBody": "Marca la casilla de confirmación para activar la publicación automática.",

  "settings.auto.heading": "Traducción automática",
  "settings.auto.bodyAutoPublish":
    "Traduce los productos y colecciones nuevos o modificados aproximadamente un minuto después de que los guardes. Solo se traducen los textos que faltan o están desactualizados, se conservan las traducciones que escribiste o aprobaste, y los resultados siguen la configuración de publicación de arriba (actualmente: se publican automáticamente). Usa tu cuota de IA. Las páginas, entradas de blog y blogs se traducen en aproximadamente media hora.",
  "settings.auto.bodyReview":
    "Traduce los productos y colecciones nuevos o modificados aproximadamente un minuto después de que los guardes. Solo se traducen los textos que faltan o están desactualizados, se conservan las traducciones que escribiste o aprobaste, y los resultados siguen la configuración de publicación de arriba (actualmente: esperan en Revisión). Usa tu cuota de IA. Las páginas, entradas de blog y blogs se traducen en aproximadamente media hora.",
  "settings.auto.offBody": "Los cambios se traducen cuando inicias una traducción.",
  "settings.auto.unavailable.heading": "No disponible en esta instalación",
  "settings.auto.unavailable.body":
    "La traducción automática requiere que la traducción con IA y las tareas en segundo plano estén configuradas.",
  "settings.auto.planHeading": "La traducción automática está incluida en los planes con traducción masiva",
  "settings.auto.noLanguages": "Primero agrega un idioma.",
  "settings.auto.languages": "Idiomas para traducir automáticamente",
  "settings.auto.saveLanguages": "Guardar idiomas",
  "settings.auto.turnOn": "Activar la traducción automática",
  "settings.auto.turnOff": "Desactivar",
  "settings.auto.consent.heading": "Primero permite la traducción con IA",
  "settings.auto.consent.body": "La traducción automática envía textos al servicio de IA. Permítelo en la sección de arriba.",
  "settings.auto.noLanguage.heading": "Elige al menos un idioma",
  "settings.auto.noLanguage.body": "Marca los idiomas a los que se debe traducir el contenido nuevo o modificado.",
  "settings.auto.savedOn":
    "Los productos y colecciones que guardes a partir de ahora se traducen aproximadamente un minuto después; las páginas, entradas de blog y blogs, en aproximadamente media hora.",
  "settings.auto.savedOff": "La traducción automática está desactivada.",
  "settings.auto.outsidePlan": {
    one: "Tu plan no incluye {languages}.",
    other: "Tu plan no incluye {languages}.",
  },
  "settings.auto.planLanguage.heading": "Tu plan incluye menos idiomas",
  "settings.auto.planLanguage.body": "La traducción automática funciona en los idiomas que incluye tu plan.",
  "settings.auto.paused.heading": "La traducción automática está en pausa",
  "settings.auto.paused.DAILY_LIMIT": "La cuota de IA de hoy está agotada. Continúa por sí sola después del {date}, con todo lo que haya cambiado mientras tanto.",
  "settings.auto.paused.PLATFORM_LIMIT": "Se alcanzó el límite de IA de la aplicación para hoy. Continúa por sí sola después del {date}, con todo lo que haya cambiado mientras tanto.",
  "settings.auto.paused.QUOTA_EXCEEDED": "La cuota de IA de este mes está agotada. Continúa por sí sola después del {date}, con todo lo que haya cambiado mientras tanto.",
  "settings.auto.paused.PROVIDER": "La traducción con IA no está disponible ahora. Linguva lo intenta de nuevo después del {date}; no se pierde nada de lo que cambie mientras tanto.",
  "settings.auto.noActiveLanguages": "Ninguno de los idiomas elegidos se puede traducir ahora. Elige idiomas abajo.",
  "settings.auto.waitingConsent.heading": "La traducción automática espera tu permiso",
  "settings.auto.waitingConsent.body": "La traducción con IA no está permitida ahora, así que no se envía nada. Permítela en la sección de arriba; lo que cambie mientras tanto se traducirá entonces.",

  "settings.memory.body":
    "Las traducciones aprobadas siempre se reutilizan para textos idénticos. También puedes reutilizar traducciones automáticas sin revisar, lo que mantiene la coherencia de la redacción y evita pagar dos veces por la misma frase.",
  "settings.memory.approvedOnly": "Reutilizar solo las traducciones aprobadas",
  "settings.memory.alsoMachine": "Reutilizar también las traducciones automáticas",

  "settings.usage.heading": "Uso de IA en {month}",
  "settings.usage.progress": "Caracteres de IA usados este mes",
  "settings.usage.month": "{used} de {limit} caracteres de IA usados ({percent} %).",
  "settings.usage.today":
    "Hoy: {used} de {limit} caracteres (el límite diario te protege de gastos inesperados y se restablece a medianoche UTC).",
  "settings.usage.notCounted":
    "El texto reutilizado de tu memoria de traducción, las frases repetidas y el texto formado solo por términos del glosario no se envían a la IA y no cuentan para este límite.",

  "settings.tools.heading": "Herramientas",
  "settings.tools.languages.detail": "Qué idiomas ven tus clientes y cuáles puede traducir la IA",
  "settings.tools.markets.label": "Países y mercados",
  "settings.tools.markets.detail": "Qué idioma leen tus clientes en cada país",
  "settings.tools.coverage.label": "Cobertura en detalle",
  "settings.tools.coverage.detail": "Todas las cifras por tipo de contenido y campo",
  "settings.tools.glossary.detail": "Los nombres de marca y los términos fijos que la IA respeta",
  "settings.tools.memory.detail": "Las traducciones que Linguva reutiliza gratis",
  "settings.tools.transfer.detail": "Las traducciones en un archivo CSV, para traductores y hojas de cálculo",
  "settings.tools.plan.detail": "Tu plan y tus caracteres de IA de este mes",
};
