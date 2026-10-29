/** Texts of the review area. Keys start with "review.". */
import type { Message, Translation } from "./define";

export const en = {
  "review.reject.heading": "Reject the selected translations?",
  "review.reject.body": "Rejected translations are not published, and bulk jobs won't translate the same original text again. This can't be undone.",
  "review.page.heading": "Review translations",
  "review.intro.empty": "Nothing to review. Bulk translations appear here before they are published.",
  "review.intro.waiting": {
    one: "{count} translation waiting for review. Nothing is visible to customers until you approve it.",
    other: "{count} translations waiting for review. Nothing is visible to customers until you approve it.",
  },

  "review.saved.heading": "Review saved",
  "review.saved.published": "Published: {count}",
  "review.saved.stale": "Original or translation changed in the meantime, not published: {count}",
  "review.saved.failed": "Failed: {count}",
  "review.saved.changed": "Changed since you opened this page (a newer translation replaced it), left as it is: {count}",
  "review.rejected.body": {
    one: "{count} draft discarded. It won't be published.",
    other: "{count} drafts discarded. They won't be published.",
  },

  "review.filter.searchPlaceholder": "Title, original or translation",
  "review.filter.fields": "Fields",
  "review.filter.allFields": "All fields",
  "review.filter.group.content": "Content",
  "review.filter.group.seo": "Search engine listing",
  "review.filter.group.handle": "URL handles",
  "review.filter.type": "Type",
  "review.filter.allContent": "All content",
  "review.filter.flagged": "Only with warnings",
  "review.filter.apply": "Apply",
  "review.filter.clear": "Clear",
  "review.filter.matching": "{count} matching.",

  "review.actions.approve": "Approve and publish selected",
  "review.actions.reject": "Reject selected",
  "review.actions.onPage": "{count} on this page. Untick the ones you don't want to change.",

  "review.draft.untitled": "(untitled)",
  "review.draft.customField": "Custom field",
  "review.draft.include": "Include",
  "review.draft.original": "Original",
  "review.draft.originalTitle": "{title}, {field}, original",
  "review.draft.previewTitle": "{title}, {field}, translation preview",
  "review.draft.richText": "{language} (rich text, approved as shown)",
  "review.draft.structured": "{language} (approved as shown; to change single items, open the editor)",
  "review.draft.editLabel": "{language} (you can edit before approving)",
  "review.draft.check": "Check: {issues}",
  "review.draft.openEditor": "Open in editor",

  "review.pagination.first": "First page",
  "review.pagination.next": "Next page",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "review.reject.heading": "Ausgewählte Übersetzungen ablehnen?",
  "review.reject.body": "Abgelehnte Übersetzungen werden nicht veröffentlicht, und Massenübersetzungen übersetzen denselben Originaltext nicht erneut. Das kann nicht rückgängig gemacht werden.",
  "review.page.heading": "Übersetzungen prüfen",
  "review.intro.empty": "Nichts zu prüfen. Massenübersetzungen erscheinen hier, bevor sie veröffentlicht werden.",
  "review.intro.waiting": {
    one: "{count} Übersetzung wartet auf Prüfung. Kunden sehen sie erst, wenn du sie freigibst.",
    other: "{count} Übersetzungen warten auf Prüfung. Kunden sehen sie erst, wenn du sie freigibst.",
  },

  "review.saved.heading": "Prüfung gespeichert",
  "review.saved.published": "Veröffentlicht: {count}",
  "review.saved.stale": "Original oder Übersetzung inzwischen geändert, nicht veröffentlicht: {count}",
  "review.saved.failed": "Fehlgeschlagen: {count}",
  "review.saved.changed": "Seit dem Öffnen dieser Seite geändert (eine neuere Übersetzung hat sie ersetzt), unverändert gelassen: {count}",
  "review.rejected.body": {
    one: "{count} Entwurf verworfen. Er wird nicht veröffentlicht.",
    other: "{count} Entwürfe verworfen. Sie werden nicht veröffentlicht.",
  },

  "review.filter.searchPlaceholder": "Titel, Original oder Übersetzung",
  "review.filter.fields": "Felder",
  "review.filter.allFields": "Alle Felder",
  "review.filter.group.content": "Inhalt",
  "review.filter.group.seo": "Suchmaschinen-Eintrag",
  "review.filter.group.handle": "URL-Handles",
  "review.filter.type": "Typ",
  "review.filter.allContent": "Alle Inhalte",
  "review.filter.flagged": "Nur mit Warnungen",
  "review.filter.apply": "Anwenden",
  "review.filter.clear": "Zurücksetzen",
  "review.filter.matching": "{count} Treffer.",

  "review.actions.approve": "Ausgewählte freigeben und veröffentlichen",
  "review.actions.reject": "Ausgewählte ablehnen",
  "review.actions.onPage": "{count} auf dieser Seite. Entferne das Häkchen bei allen, die du nicht ändern möchtest.",

  "review.draft.untitled": "(ohne Titel)",
  "review.draft.customField": "Benutzerdefiniertes Feld",
  "review.draft.include": "Einbeziehen",
  "review.draft.original": "Originaltext",
  "review.draft.originalTitle": "{title}, {field}, Original",
  "review.draft.previewTitle": "{title}, {field}, Vorschau der Übersetzung",
  "review.draft.richText": "{language} (formatierter Text, wird wie angezeigt freigegeben)",
  "review.draft.structured": "{language} (wird wie angezeigt freigegeben; einzelne Einträge änderst du im Editor)",
  "review.draft.editLabel": "{language} (vor dem Freigeben bearbeitbar)",
  "review.draft.check": "Prüfen: {issues}",
  "review.draft.openEditor": "Im Editor öffnen",

  "review.pagination.first": "Erste Seite",
  "review.pagination.next": "Nächste Seite",
};

