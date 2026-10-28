/** Texts of the review area. Keys start with "review.". */
import type { Message, Translation } from "./define";

export const en = {
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
  "review.rejected.heading": "Drafts rejected",
  "review.rejected.body": {
    one: "{count} draft(s) discarded. They won't be published.",
    other: "{count} draft(s) discarded. They won't be published.",
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
  "review.draft.editLabel": "{language} (you can edit before approving)",
  "review.draft.check": "Check: {issues}",
  "review.draft.openEditor": "Open in editor",

  "review.pagination.first": "First page",
  "review.pagination.next": "Next page",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
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
  "review.rejected.heading": "Entwürfe abgelehnt",
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
  "review.draft.editLabel": "{language} (vor dem Freigeben bearbeitbar)",
  "review.draft.check": "Prüfen: {issues}",
  "review.draft.openEditor": "Im Editor öffnen",

  "review.pagination.first": "Erste Seite",
  "review.pagination.next": "Nächste Seite",
};
