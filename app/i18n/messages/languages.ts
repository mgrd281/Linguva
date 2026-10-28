/** Texts of the languages area. Keys start with "languages.". */
import type { Message, Translation } from "./define";

export const en = {
  "languages.manage": "Manage in Shopify",
  "languages.limit.heading": "Language limit reached",
  "languages.limit.body": "Shopify allows up to {max} languages per store. Remove a language before adding another.",
  "languages.rtl.heading": "Right-to-left language enabled",
  "languages.rtl.body": "Check that your theme supports right-to-left layouts before you publish these languages.",
  "languages.table.code": "Code",
  "languages.table.role": "Role",
  "languages.table.storefront": "Storefront",
  "languages.role.primary": "Primary",
  "languages.role.additional": "Additional",
  "languages.unpublished": "Unpublished",
  "languages.usage.heading": "Usage",
  "languages.usage.count": "{enabled} of {max} languages enabled, {published} published.",
  "languages.usage.source":
    "Shopify is the source of truth for which languages are enabled and published. This list is read from your store each time you open it.",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "languages.manage": "In Shopify verwalten",
  "languages.limit.heading": "Sprachlimit erreicht",
  "languages.limit.body": "Shopify erlaubt bis zu {max} Sprachen pro Shop. Entferne eine Sprache, bevor du eine weitere hinzufügst.",
  "languages.rtl.heading": "Rechts-nach-links-Sprache aktiviert",
  "languages.rtl.body": "Prüfe, ob dein Theme Layouts von rechts nach links unterstützt, bevor du diese Sprachen veröffentlichst.",
  "languages.table.code": "Sprachcode",
  "languages.table.role": "Rolle",
  "languages.table.storefront": "Onlineshop",
  "languages.role.primary": "Hauptsprache",
  "languages.role.additional": "Zusätzlich",
  "languages.unpublished": "Nicht veröffentlicht",
  "languages.usage.heading": "Nutzung",
  "languages.usage.count": "{enabled} von {max} Sprachen aktiviert, {published} veröffentlicht.",
  "languages.usage.source":
    "Shopify legt fest, welche Sprachen aktiviert und veröffentlicht sind. Diese Liste wird bei jedem Öffnen aus deinem Shop gelesen.",
};