export const fr: Translation<typeof en> = {
  "review.reject.heading": "Rejeter les traductions sélectionnées ?",
  "review.reject.body":
    "Les traductions rejetées ne sont pas publiées, et les tâches de traduction groupée ne retraduiront pas le même texte original. Cette action est irréversible.",
  "review.page.heading": "Réviser les traductions",
  "review.intro.empty": "Rien à réviser. Les traductions groupées apparaissent ici avant d'être publiées.",
  "review.intro.waiting": {
    one: "{count} traduction en attente de révision. Rien n'est visible pour les clients tant que vous ne l'avez pas approuvée.",
    other: "{count} traductions en attente de révision. Rien n'est visible pour les clients tant que vous ne les avez pas approuvées.",
  },

  "review.saved.heading": "Révision enregistrée",
  "review.saved.published": "Publiées : {count}",
  "review.saved.stale": "Non publiées, car l'original ou la traduction a été modifié entre-temps : {count}",
  "review.saved.failed": "Échecs : {count}",
  "review.saved.changed": "Modifiées depuis l'ouverture de cette page (une traduction plus récente les a remplacées), laissées telles quelles : {count}",
  "review.rejected.body": {
    one: "{count} brouillon écarté. Il ne sera pas publié.",
    other: "{count} brouillons écartés. Ils ne seront pas publiés.",
  },

  "review.filter.searchPlaceholder": "Titre, original ou traduction",
  "review.filter.fields": "Champs",
  "review.filter.allFields": "Tous les champs",
  "review.filter.group.content": "Contenu",
  "review.filter.group.seo": "Référencement",
  "review.filter.group.handle": "Identifiants d'URL (handles)",
  "review.filter.type": "Type",
  "review.filter.allContent": "Tout le contenu",
  "review.filter.flagged": "Avec avertissements uniquement",
  "review.filter.apply": "Appliquer",
  "review.filter.clear": "Effacer",
  "review.filter.matching": "Résultats : {count}.",

  "review.actions.approve": "Approuver et publier la sélection",
  "review.actions.reject": "Rejeter la sélection",
  "review.actions.onPage": "{count} sur cette page. Décochez celles que vous ne voulez pas modifier.",

  "review.draft.untitled": "(sans titre)",
  "review.draft.customField": "Champ personnalisé",
  "review.draft.include": "Inclure",
  "review.draft.original": "Original",
  "review.draft.originalTitle": "{title}, {field}, original",
  "review.draft.previewTitle": "{title}, {field}, aperçu de la traduction",
  "review.draft.richText": "{language} (texte enrichi, approuvé tel qu'affiché)",
  "review.draft.structured": "{language} (approuvé tel qu'affiché ; pour modifier des éléments individuels, ouvrez l'éditeur)",
  "review.draft.editLabel": "{language} (vous pouvez le modifier avant de l'approuver)",
  "review.draft.check": "À vérifier : {issues}",
  "review.draft.openEditor": "Ouvrir dans l'éditeur",

  "review.pagination.first": "Première page",
  "review.pagination.next": "Page suivante",
};

