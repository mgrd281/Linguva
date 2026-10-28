# Competitor research (raw): Langify and Transcy

- **Read date for every source in this file:** 2026-10-28
- **Method:** public pages only, read with WebSearch and WebFetch. No logins, no paid tools.
- **Caveats on the method. Read these before you rely on the data.**
  - WebFetch returns page text through an extraction model. That model caps each verbatim quote at about 125 characters. Each quote below was copied from that output, and most of them came back the same in two separate reads (marked "2 reads"). Before you publish a quote outside the team, check it character by character against the live page.
  - The Shopify review pages do not put a review's star rating in its text. Per-review ratings below come from cross-checking the rating-filtered review lists (`ratings[]=1&ratings[]=2`, `ratings[]=3&ratings[]=4`, `ratings[]=5`, each sorted newest). They are labelled "derived".
  - In one read of an older Langify review page (1–2★ filter, page 2), store names were shifted against the review texts, while the date and text pairs stayed the same across reads. For that page this file gives only the date and the text, and leaves out the store name.
  - Where two public sources from the same vendor disagree, both are listed and the conflict is flagged. This file does not pick one.

---

## 1. Langify

### 1.1 Shopify App Store listing

| Field | Value |
|---|---|
| Listing title | "langify ‑ translate your store" |
| Developer | langify GmbH & Co. KG, Im Robbenklee 29a, Herford, 32052, DE |
| Rating | 4.7 |
| Number of reviews | 728 (5★ 641 / 4★ 37 / 3★ 7 / 2★ 6 / 1★ 37) |
| "Built for Shopify" badge | Not shown (the badge appears only on other apps in "More apps like this") |
| Launch date | March 24, 2014 |
| Category | Currency and translation |
| Languages of the listing/app | German, English, Italian, French, Spanish |
| Free plan | "Free plan available" |
| Free trial | Not listed for the app. The "Try Shopify free for 3 days" link on the page is Shopify's own sign-up offer. |
| Billing note | "All charges are billed in USD." "Recurring and usage-based charges are billed every 30 days." |
| Works with | Appstle℠ Subscriptions, Boost Product Filter & Search, Cross-Sell, Searchanise, Store Pickup + Delivery, Yoast SEO ‑ SEO for everyone |
| Data access requested | Store owner details. Edit products, collections, Online Store, theme. View metaobjects. Edit files, locales, Shopify Markets settings, translations. |
| Website / privacy | https://langify-app.com (redirects to https://lp.langify-app.com/), https://langify-app.com/privacy_policy |

Source: https://apps.shopify.com/langify (read 2026-10-28)

### 1.2 Plans

**As shown on the App Store listing**

| Plan | Monthly | Yearly | Languages | MT words included | Other plan bullets |
|---|---|---|---|---|---|
| Free | $0 | not found | Up to 5 | none | Unlimited manual translations, basic support, AI chatbot |
| Basic Plan | $17.50 / month | not found | Up to 20 | "10,000 free words" | 24/7 support, translation of 3rd-party apps, "up to 21%" off AI translation |
| Growth Plan | $29.95 / month | not found | (20, per website) | "50,000 free words" | Bulk translations, "up to 32%" off AI translation |
| Premium Plan | $59.95 / month | not found | (20, per website) | "200,000 free words" | Priority ("jump-the-line") support, "up to 42%" off AI translation |

Source: https://apps.shopify.com/langify (read 2026-10-28)

**Plan feature matrix from the help center** ("Plan Features Overview", modified Thu, 1 Oct 2026)

| Feature | Free | Basic | Growth | Premium |
|---|---|---|---|---|
| Languages | 5 | 20 | 20 | 20 |
| 24/7 Support | ✓ | ✓ | ✓ | ✓ |
| SEO / Manual translations / Checkout translations | ✓ | ✓ | ✓ | ✓ |
| Machine translations | ✕ | ✓ | ✓ | ✓ |
| Bulk translations | ✕ | ✕ | ✓ | ✓ |
| Welcome Gift (MT words) | ✕ | 10,000 | 50,000 | 200,000 |
| Import & Export | ✕ | ✓ | ✓ | ✓ |
| Max word discount | ✕ | 21% | 32% | 42% |
| Custom Content, Switcher Configurator, Country & Currency Switcher, Language Detection, Image Translations, Analytics | ✕ | ✓ | ✓ | ✓ |
| Priority Support | ✕ | ✕ | ✕ | ✓ |
| Words Log | ✕ | 7 days | 30 days | 90 days |
| Glossary entries | ✕ | 3 | 50 | 100 |

Source: https://support.langify-app.com/support/solutions/articles/11000128806-plan-features-overview (read 2026-10-28)

**Conflicts between Langify's own sources (flagged, not resolved)**
- **Language limit.** The landing page lists "Unlimited" languages on paid plans. Its FAQ, the pricing page and the help center say 20 (plus the base language, so 21 in total).
- **Support on the Free plan.** The listing says "basic support". The help-center matrix shows "24/7 Support ✓" for Free.

Sources: https://lp.langify-app.com/ , https://lp.langify-app.com/en/pricing (read 2026-10-28)

### 1.3 Pricing model details (overage, per-word cost, what counts)
- **The included words are one-time, not monthly.** The pricing page says free MT words are "credited only once at plan sign-up". The listing only says "10,000 free words" and gives no period.
- **Extra words are bought as one-time packages** that "do not add to your monthly langify subscription". In the app, packages come "in steps of 10,000 words, up to 10,000,000 at once".
- **Word package prices** (help center, modified Wed, 1 Jul 2026; list price → discounted price):

| Words | Basic | Growth | Premium |
|---|---|---|---|
| 10,000 | $4.99 | $4.99 | $4.99 |
| 20,000 | $9.99 → $9.49 | $9.99 → $9.19 | $9.99 → $8.99 |
| 50,000 | $24.99 → $22.49 | $24.99 → $21.24 | $24.99 → $19.99 |
| 200,000 | $99.99 → $84.99 | $99.99 → $81.99 | $99.99 → $69.99 |
| 500,000 | $249.99 → $199.99 | $249.99 → $174.99 | $249.99 → $149.99 |
| 1,000,000 | $499.99 → $394.99 | $499.99 → $339.99 | $499.99 → $289.99 |

  That works out to $0.499 per 1,000 words at list price and about $0.29 per 1,000 words at the deepest discount (Premium, 1M package).
