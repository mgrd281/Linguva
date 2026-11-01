# App Store listing (draft)

Draft texts for the Shopify App Store submission form, in English and German. Written to Shopify's rules as read on 2026-10-28 (shopify.dev, "App Store requirements" §4 and "Best practices for apps in the Shopify App Store"):

- App introduction at most 100 characters, app details at most 500, each feature at most 80, up to 5 search terms (one idea each).
- No statistics, no data, no "the best / the first / the only", no reviews, no comparisons with other apps, no pricing outside "Pricing details" (also not in images).
- Only list interface languages the app fully supports.
- Screenshots 1600 × 900, 3–6 for desktop, no browser chrome, no personal data, with alt text; add mobile screenshots if the app works on phones.

Lengths are checked by `tests/unit/app-store-listing.test.ts`. **Nothing here is submitted**: submission needs the owner's account, privacy policy, demo store and the plans entered in the Partner Dashboard (OWNER_DECISIONS.md; prices: PRICING_DECISION.md).

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
| 9 | Coverage dashboard: what is missing, waiting or outdated in each language | Abdeckung im Überblick: was je Sprache fehlt, wartet oder veraltet ist |
| 10 | Import and export translations as CSV; imports wait for your approval | Übersetzungen per CSV importieren und exportieren, Importe warten auf Freigabe |

## Search terms (max. 5, one idea each)

- **EN:** translation, multilingual, language translate, translation review, glossary
- **DE:** Übersetzung, mehrsprachig, Sprachen, Übersetzung prüfen, Glossar

## Categories and languages

