# UI/UX review and premium improvement plan (phase J)

Status 2026-10-28; the redesign of 2026-10-30 is §3c. Everything here is **Tested Locally** (production build, simulated Shopify, Playwright). Nothing in this document is verified inside the real Shopify admin yet; that is checklist U and V in DEV_STORE_VERIFICATION.md §3.6–3.7.

Scope agreed with the owner: improve the existing interface with sound product-design principles, **no speculative redesign**. A full competitor-based specification (T Lab, Langify, Transcy screenshots) follows separately; nothing here claims an advantage over them.

## 1. Method

1. Screenshots of 10 key screens with the simulated stores (`full`, `demo`, `empty`), desktop 1280 px and phone (Pixel 7) for the main ones: `tests/ui/ui-review-screenshots.spec.ts`, on demand:
   ```bash
   UI_REVIEW_SCREENSHOTS=docs/ui-review/after pnpm test:ui tests/ui/ui-review-screenshots.spec.ts
   ```
2. Each screen reviewed for hierarchy, density, consistency, honesty of the figures, and the merchant's next action.
3. Fixes chosen by effect on real use and by risk: no new dependencies, Polaris web components only, every changed behaviour covered by a test.
4. The same screenshots again after the changes: `docs/ui-review/before/` and `docs/ui-review/after/` (fictional data; phone images scaled to 2× and compressed).

## 2. Findings, by priority

| # | Priority | Screen | Finding | Status |
|---|---|---|---|---|
| 1 | P0 (misleading) | Coverage | A field group with only AI drafts showed a **full bar at 0 %** (solid blue): at a glance it read as finished | **Fixed**: drafts and "needs review" are striped (not live yet); complete stays solid green; the percentage sits next to the bar |
| 2 | P0 (defect) | Editor | The original description's preview frame was too short for lists: the last item was **cut off** ("New: recycled fabric" invisible) | **Fixed**: frame height counts paragraphs, list items and headings; regression test |
| 3 | P1 | Editor | A field's state (outdated, AI draft) was shown **at the bottom**, under the inputs; missing fields had no state at all | **Fixed**: one state badge at the top of every field: Translated, Outdated, Not translated, AI draft or Published, plus notes ("Manual only", review notes) |
| 4 | P1 | Coverage | The intro took a whole phone screen (3 paragraphs) before any figure | **Fixed**: one line with the last scan date and the rescan button; the explanation moved into "How coverage is counted", now folded |
| 5 | P1 | Coverage | Percentages above the bars: tables were tall and hard to scan down | **Fixed**: percentage and bar on one line, numbers aligned |
| 6 | P1 | Coverage | "Translate missing" looked like plain text next to blue links | **Fixed**: a real (secondary) button; links stay links |
| 7 | P1 | Coverage | "Next step" button said only "Open" | **Fixed**: "Review drafts", "Show failed fields" or "Show what's missing" |
| 8 | P1 | Coverage | The whole-store bar had no key | **Fixed**: key with every state and its count under the bar |
| 9 | P1 | Coverage items | One line per field and state: 30 items took 2,586 px | **Fixed**: one line per state ("Missing: Titles and names, Descriptions, URLs"); type column only when several types are listed: **1,464 px (−43 %)** |
| 10 | P2 | Overview | Finished onboarding steps took as much room as open ones | **Fixed**: finished steps as one line of check badges; open steps keep their card and action |
| 11 | P2 | Import/export | Export language defaulted to the alphabetically first language (often an unpublished one) | **Fixed**: published languages first |
| 12 | P2 | Import/export | Import result gave only the draft count | **Fixed**: "N rows read, M skipped (listed below with their line)" |
| 13 | P2 | Editor | SEO length only as "35 / 60" | **Fixed**: small length bar (green within the limit, red over it) next to the numbers |
| 14 | P2 | Products list | "Translated fields 3 / 5" as text only; the bulk card is heavier than the list | Planned: mini bars per row; bulk options folded behind one button |
| 15 | P2 | Import/export | "Columns: resource_id, …" is developer language; no numbered steps | Planned with the competitor-based specification |
| 16 | P2 | Coverage | Language cards repeat what the table below shows for the selected language | Planned: make cards selectors (tabs) once the specification decides the layout |
| 17 | P3 | All | Custom colours are light-theme values; Shopify renders embedded apps in the admin's light appearance today | Open: dark appearance follows only if the admin offers it to apps; colours are defined in one place (`STATE_COLOURS`, `TRACK_COLOUR`) for that |
| 18 | P3 | Coverage | Long phone page (5,090 px, was 5,668 px) | Planned: type and field tables as collapsible groups on narrow screens |