- **How costs are counted.** Costs are "calculated based on the number of words that are to be translated". A dialog shows the word count, the cost and the balance afterwards before a run starts, and bulk translation counts the words first. The help center does not define what a "word" is (HTML, per target language, and so on).
- **Upgrades and downgrades.** You can upgrade at any time and downgrade after 14 days. Upgrades are prorated by Shopify with the formula `plan1_cost + (plan2_cost - plan1_cost) × (cycle_days_left / total_cycle_days)`.
- **Merchant evidence on what counts.** A 1★ review dated 2023-06-08 says "You can not filter archived or draft products." The extraction paraphrased it as unused words being billed (older review; see the store-name caveat at the top).

Sources: https://lp.langify-app.com/en/pricing , https://support.langify-app.com/support/solutions/articles/11000128762-word-packages , https://support.langify-app.com/support/solutions/articles/11000100274-machine-translations , https://apps.shopify.com/langify/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest&page=2 (read 2026-10-28)

### 1.4 Features

**Content Langify can translate**
- Theme, products, collections, pages, navigation (menus), blogs, articles, metaobjects, metafields, third-party apps, images, checkout, notifications (emails) and shop policies.
- Anything else goes through "Custom Content".
- Separate guides cover homepage, image alt text, handle (URL) translations, collection filters, product types and videos.
- SEO fields: bulk translation covers each item's "titles, descriptions, and SEO fields" by default.
- URL handles can be translated for articles, blogs, collections, pages and products. "Your existing URLs will automatically redirect to the new translated URLs" (a Shopify-managed redirect). One known issue: translating a collection handle has made that collection's filters disappear.
- Checkout: third-party content "cannot be translated on the checkout pages".

Sources: https://support.langify-app.com/support/solutions/articles/11000082047-translate-your-store (modified 29 Jul 2026), https://support.langify-app.com/support/solutions/folders/11000014738 , https://support.langify-app.com/support/solutions/articles/11000122295-handle-translations (modified 30 Jul 2026), https://support.langify-app.com/support/solutions/articles/1000075598-how-to-bulk-translate-your-store-with-langify (modified 15 Oct 2026), https://lp.langify-app.com/en/pricing (read 2026-10-28)

**Machine translation engines and automation**
- **Engines.** "By default" Langify uses DeepL, with Google Cloud Translation for languages DeepL does not support. "Both services use AI‑based neural machine translation technology." No OpenAI or other LLM engine is named.
- **No automatic translation of new or changed content.** The tools "will only apply translations when prompted" and "will not automatically translate your store without your input."
- **Bulk translation** is on Growth and Premium. By default it only fills in missing translations, and "Translate outdated" replaces stale ones. It does not cover third-party apps, metafields, metaobjects, collection filters or the General section.
- **Glossary.** It is in "open beta". It has two modes: *Translate* (a fixed translation for a term) and *Block* (leave the term untranslated). Entry limits are 0 / 3 / 50 / 100 (Free / Basic / Growth / Premium). "Entries cannot be applied to existing translations."
- **Translation memory:** not found.
- **Review/approval workflow:** not found.
- **Visual/in-context editor:** not found. Editing happens in a field-by-field editor with a search bar.

Sources: https://support.langify-app.com/support/solutions/articles/11000100274-machine-translations (modified 5 Oct 2026), https://support.langify-app.com/support/solutions/articles/1000075598-how-to-bulk-translate-your-store-with-langify , https://support.langify-app.com/support/solutions/articles/11000134567-machine-translation-glossary (modified 29 Jul 2026) (read 2026-10-28)

**Import and export**
- Export formats are "PO/MO, CSV, and Advanced CSV". XLIFF is not mentioned.
- "each section has to be exported individually in langify".
- For stores with more than 10,000 products or more than 100,000 metafields, the help center recommends Shopify's own export. Metaobjects are not covered by Langify's export.

Source: https://support.langify-app.com/support/solutions/articles/11000082134-export-translations (modified 29 Jul 2026) (read 2026-10-28)

**Storefront, Markets, SEO**
- **Language switcher.** Langify has a "Switcher Configurator" (Basic and up) with switcher types and breakpoints, plus a Country & Currency Switcher.
- **Auto-redirect.** It redirects by **browser language only**. For country (geo) redirects the help center says "we recommend geolizr", a separate app. The alternative to a redirect is a recommendation banner or popup, and detection and recommendation cannot both be on at once.
- **Currency.** The listing lists "Local currency checkout, Multi-currency, Country selector". The help center has no separate currency-conversion article. The landing page says the app "shows prices in local currency".
- **Markets.** The help center has guides for assigning languages to domains and markets, setting up "New Shopify Markets (July 2025 Update)", and Market Domains.
- **Hreflang** is generated by Shopify: "Our langify app does not have any direct influence on them." The tags are added once a language is published and assigned to a market.
- **Sitemaps:** not found.
- **Translated URLs:** yes, through handle translation (see above). The listing says "SEO optimized by subfolders and custom domain option".
- **Images per language.** You can upload, pick or enter a URL for a different image per language. This covers theme images, product, collection and article images, images inside descriptions, and Custom Content images. It works by swapping the image file, not by AI text-in-image translation. If the original image's URL or title changes, "the image translation will stop working and has to be done again".

Sources: https://support.langify-app.com/support/solutions/articles/11000082052-language-detection-recommendation (modified 20 Jul 2026), https://support.langify-app.com/support/solutions/articles/11000136432-hreflang-tags (modified 6 Aug 2026), https://support.langify-app.com/support/home , https://support.langify-app.com/support/solutions/articles/11000100718-image-translations (modified 28 Sep 2026), https://apps.shopify.com/langify , https://lp.langify-app.com/ (read 2026-10-28)

**Integrations** (help-center app list, modified 30 Sep 2026)
- **Native:** BOGOS: Free Gift Bundle Upsell; geolizr.
- **Shopify apps:** Shopify Inbox; Search & Discovery.
- **Custom:** Boost AI Search & Filter; Searchanise; Fast Simon; Zapiet ‑ Pickup + Delivery; Unlimited Bundles & Discounts.
- **Page builders:** LayoutHub, GemPages, PageFly, Shogun.
- **Tips only:** Judge.me.
- **Additions:** AR: Google Shopping Feed Pro; Sufio.
- No app is labelled incompatible. Reviews do report problems with PageFly, Judge.me and Shogun (see 1.6).

Source: https://support.langify-app.com/support/solutions/articles/11000106843-integrations-app-list (read 2026-10-28)

