/** Texts of the memory area. Keys start with "memory.". */
import type { Message, Translation } from "./define";

export const en = {
  "memory.delete.heading": "Delete this memory entry?",
  "memory.delete.body": "It won't be reused for new translations. Published translations in your store don't change. This can't be undone.",
  "memory.intro":
    "Every translation you publish is remembered sentence by sentence. Identical text is reused automatically and isn't sent to AI again, so it costs nothing. Your memory is private to your store.",
  "memory.stats.entries": { one: "{count} entry", other: "{count} entries" },
  "memory.stats.reused": { one: "reused {count} time", other: "reused {count} times" },
  "memory.search.placeholder": "Original or translation",
  "memory.empty": "No entries yet. Publish translations to build your memory.",
  "memory.column.source": "Source",
  "memory.column.translation": "Translation",
  "memory.column.uses": "Uses",
  "memory.column.actions": "Actions",
  "memory.status.approved": "Approved",
  "memory.status.machine": "Machine",
  "memory.action.approve": "Approve",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "memory.delete.heading": "Diesen Speichereintrag löschen?",
  "memory.delete.body": "Er wird für neue Übersetzungen nicht mehr verwendet. Veröffentlichte Übersetzungen in deinem Shop ändern sich nicht. Das kann nicht rückgängig gemacht werden.",
  "memory.intro":
    "Jede Übersetzung, die du veröffentlichst, wird Satz für Satz gespeichert. Identischer Text wird automatisch wiederverwendet und nicht erneut an die KI gesendet, das kostet also nichts. Dein Übersetzungsspeicher gehört nur deinem Shop.",
  "memory.stats.entries": { one: "{count} Eintrag", other: "{count} Einträge" },
  "memory.stats.reused": { one: "{count}-mal wiederverwendet", other: "{count}-mal wiederverwendet" },
  "memory.search.placeholder": "Original oder Übersetzung",
  "memory.empty": "Noch keine Einträge. Veröffentliche Übersetzungen, um deinen Übersetzungsspeicher aufzubauen.",
  "memory.column.source": "Original",
  "memory.column.translation": "Übersetzung",
  "memory.column.uses": "Verwendungen",
  "memory.column.actions": "Aktionen",
  "memory.status.approved": "Freigegeben",
  "memory.status.machine": "Maschinell",
  "memory.action.approve": "Freigeben",
};

export const fr: Translation<typeof en> = {
  "memory.delete.heading": "Supprimer cette entrée de la mémoire ?",
  "memory.delete.body": "Elle ne sera plus réutilisée pour les nouvelles traductions. Les traductions publiées dans votre boutique ne changent pas. Cette action est irréversible.",
  "memory.intro":
    "Chaque traduction que vous publiez est mémorisée phrase par phrase. Un texte identique est réutilisé automatiquement sans être renvoyé à l'IA : il ne coûte donc rien. Votre mémoire est réservée à votre boutique.",
  "memory.stats.entries": { one: "{count} entrée", other: "{count} entrées" },
  "memory.stats.reused": { one: "{count} réutilisation", other: "{count} réutilisations" },
  "memory.search.placeholder": "Original ou traduction",
  "memory.empty": "Aucune entrée pour l'instant. Publiez des traductions pour constituer votre mémoire.",
  "memory.column.source": "Original",
  "memory.column.translation": "Traduction",
  "memory.column.uses": "Utilisations",
  "memory.column.actions": "Actions",
  "memory.status.approved": "Approuvée",
  "memory.status.machine": "Automatique",
  "memory.action.approve": "Approuver",
};

export const es: Translation<typeof en> = {
  "memory.delete.heading": "¿Eliminar esta entrada de la memoria?",
  "memory.delete.body": "Ya no se reutilizará en nuevas traducciones. Las traducciones publicadas en tu tienda no cambian. Esta acción no se puede deshacer.",
  "memory.intro":
    "Cada traducción que publicas se guarda frase por frase. El texto idéntico se reutiliza automáticamente y no se vuelve a enviar a la IA, así que no cuesta nada. Tu memoria es exclusiva de tu tienda.",
  "memory.stats.entries": { one: "{count} entrada", other: "{count} entradas" },
  "memory.stats.reused": { one: "{count} reutilización", other: "{count} reutilizaciones" },
  "memory.search.placeholder": "Original o traducción",
  "memory.empty": "Aún no hay entradas. Publica traducciones para crear tu memoria.",
  "memory.column.source": "Original",
  "memory.column.translation": "Traducción",
  "memory.column.uses": "Usos",
  "memory.column.actions": "Acciones",
  "memory.status.approved": "Aprobada",
  "memory.status.machine": "Automática",
  "memory.action.approve": "Aprobar",
};
