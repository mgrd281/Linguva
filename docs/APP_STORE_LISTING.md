# App Store listing (draft)

Draft texts for the Shopify App Store submission form, in English and German. Written to Shopify's rules as read on 2026-10-28 (shopify.dev, "App Store requirements" §4 and "Best practices for apps in the Shopify App Store"):

- App introduction at most 100 characters, app details at most 500, each feature at most 80, up to 5 search terms (one idea each).
- No statistics, no data, no "the best / the first / the only", no reviews, no comparisons with other apps, no pricing outside "Pricing details" (also not in images).
- Only list interface languages the app fully supports.
- Screenshots 1600 × 900, 3–6 for desktop, no browser chrome, no personal data, with alt text; add mobile screenshots if the app works on phones.

Lengths are checked by `tests/unit/app-store-listing.test.ts`. **Nothing here is submitted**: submission needs the owner's account, privacy policy, demo store and prices (OWNER_DECISIONS.md).

## Name and card

| Field | English | German |
|---|---|---|
| App name | Linguva: Translate & Review | Linguva: Translate & Review |
| App card subtitle | Translate your store with AI, review before it goes live | Übersetze deinen Shop mit KI und prüfe alles vor dem Livegang |

## App introduction (max. 100 characters)

- **EN:** Translate products, pages and SEO with AI, and approve every change before customers see it.
- **DE:** Übersetze Produkte, Seiten und SEO mit KI und gib jede Änderung frei, bevor Kunden sie sehen.

## App details (max. 500 characters)

**EN:**
> Linguva translates your store into the languages you sell in: products, collections, pages, blog posts, menus, theme texts, image alt text and custom fields. AI drafts wait for your approval, and translations your team wrote are never replaced without asking. Your glossary keeps brand names and terms right, and translation memory reuses text you already approved. New and changed content is translated automatically. Everything is saved in Shopify's own translations.

**DE:**
> Linguva übersetzt deinen Shop: Produkte, Kollektionen, Seiten, Blogbeiträge, Menüs, Theme-Texte, Alt-Texte und benutzerdefinierte Felder. KI-Entwürfe warten auf deine Freigabe, und Übersetzungen deines Teams werden nie ungefragt ersetzt. Dein Glossar hält Markennamen und Begriffe richtig, der Übersetzungsspeicher nutzt Freigegebenes wieder. Neue und geänderte Inhalte werden automatisch übersetzt. Alles wird in Shopifys eigenen Übersetzungen gespeichert.

## Feature list (max. 80 characters each)

| # | English | German |
|---|---|---|
| 1 | Review queue: approve or reject AI drafts before anything goes live | Prüfliste: KI-Entwürfe freigeben oder ablehnen, bevor etwas live geht |
| 2 | Automatic translation of new and changed products, pages and blog posts | Automatische Übersetzung neuer und geänderter Produkte, Seiten und Blogs |
| 3 | Glossary for brand names and terms that must never change | Glossar für Markennamen und Begriffe, die sich nie ändern dürfen |
| 4 | Translation memory reuses text you already approved | Übersetzungsspeicher nutzt bereits freigegebene Texte wieder |
| 5 | Quality checks flag changed numbers, wrong terms and wrong tone | Qualitätsprüfung meldet geänderte Zahlen, falsche Begriffe und Anrede |
| 6 | SEO titles, descriptions and URLs with a search result preview | SEO-Titel, Beschreibungen und URLs mit Vorschau des Suchergebnisses |
| 7 | Image alt text and custom fields, with links and lists kept intact | Alt-Texte und benutzerdefinierte Felder, Links und Listen bleiben intakt |
| 8 | History of every translation, with earlier versions to restore | Verlauf jeder Übersetzung, frühere Versionen wiederherstellbar |

## Search terms (max. 5, one idea each)

- **EN:** translation, multilingual, language translate, translation review, glossary
- **DE:** Übersetzung, mehrsprachig, Sprachen, Übersetzung prüfen, Glossar

## Categories and languages

- Category: Store management → Internationalization → Translation (as in Shopify's category list; confirm in the form).
- **Interface languages to list now: English, German.** French and Spanish exist but are listed only after a native speaker has read them (I18N_REVIEW.md; requirement 4.3.2).
- Integrations: none listed (DeepL is a service, not a Shopify app).
- Sales channel requirement: Online Store not required (translations also serve other channels through Shopify), confirm on the dev store.

## Screenshots

Generated from the real app on the production build with a fictional demo catalog (`APP_STORE_SCREENSHOTS=1 pnpm test:ui tests/ui/app-store-screenshots.spec.ts`). Files: [app-store/screenshots/](app-store/screenshots/). Before submission, regenerate them inside the real admin on the dev store if the embedded frame looks different.

| File | Shows | Alt text (EN) |
|---|---|---|
| 1-products.png | Translation status per product and "Translate all" | Product list with the translation status of each product in German and an option to translate all products |
| 2-editor.png | Original and translation side by side, formatted preview | Product editor with the English original and the German translation side by side, including a formatted preview |
| 3-outdated.png | An outdated translation after the original changed | Product whose German translation is marked outdated because the English description changed |
| 4-review.png | Review queue with a flagged draft | Review queue with French drafts to approve or reject; one draft is flagged because a number changed |
| 5-glossary.png | Brand terms and rules | Glossary with brand names that are never translated and preferred terms per language |
| 6-settings.png | Automatic translation and safe publishing | Settings for automatic translation of new content, with results waiting for review |
| 7-overview.png | Guided start | Overview with the next steps to set up translations |
| 8-mobile-editor.png | The editor on a phone | Translation editor on a phone, with the original above the translation |

Recommended order in the listing: 4, 2, 1, 5, 6, 8 (six images; 3 and 7 as spares).

## Feature media

A static feature image (1600 × 900, one focal point, no Shopify logo, no pricing) is still to be designed: suggestion "Review before it goes live" with the Review queue cropped large. A 2–3 minute video can follow after launch.

## Still needed from the owner

App icon (1200 × 1200, no text), privacy policy URL, support email and FAQ URL, demo store URL (dev store), pricing details as configured in the Partner Dashboard. See OWNER_DECISIONS.md.