### 1.5 Data handling, privacy, support
- **GDPR FAQ** (modified 30 Jul 2026):
  - "We do not store, share or sell any of your or your customer's personal data."
  - "per default langify doesn't load any other third-party scripts from within the storefront."
  - On the DPA question: "No, we do not store, share, sell or process any of your customer's personal data."
- **Privacy policy:**
  - The controller is "langify GmbH u. CO KG", Herford, Germany.
  - The named processors are Hetzner (the website provider, under a DPA) and Freshworks Inc. (the contact form and support tickets).
  - The policy covers the **website**. It does not describe the app's data flows, and it does not name DeepL or Google. It has no date.
- **Where store text is sent:** the help center names DeepL by default and Google Cloud Translation as the fallback (see 1.4).
- **Support:**
  - "24/7" support on paid plans. Requests are "typically answered within 24 hours". The help center gives core support hours as **08:00 to 24:00 CET**. Premium gets "jump-the-line" priority.
  - Support channels mentioned: the in-app ticket view and support@langify-app.com.
  - Support languages: not found.

Sources: https://support.langify-app.com/support/solutions/articles/11000052843-gdpr-f-a-q , https://langify-app.com/privacy_policy , https://support.langify-app.com/support/solutions/articles/11000128806-plan-features-overview , https://lp.langify-app.com/ (read 2026-10-28)

### 1.6 Review themes (Langify)

**Sample**
- The 30 newest reviews (pages 1–3, sorted newest), dated **2024-09-30 to 2026-08-18**. Langify gets few reviews: 30 reviews span about 23 months.
- Plus the 1–2★ filter (43 reviews in total; the newest 20 were read) and the 3–4★ filter (44 in total; the newest 10 were read).

**Rating mix of the newest 30 (derived)**
- 22 are 5★.
- 0 are 3–4★. The newest 3–4★ review is dated 2024-08-28, which is before the sample window.
- 8 are 1–2★: BAGS & PIECES, CÉLE®, HenryPawHaven, Nutridome, Schweiz Trend Shop, TricycleBlend, ZooQueen, Edicola online.
- The developer replied to 3 of the 10 newest 1–2★ reviews (CÉLE®, TricycleBlend, Edicola online).

**Praise themes (newest 30)**

| Theme | Count | Representative quotes (exact, date) |
|---|---|---|
| Fast, helpful support | 21 of 30 (21 of the 22 5★ reviews; the 22nd has no text). The agent "Michael" is named in 3. | "Michael replied extremely fast and solved my issue right away! Much appreciated!" (2026-06-27, Charlotte sy Dimby, 2 reads); "Prompt reply, then above and beyond expectation support. Delivered by Michael. Thumbs up and Recommended." (2026-06-30, WORLDTIMER Watch Store, 2 reads); "The support has been 10/10 (late night replies, helpful people)." (2025-01-23, Fridja) |
| The app itself is capable or easy, including on complex setups | 8 of 30 | "We run a fairly complex setup: PageFly, multiple third-party plugins, custom sections, and 7+ active languages" (2026-02-12, OATENTIK); "I find the application very comprehensive and easy to use if you’ve already used translation plugins." (2026-01-26, FRISAFRAN, 2 reads) |

**Complaint themes (the 8 negative reviews in the newest 30; one review can count toward several themes)**

| # | Theme | Count (in newest 30) | Representative quotes (exact, date) |
|---|---|---|---|
| 1 | Machine translation is unreliable or wrong (including legal pages, partial translations) | 3 (HenryPawHaven, CÉLE®, ZooQueen) | "This is not an app i will use, translations can’t be trusted." (2026-01-06, HenryPawHaven); "For an app that praises it’s own legal accuracy, the mistakes are horrible." (2026-01-06, HenryPawHaven, 2 reads); "It translates part of the text and then skips an entire section for no reason." (2024-10-16, ZooQueen) |
| 2 | Support unreachable or no live chat (a minority view against the praise above) | 2 (BAGS & PIECES, ZooQueen) | "Support team can't be reached, sent three message already over the span of two weeks and never heard back." (2026-07-07, BAGS & PIECES, 3 reads) |
| 3 | Billing: charged after uninstall, or the app is not free as expected | 2 (TricycleBlend, Edicola online) | "Scam already uninstall but still charging me" (2024-12-12, TricycleBlend, 2 reads). The developer refunded it and blamed overlapping Shopify billing cycles. "Non e Gratis" (2024-10-05, Edicola online) |
| 4 | Third-party app or page-builder content not translated (Judge.me, PageFly) | 1 in the window, plus older ones | "Doesn't translate everything on other apps that you have to use within shopify." (2024-10-16, ZooQueen, 2 reads); "Doesn't work with for example Judge.me review app or Pagefly." (2024-10-16, ZooQueen); older: "Extremely slow, no integration with Pagefly and 'static section' is connected to 1 theme," (2024-04-11, Neofollics) |
| 5 | Slow, or impractical for large catalogs | 1 in the window, plus older ones | "The application is useless – it’s extremely slow." (2025-06-03, Nutridome, 2 reads); "Translating several thousand products in multiple language versions is practically impossible with it." (2025-06-03, Nutridome); older 3–4★: "It's very slow to open langify. It can't be opened for more than ten minutes." (2022-08-16, godes) |
| 6 | Automatic translation does not start or is not automatic; updates create rework | 1 in the window, plus older ones | "I purchased the app and added three languages, but despite this, the automatic translation does not start." (2025-03-23, Schweiz Trend Shop, 2 reads); older: "This app does absolutely nothing to help with workload and adds more workload." (2023-09-14, NAYA, 2 reads) |
| 7 | Switcher reverts or translations don't persist | 1 (CÉLE®) | "When you switch to another language, the page automatically jumps back to the original language." (2026-01-09, CÉLE®, 2 reads). The developer disputed this on 2026-01-12, saying a deleted language's translations and used credits could not be restored, and gave partial goodwill credit. |

**Ease-of-use remarks in 3–4★ reviews (outside the window, for context)**
- "The app is not always ultra easy to use but the support team is extremely fast and helpful to solve any issues." (2024-08-28, PERS)
- "La app es algo compleja de utilizar al principio, pero es muy eficiente y tiene un muy buen soporte" (2023-07-04, PARIS/64)
- One feature request asked for filtering of untranslated content, Google Sheets integration, and URL updates after automatic translation (2023-09-14, CENGIZ AKTURK, paraphrased).

