/** Texts of the landing area (the public page outside the admin). Keys start with "landing.". */
import type { Message, Translation } from "./define";

export const en = {
  "landing.hero.heading": "Translate your Shopify store, carefully",
  "landing.hero.body":
    "Linguva translates your store into the languages your customers speak, with AI you can review, and shows you when a translation no longer matches its original.",
  "landing.hero.start":
    "To get started, install Linguva from the Shopify App Store, or open it from the Apps section of your Shopify admin.",

  "landing.feature.content.title": "Every part of your store",
  "landing.feature.content.text":
    "Products, collections, pages, blogs, menus, theme texts, policies, image alt text and custom fields: all 30 kinds of content Shopify lets apps translate.",
  "landing.feature.control.title": "AI you stay in control of",
  "landing.feature.control.text":
    "Your glossary, translation memory and tone of voice are applied. Results wait for your review unless you choose otherwise, and nothing you wrote is overwritten.",
  "landing.feature.seo.title": "Found in every language",
  "landing.feature.seo.text":
    "Search engine titles, descriptions and URLs are translated and checked, with a preview of how each page appears in search results.",

  "landing.dev.heading": "Open a development store",
  "landing.dev.shopDomain": "Shop domain",
  "landing.dev.logIn": "Log in",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "landing.hero.heading": "Übersetze deinen Shopify-Shop – mit Sorgfalt",
  "landing.hero.body":
    "Linguva übersetzt deinen Shop in die Sprachen deiner Kunden, mit KI, deren Ergebnisse du prüfen kannst, und zeigt dir, wenn eine Übersetzung nicht mehr zu ihrem Original passt.",
  "landing.hero.start":
    "Installiere Linguva zum Start aus dem Shopify App Store oder öffne die App im Bereich „Apps“ deines Shopify-Adminbereichs.",

  "landing.feature.content.title": "Dein ganzer Shop",
  "landing.feature.content.text":
    "Produkte, Kollektionen, Seiten, Blogs, Menüs, Theme-Texte, Richtlinien, Alt-Texte von Bildern und benutzerdefinierte Felder: alle 30 Inhaltsarten, die Apps in Shopify übersetzen können.",
  "landing.feature.control.title": "KI, bei der du die Kontrolle behältst",
  "landing.feature.control.text":
    "Dein Glossar, dein Übersetzungsspeicher und deine Tonalität werden angewendet. Ergebnisse warten auf deine Prüfung, sofern du nichts anderes festlegst, und nichts, was du selbst geschrieben hast, wird überschrieben.",
  "landing.feature.seo.title": "In jeder Sprache gefunden werden",
  "landing.feature.seo.text":
    "SEO-Titel, SEO-Beschreibungen und URLs werden übersetzt und geprüft, mit einer Vorschau, wie jede Seite in den Suchergebnissen erscheint.",

  "landing.dev.heading": "Entwicklungsshop öffnen",
  "landing.dev.shopDomain": "Shop-Domain",
  "landing.dev.logIn": "Anmelden",
};

export const fr: Translation<typeof en> = {
  "landing.hero.heading": "Traduisez votre boutique Shopify, avec soin",
  "landing.hero.body":
    "Linguva traduit votre boutique dans les langues de vos clients, grâce à une IA dont vous pouvez réviser les résultats, et vous signale quand une traduction ne correspond plus à son original.",
  "landing.hero.start":
    "Pour commencer, installez Linguva depuis le Shopify App Store ou ouvrez l'application depuis la section Applications de votre interface administrateur Shopify.",

  "landing.feature.content.title": "Toute votre boutique",
  "landing.feature.content.text":
    "Produits, collections, pages, blogs, menus, textes du thème, politiques, textes alternatifs des images et champs personnalisés : les 30 types de contenu que Shopify permet aux applications de traduire.",
  "landing.feature.control.title": "Une IA sous votre contrôle",
  "landing.feature.control.text":
    "Votre glossaire, votre mémoire de traduction et votre ton sont appliqués. Les résultats attendent votre révision, sauf si vous en décidez autrement, et rien de ce que vous avez écrit n'est écrasé.",
  "landing.feature.seo.title": "Visible dans toutes les langues",
  "landing.feature.seo.text":
    "Les titres, descriptions et URL destinés aux moteurs de recherche sont traduits et vérifiés, avec un aperçu de chaque page telle qu'elle apparaît dans les résultats de recherche.",

  "landing.dev.heading": "Ouvrir une boutique de développement",
  "landing.dev.shopDomain": "Domaine de la boutique",
  "landing.dev.logIn": "Se connecter",
};

export const es: Translation<typeof en> = {
  "landing.hero.heading": "Traduce tu tienda Shopify con cuidado",
  "landing.hero.body":
    "Linguva traduce tu tienda a los idiomas de tus clientes con una IA cuyos resultados puedes revisar, y te avisa cuando una traducción ya no coincide con su original.",
  "landing.hero.start":
    "Para empezar, instala Linguva desde la Shopify App Store o ábrela desde la sección Aplicaciones de tu panel de control de Shopify.",

  "landing.feature.content.title": "Toda tu tienda",
  "landing.feature.content.text":
    "Productos, colecciones, páginas, blogs, menús, textos del tema, políticas, texto alternativo de imágenes y campos personalizados: los 30 tipos de contenido que Shopify permite traducir a las aplicaciones.",
  "landing.feature.control.title": "Una IA bajo tu control",
  "landing.feature.control.text":
    "Se aplican tu glosario, tu memoria de traducción y tu tono de voz. Los resultados esperan tu revisión, a menos que elijas otra cosa, y nada de lo que escribiste se sobrescribe.",
  "landing.feature.seo.title": "Visible en todos los idiomas",
  "landing.feature.seo.text":
    "Los títulos, las descripciones y las URL para buscadores se traducen y se revisan, con una vista previa de cómo aparece cada página en los resultados de búsqueda.",

  "landing.dev.heading": "Abrir una tienda de desarrollo",
  "landing.dev.shopDomain": "Dominio de la tienda",
  "landing.dev.logIn": "Iniciar sesión",
};
