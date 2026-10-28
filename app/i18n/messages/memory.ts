/** Texts of the memory area. Keys start with "memory.". */
import type { Message, Translation } from "./define";

export const en = {
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
