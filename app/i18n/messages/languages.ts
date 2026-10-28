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
  "languages.table.ai": "AI translation",
  "languages.ai.supported": "Available",
  "languages.ai.unsupported": "Not available with DeepL: translate in the editor or import a CSV",
  "languages.ai.unknown": "Couldn't check right now",
  "languages.ai.none": "Not set up",
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
  "languages.table.ai": "KI-Übersetzung",
  "languages.ai.supported": "Verfügbar",
  "languages.ai.unsupported": "Mit DeepL nicht verfügbar: im Editor übersetzen oder eine CSV importieren",
  "languages.ai.unknown": "Gerade nicht prüfbar",
  "languages.ai.none": "Nicht eingerichtet",
  "languages.role.primary": "Hauptsprache",
  "languages.role.additional": "Zusätzlich",
  "languages.unpublished": "Nicht veröffentlicht",
  "languages.usage.heading": "Nutzung",
  "languages.usage.count": "{enabled} von {max} Sprachen aktiviert, {published} veröffentlicht.",
  "languages.usage.source":
    "Shopify legt fest, welche Sprachen aktiviert und veröffentlicht sind. Diese Liste wird bei jedem Öffnen aus deinem Shop gelesen.",
};

export const fr: Translation<typeof en> = {
  "languages.manage": "Gérer dans Shopify",
  "languages.limit.heading": "Limite de langues atteinte",
  "languages.limit.body": "Shopify autorise jusqu'à {max} langues par boutique. Supprimez une langue avant d'en ajouter une autre.",
  "languages.rtl.heading": "Langue de droite à gauche activée",
  "languages.rtl.body": "Vérifiez que votre thème prend en charge les mises en page de droite à gauche avant de publier ces langues.",
  "languages.table.code": "Code de langue",
  "languages.table.role": "Rôle",
  "languages.table.storefront": "Boutique en ligne",
  "languages.table.ai": "Traduction par IA",
  "languages.ai.supported": "Disponible",
  "languages.ai.unsupported": "Indisponible avec DeepL : traduisez dans l'éditeur ou importez un CSV",
  "languages.ai.unknown": "Vérification impossible pour le moment",
  "languages.ai.none": "Non configurée",
  "languages.role.primary": "Principale",
  "languages.role.additional": "Supplémentaire",
  "languages.unpublished": "Non publiée",
  "languages.usage.heading": "Utilisation",
  "languages.usage.count": "Langues activées : {enabled} sur {max} (publiées : {published}).",
  "languages.usage.source":
    "Shopify détermine quelles langues sont activées et publiées. Cette liste est lue depuis votre boutique chaque fois que vous l'ouvrez.",
};

export const es: Translation<typeof en> = {
  "languages.manage": "Administrar en Shopify",
  "languages.limit.heading": "Límite de idiomas alcanzado",
  "languages.limit.body": "Shopify permite hasta {max} idiomas por tienda. Elimina un idioma antes de agregar otro.",
  "languages.rtl.heading": "Idioma de derecha a izquierda activado",
  "languages.rtl.body": "Comprueba que tu tema admita diseños de derecha a izquierda antes de publicar estos idiomas.",
  "languages.table.code": "Código",
  "languages.table.role": "Rol",
  "languages.table.storefront": "Tienda online",
  "languages.table.ai": "Traducción con IA",
  "languages.ai.supported": "Disponible",
  "languages.ai.unsupported": "No disponible con DeepL: traduce en el editor o importa un CSV",
  "languages.ai.unknown": "No se pudo comprobar ahora",
  "languages.ai.none": "Sin configurar",
  "languages.role.primary": "Principal",
  "languages.role.additional": "Adicional",
  "languages.unpublished": "No publicado",
  "languages.usage.heading": "Uso",
  "languages.usage.count": "Idiomas activados: {enabled} de {max} (publicados: {published}).",
  "languages.usage.source":
    "Shopify determina qué idiomas están activados y publicados. Esta lista se lee de tu tienda cada vez que la abres.",
};