## 3. Before and after (Tested Locally)

| Screen | Before | After | Height before → after |
|---|---|---|---|
| Coverage (desktop) | [before](ui-review/before/coverage-desktop.png) | [after](ui-review/after/coverage-desktop.png) | 2,382 → 2,080 px (−13 %) |
| Coverage (phone) | [before](ui-review/before/coverage-phone.png) | [after](ui-review/after/coverage-phone.png) | 5,668 → 5,090 px (−10 %) |
| Coverage items | [before](ui-review/before/coverage-items-desktop.png) | [after](ui-review/after/coverage-items-desktop.png) | 2,586 → 1,464 px (−43 %) |
| Editor (desktop) | [before](ui-review/before/editor-desktop.png) | [after](ui-review/after/editor-desktop.png) | 1,682 → 1,843 px (+10 %: state badges and the full original text) |
| Editor (phone) | [before](ui-review/before/editor-phone.png) | [after](ui-review/after/editor-phone.png) | 2,642 → 2,906 px |
| Overview (desktop) | [before](ui-review/before/overview-desktop.png) | [after](ui-review/after/overview-desktop.png) | Checklist 3 done steps: 3 cards → 1 line |
| Overview (phone) | [before](ui-review/before/overview-phone.png) | [after](ui-review/after/overview-phone.png) | 1,816 → 1,674 px (−8 %) |
| Import/export | [before](ui-review/before/import-export-desktop.png) | [after](ui-review/after/import-export-desktop.png) | Unchanged layout; default language and result summary |
| Products, Review, Jobs, empty Overview | in `before/` | in `after/` | Unchanged (reference) |

Heights are CSS pixels of full-page screenshots with the same data.

## 3a. Overview redesign (owner request, 2026-10-28, Tested Locally)

The owner asked to see the translated share of every language, which of the countries the store sells to can't read it in their language, and a more modern Overview.