Sources: https://apps.shopify.com/langify/reviews?sort_by=newest&page=1 , https://apps.shopify.com/langify/reviews?sort_by=newest&page=2 , https://apps.shopify.com/langify/reviews?sort_by=newest&page=3 , https://apps.shopify.com/langify/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest , https://apps.shopify.com/langify/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest&page=2 , https://apps.shopify.com/langify/reviews?ratings%5B%5D=3&ratings%5B%5D=4&sort_by=newest , https://apps.shopify.com/langify/reviews?ratings%5B%5D=5&sort_by=newest (read 2026-10-28)

### 1.7 Langify: unverified / not found
- Yearly prices: not found.
- App free trial: not found on the listing or the website. The extraction summarised the CÉLE® review (2026-01-09) as calling "the free trial too short"; this is not verified.
- Definition of a "word", and whether bought words expire: not found.
- Whether the included words ("10,000 free words" etc.) recur: the listing does not say. The website says they are credited once at sign-up.
- Language limit: conflicting ("Unlimited" on the landing page, 20 elsewhere).
- Support level on Free: conflicting ("basic" on the listing, "24/7 ✓" in the help-center matrix).
- LLM engines (OpenAI etc.): not found. Only DeepL and Google are documented.
- Automatic translation of new/changed content: explicitly not offered.
- Translation memory, review/approval workflow, visual/in-context editor, XLIFF: not found.
- Native geo/IP redirect: not offered (geolizr is recommended). Sitemaps: not found.
- AI text-in-image translation: not found (image swapping only).
- App data hosting location, subprocessor list for the app, data deletion on uninstall: not found.
- Support languages: not found.
- Whether translations are stored through Shopify's Translations API or in Langify's own storage: not stated. The listing asks for "edit translations, locales" access, which suggests the Shopify API, but this is not confirmed.
- Per-review star ratings: not in the page text (derived, see the method note).

---

## 2. Transcy

### 2.1 Shopify App Store listing

| Field | Value |
|---|---|
| Listing title | "Transcy: AI Language Translate" |
| Listing URL | https://apps.shopify.com/transcy-multiple-languages (`/transcy-multilingual` returns 404) |
| Developer | FireGroup. The listing says "Based in United States". The privacy policy names the controller as FireGroup JSC, F21-22, 182 Le Dai Hanh St., Ward 15, District 11, HCMC. Flagged: the two locations differ. |
| Rating | 4.5 |
| Number of reviews | 2,565 (89% 5★ / 5% 4★ / 1% 3★ / 1% 2★ / 5% 1★; filter counts: 5★ 2,289, 4★ 117, 3★ 25, 2★ 17, 1★ 117) |
| "Built for Shopify" badge | Yes |
| Launch date | May 28, 2020 |
| Categories | Currency and translation; Geolocation |
| Languages of the listing/app | English, French, Italian, Japanese, Spanish, German, Dutch, Chinese (Simplified, Traditional), Portuguese (Brazil, Portugal), Danish, Hindi. The help center counts the admin UI as "13 languages" and lists "Indian". |
| Badges/labels | "Built for Shopify", "Free plan available", "Free trial available", "Popular with stores like yours" |
| Headline claims | 147 languages through AI (OpenAI, DeepL, Gemini), 168 currencies converted in real time, image localization per market, multilingual SEO, Shopify Markets integration |
| Works with | Checkout, Shopify Flow, Shopify Admin, ChatGPT-4o and 4o-mini, DeepL Translator, GemPages, PageFly, EComposer, Kudosi, Judge.me, OneMobile, Printful, Growave, Yotpo, Shipping Bar, BOGOS |
| Data access requested | Customer device and activity data (geolocation, IP address, browser, OS). Store owner and blog contributor info. Edit products, collections, Online Store (pages and theme), metaobjects, Markets settings, translations, locales. View customers and orders (the last 60 days of orders). |
| Billing note | "All charges are billed in USD." Recurring and usage-based charges are billed every 30 days. |

Sources: https://apps.shopify.com/transcy-multiple-languages , https://transcy.io/privacy-policy/ , https://help.transcy.io/en/article/faq-the-language-transcys-interface-can-be-displayed-in-1t1amzs/ (read 2026-10-28)

### 2.2 Plans

**As shown on the App Store listing** (4 plans)

| Plan | Monthly | Yearly | Languages and currencies | Products | Glossary ("brand/tech term") rules | Trial | Other bullets |
|---|---|---|---|---|---|---|---|
| Free | $0 | – | 1 language and 1 currency | – | – | – | Instant on-page translation, built-in switcher, auto-translates 3rd-party app content, "Upgrade anytime for full editing and SEO" |
| Regional | $29 | $276 ("save 21%") | 3 | 200 | 20 | 7 days | New content auto-translates "on a schedule", branded switcher, SEO-safe URLs, "Translations stay in Shopify", translate any app and edit integrated ones |
| Continental | $69 | $660 ("save 20%") | 15 | 300 | 200 | 7 days | AI or your own API key, auto-redirect to the shopper's market, scheduled auto-translate |
| Cross-Border | $99 | $948 ("save 20%") | 50 | 1,500 | 500 | 7 days | "New content updates in real time", dedicated onboarding specialist |

Source: https://apps.shopify.com/transcy-multiple-languages (read 2026-10-28)

**As shown on transcy.io/pricing** (6 plans; the page has no date, and its image assets are dated Jan–Feb 2026). **Local Plus and Global do not appear on the App Store listing.**

| Plan | Monthly | Annual | Lang + currency | Editable langs | Products | AI tokens | Glossary rules | Image translation | Automation translation | Schedule sync slots |
|---|---|---|---|---|---|---|---|---|---|---|
| Free | $0 | – | 1 + 1 | none | – | none | none | none | none | none |
| Local Plus | $14.9 | $142.8 ($11.9/mo) | 1 + 1 | 1 | 100 | 150 | none | none | none | none |
| Regional | $29 | $276 ($23/mo) | 3 + 3 | 2 | 200 | 300 | 20 | 10 products, 10 collections | 10 products, 10 collections | 2 |
| Continental | $69 | $660 ($55/mo) | 15 + 15 | 10 | 300 | 500 | 200 | 50 / 50 | 50 / 50 | 4 |
| Cross-Border | $99 | $948 ($79/mo) | 50 + 50 | 20 | 1,500 | 1,000 | 500 | 100 / 100 / 100 others | 200 / 200 / 200 others | 6 |
| Global | $599 | $5,748 ($479/mo) | 147 + 168 | 147 | Unlimited | 5,000 | Unlimited | Unlimited | Unlimited | 6 |

