/** Texts of the "All content" page. Keys start with "content.". */
import type { Message, Translation } from "./define";

export const en = {
  "content.intro":
    "Everything in your store that Shopify lets you translate: {ready} of {total} content types have something to translate. Products and collections have their own pages in the navigation.",
  "content.ready.heading": "Ready to translate",
  "content.ready.none": "Nothing besides products and collections yet.",
  "content.table.area": "Area",
  "content.table.how": "How",
  "content.table.action": "Action",
  "content.mode.bulk": "Translate all at once",
  "content.mode.legal": "One by one (legal text)",
  "content.mode.single": "One by one",
  "content.translate": "Translate",
  "content.translateLabel": "Translate {label}",
  "content.permission.heading": "Needs your permission",
  "content.permission.allow": "Allow access",
  "content.permission.allowLabel": "Allow access to {label}",
  "content.permission.note": "Linguva only asks to read this content. It never changes your originals.",
  "content.empty.heading": "Not in your store yet",
  "content.empty.note": "They appear under Ready to translate as soon as you add them in Shopify.",
  "content.unavailable.heading": "Not available to apps in this store",
  "content.unavailable.note": "You can translate these in Shopify's own Translate & Adapt app.",
  "content.group.onlineStore": "Online store",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "content.intro":
    "Alles in deinem Shop, was Shopify übersetzen lässt: {ready} von {total} Inhaltsarten haben etwas zu übersetzen. Produkte und Kollektionen haben eigene Seiten in der Navigation.",
  "content.ready.heading": "Bereit zum Übersetzen",
  "content.ready.none": "Noch nichts außer Produkten und Kollektionen.",
  "content.table.area": "Bereich",
  "content.table.how": "Vorgehen",
  "content.table.action": "Aktion",
  "content.mode.bulk": "Alle auf einmal übersetzen",
  "content.mode.legal": "Einzeln (Rechtstext)",
  "content.mode.single": "Einzeln",
  "content.translate": "Übersetzen",
  "content.translateLabel": "Übersetzen: {label}",
  "content.permission.heading": "Braucht deine Erlaubnis",
  "content.permission.allow": "Zugriff erlauben",
  "content.permission.allowLabel": "Zugriff erlauben: {label}",
  "content.permission.note": "Linguva fragt nur nach Lesezugriff auf diese Inhalte. Deine Originale werden nie geändert.",
  "content.empty.heading": "Noch nicht in deinem Shop",
  "content.empty.note": "Sie erscheinen unter „Bereit zum Übersetzen“, sobald du sie in Shopify hinzufügst.",
  "content.unavailable.heading": "In diesem Shop für Apps nicht verfügbar",
  "content.unavailable.note": "Du kannst sie in Shopifys eigener App „Translate & Adapt“ übersetzen.",
  "content.group.onlineStore": "Onlineshop",
};