- Category: **Store design → Internationalization → Currency and translation** (Shopify's current category list; confirm the wording in the form).
- **Interface languages to list now: English, German.** French and Spanish exist but are listed only after a native speaker has read them (I18N_REVIEW.md; requirement 4.3.2).
- Integrations: none listed (DeepL is a service, not a Shopify app).
- Sales channel requirement: Online Store not required (translations also serve other channels through Shopify), confirm on the dev store.
- Privacy policy URL: `https://PUBLIC-APP-DOMAIN/privacy`; FAQ URL: `https://PUBLIC-APP-DOMAIN/support#faq` (served by the app with `PUBLIC_PAGES=on`, docs/LEGAL_FACTS.md). Support email: the owner's support mailbox (today shop@softwarekey.de).
- Website: not needed for the listing; the website at `/` can be added once it has a real domain.
- Every form field and its order: docs/APP_STORE_SUBMISSION.md.

## Pricing details

Entered by the owner in the Partner Dashboard (Pricing content, per published language: PRICING_DECISION.md §9 step 3), from the decision of 2026-10-30. Display name = the plan name; Shopify shows the prices from the plans themselves ($0; $29 or $290 a year; $99 or $990 a year; $299 a month only). The app's Plan page shows the same prices from `PLAN_PRICES` (`app/lib/plans.ts`); change all three on the same day.

| Plan | Top features (EN) | Top features (DE) |
|---|---|---|
| Free | 20,000 AI characters a month (DeepL) · AI translation into 1 language · Review and approve every draft · Translation memory: reused text is free · Translate by hand into every language | 20.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 1 Sprache · Jeden Entwurf prüfen und freigeben · Übersetzungsspeicher: Wiederverwendetes kostet nichts · Selbst übersetzen in jeder Sprache |
| Starter | 300,000 AI characters a month (DeepL) · AI translation into 3 languages · Translate whole areas at once · New and changed content translated automatically · 7-day trial with 100,000 AI characters | 300.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 3 Sprachen · Ganze Bereiche auf einmal übersetzen · Neue und geänderte Inhalte automatisch übersetzen · 7 Tage testen, mit 100.000 KI-Zeichen |
| Pro | 1,200,000 AI characters a month (DeepL) · AI translation into 10 languages · Glossary for brand names and fixed terms · Optional automatic publishing; texts with warnings wait · Everything in Starter; 7-day trial with 100,000 AI characters | 1.200.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 10 Sprachen · Glossar für Markennamen und feste Begriffe · Automatisch veröffentlichen, wenn du willst; Texte mit Hinweis warten · Alles aus Starter; 7 Tage testen, mit 100.000 KI-Zeichen |
| Business | 4,000,000 AI characters a month (DeepL) · AI translation into 20 languages · Smart schedule: your whole store on your timetable, with budgets · Everything in Pro · 7-day trial with 100,000 AI characters | 4.000.000 KI-Zeichen pro Monat (DeepL) · KI-Übersetzung in 20 Sprachen · Intelligenter Zeitplan: ganzer Shop nach deinem Zeitplan, mit Budgets · Alles aus Pro · 7 Tage testen, mit 100.000 KI-Zeichen |

Under the plans:

- **EN:** AI characters are the characters DeepL translates for you, spaces included. Text reused from your translation memory doesn't count. New allowance on the 1st of every month (UTC).
- **DE:** KI-Zeichen sind die Zeichen, die DeepL für dich übersetzt, Leerzeichen inklusive. Text aus deinem Übersetzungsspeicher zählt nicht. Neues Kontingent am 1. jedes Monats (UTC).

Rules: the trial feature goes in only once the trial allowance has been checked on the dev store (DEV_STORE_TEST_PLAN.md §L); with 0 trial days, no trial text anywhere. No price in any image, the icon or the logo (requirements 4.2.2 / 4.2.3): no listing screenshot shows the Plan page. No "popular" or "best value" claims (4.3.3).

## Screenshots

Generated from the real app on the production build with a fictional demo catalog (`APP_STORE_SCREENSHOTS=1 pnpm test:ui tests/ui/app-store-screenshots.spec.ts`). Files: [app-store/screenshots/](app-store/screenshots/). Before submission, regenerate them inside the real admin on the dev store if the embedded frame looks different.

| File | Shows | Alt text (EN) |
|---|---|---|
| 1-products.png | Translation status per product and "Translate all" | Product list with the translation status of each product in German and an option to translate all products |
| 2-editor.png | Original and translation side by side, formatted preview | Product editor with the English original and the German translation side by side, including a formatted preview |
| 3-outdated.png | An outdated translation after the original changed | Product whose German translation is marked outdated because the English description changed |
| 4-review.png | Review: one card per product, an imported text with a note | Review page with French translations in one card per product, each text to approve or reject; an imported text has a note because a number changed |
| 5-glossary.png | Brand terms and rules | Glossary with brand names that are never translated and preferred terms per language |
| 6-settings.png | Settings at a glance: AI permission, automatic translation, publishing with review | Settings page with cards for AI permission, translating changes and publishing with review, and the options for translating new content automatically |
| 7-overview.png | How far the store is, by country | Overview with the share of texts translated, the next step, and a card for each country the store sells to |
| 8-mobile-editor.png | The editor on a phone | Translation editor on a phone, with the original above the translation |
| 9-language.png | One language, area by area, with the store's pictures | German language page with the products and collections as pictures, each marked done, outdated or missing |
| 10-content.png | Everything translatable, by language and area | Content page with a language picker and, area by area, how much of the products and collections is translated, waiting for approval or missing |

Recommended order in the listing: 4, 10, 2, 9, 6, 5 (six images; 1, 3, 7 and 8 as spares). No image shows the Plan page or a price.

All ten were regenerated on 2026-11-01 from the current pages (Redesign 2, Settings v2, the Content page), with the fictional demo catalog in the simulated admin.

## Feature media

Static feature image, 1600 × 900 PNG, one per listing language (BRAND_ASSETS.md §2), generated with the screenshots:

| File | Line | Alt text |
|---|---|---|
| [feature-image-en.png](app-store/feature-image-en.png) | Approve every translation before it goes live | Linguva's Review queue with AI translations waiting for approval; one is flagged because a number changed |
| [feature-image-de.png](app-store/feature-image-de.png) | Jede Übersetzung freigeben, bevor sie online geht | Linguvas Prüfen-Seite mit KI-Übersetzungen, die auf Freigabe warten; eine ist markiert, weil sich eine Zahl geändert hat |

A 2–3 minute video can follow after launch.

## Audit against current requirements (phase I, 2026-10-28)

Read again on shopify.dev ("App Store requirements" §4.5, "Pass app review", "Best practices").

| Requirement | Status |
|---|---|
| Introduction ≤ 100, details ≤ 500, features ≤ 80 characters; no statistics, superlatives or pricing outside pricing details | Met (checked by `tests/unit/app-store-listing.test.ts`) |
| Screenshots 1600 × 900, 3–6 desktop, alt text, no browser chrome or personal data; mobile if responsive | Met with the demo catalog (ten images regenerated 2026-11-01, including the Content page); regenerate inside the real admin after the dev-store check if the frame looks different |
| Feature media: video 2–3 min (≤ 25 % screencast) or a 1600 × 900 image, one focal point, contrast 4.5:1, no Shopify logos, not repeating the subtitle | Done: `docs/app-store/feature-image-{en,de}.png` (BRAND_ASSETS.md §2) |
| App icon 1200 × 1200 | Done: `docs/brand/linguva-icon-1200.png` (BRAND_ASSETS.md §1); the owner uploads it in the Partner Dashboard |
| 4.5.3 Demo screencast of onboarding and listed features, English | Script for the current navigation ready (SUBMISSION_DEMO.md §1); recording needs the review store (owner) |
| 4.5.4 / 4.5.5 Testing instructions and working access | Ready to paste (SUBMISSION_DEMO.md §2): no credentials, Business plan for the reviewer, AI permission first |
| Privacy policy URL, FAQ URL | Drafts served at `/privacy` and `/support#faq` with `PUBLIC_PAGES=on`; production needs the lawyer's review first (`LEGAL_TEXTS_REVIEWED=yes`) |
| 4.5.6 Emergency developer contact | Owner, Partner Dashboard |
| Only list interface languages fully supported | English and German; French and Spanish after native review |
| Online store changes only through theme app extensions | Met: Linguva changes no theme files and adds no storefront script (STOREFRONT_LANGUAGE_SELECTOR.md) |
| Billing through Shopify | Met in code (App Pricing); prices decided (PRICING_DECISION.md), plans not created in the Partner Dashboard yet |
| Claims only for features verified on Shopify | Features 9 (coverage: the Overview, the Content page and Settings › Tools › Coverage in detail) and 10 (Settings › Tools › Import & export) are implemented and Tested Locally, not yet Verified on Shopify; keep them out of the submitted listing until the dev-store checks K and K2 pass |

## Still needed from the owner

App icon upload (`docs/brand/linguva-icon-1200.png`), the public app's domain for the privacy policy and FAQ URLs (and the lawyer's review of those pages), the support mailbox, the review store. The full list with O-steps: docs/APP_STORE_SUBMISSION.md. Pricing is decided (PRICING_DECISION.md, 2026-10-30): the owner enters exactly these plans and the pricing details above in the Partner Dashboard (PRICING_DECISION.md §9). See OWNER_DECISIONS.md.