More rows from the same page:
- **Words** "Unlimited" on every plan. **Pageviews** "Unlimited".
- **Free engine:** Google on every plan.
- **AI engines used directly** (paid plans): OpenAI, Gemini, Baidu, Yandex, Grok, DeepSeek. **Own API key** (Continental and up): OpenAI, Gemini, DeepL.
- **Translation history:** 1 / 2 / 3 / 5 / 10 versions.
- **Real-time sync:** Cross-Border and Global only.
- **Geolocation auto-detect and location pop-up:** Continental and up.
- **Agent support (chat and email):** Local Plus and up. **Customer success manager and priority technical support:** Global only.

Source: https://transcy.io/pricing (read 2026-10-28)

**Forced plan migration for existing users** (help center, updated 18/08/2026)
- Plan names and structures changed from **September 4, 2025**. Accounts without a new plan "will lose access to all Transcy features" after **January 1, 2026**.
- Mapping: Basic $11.9 → Local Plus $14.9; Growth $29.9 → Regional $29; **Premium $59.9 → Cross-Border $99**; Enterprise $599 → Global $599.

Source: https://help.transcy.io/en/article/why-you-need-to-migrate-to-a-new-plan-existing-users-only-lc2xa7/ (read 2026-10-28)

### 2.3 Pricing model details (overage, per-word cost, what counts)
- **Token wallet.** The help center calls it "Overview of App Wallet – Transcy Token System" (updated 17/08/2026).
  - Content translation through AI engines without your own key costs **1.2 tokens per word**. Each image translation costs **1,000 tokens**.
  - Top-ups: $1 = 1,000 tokens; $10 = 10,000; $25 = 25,000; $50 = 50,000 + 2,500 bonus; $100 = 100,000 + 10,000; $250 = 250,000 + 25,000; $500 = 500,000 + 50,000. That implies about **$1.20 per 1,000 words** before bonuses.
  - Tokens "cannot be withdrawn". Usage charges "are non-refundable" (refund policy).
  - Not found: whether the plan's AI-token allowance (150 / 300 / …) resets monthly, and how that allowance squares with "Words: Unlimited".
- **Older blog post:** "OpenAI Translation $1 For 1K Words", where the word count is based on the source text. This was found through search and the page itself was not read, so it may be out of date.
- **Quota add-ons are recurring monthly charges.** "All add-on prices listed above are charged on a monthly basis." Only one extension package applies at a time; a new one replaces the old one. Languages cannot be extended; a higher plan is required. Examples:
  - Products: Regional +1,000 $8.90/mo; Cross-Border +10,000 $59.90/mo.
  - Glossary rules: Regional +100 $2.90/mo.
  - Automation rules: Regional +100 $2.00/mo.
- **What counts.**
  - Language and currency limits count **target** languages and currencies only, not the default ones.
  - "Product translation" is the total number of products translatable "(any method)". "Automate translation" is a separate "trigger limit" on how many products re-translate automatically when the source changes. For example, Cross-Border allows 1,500 products in total but only 200 auto-retranslated.
  - Whether variants, drafts or archived products count: not found.
- **Image translation.** Free AI image translations per month are Regional 5, Continental 5, Cross-Border 10, Global 20. After that the cost is 1,000 tokens per image.
- **Refunds.**
  - "After the trial period, we do not provide unconditional refunds" (monthly and yearly).
  - A charge after uninstalling "means you uninstalled after the 7-day free trial period ended".
  - Shopify fees are not refunded.
- **Plan changes.** "We cannot upgrade your plan for you, downgrade it for you, or change it for you"; only the store owner can approve a charge (updated 14/10/2026).

Sources: https://help.transcy.io/en/article/overview-of-app-wallet-transcy-token-system-16tew75/ , https://help.transcy.io/en/article/extend-your-quotas-in-transcy-rebn8x/ (updated 13/10/2026), https://help.transcy.io/en/article/faq-transcy-pricing-plans-qa-7bsnv4/ (updated 18/08/2026), https://help.transcy.io/en/article/get-started-translate-images-with-transcy-1yezavm/ (updated 13/10/2026), https://help.transcy.io/en/article/transcy-payment-refund-policy-1su1zsf/ (updated 18/08/2026), https://help.transcy.io/en/article/faq-can-transcy-change-my-plan-or-approve-a-charge-for-me-u1gz9b/ , https://transcy.io/blog/pay-per-use-open-ai-translation/ (search snippet only) (read 2026-10-28)

### 2.4 Features

**Content Transcy can translate**
- Product, collections, "Transcy integrations", themes, blog posts, pages, navigation, preferences, payments, shipping and delivery, policies, metaobjects, metafields, notifications.
- **Checkout:** yes, for **editable** languages only.
- **Notifications:** Shopify notifications only (not third-party apps); Regional and up; editable languages only.
- **SEO meta titles and descriptions:** yes. **URL handles:** yes (a help article exists; the listing says "URL translation"). The packing slip template is also covered.
- **Alt text: not supported.** "Currently, Transcy don't support translating Alt text or Alt attributes" (updated 04/11/2025).
- **Third-party apps:** auto-translated on all plans. Editing those translations requires a paid plan.

Sources: https://help.transcy.io/en/article/how-to-translate-and-update-content-in-transcy-1kn3ka/ (updated 14/10/2026), https://help.transcy.io/en/article/faq-does-your-app-translate-order-email-notifications-150m2i1/ , https://help.transcy.io/en/article/faq-does-transcy-translate-alt-text-jicdcf/ , https://help.transcy.io/en/category/manage-translation-1a8k078/ , https://transcy.io/pricing (read 2026-10-28)

**Two language modes ("Non-Editable" vs "Editable")**
- **Non-Editable** languages use "Google auto-translate" (google.translate.js) when the visitor switches language. There is "No manual editing", they "cannot translate checkout pages", and they do not work with Shopify Markets. The help center does not say whether these languages are indexed by search engines.
- **Editable** languages use "Shopify's native language system": "Your translations are saved to Shopify." Up to 20 editable languages.

Source: https://help.transcy.io/en/article/what-are-the-differences-between-non-editable-and-editable-languages-in-transcy-nkgbfq/ (updated 14/10/2026) (read 2026-10-28)

