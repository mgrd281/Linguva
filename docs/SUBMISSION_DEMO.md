# App review: demo screencast and testing instructions

Shopify requires (App Store requirements, read again 2026-10-31 on shopify.dev):

- **4.5.3** a demo screencast that shows the app's onboarding and the features described in the listing, with clear step-by-step setup, in English or with English subtitles;
- **4.5.4 / 4.5.5** testing instructions that give full access (Linguva is an embedded app with Shopify login only: there is no separate account and there are no credentials, so the instructions say so);
- **4.5.6** an emergency developer contact in the Partner Dashboard (owner, docs/APP_STORE_SUBMISSION.md);
- a finished, stable app with working install, reinstall, embedding, billing and no 404 or 500 pages ("Pass app review").

Nothing here is recorded or submitted yet: it needs the public app deployed on the review store and the owner's Partner account (docs/APP_STORE_SUBMISSION.md, owner steps O8 to O15).

Navigation as it is now: **Overview, Content, Review, Jobs, Settings**. Glossary, translation memory and the plan open from cards on Settings; languages, countries and markets, coverage in detail, and import and export are under **Settings › Tools**.

## 1. Screencast script (about 4 minutes, English narration or subtitles)

Recorded on the review store with the fictional demo catalog (`docs/dev-store/demo-catalog-products.csv`; no customer data), browser chrome hidden, 1080p, admin language English.

| # | Time | Screen | Say / show |
|---|---|---|---|
| 1 | 0:00 | Shopify App Store listing → Install | "Linguva translates a store's content with AI and lets the merchant approve every change before customers see it." Install; Shopify's permission screen (no customer or order data). |
| 2 | 0:20 | Shopify's plan page (with `BILLING_REQUIRED=true`) | Shopify's own plan selection; choose a plan. Linguva opens on its welcome page. |
| 3 | 0:35 | Welcome → Overview | The next step on the Overview: count the store ("Count now"), then the share translated per language. |
| 4 | 0:55 | Settings → AI permission | Allow AI translation: nothing is sent to DeepL before this, and it can be withdrawn here. Form of address per language. |
| 5 | 1:15 | Content → a language | Area by area: products, collections, pages and more, each done, waiting, outdated or missing. |
| 6 | 1:35 | Content → Products → "Translate all into German" | The confirm dialog: what is translated, that results wait in Review. Confirm. |
| 7 | 1:55 | Jobs | The job's progress; the report when it ends. |
| 8 | 2:10 | Review | One card per product; a text flagged because a number changed; edit one text, approve a card, reject a text. "Customers see these translations only after you approve them." |
| 9 | 2:45 | A product in the editor | Original and translation side by side, AI translate one field, the formatted preview and the search result preview for SEO fields; history with restore. |
| 10 | 3:10 | Settings → Glossary | A brand name that is never translated, a preferred term per language. |
| 11 | 3:20 | Settings › Tools → Import & export | Download the CSV, import a filled file: rows wait in Review. |
| 12 | 3:35 | Settings → Translating changes | New and changed products are translated shortly after saving; results wait in Review unless automatic publishing is turned on. |
| 13 | 3:50 | The storefront in German | The approved translation in the store, through Shopify's language selector. |

The Plan page shows prices: it may appear in the screencast (Shopify's rules on prices apply to the listing images, not to the screencast), but the screenshots never show it.

## 2. Testing instructions (ready to paste into the submission form)

> Linguva is an embedded app. There is no separate account and there are no credentials: you log in with Shopify.
>
> 1. **Install** Linguva on a development store. Before or after installing, add and publish at least one more language in Shopify (Settings → Languages). The review store we prepared already has German, French and Spanish and a demo catalog.
> 2. **Plan:** on Shopify's plan page, choose **Business** so every feature in the listing is unlocked. Reviewers can select plans at no charge.
> 3. **Allow AI translation first:** in Linguva, Settings → AI permission → "Allow AI translation". Until then no text is sent to the translation service (DeepL).
> 4. **Overview:** "Count now" counts what is translated. **Content** shows each language area by area.
> 5. **Translate in bulk:** Content → Products → "Translate all into German" → confirm. **Jobs** shows the progress. The results wait as drafts.
> 6. **Review:** approve a card (published to Shopify at once), reject a text, edit a text. Texts with a note (for example a changed number) are marked.
> 7. **Editor:** Content → Products → a product: original and translation side by side, "Translate with AI" on one field, SEO fields with a search result preview, history with restore.
> 8. **Glossary and translation memory:** Settings → Glossary; Settings → Translation memory.
> 9. **Automatic translation:** Settings → Translating changes → "Shortly after saving"; edit a product in Shopify and its translation appears in Review about a minute later.
> 10. **Import & export:** Settings → Tools → Import & export.
> 11. **Plan and usage:** Settings → AI characters. Changing the plan goes through Shopify's plan page.
> 12. **Uninstall and reinstall:** uninstalling removes Linguva's access at once; Shopify's shop/redact request 48 hours later erases the store's data. After a reinstall Linguva asks Shopify for the plan again.
>
> Help and FAQ: https://PUBLIC-APP-DOMAIN/support#faq · Support: SUPPORT-EMAIL · Emergency contact: in the Partner Dashboard.

Before pasting, replace `PUBLIC-APP-DOMAIN` with the public app's domain and `SUPPORT-EMAIL` with the support mailbox (today shop@softwarekey.de, the address on `/support`; owner step O5).

## 3. Before recording (checklist)

- [ ] The public app deployed with the production configuration (docs/RAILWAY_STAGING.md §10) and installed on the review store (owner, O8).
- [ ] DEV_STORE_TEST_PLAN.md run on the review store, results logged; no 404 or 500 in the flows above (owner, O11).
- [ ] Demo catalog imported (fictional); German partly translated, so the Content page shows every state.
- [ ] The four plans created in the Partner Dashboard (owner, O9); the DeepL key set (owner, O3).
- [ ] Screen recorder at 1080p, admin language English, no personal data visible (store owner's name, email).
