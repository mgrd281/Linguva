# App review: demo screencast and testing instructions

Shopify requires (App Store requirements, read 2026-10-28 on shopify.dev):

- **4.5.3** a demo screencast that shows the app's onboarding and the features described in the listing, with clear step-by-step setup, in English or with English subtitles;
- **4.5.4 / 4.5.5** testing instructions with credentials that give full access (Linguva is an embedded app with Shopify login only: no separate account, so the instructions say so);
- **4.5.6** an emergency developer contact in the Partner Dashboard (owner);
- a finished, stable app with working install, re-install, embedding, billing and no 404/500 pages ("Pass app review").

Nothing here is recorded or submitted yet: it needs the development store, the deployed app and the owner's Partner account (OWNER_DECISIONS.md).

## 1. Screencast script (about 4 minutes, English narration or subtitles)

Recorded on the development store with the fictional demo catalog (no customer data), browser chrome hidden, 1080p.

| # | Time | Screen | Say / show |
|---|---|---|---|
| 1 | 0:00 | Shopify admin → Apps → Linguva install | "Linguva translates a store's content with AI and lets the merchant approve every change before customers see it." Install, approve scopes (no customer or order data). |
| 2 | 0:20 | Overview | The guided checklist: languages, AI consent, first translation, review, publish. |
| 3 | 0:40 | Settings → AI processing consent; form of address per language | Consent is explicit and recorded; nothing is sent to DeepL before it. |
| 4 | 1:00 | Coverage → Scan store | Whole-store figure, each language, by content type and by field; "Next step". Click a number: the exact items behind it. |
| 5 | 1:40 | Products → a product → editor | Original and translation side by side, AI translate one field, SEO preview, save; history with restore. |
| 6 | 2:10 | Coverage → Products → Translate missing | A bulk job with progress; remaining time appears once it is reliable. Results wait as drafts. |
| 7 | 2:40 | Review | Filter, a draft flagged by the number check, edit, approve and publish; reject another. Coverage updates right after. |
| 8 | 3:10 | Glossary; Import & export | Brand names never translated; CSV export, a filled file imported as drafts (rows with a changed original refused). |
| 9 | 3:30 | Settings → Automatic translation | New and changed products are translated automatically; results wait in Review unless automatic publishing is confirmed. |
| 10 | 3:45 | Plan | Shopify's own billing, monthly allowance, usage. |
| 11 | 3:55 | Storefront in German | The published translation in the store, through Shopify's language selector. |

## 2. Testing instructions (draft for the submission form)

> Linguva is an embedded app; no separate login is needed. Install it on a development store with at least one additional language (Settings → Languages). For the full feature set, the review store "linguva-review" is prepared with demo products and German, French and Spanish.
>
> 1. Open Linguva → Overview and follow the checklist. Allow AI processing under Settings (required before any text is sent to DeepL).
> 2. Coverage → "Scan store", then "Show items" on any row.
> 3. Products → open a product → choose German → "Translate with AI" on a field → Save.
> 4. Coverage → Products → "Translate missing": drafts appear under Review. Approve one: it is published to Shopify; reject one.
> 5. Import & export → "Download CSV", fill the translation column, import: rows appear under Review.
> 6. Plan: test charges only on development stores (Shopify App Pricing).
>
> Emergency contact: see the Partner Dashboard. Support: (owner's support address).

## 3. Before recording (checklist)

- [ ] Deployed build with production configuration on the review store (owner).
- [ ] DEV_STORE_TEST_PLAN.md run, results logged; no 404/500 in the flows above.
- [ ] Demo catalog imported (fictional); German translations partly done so coverage shows all states.
- [ ] Billing plans created in the Partner Dashboard (owner).
- [ ] Screen recorder at 1080p, admin language English, no personal data visible (store owner name, email).