**Engines, automation, bulk**
- **Engines:** OpenAI, DeepL, DeepSeek, Grok, Gemini, Baidu, Yandex, Google. Bring-your-own API key works for DeepL, OpenAI and Gemini. Otherwise wallet tokens are used, and Google is the free engine.
- **Automatic translation of new/changed content.**
  - "Automate translation" rules fire when "Default content in Shopify is created or updated". They work on products, collections, blog posts, pages and metaobjects, one resource type per rule.
  - They require Regional or higher and editable languages, and they are capped by the automation quota (e.g., 10 products and 10 collections on Regional).
  - Content sync options: manual sync (paid plans), scheduled daily sync (2–6 slots), and real-time sync (Cross-Border and Global only).
- **Bulk translation:** you can select multiple resources or select all. The help center still advises "Handle translations one resource at a time for optimal results." Locked translations are skipped.
- **Glossary:** rules capped by plan (20 / 200 / 500 / Unlimited), plus "Blocked Elements". The help center has a "Why my Glossary rule not working" FAQ.
- **Translation history:** 1–10 versions by plan. **Lock translations:** yes. **Find & replace:** yes (Local Plus and up).
- **Translation memory:** not found (only version history).
- **Review/approval workflow:** not found. Statuses are Translated, Partly-Translated, Untranslated and Outdated, plus a "mark as Translated" status; no roles or approval step is described.
- **Visual/in-context editor:** not found in the help center. Transcy.io links a "Visual Localization" page, which was not read.

Sources: https://help.transcy.io/en/article/how-to-translate-and-update-content-in-transcy-1kn3ka/ , https://help.transcy.io/en/article/how-to-set-up-rule-automate-translation-in-transcy-10czyap/ (updated 14/10/2026), https://help.transcy.io/en/article/overview-of-content-synchronization-system-b2b65d/ (updated 13/10/2026), https://help.transcy.io/en/article/understanding-translation-status-14hc59c/ (updated 07/11/2025), https://transcy.io/pricing , https://transcy.io (read 2026-10-28)

**Import and export**
- "Transcy does not yet support exporting translations to CSV or other files." The suggested workaround is Shopify Settings → Languages → Export.
- Import: "importing translations via CSV" is not yet available. The workaround is a Shopify import, which "may not work perfectly in all cases".
- XLIFF: not found.

Sources: https://help.transcy.io/en/article/faq-can-i-export-my-translation-in-transcy-erdi1k/ (updated 21/05/2026), https://help.transcy.io/en/article/faq-can-i-import-my-translation-to-the-app-18euhok/ (updated 27/05/2026) (read 2026-10-28)

**Storefront, Markets, SEO, images, currency**
- **Switcher:** a built-in language and currency switcher, customisable on paid plans. A help article covers which themes support an embedded header switcher.
- **Auto-redirect:** "Auto switch language/currency" based on "Visitor's browser language" or "Visitor's location". The pricing page puts geolocation auto-detect and the location pop-up on Continental and up.
- **Currency:** 168 currencies, real-time rates, rounding, "Display original price", cart notice. Multi-currency checkout works only with Shopify Payments.
- **Markets:** "Shopify Markets adaptation" on Local Plus and up. Editable languages are required.
- **SEO:**
  - "Shopify automatically generates hreflang tags and meta tags"; Transcy does not control hreflang or canonical tags.
  - "Your sitemaps will include all your published languages" (Shopify-managed).
  - Translated URL handles are supported, as noted above.
- **Images:** there are two methods.
  - **AI "Translate Images"** detects the text in an image, translates it and redraws it. It covers products, collections and "Others", Regional and up, one image at a time ("we don't support for bulk selection"), PNG/JPG/WEBP up to 50MB. Generated images are kept for 3 months.
  - **"Use your image"** uploads a different image per language.

Sources: https://help.transcy.io/en/article/faq-how-to-automatically-redirected-users-based-on-location-17rpfy6/ (updated 13/10/2026), https://help.transcy.io/en/article/faq-does-transcy-support-hreflang-tags-1a8ot6c/ (updated 19/08/2026), https://help.transcy.io/en/article/get-started-translate-images-with-transcy-1yezavm/ , https://transcy.io/pricing , https://apps.shopify.com/transcy-multiple-languages (read 2026-10-28)

**Integrations:** the listing's "Works with" list (see 2.1).

### 2.5 Data handling, privacy, support
- **Privacy policy** ("Effective Date: April 27, 2026", "Public v1.0"):
  - It collects merchant contact and billing data, end-user data processed for merchants, and "geolocation signals derived from IP address".
  - On transfers: "We may process and transfer personal data internationally".
  - Vendors are named only as "cloud hosting and infrastructure providers" and "AI and translation providers"; such a provider "may process data under its own terms and privacy policies". Google, OpenAI, DeepL and Gemini are not named in the policy.
  - The policy refers to a Subprocessor List page, which was not read.
  - After uninstall, data is deleted "within 45 days" for free-plan merchants and "within 90 days for merchants on a paid plan".
- **Listing data access** includes customer IP, geolocation, browser and OS, and 60 days of orders (see 2.1).
- **Uninstall:** Transcy "automatically remove[s] any remaining code when you uninstall". If anything is left, the merchant has to contact support.
- **Support policy** (updated 13/10/2026):
  - Channels: in-app live chat and support@transcy.io.
  - Response times: "Responded to within 1 hour during business days" for general questions, and "within 24 hours (excluding weekends)" for technical issues.
  - Hours: "Support availability varies by app". The policy does not say 24/7.
  - The developer's reply to MARSONIPRINT (2026-09-17) refers to 24/7 live chat, according to the extraction. This is not verified as policy.
  - Support languages: not found.

Sources: https://transcy.io/privacy-policy/ , https://help.transcy.io/en/article/faq-how-can-i-remove-leftover-code-after-uninstalling-the-app-gc9sci/ (updated 29/07/2025), https://help.transcy.io/en/article/overview-of-transcy-support-policy-17r4ztj/ , https://help.transcy.io/en/article/why-does-transcy-need-access-permissions-to-your-shopify-account-16hg7cv/ (read 2026-10-28)

### 2.6 Review themes (Transcy)

**Sample**
- The 30 newest reviews (pages 1–3, sorted newest), dated **2026-04-13 to 2026-10-27**.
- Plus the 20 newest 1–2★ reviews (134 in total), dated 2026-01-12 to 2026-10-27, and the newest 10 3–4★ reviews (142 in total).