export const es: Translation<typeof en> = {
  "review.reject.heading": "¿Rechazar las traducciones seleccionadas?",
  "review.reject.body":
    "Las traducciones rechazadas no se publican y las tareas de traducción masiva no volverán a traducir el mismo texto original. Esta acción no se puede deshacer.",
  "review.page.heading": "Revisar traducciones",
  "review.intro.empty": "No hay nada que revisar. Las traducciones masivas aparecen aquí antes de publicarse.",
  "review.intro.waiting": {
    one: "{count} traducción pendiente de revisión. Los clientes no verán nada hasta que la apruebes.",
    other: "{count} traducciones pendientes de revisión. Los clientes no verán nada hasta que las apruebes.",
  },

  "review.saved.heading": "Revisión guardada",
  "review.saved.published": "Publicadas: {count}",
  "review.saved.stale": "No publicadas porque el original o la traducción cambiaron mientras tanto: {count}",
  "review.saved.failed": "Fallidas: {count}",
  "review.saved.changed": "Cambiadas desde que abriste esta página (una traducción más reciente las reemplazó), sin cambios: {count}",
  "review.rejected.body": {
    one: "{count} borrador descartado. No se publicará.",
    other: "{count} borradores descartados. No se publicarán.",
  },

  "review.filter.searchPlaceholder": "Título, original o traducción",
  "review.filter.fields": "Campos",
  "review.filter.allFields": "Todos los campos",
  "review.filter.group.content": "Contenido",
  "review.filter.group.seo": "Listado en buscadores",
  "review.filter.group.handle": "Identificadores de URL (handles)",
  "review.filter.type": "Tipo",
  "review.filter.allContent": "Todo el contenido",
  "review.filter.flagged": "Solo con advertencias",
  "review.filter.apply": "Aplicar",
  "review.filter.clear": "Borrar",
  "review.filter.matching": "Resultados: {count}.",

  "review.actions.approve": "Aprobar y publicar la selección",
  "review.actions.reject": "Rechazar la selección",
  "review.actions.onPage": "{count} en esta página. Desmarca las que no quieras cambiar.",

  "review.draft.untitled": "(sin título)",
  "review.draft.customField": "Campo personalizado",
  "review.draft.include": "Incluir",
  "review.draft.original": "Original",
  "review.draft.originalTitle": "{title}, {field}, original",
  "review.draft.previewTitle": "{title}, {field}, vista previa de la traducción",
  "review.draft.richText": "{language} (texto enriquecido, se aprueba tal como se muestra)",
  "review.draft.structured": "{language} (se aprueba tal como se muestra; para cambiar elementos concretos, abre el editor)",
  "review.draft.editLabel": "{language} (puedes editarlo antes de aprobarlo)",
  "review.draft.check": "Por revisar: {issues}",
  "review.draft.openEditor": "Abrir en el editor",

  "review.pagination.first": "Primera página",
  "review.pagination.next": "Página siguiente",
};
