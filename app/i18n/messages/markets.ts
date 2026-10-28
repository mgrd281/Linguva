/** Texts of the markets area. Keys start with "markets.". */
import type { Message, Translation } from "./define";

export const en = {
  "markets.access.heading": "See your languages per market",
  "markets.access.body":
    "Linguva can show which languages each of your markets offers, under which web address, and what stops customers from seeing your translations. For this, Linguva needs permission to read your markets. It never changes them.",
  "markets.access.allow": "Allow reading markets",

  "markets.checks.heading": "Checks",
  "markets.checks.none": "No problems found",
  "markets.checks.allOffered": "Every published language is offered in a market.",
  "markets.checks.coverageBefore": "How complete each language is: see",
  "markets.checks.coverageLink": "Coverage",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} offers {language}, but the language isn't published, so customers see the default language. Publish it under Languages.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "{language} is published, but no active market offers it, so no storefront address serves it. Add it to a market in Shopify.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "{language} is offered in a market, but your plan doesn't include AI translation into it.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} has no domain or subfolder of its own; customers reach it through your primary domain and the country selector.",

  "markets.market.active": "Active",
  "markets.market.status.DRAFT": "draft",
  "markets.market.number": "Market number {id} (for glossary terms)",
  "markets.market.primaryDomain": "Uses your primary domain.",
  "markets.market.address": "Address",
  "markets.market.default": "default",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "markets.access.heading": "Deine Sprachen pro Markt ansehen",
  "markets.access.body":
    "Linguva kann zeigen, welche Sprachen jeder deiner Märkte anbietet, unter welcher Webadresse und was Kunden daran hindert, deine Übersetzungen zu sehen. Dafür braucht Linguva die Berechtigung, deine Märkte zu lesen. Linguva ändert sie nie.",
  "markets.access.allow": "Lesen der Märkte erlauben",

  "markets.checks.heading": "Prüfungen",
  "markets.checks.none": "Keine Probleme gefunden",
  "markets.checks.allOffered": "Jede veröffentlichte Sprache wird in einem Markt angeboten.",
  "markets.checks.coverageBefore": "Wie vollständig jede Sprache ist, siehst du unter",
  "markets.checks.coverageLink": "Abdeckung",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} bietet {language} an, aber die Sprache ist nicht veröffentlicht, daher sehen Kunden die Standardsprache. Veröffentliche sie unter „Sprachen“.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "{language} ist veröffentlicht, wird aber von keinem aktiven Markt angeboten und ist daher unter keiner Shop-Adresse erreichbar. Füge die Sprache in Shopify einem Markt hinzu.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "{language} wird in einem Markt angeboten, aber dein Tarif enthält keine KI-Übersetzung in diese Sprache.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} hat keine eigene Domain und keinen eigenen Unterordner; Kunden erreichen den Markt über deine Hauptdomain und die Länderauswahl.",

  "markets.market.active": "Aktiv",
  "markets.market.status.DRAFT": "Entwurf",
  "markets.market.number": "Marktnummer {id} (für Glossarbegriffe)",
  "markets.market.primaryDomain": "Verwendet deine Hauptdomain.",
  "markets.market.address": "Adresse",
  "markets.market.default": "Standard",
};

export const fr: Translation<typeof en> = {
  "markets.access.heading": "Voir vos langues par marché",
  "markets.access.body":
    "Linguva peut afficher les langues proposées par chacun de vos marchés, sous quelle adresse web, et ce qui empêche les clients de voir vos traductions. Pour cela, Linguva a besoin de l'autorisation de lire vos marchés. Linguva ne les modifie jamais.",
  "markets.access.allow": "Autoriser la lecture des marchés",

  "markets.checks.heading": "Vérifications",
  "markets.checks.none": "Aucun problème détecté",
  "markets.checks.allOffered": "Chaque langue publiée est proposée dans un marché.",
  "markets.checks.coverageBefore": "Consultez l'avancement de chaque langue sur la page",
  "markets.checks.coverageLink": "Couverture",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} propose la langue {language}, mais elle n'est pas publiée : les clients voient donc la langue par défaut. Publiez-la dans Langues.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "La langue {language} est publiée, mais aucun marché actif ne la propose : aucune adresse de la boutique en ligne ne la dessert. Ajoutez-la à un marché dans Shopify.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "La langue {language} est proposée dans un marché, mais votre forfait n'inclut pas la traduction IA vers cette langue.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} n'a ni domaine ni sous-dossier propre ; les clients y accèdent via votre domaine principal et le sélecteur de pays.",

  "markets.market.active": "Actif",
  "markets.market.status.DRAFT": "brouillon",
  "markets.market.number": "Numéro de marché {id} (pour les termes du glossaire)",
  "markets.market.primaryDomain": "Utilise votre domaine principal.",
  "markets.market.address": "Adresse",
  "markets.market.default": "par défaut",
};

export const es: Translation<typeof en> = {
  "markets.access.heading": "Ver tus idiomas por mercado",
  "markets.access.body":
    "Linguva puede mostrar qué idiomas ofrece cada uno de tus mercados, en qué dirección web y qué impide que los clientes vean tus traducciones. Para ello, Linguva necesita permiso para leer tus mercados. Linguva nunca los modifica.",
  "markets.access.allow": "Permitir la lectura de mercados",

  "markets.checks.heading": "Verificaciones",
  "markets.checks.none": "No se encontraron problemas",
  "markets.checks.allOffered": "Cada idioma publicado se ofrece en un mercado.",
  "markets.checks.coverageBefore": "Consulta el avance de cada idioma en la página",
  "markets.checks.coverageLink": "Cobertura",
  "markets.checks.coverageAfter": ".",

  "markets.finding.UNPUBLISHED_LOCALE":
    "{market} ofrece el idioma {language}, pero no está publicado, por lo que los clientes ven el idioma predeterminado. Publícalo en Idiomas.",
  "markets.finding.LOCALE_IN_NO_MARKET":
    "El idioma {language} está publicado, pero ningún mercado activo lo ofrece, así que no está disponible en ninguna dirección de la tienda online. Agrégalo a un mercado en Shopify.",
  "markets.finding.LOCALE_NOT_IN_PLAN": "El idioma {language} se ofrece en un mercado, pero tu plan no incluye la traducción con IA a este idioma.",
  "markets.finding.NO_WEB_PRESENCE":
    "{market} no tiene dominio ni subcarpeta propios; los clientes acceden a él a través de tu dominio principal y el selector de país.",

  "markets.market.active": "Activo",
  "markets.market.status.DRAFT": "borrador",
  "markets.market.number": "Número de mercado {id} (para términos del glosario)",
  "markets.market.primaryDomain": "Usa tu dominio principal.",
  "markets.market.address": "Dirección",
  "markets.market.default": "predeterminado",
};