**Rating mix of the newest 30 (derived)**
- 24 are 5★. Five of the 30 have no visible text: Byron Custom Guitars, Arkpax EU, Spines, Jagua Henna, HenStagPortugal.
- 3 are 3–4★: Spines, YoungLong, Pieco.
- 3 are 1–2★: Rattan, MARSONIPRINT, My Store.
- Byron Custom Guitars is listed under 5★ (edited 2026-10-13). Its text is not visible, but FireGroup's reply (2026-09-28) answers a complaint about a charge after uninstalling.

**Developer replies:** 19 of the 20 newest 1–2★ reviews have a FireGroup reply. The exception is Rattan.

**Timing of the negative reviews:** 17 of the 20 newest 1–2★ reviews are dated 2026-01-12 to 2026-04-01 (one date is unclear). That is the period right after the forced plan migration deadline of 2026-01-01 (see 2.2). This is a correlation only; this file makes no causal claim.

**Praise themes (newest 30)**

| Theme | Count | Representative quotes (exact, date) |
|---|---|---|
| Fast, patient support, including weekends | 21 of 30. Agent "Raymond" is named in 3, "Mary" in 1. | "Very helpful and quick support, even over the weekend." (2026-09-15, Wig Studio 1, 2 reads); "Very helpful and available support team. My problem was handled and solved within the afternoon." (2026-08-18, CHARLIE - Paris, 2 reads); "I've never seen any faster response with actual related content instead of auto-reply from an app developer." (2026-06-25, LifeSpan Europe) |
| Product makes multi-language feasible or easy | 7 of 30 | "App makes a difficult and time consuming job feel achievable. Support is very responsive." (2026-05-18, Gloverall); "We translated our store in 8 different languages. The app is very easy to use." (2026-04-14, Pieco, 2 reads); "Not the cheapest, but probably one of the best. Support is also really fast." (2026-07-29, Trail.nl) |

**Complaint themes**

Counts are given as A / B:
- **A** = the newest 30 reviews (all ratings).
- **B** = the 20 newest 1–2★ reviews (17 with visible text).
- One review can count toward several themes.