| Change | Why |
|---|---|
| Four headline figures, two with a meter: languages on the storefront, average translated share, countries in their language, waiting for review | The state of the store at a glance; the review count moved here from the sidebar |
| One row per language: name, storefront state, the share in large figures, the field bar, "N of M fields", Translate | In the old table the percentage was **cut off on phones** (the bar's fixed width pushed it out of view). The rows keep one layout at every width; `overview.spec.ts` checks the share on a phone |
| Countries: one bar by status (without their language, mostly untranslated, partly, in their language) with its key; the languages to add first, each with the countries it reaches and the Shopify setting to change; offered languages that are mostly untranslated | Answers "which countries can't read my store?" and what to do next |
| "Measure now" on the Overview, with progress while it runs | The shares need a measurement; no detour through the coverage page |
| Markets page: the same bar, and every country with its languages and why one is missing ("Czech (not added)") | The full list behind the Overview's top five |

## 3b. Overview v2: one next step, calm sections (owner request, 2026-10-29, Tested Locally)

On KARINEX the first redesign still read as busy: four tiles, a checklist, twelve three-line language blocks with empty bars ("Noch nicht gemessen"), five identical "Sprache hinzufügen" buttons, and a measurement stuck at "0 von 396 Teilen" (production had no worker; fixed separately, RAILWAY_STAGING.md §8b). The owner asked for a modern, simple page that is easy to use. Three independent designs were judged on the merchant's experience, Shopify consistency and accessibility, and honesty and risk; the winner ("next step first") was implemented with the others' best ideas.

| Before | After | Why |
|---|---|---|
| Four headline tiles, a "Get started" checklist with its counter, step cards with their own buttons | One **Next step** card with the page's only primary button, chosen by a fixed order: add a language, measure, review drafts, allow AI, first translation, publish a language, the least translated language under 50 %, countries without their language, the rest under 100 %, all caught up | One question, one action; no counter that jumps backwards when a step appears |
| A bar and "0 of 396 parts" for a measurement that hadn't started | Said in words: starting, waiting (it starts by itself), running with real progress, "hasn't moved since …" with **Measure again**, failed; the page reloads only while a measurement is under way | Never fake progress, never endless polling |
| Percentages from any scanned part (a first measurement under way showed products-only figures) | Percentages only from the newest **completed** measurement; the headline is field-weighted and says how many published languages it covers ("measured in 12 of your 13 published languages"); once every published language is measured it equals the Coverage page's whole-store figure, which also shows a measurement under way live. A language whose content the measurement partly skipped (errors) keeps its share with a note, and the page never says "all caught up" over it | Never a partial number presented as the whole |
| Twelve three-line language blocks with flags and a green badge on every row | One line per language: its name (the link to what's missing) and the bar with the share; only hidden languages get a badge; before measuring, one sentence instead of empty rows | Shorter, scannable like a bar chart |
| Five cards with five identical "Add language" buttons; a "mostly untranslated" list | The status bar with its key, one line per reason ("Not added to your store: Bulgarian (Bulgaria), Czech (Czechia), …"), Shopify's language limit when it limits the fix, links to the settings | The countries the owner asked about, without clutter |
| Store card and AI usage in the sidebar | "AI translation" card only (on/off, DeepL, usage) | The store card repeated the language count |

KARINEX today (stalled measurement, AI off, German): about 2,700 px → about 800 px on a desktop; after measuring, about 1,100 px.

An independent review of the deployed page (2026-10-29) found a few states where the page said more than it knew; all fixed with tests:
- A store whose translations were made outside Linguva (KARINEX, a store moving from another app) was sent to "publish your first translation" after measuring, which hid the least translated language and the countries. Measured live translations now count.
- The countries card's title counted every country with a gap while its text named one fix ("offer Italian in the market of these countries"); it now counts that fix's countries.
- A newer measurement stuck for 30 minutes could be restarted nowhere (the Coverage page's button stayed disabled and polled forever); both pages now offer "Measure again".
- Without a running worker a waiting measurement said "it begins by itself"; it now says background jobs aren't running (heartbeat).
- "Fully translated" no longer appears over content the measurement skipped or over a published language that was never measured; countries count as "in their language" only when their languages are measured; the store-wide figure names how many languages it covers; the primary language appears in the admin's language.
- While a scan ran, the Coverage page promised it would read a type again that it had already skipped (or whose language it doesn't cover); it now says to scan again once it has finished, and promises a new read only for types still ahead of it.

## 3c. Redesign: five entries, a page per language, areas with pictures (owner request, 2026-10-30, Tested Locally)

The owner: "When I click a country, show each area on its own with product images, in the best order, with a percentage per category. Everything is hard to understand now." The reader is a non-technical store owner who reads German as a second language. Three concepts were designed on a canvas and judged on the merchant's five-second read, on what Polaris and the app's data can honestly show, and on accessibility; the approved design took the best of each. Screenshots (fictional stores, production build): [`ui-review/redesign/`](ui-review/redesign/).

| Before | After | Why |
|---|---|---|
| 13 navigation entries (Products, Collections, Coverage, Transfer, Markets, Glossary, Memory, Plan …) | Five: Overview, Content, Review, Jobs, Settings. Products and collections lead under Content; the tools sit in Settings › Tools, each with a one-line explanation | One place per question; nothing became unreachable |
| A language was a row with a bar; clicking it opened the coverage tables or the product list | A page per language, opened from every language and country: the figure as a ring and in words, what customers see where nothing is translated, up to three numbered next steps with one black button, the three steps to live ("Translate → You approve → Customers see it") | Answers "how far, and what next?" in one look; the strip explains why the percentage rises only after approving |
| Coverage by Shopify's content types ("Product options", "Metaobjects", "Selling plan groups") | Ten areas in the merchant's words, by tier and why it matters ("What customers see first – this is where people decide to buy"), each with its percentage, bar, states and real examples: the store's product, collection and blog pictures with their translated names, page names, each original beside its translation | Recognition by pictures rather than German words; the areas add up to the language's figure (COVERAGE_RULES §11) |
| Several names for one state; "prüfen" for both rescanning and approving | One word per state, always with its icon: done, waiting for approval, outdated ("You changed the original – customers still see the old translation"), failed, missing. Rescanning is "count" ("Count store again"); "Review" only means approving | The confusion the owner described |
| Bulk translation started from a table row without saying what it does | A dialog first: what gets translated (in products and texts), that results wait under Review (or go live with automatic publishing), that own translations stay, the AI characters it may use of what's left | No surprise costs or overwritten work |
| Product list per type, sorted by product | An area's list: items in groups by their one state (open work first, each group saying what it means), filters that add up to "All", search, the state of each text as a neutral chip with a coloured icon, "Open ›" to the editor | Work order, and counts that add up |
| Overview: one row per language, a countries summary | The store's figure beside the next step; running jobs; the customers by country (or by language), each card opening its language's page | The owner thinks in countries; one translation serves every country of its language, so the page is per language and names its countries |

Measured on the fictional stores (CSS pixels, full page): the demo store's German page 2,723 px on a desktop (1,280 px wide) and about 2,840 px on a phone (412 px wide, every area with its "View all"); its products list 1,494 px; the list of a 55-product store 6,051 px for a page of 50 items.

| Screen | Desktop | Phone |
|---|---|---|
| Overview by country (demo store) | [overview-countries-desktop](ui-review/redesign/overview-countries-desktop.png) | [overview-countries-phone](ui-review/redesign/overview-countries-phone.png) |
| German, area by area (demo store) | [language-desktop](ui-review/redesign/language-desktop.png) | [language-phone](ui-review/redesign/language-phone.png) |
| A language not counted yet | [language-not-counted-desktop](ui-review/redesign/language-not-counted-desktop.png) | — |
| Products in German (demo store) | [category-desktop](ui-review/redesign/category-desktop.png) | [category-phone](ui-review/redesign/category-phone.png) |
| Products in German, 55 products, paged | [category-list-desktop](ui-review/redesign/category-list-desktop.png) | [category-list-phone](ui-review/redesign/category-list-phone.png) |

Taken with `UI_REVIEW_SCREENSHOTS=docs/ui-review/redesign pnpm test:ui tests/ui/ui-review-screenshots.spec.ts -g "overview-countries|language|category"` (the pattern also takes `coverage-language`, which belongs to §3); phone images scaled to 2× and compressed.

Found and fixed while testing the redesign in the browser:
- The language page or area list opened for the store's own language redirected to a bare `/app` and left the admin's session (an empty page); it now uses Shopify's redirect, which keeps the embedded app's parameters.
- When the examples' request failed, React Router showed the page's error screen in place of the whole language page; the examples are now optional (each card says "Names and pictures can't be loaded right now").
- Examples and list rows came in the database rows' random order, so each count showed other examples and reshuffled the list; both now go by state, then by resource.

Open points:
1. Rows inside a state group are in the order of Shopify's ids (the same after every count), not by name: names are read live from Shopify and not stored (COVERAGE_RULES §8). Sorting by name would need Shopify's search for every page.
2. No selection of single items to translate ("Ausgewählte übersetzen" in the canvas): bulk jobs cover a whole content type. Retrying one failed item happens in the editor or through the area's "Translate".
3. On a phone the first step's button is 44 px high but not full width (the canvas shows it full width); Polaris buttons can't change width by container size.
4. Collection and blog post image descriptions have no picture (Shopify's translatable resources don't link them to their image).
5. Seen in the real admin: not yet (checklist U, V) — the flags and Shopify CDN pictures inside the admin frame in particular.
6. A category with one type Linguva can't read (policies without `read_legal_policies`, menus without `read_online_store_navigation`) shows "Kein Zugriff" instead of its figures, although the texts that were read count in the language's percentage (COVERAGE_RULES §11). Showing the read part plus a "no access" line needs a product decision.
7. The language page counts open items per bulk type on each load (for the confirm dialog), also while it polls during a job: well within budget at 50,000 products (performance test), but it scales with the catalog. An indexed item state would make it constant.
8. The confirm dialog's AI-character estimate leaves out image descriptions and custom fields when "Also translate…" is ticked.

## 4. Tests for the changes

| Change | Test |
|---|---|
| Drafts striped, never solid like complete | `tests/unit/coverage-visuals.test.ts` |
| Preview frame fits lists | `tests/unit/html-preview.test.ts` (failed on the old height formula: 120 px for a text that needs 170 px); `tests/ui/editor-states.spec.ts` measures the content inside the real frame |
| Field state at the top of each editor field | `tests/ui/editor-states.spec.ts` (desktop and phone, accessibility) |
| Next-step label, whole-store key, folded rules | `tests/ui/coverage.spec.ts` |
| Item rows grouped by state | `tests/ui/coverage.spec.ts` ("Outdated: Descriptions") |
| Four interface languages complete, nothing left in English | `tests/unit/i18n.test.ts`, `tests/unit/i18n-usage.test.ts` |
| Accessibility (axe WCAG 2.1 AA), no sideways scrolling on phones, touch targets, keyboard | Existing suites on every changed page |
| Language page and area lists (redesign) | `tests/ui/language-page.spec.ts`, `tests/ui/category-list.spec.ts`, `states.spec.ts` (examples loading and failing), `i18n.spec.ts` (German, French, Spanish), `touch.spec.ts`, `csp.spec.ts`, `visual.spec.ts` (language and category, desktop and phone); areas adding up: `tests/unit/language-categories.test.ts` |

## 5. Design system rules kept

- Polaris web components and App Bridge only; no CSS framework or icon set added. Custom drawing only where Polaris has no component (segmented coverage bars, length bars), with the same information as text for screen readers.
- One colour source for coverage and progress: `STATE_COLOURS` and `TRACK_COLOUR` in `app/components/Coverage.tsx` (the progress bar and SEO length bar use them).
- Numbers that are compared down a column use tabular figures; a large standalone figure (the Overview's headline numbers) keeps proportional ones.
- Country statuses use their own status colours (`app/components/CountryStatus.tsx`), always next to their label; the bar itself is hidden from screen readers because its key says the same.
- Every page: one primary action at most per section; navigation as links, actions as buttons.

## 6. What still stands between this and a genuine Premium 10/10

1. **Seen in the real admin**: App Bridge title bar, navigation, save bar, toasts and modals inside Shopify, and the Shopify mobile app (checklist U, V). Not done.
2. **The competitor-based specification** (pending, owner): layout decisions for items 14–16 and 18 wait for it.
3. **Real merchants**: no usability session yet.
4. **Native-speaker review** of French and Spanish (I18N_REVIEW.md).
5. **Real catalog sizes**: the scan of the real dev store took 16 s for 34 API pages on an almost empty store; the per-type sequence should be measured on the fictional catalog and, later, a large store, before the progress UI can be called finished.
