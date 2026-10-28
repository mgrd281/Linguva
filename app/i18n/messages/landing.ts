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