| # | Theme | Count A / B | Representative quotes (exact, date) |
|---|---|---|---|
| 1 | Pricing, billing, refunds, tokens, plan changes | A: 5 (Rattan won't renew, MARSONIPRINT, My Store, Trail.nl "not the cheapest", Byron via reply) / B: 9 by text (MARSONIPRINT, My Store, BunkySofa, MIHAILIUC, chronofactum.com, Natural Remedies, Kaufweise, aoon, Tessi-supply.com), plus 1 by reply only (Dolce Catene) | "Unfortunately nearly useless thanks to their token price gouging." (2026-03-30, BunkySofa, 2 reads); "We're waiting for a refund of almost 1000 USD for several months now..." (chronofactum.com, edited 2026-04-01); "Für einen Preis von 599 Euro ist die Leistung dieser App ungenügend." (2026-01-26, Kaufweise). Related 3–4★: "Transcy unilaterally changed my subscription plan WITHOUT my consent or any prior notification." (liwisi, edited 2026-03-19); FireGroup's reply cited the Sep 2025 pricing update. |
| 2 | Bugs: admin pages not loading, store links broken, currency display wrong | A: 0 / B: 6 (PurrEmbassy, Japanese Taste DEV, aoon, Tessi-supply.com, intentioncph.com, Zen Ara Grove) | "The app is very buggy, many times pages inside the app doesn't even load." (2026-02-03, Japanese Taste DEV, 2 reads); "This is horrifying - It has completely hijacked my store - Changed the links." (2026-03-17, PurrEmbassy \| Pet & Home, 2 reads); "prices for the U.S. market are incorrectly displayed in Australian dollars" (2026-01-20, Zen Ara Grove, 2 reads) |
| 3 | Slow or unhelpful support (a minority against the praise above, concentrated in 1–2★ reviews) | A: 0 / B: 5 (Natural Remedies, Kaufweise, chronofactum.com, intentioncph.com, Zen Ara Grove) | "Translations take forever, endless upsells before being able to use the app, custmoer service time is horrible" (2026-03-06, Natural Remedies, 2 reads) |
| 4 | Automatic translation doesn't happen; manual rework; stale images and content | A: 1 (Rattan) / B: 4 (Rattan, MIHAILIUC, Kaufweise, intentioncph.com partial) | "It almost never translates automatically, and every single change you make has to be translated manually." (2026-10-27, Rattan, 3 reads); "Die versprochene automatische Übersetzung funktioniert schlichtweg nicht." (2026-01-26, Kaufweise); "These are scammers. They take money, but the program doesn't work and translates nothing." (2026-03-15, MIHAILIUC, 2 reads) |
| 5 | SEO damage: hreflang conflicts, rankings drop, leftover code, 404s | A: 0 / B: 3 (Endurance kollective, Tessi-supply.com, PurrEmbassy) | "The app generated hundreds of "743 Hreflang Conflicts," confusing Google" (2026-02-17, Endurance kollective, 1 read); "Generally I would not use this APP as the SEO Rankings plummed after installation." (2026-01-12, Tessi-supply.com, 2 reads) |
| 6 | Translation quality; glossary ignored; literal or meta-field errors | A: 1 (Rattan) / B: 3 (intentioncph.com, PurrEmbassy, Rattan) | "An Absolute disaster. So many bugs and mistakes in the translations handled by Transcy" (2026-02-24, intentioncph.com, 2 reads). Per the extraction, this review says glossary rules were ignored even with DeepL through the merchant's own API key. |
| 7 | Complex, vague setup; outdated docs; slow sync | A: 2 (YoungLong, Pieco) / B: 2 (Gunderwear, Natural Remedies) | "App function is little complicated, and wish the manuals improved and renewed." (2026-06-29, YoungLong, 2 reads); "To be honest this whole setup is so vague that I do not feel confident Trancy is a tool I'd like to work with." (2026-03-13, Gunderwear, 2 reads) |

Sources: https://apps.shopify.com/transcy-multiple-languages/reviews?sort_by=newest&page=1 , https://apps.shopify.com/transcy-multiple-languages/reviews?sort_by=newest&page=2 , https://apps.shopify.com/transcy-multiple-languages/reviews?sort_by=newest&page=3 , https://apps.shopify.com/transcy-multiple-languages/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest , https://apps.shopify.com/transcy-multiple-languages/reviews?ratings%5B%5D=1&ratings%5B%5D=2&sort_by=newest&page=2 , https://apps.shopify.com/transcy-multiple-languages/reviews?ratings%5B%5D=3&ratings%5B%5D=4&sort_by=newest , https://apps.shopify.com/transcy-multiple-languages/reviews?ratings%5B%5D=5&sort_by=newest (read 2026-10-28)

### 2.7 Transcy: unverified / not found
- The listing (4 plans) and transcy.io/pricing (6 plans: plus Local Plus $14.9 and Global $599) disagree. The listing's "3 languages" on Regional compares with "2 editable" languages on the website.
- What an AI token buys in the plan allowance (150 / 300 / 500 / 1,000 / 5,000), and whether it resets monthly: not found.
- How "Words: Unlimited" relates to 1.2 tokens per word: not stated.
- Whether variants, drafts or archived products count toward the product limit: not found.
- Translation memory, review/approval workflow, XLIFF, CSV import/export inside the app: not found or not supported.
- Visual editor: not found (the "Visual Localization" page was not read).
- Alt-text translation: not supported (as of the 2025-11-04 article).
- Whether Non-Editable (google.translate.js) languages are indexed by search engines: not stated.
- Hosting country and named AI subprocessors: not found (the Subprocessor List page was not read).
- Company base: "Based in United States" on the listing versus a HCMC, Vietnam address in the privacy policy.
- Support hours (24/7 or not) and support languages: not confirmed.
- Text of the Byron Custom Guitars and Arkpax EU reviews: not visible in the page text.
- Per-review star ratings: not in the page text (derived).

---

## 3. Other prominent translation apps seen in the field

- **Shopify Translate & Adapt** (developer: Shopify).
  - 4.4 from 1,394 reviews; launched August 16, 2022; no "Built for Shopify" badge shown.
  - Price: "Free".
  - "Use translations by Shopify for up to 2 languages, or 8 in select countries."
  - Features: a side-by-side editor, market adaptation ("Adapt content to reflect spelling and messaging variations between markets") and localisation from the theme editor. "Auto-sync keeps your translations up to date (only in select countries)".
  - This is the free baseline every paid app competes against.
  - Source: https://apps.shopify.com/translate-and-adapt (read 2026-10-28)
- **Weglot: AI Translation & SEO** (developer: Weglot).
  - 4.5 from 826 reviews; launched September 23, 2016; no badge shown.
  - Plans: Free (1 language, 2,000 words); Starter $17/mo or $170/yr (1 language, 10,000 words); Business $32/mo or $320/yr (3 languages, 50,000 words); Pro $87/mo or $870/yr (5 languages, 200,000 words). Paid plans have a 14-day trial.
  - Engines: DeepL, Google and Microsoft, "across 110+ languages", plus a "Custom AI Language Model".
  - "All-in-one dashboard: Edit, review, set Glossary rules, and collaborate"; hreflang and clean URLs.
  - It is the only one of these listings that explicitly advertises review and collaboration.
  - Source: https://apps.shopify.com/weglot (read 2026-10-28)
- **LangShop AI Language Translate** (developer: Aheadworks).
  - 4.5 from 473 reviews; **Built for Shopify: yes**; launched September 15, 2016.
  - Plans: Free (1 language, 50 products); Basic $10/mo or $100/yr (10 languages, 250 products); Standard $40/mo or $400/yr (15, 2,000); Advanced $75/mo or $750/yr (20, 5,000). Paid plans have a 14-day trial.
  - Limits are by product count, with "Unlimited words" and "Unlimited glossary rules" (Basic and up). Auto-sync for new items is capped at 50 (Standard) and 125 (Advanced).
  - Engines: "OpenAI, DeepL Pro, Google Cloud Translation".
  - Source: https://apps.shopify.com/langshop (read 2026-10-28)

---

## 4. Gap notes (for an alternative), each tied to evidence above

1. **Automatic, uncapped sync of new or changed content.**
   - Langify does not auto-translate at all (§1.4: "will not automatically translate your store without your input").
   - Transcy limits auto-translation by quota: 10 products and 10 collections on Regional, 200 products on Cross-Border; real-time sync only from $99 (§2.2, §2.3).
   - Matching complaints: Rattan 2026-10-27, Kaufweise 2026-01-26, MIHAILIUC 2026-03-15, Schweiz Trend Shop 2025-03-23 (§1.6 #6, §2.6 #4).
2. **Predictable, transparent pricing and billing.**
   - Transcy stacks plan product caps, monthly add-on quotas, a non-refundable token wallet and a forced migration (Premium $59.9 → Cross-Border $99). Its listing and its website show different plan lineups (§2.2, §2.3).
   - Billing or pricing is the #1 complaint theme in Transcy's 1–2★ reviews: 9–10 of the 17 with text (§2.6 #1).
   - Langify's "10,000 free words" are credited once at sign-up, which the listing does not say (§1.3).
   - Charge-after-uninstall complaints appear for both apps (TricycleBlend; Byron, MARSONIPRINT).
3. **A professional localisation workflow.**
   - Transcy cannot import or export translations in the app (§2.4).
   - Langify exports CSV/PO one section at a time, without metaobjects (§1.4).
   - Neither documents translation memory, a review/approval step or XLIFF (§1.7, §2.7). Weglot advertises "review … collaborate" (§3).
4. **SEO safety and a clean uninstall.**
   - Transcy 1–2★ reviews report hreflang conflicts, ranking drops, changed links and leftover code (§2.6 #5).
   - Transcy's Non-Editable languages render through client-side google.translate.js, with no editing, no checkout and no Markets support (§2.4).
   - Both apps leave hreflang to Shopify (§1.4, §2.4).
5. **Terminology and quality control, plus full asset coverage.**
   - Langify's glossary is in open beta, has 3 entries on Basic and is not retroactive (§1.4).
   - Transcy's glossary is capped at 20 rules on Regional, and one review says the rules were ignored (§2.6 #6).
   - Langify draws machine-translation quality complaints on legal pages (HenryPawHaven 2026-01-06).
   - Transcy does not translate alt text (§2.4). Langify's image swaps break when the image URL changes (§1.4).

Smaller gaps:
- Langify has no native geo-IP redirect; it recommends the third-party app geolizr (§1.4).
- Both apps draw slowness complaints at scale (Nutridome 2025-06-03; Pieco 2026-04-14; Natural Remedies 2026-03-06).
- Neither publishes app-level data residency or named machine-translation subprocessors in its privacy policy (§1.5, §2.5).
