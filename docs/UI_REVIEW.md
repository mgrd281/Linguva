# UI/UX review and premium improvement plan (phase J)

Status 2026-10-28; the redesigns of 2026-10-30 are §3c (Overview, language pages) and §3d (Content, Review and Plan). Everything here is **Tested Locally** (production build, simulated Shopify, Playwright). Nothing in this document is verified inside the real Shopify admin yet; that is checklist U and V in DEV_STORE_VERIFICATION.md §3.6–3.7.

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

## 3d. Redesign 2: Content, Review and Plan (owner request, 2026-10-30, Tested Locally)

Redesign 2 covers the three pages the first redesign left as they were. For Content the owner asked for a "redesign with icons, very modern, the highest possible UX, easy to understand 10/10"; for the Plan page: "You set the prices yourself now. On the plan page I want the highest modern level, with an icon for every feature." The prices come from PRICING_DECISION.md. Each page got a spec and canvas artboards (desktop and phone), which an adversarial review checked against the code; each was built on its own branch and reviewed twice (code, then UX) before the three branches were merged. The reader is still the non-technical store owner who reads German as a second language.

Screenshots (fictional stores, production build) are taken on demand and are **not in the repository yet**. Take them from commit 3cf4fbc or later (Review's look changed in its last commits):

| Screens | Command | Files |
|---|---|---|
| Content, Review | `UI_REVIEW_SCREENSHOTS=docs/ui-review/redesign2 pnpm test:ui tests/ui/ui-review-screenshots.spec.ts -g "content\|review"` | `content-desktop`, `content-phone`, `content-pictures-desktop`, `content-not-counted-desktop`, `review-desktop`, `review-phone`, `review-empty-desktop`, `review-empty-phone` |
| Plan | `UI_REVIEW_SCREENSHOTS=docs/ui-review/plan pnpm test:ui tests/ui/ui-review-screenshots.spec.ts -g "plan"` | `plan-desktop`, `plan-phone`, `plan-none-desktop`, `plan-none-phone`, `plan-trial-desktop` |

Review before Redesign 2: [ui-review/after/review-desktop.png](ui-review/after/review-desktop.png) (phase J).

### Content ("Inhalte")

| Before | After | Why |
|---|---|---|
| A table of 26 content types in Shopify's words, with no figures and no language | One language at a time: chips with flag and percentage (a select with more than six languages; visible languages first, a hidden one marked). The language page's areas as tiles with icon, name, figure, bar, open work and the store's pictures | The same map as the language page and the Overview; figures only for a counted language |
| Eight identical "Translate" buttons that only opened a list | Each tile is one link to its area's list, where "Translate" starts the job after its dialog | One place and one set of buttons per area |
| Up to 12 "Allow access" buttons for 5 permissions | One card: what Linguva can't read yet, and one button that asks for every missing optional scope on one Shopify screen | One decision, one confirmation |
| The theme's texts as seven technical rows | "More texts": the theme's and the notifications' parts in plain names, each with a one-line hint, opened in place (also from a language page) | The merchant's words |
| Walls of "not yet" and "not available" text | Two folds with counts and icons: what isn't in the store yet, and what Shopify doesn't let apps read | A short page, nothing hidden |
| 27 Shopify calls on every view; one failed check took the page down | Shopify's answers kept a minute per shop and granted scopes (2 calls on a repeat view); a type Shopify didn't answer for is named, with "Load again" | Speed (PERFORMANCE.md §3) and an honest page |
| Lists opened in a hidden language when no language was given | Every link carries the language; a list without one opens in a visible language, marks hidden ones and leads back to Content | No surprise languages |

Accessible names: the link text of a chip or a tile is a screen-reader-only label (`s-text accessibilityVisibility="exclusive"`: "Products: 47% translated. …"), and the visible words inside are hidden from screen readers. Nothing is read twice, and the name contains the visible label (WCAG 2.5.3) without an `aria-label`.

After the UX review: names are semibold through a small `Strong` element (600), because Polaris' `s-text type="strong"` draws at body weight; language chips are as wide as their words (at least 168 px, equal height per row) instead of equal columns, so no name is cut; an open theme or notifications group indents its parts under the group's name on wide pages; the folds use columns of at least 340 px (two on a desktop), so every item stays on one line; a store with nothing to translate shows an icon card and no count.

### Review ("Übersetzungen prüfen")

| Before | After | Why |
|---|---|---|
| One card per field, in key order (Description before Title), Product 10 before Product 2, images and custom fields far from their product | One card per item and language with its picture, name, area and language; texts in their natural order; products, then collections, pages, blog posts and blogs, by number; image texts and custom fields inside their item's card | The merchant decides per product, as on the language page |
| Raw HTML in a text area next to a rendered copy | Rendered only, at the size of the plain text boxes; "Edit HTML" opens the raw text with a live preview | One look for every text |
| Pre-ticked "Include" boxes and "Approve and publish selected" | No checkboxes: "Approve" and "Reject" on every text, "Approve all N" on a card, and for the page after a dialog that names its languages, the hidden ones and the notes | Nothing goes live that the merchant didn't see |
| A warning at the bottom of the card, without detail | A note beside the text's label ("Note: Numbers changed (12 → 6)"), the numbers marked in both texts; numbers and Google lengths are checked again while the merchant types | The problem is visible, and a fixed note goes away |
| Three control cards and an Apply button | One control card: language tabs with counts, search while typing, area chips that add up to "All areas" and match the language pages, "With notes", a job's scope as a chip with "Show all" | Every filter at a glance, no extra step |
| Partial results as four counts; a Shopify timeout replaced the page | Each text's result in its place (approved, still hidden, outdated, not published and why); after a timeout the texts not sent yet keep waiting | Every partial failure explained beside its text |
| Clearing a text and approving it published the AI draft | An emptied text can't be approved; the server refuses it too | No accidental publishing |
| A bare empty state | "All reviewed" with a tinted check, what happens next and the languages with their figures; an empty selection says "No translations for this selection." with the way back | Never a dead end |

After the code review: about 50 texts a page in whole cards with "Next page", "Back to the start" and "1–50 of N"; each result shows once; the page's buttons wait while a text's or card's request runs. Reload with unsaved edits is a navigation to the same address, so the leave question asks first (the spec reloaded the data in place; a deviation). A job's or field group's page with nothing left says "No translations for this selection." with "Show all" instead of "All reviewed", from texts that already existed (`review.filtered.none`, `review.filter.showAll`; no new keys).

After the UX review: rendered descriptions and page bodies fit their boxes at every width. Review's frames use the text-box size (13 px on 20 px lines) and a height for each width a card can have (`app/lib/text-box-height.ts`), instead of `HtmlPreview`'s `previewHeight`; `HtmlPreview`'s Review-only props are `tone`, `blockSize`, `textBox` and `label`, and the editor is unchanged. Text names are semibold (650); the filter chips are all in view on wide screens, and a phone's row starts at the chosen chip; on a phone, decided cards and the "page done" panel keep the picture or tick beside the words, with "Continue" on the thumb side; right-to-left translations start at the right; an empty selection says so once, without the page's strip; the payoff line goes once its language is fully decided.

### Plan ("Tarif") with prices

| Before | After | Why |
|---|---|---|
| No prices on the page (v1 rule) | Four aligned cards with list prices from `PLAN_PRICES` (Free as a word), Starter and Pro with "or $290 / year" and "2 months free", Business "Monthly only", no switch, a footnote on US dollars, Shopify's billing and taxes | Merchants compare before Shopify's page; one exact savings claim, no pressure |
| Features as check rows without icons | One Polaris icon per feature, the same in the cards, "In every plan" (all eleven) and the full comparison (with a price row) | The owner's request; recognition at a glance |
| No hint which plan suits the store | "Fits your store: Pro. The smallest plan for your 4 languages.", computed from the store's own use, with a badge on that card; never "popular" | Honest guidance (PRICING_DECISION.md §10.3, rule 5) |
| Usage as text lines | A hero with the plan's icon and state, and two meters: AI characters with the allowance in force (also a trial's) and the day they renew; languages with the plan's places and those outside it | What do I have, what's left, when does it renew: in one look |

On a card, the state badges ("Your plan", "Applies now", "from …") sit beside the plan's icon, and a badge too wide for the row moves below it. The current plan's 2 px ring lies inside the card, so the cards' edges line up. The hero has one heading ("Your plan: Pro"), and the meter names are h3 headings. Lead phrases, meter names, the table title and the questions are set in semibold (600). German "KI-" compounds keep a non-breaking hyphen, so no line ends in "KI-" (I18N_REVIEW.md).

### Measured in Polaris (2026-10-30)

- `s-text type="strong"` draws at body weight (450), the same as plain text. Where a page needs emphasis, it sets the weight inline, as the language page does for its summary: the Plan page at 600 (`EMPHASIS`, `METER_LABEL` in `app/components/plan/styles.ts`), Content through its `Strong` element (600), Review's text names at 650. Names that still rely on `type="strong"` show no emphasis: the Overview's card titles (`app._index.tsx`) and `CountryCards`, `CategoryList`, the Settings tool labels, `StepStrip`, the language page's extras rows, and `DialogPoint`'s titles. A shared semibold helper would fix them together. The numbered "Next" steps already do (Redesign 3): `NumberedSteps` sets a title given as text in semibold (600), on the language and area pages as on the Jobs pages.
- A neutral badge with `color="strong"` looks exactly like a plain neutral one ("Hidden"), so the current plan's "Your plan" badge is info with `color="strong"`.
- `s-text` has no size, so the artboards' 12 px captions can't be built: two meter captions wrap at 1,280 px, and the trial line takes three lines in a four-column card.
- A sandboxed frame can't report its own height. Review counts lines per block at the text-box size for each range of card widths, at the narrowest width of each range, and gives the frame a Polaris responsive height, so no box changes height after the page shows and no text is cut. The price: on a 390 px phone a long multi-paragraph box can keep 1–3 spare lines.
- Polaris' touch look draws flat sections without a border, so on a phone Review's cards are separated by white space only.

**Colour:** `MARK_COLOUR` (`#ffef9d`, `app/components/Coverage.tsx`) is a new named colour: the light yellow behind the numbers marked in Review's notes, in plain texts and inside rendered frames. It keeps the text's contrast and sits in the one colour source with `STATE_COLOURS`, `TRACK_COLOUR` and `SURFACE_COLOUR` (§5).

### Open points (named by the reviews)

Content:
1. The theme parts' lists (`ResourceList`) still use Shopify-style titles that don't match the Content page's row names, and order languages by their English names. A follow-up in the spec.
2. "Allow access" on other pages still leads to the type's own page (`/app/content/<type>`), not to the new card. A follow-up.
3. Tiles that are new since the last count or not counted completely say to count the store again, but the page shows no count button then (the Overview's "Count store again" does it). Owner decision (OWNER_DECISIONS.md §6).
4. The word-only state lines ("Not counted yet", "Being counted now", "Nothing to translate") have no icon, while "Translating now" has one. This matches the language page and the artboard, so it stays.
5. While a count is only queued (no worker running yet), the counting card shows no progress until the job runs; the spec defines a bar for the running state only.
6. The pictures' request also loads examples for text areas (at most 5 each); limiting it to picture areas would save a little. Also possible later: count only the page's 26 types in `contentItemCounts` (3.5× faster at 300,000 items per language), key the pictures by language (no one-frame flash of the previous language's pictures), shorten the name lists in "Newly unlocked" and "Not checked".
7. Not yet seen in the real admin: one Shopify screen for several scopes (DEV_STORE_TEST_PLAN K14), the theme parts' hints (K15), and pictures from Shopify's CDN inside the admin.

Review:
1. On a phone, the language label inside a rendered box sits 12 px further from the text than in a plain box: the sandboxed frame's own padding can't depend on whether the label shows. A real fix moves the labels out of the boxes, a design change (OWNER_DECISIONS.md §6).
2. As designed: the strip says "30 translations on this page" while the button says "Approve all 29" (a new web address is approved on its own; the dialog says so), and a web address's note repeats while its question is open.
3. Before any page has synced the store's languages (Review makes no Shopify call), the originals carry no language name, hidden languages aren't marked and "All reviewed" lists no languages. This affects only a store's very first visit.
4. An image text drafted without its owner (an import, a smart check of the image) gets a card of its own: the coverage scan stores owners for custom fields, not for images. Changing that touches the scan or the job and import paths.
5. Smaller ones from the code review: the "page done" panel's "N more are waiting" leaves out failed or changed texts of the page that still wait; the "changed" result says "there is a newer version" also when the text was decided in another tab; focus can jump into the search field after a navigation the leave question blocked; the approve dialog's "Customers see them right away" takes its plural from all texts, hidden languages included; `aria-busy` is set only during the page's own request, not while filters navigate; image texts' pictures have a 10 px radius (spec: 6).

Plan:
1. At four columns a card without a badge keeps an empty band under its icon: 28 px, about 56 px in French with a pending change and the fitting plan, because the column is 966 px wide where the artboard assumed 992 px. Removing it needs a design decision, for example "Fits your store" as a band at the top of the card (OWNER_DECISIONS.md §6).
2. Deviations from the spec, kept for now: the meter names are h3 headings (spec: strong text); the hero section has no accessibility label (Polaris would add a second, hidden heading); a new key `plan.row.languages.detail`; at four columns "Fits your store" sits below the plan icon in German, French and Spanish (artboard: at the right).
3. A plan change that keeps the plan handle (for example Pro monthly to Pro yearly at the cycle's end, if Shopify reports it so) would read "Changes to Pro on …" on a Pro store, because the app doesn't read the billing period. To check on the dev store (DEV_STORE_TEST_PLAN L14).

## 3e. Redesign 3: the Jobs pages (owner request, 2026-11-02/03)

The Jobs list and a job's page, rebuilt on the shared view logic (`app/lib/job-view.ts`, tested in `tests/unit/job-view.test.ts`) and the list's server queries (`app/.server/jobs/bulk-jobs.ts`, `tests/integration/jobs-page.test.ts`). The words, states and figures are the view logic's, so the list and the job's page always say the same.

- **Jobs list** (`/app/jobs`): an attention card first (a stop that needs the merchant, with its fix and the way to the job; stops that go on by themselves; failed items; background jobs not running; translations to approve), only on the unfiltered first page of "All". Tabs with their figures (All, Running, Problems in the last 14 days, Completed, Cancelled), the search (a product's name or a job's reference) and four filters (language, content, who started it, when; behind "Filters (n)" on a phone). On "All": the jobs running now, updating by themselves, then the history by day in the store's time zone ("Today · Tuesday, November 3"), the jobs of one click or one schedule check together. Each row: the language's flag, the job's one name ("French · Products"), its origin badges, what came out in words with its icon (never colour alone), and its meta. Pages go both ways by keyset.
- **A job's page** (`/app/jobs/:id`): the header with the state badge and who started it when; the hero like the language page's: the ring of what ended well (dashed while the job still finds its items, a clock while queued), the title, its lines (time left, the stop's reason, "Updates by itself") and the legend; beside it the Next panel with at most three numbered steps and one primary button (approve, try again, finish in the editor, fix the cause, resume), or "Nothing to do." The stats (time, AI characters, saved), the items that need the merchant by their names and pictures (each opens the editor), and the results in detail with the CSV report and the support reference, folded. Cancel asks first and says what stays.

Status: **Implemented; content checked locally** (every state of `tests/ui/fixtures/jobs-store.ts` rendered from the production build). This development container can't load Polaris from Shopify's CDN (network policy), so the layout itself is checked in CI: `tests/ui/jobs.spec.ts` and the `jobs-completed` and `job` screenshot comparisons, whose `*-ci.png` images come from the first CI run.

## 3f. Redesign 3: Settings in sections (owner-approved design, 2026-11, Tested in tests only)

Settings was one long stack of cards under six "At a glance" tiles. It is now sections, one shown at a time and addressed by `?section=<key>` (`changes`, `publish`, `style`, `memory`, `keys` on the Own key plan, `ai`, `plan`, `tools`):

| Before | After | Why |
|---|---|---|
| Six glance tiles, then every card | Under the heading one status row: "Everything is set up" with a green check, or the one thing that needs the merchant (a language, a key, the AI permission, translating changes paused or waiting) in its tone with its fix | One answer to "is anything wrong?" |
| Cards in a stack; the permission moved to the top while missing | A nav card (260 px) beside the section: each section's name and its state in one line ("Translating changes · Start it yourself"), the current one filled (`aria-current`), the two groups apart by a divider; without `?section` the first section that needs the merchant | Short page, every state still in view |
| The same stack on a phone | The sections as two cards of rows (icon tile, name, a summary of up to two lines, chevron); a chosen section opens alone under a 44 px back row "‹ Settings" | Phone-sized decisions |
| "AI characters" tile linking to the Plan page; tools without glossary and memory | "Plan & usage" (plan, this month's AI characters, the date new ones come, the way to the Plan page); "Tools" with six links including glossary and translation memory | Every page beside the settings in one place |

Behaviour kept: every action, toast and focus move; giving the permission moves on to "Translating changes"; switching keeps a choice being made and unsaved text (every section stays mounted; only `?section` changes, so the data isn't loaded again); the cards' old `#settings-*` addresses open their section; links from the Overview, editor, language and content pages open `?section=keys` or `?section=ai`. A job stopped for the permission, a key, the plan, the month's AI characters or a smart budget links to its fix with `?job=<id>`; once the cause is fixed there (`app/.server/jobs/back-to-job.ts`), the section, the smart page's card or the Plan page shows "Back to the job" as the page's one primary button.

Screenshots (German, 1,280 px at scale 1 and an iPhone 13): `UI_REVIEW_SCREENSHOTS=docs/ui-review/redesign3 pnpm test:ui tests/ui/ui-review-screenshots.spec.ts -g "settings-sections"` writes `settings-desktop.png` and `settings-phone.png`. They couldn't be taken where this was built (Polaris' script from Shopify's CDN wasn't reachable there); the browser tests run in CI.

## 3g. Buttons without the dark edge, the form of address as one row (owner request, 2026-11-03)

The owner, looking at Settings in the admin: the English flag was missing, and the buttons and the dark edges of the controls didn't look modern; every button of the app should be 10/10. Polaris' buttons (`s-button`) can't be styled (only variant, tone, icon and width), so the app's buttons are its own now:

- **`app/components/Button.tsx`** with **`app/styles/ui.css`**: a native `<button>`, or a link (React Router's Link inside the app, `window.open` for the admin's `shopify://` pages, a plain link otherwise), with s-button's props. Flat, a light 1 px edge instead of the dark bevel, a soft shadow, 10 px corners (12 px on touch screens), Inter 13 px semibold, 32 px high (44 px on touch screens), a 2 px blue focus ring, a spinner in the words' place while loading. Primary dark, secondary white, tertiary words only, critical red. 140 buttons on every page use it; the 19 that Polaris places itself (a dialog's actions, a banner's, the page's) stay the admin's.
- **The form of address** ("So schreibt die KI"): instead of a select per language, one row per language that has a choice, with a segmented choice ("DeepL entscheidet · Sie · Du", `app/components/Segmented.tsx`, native radio buttons); the languages without a choice in one line with their flags. All rows line up.
- **English's flag**: the United Kingdom's when the store's markets name no English-speaking country (`localeCountry`); Arabic and Chinese still show their code.
- **The chosen card** of a set (Settings' current setting, the Plan page's current plan): a 2 px blue ring with a light blue tint, the colour of its "Current" badge (`.lv-selected-frame`), instead of the dark ring.
- **When Linguva was last updated**: Settings' last line, quiet, under the sections (on a phone under the list): "Linguva zuletzt aktualisiert heute um 12:41 · Version 183028e", in the store's time zone (owner request, 2026-11-03).
- **Form fields keep Polaris' darker edge** (text fields, selects, the search): a field's edge is how it is recognised, so it needs a contrast of 3:1 (WCAG 1.4.11, non-text contrast); a button is recognised by its words and needs none.

Status: **Implemented; buttons and the segmented choice checked in a browser** (their CSS doesn't need Polaris). The pages around them are checked in CI (`visual.spec.ts`, new `settings-style`).

## 3h. Redesign 4: square buttons, one design system, every page (owner request, 2026-11-03)

The owner: "Raise everything to 10/10 in modernity, user experience, ease of understanding, icons and order, above all in Settings: square buttons." Asked what "square buttons" meant, the owner chose **square tiles above the content**: on a desktop every section of Settings a square button with a big icon, its name and its state in one row, the chosen one framed in blue and its section right under the row; on a phone a grid of squares that opens each section; inside a section the choices as equal tiles with icons. Before building, eight readers audited every page (modernity, UX, clarity, icons, order, buttons) against the CI screenshots; their findings are the work list of this redesign.

### Settings

| Before | After | Why |
|---|---|---|
| A 260 px nav card of text (name and a grey line) beside the section; no icons on a desktop, a list of rows on a phone | **Square tiles** (`SectionTiles`, `.lv-tile`): the section's icon in a tinted square, its name, its state in a few words, a dot in the state's tone where it needs the merchant. One row above the section on a wide page (the groups apart by a fine line, the current one framed in blue, `aria-current`), four in a row on a tablet, three in a row on a phone, where a tile opens its section alone under the 44 px back row | The owner's square buttons; every section recognisable by its picture, its state in view on every width |
| States cut at the end of a line ("Kurz nach dem Speichern · Braucht deinen Schl…"); everything grey | A tile says one state in up to two lines; one that needs the merchant ("Pausiert", "Nicht erlaubt", "Bitte prüfen") in its tone with a dot; long German words break at a soft hyphen ("Übersetzungs-/speicher"), "KI-" never ends a line | What is wrong is the part that was cut |
| Option cards that looked like information; three cards in 2 + 1 rows of different heights | Equally high **option tiles** with the feature's icon (the Plan page's: play-circle, automation, calendar-time, eye-check-mark, send, wand), an empty radio mark where one can be chosen, a chevron where choosing opens a page; the chosen way's details (shortly after saving's languages, the schedule's summary with Check now) in a panel under the choices | One look for "this is a choice", one place for its details |
| A gear for "Translating changes", a speech bubble for "How AI writes", a lock for "allow AI first", `connect` for a missing key | `automation`, `text-quote`, `shield-check-mark` (the lock means "not in your plan"), `key`; each section's heading carries its tile's icon | One icon per concept app-wide |
| Badges repeating the current option ("Mit Prüfung" beside "Erst prüfen"), "Aus" plus a line plus the option | No badge or line repeats the current option; the heading's badge only where it adds (On, Paused, Waiting, Stopped) | Calmer, nothing said twice |
| Status row "Änderungen übersetzen [Pausiert]" | A sentence in a tinted row: "Die automatische Übersetzung ist pausiert", the fix "Einstellung öffnen" | Says what is wrong |
| The browser's triangle on folds | A chevron that turns (`Disclosure`) | The one control that wasn't drawn like the rest |

Texts: publishing's scope in plain words ("wenn Linguva viele Texte auf einmal übersetzt"), "neue KI‑Zeichen am …", "Feste Begriffe im Glossar: 0 · Glossar bearbeiten", "Noch keine Sprache"; withdrawing the AI permission is a critical button; the permission section names what can't work first. The smart schedule's field groups showed their codes ("seo_title"); they use the Coverage page's names.

### One design system

`app/styles/ui.css` starts with the app's tokens (`--lv-font`, text and border colours, `--lv-radius-card` 12 px, shadows, `--lv-focus`, the chosen look `--lv-selected-*`) and a type scale (`.lv-h1` 22/28/700, `.lv-h2` 17/24/650, `.lv-h3` 14/20/650, `.lv-strong` 600, `.lv-figure`, `.lv-figure-row`, `.lv-caption`), because Polaris' `s-text` has no size and draws `type="strong"` at the body weight. Shared components: `IconSquare` (the one icon square, tinted by place; `IconTile` draws it), `Strong`, `Disclosure`. Each area keeps its own rules in its section of `ui.css`.

### Overview

| Before | After | Why |
|---|---|---|
| The store card first, the next step under it (on a phone about 670 px down) | **Next first**: on the left on a desktop, on top on a phone; every card a native section with its edge (`CARD`) | The page's one primary button on the first screen |
| Five heading styles, the most important section the smallest | One scale: `.lv-h1` for the page, `.lv-h2` for Next, Running now, the customers and the store card, `.lv-h3` for a step's title | Size follows importance |
| Bare 20 px step icons, three of them pointing elsewhere (a gear for the AI permission, `connect` for a key, a dashed circle for translating) | Each step's icon in a tinted square, the icon of the place it opens: `shield-check-mark`, `key`, `language-translate`, `chart-donut` (count), `eye-check-mark` (approve), `globe` (countries), `lock` (access) | Recognition by picture; nothing looks disabled |
| "Your store in 1 language" for English plus German | "Your store in 1 other language" / "Dein Shop in 1 weiteren Sprache" | The original isn't counted as a translation |
| "Shop neu zählen" with the outdated state's `refresh` icon, top right, far from its date | "Übersetzungen neu zählen" with `chart-donut`, beside "Zuletzt gezählt" in the store card | Says what is counted, next to when |
| "Ansehen", "… Auf Deutsch." | The language in the title ("1 Text auf Deutsch ist veraltet") and the button ("Deutsch öffnen") | Says where it leads |
| Two looks for the Countries · Languages switch | `SegmentedButtons` (Segmented's pressed-button mode, `.lv-seg`) with `globe` and `language` | One segmented control app-wide |
| After approving a plan: the Plan page, a dead end | `/app/welcome` lands on the Overview with the plan's success banner above Next (the Plan page only while Shopify doesn't report the plan active) | The first moment after paying leads on |
| A country's language states as badges, badges without icons or grey words | One badge with its icon per state: Hidden (`hide`), Not offered (`disabled`), Not set up (`minus-circle`), Original (`check-circle`) | One look per state |

### Content, a language's page, an area's list, Languages

| Before | After | Why |
|---|---|---|
| Grey squares and grey icons for every area | Each area has its tint (`CATEGORIES`; image descriptions and extra details take their products' blue) in the shared icon square, on Content, the language page, the list's header and the steps | The same place has the same picture and colour everywhere |
| The chosen language chip and filter a grey fill | The app's chip and pill with the chosen ring and tint (`.lv-lang`, `.lv-filter`); `aria-current` stays | One "chosen" look app-wide |
| A lone tile beside empty space | Rows always full: one card full width, two or three side by side, four as two by two | No half-empty rows |
| Image descriptions and extra details as their own step with "Ansehen" to a list without "Übersetzen" | Their open texts join their owner's step ("Produkte übersetzen – … dazu 3 Bildbeschreibungen"), whose Translate opens the dialog with "Auch Bildbeschreibungen und Zusatzinfos übersetzen" ticked | No dead end |
| A gate (no permission, plan, key) turned every step into "Ansehen" with a grey line | The gate is a step with its own button: "KI-Übersetzung erlauben" (`?section=ai`), "Schlüssel hinzufügen" (`?section=keys`), "Tarife ansehen" | The fix is the next step |
| Tier headings with filled 1/2/3 circles like the steps | Plain tier headings; steps carry an icon square instead of a number where the kind is clear | Numbers only where order matters |
| "34 % übersetzt" beside drafts "von der KI übersetzt" | "34 % fertig" (the state word); the steps-to-live strip only while texts wait, with state icons and semibold titles, "2 · Du gibst frei" | One word, one meaning |
| A small "Öffnen ›" on each list row; the name repeated in "Noch nicht auf Deutsch – Kunden sehen …" | The whole row opens the editor (a chevron at its end); the repeated line is gone | A bigger target, less text |
| The trail always "Übersicht › …" | "Inhalte › Deutsch › Produkte" when opened from Content (`?from=content`) | Back leads where the merchant came from |
| Languages as a technical table (code, role, "(RTL)") | One row per language like Content's chips: flag, visibility badge, bar and figure, the AI line, chevron; the main language first; a trail to Settings › Tools | Readable, one look with Content |

Words: "Bildbeschreibung" everywhere for alt text, the list's kind words in the previews (no "Tarifgruppe", "Richtlinie"), "Theme" for the theme, plural forms ("1 von 1 Text ist fertig").

### Review

| Before | After | Why |
|---|---|---|
| A bare ✕ for rejecting (read as "close") | "✕ Ablehnen" in words on every width; on a phone "Bearbeiten" at the start, "Ablehnen" and "Freigeben" together at the end | Says what it does |
| Questions answered with Polaris' dark-edged buttons | The in-card questions (reject, a new web address) answer with the app's buttons, with a spinner while the request runs | One button look |
| "Diese Übersetzung ablehnen? Das lässt sich nicht rückgängig machen." | Says what rejecting does: nothing changes in the store, Linguva won't translate the text again by itself while the original stays the same | No fear of the unknown |
| Approving a page with notes: one answer | A second answer: "Nur die 3 ohne Hinweis freigeben" | The safe, fast path |
| Deciding a long page meant scrolling back up | A decision bar at the bottom while the strip is out of view (count and both buttons) | The decision where the merchant is |
| "4 Übersetzungen auf dieser Seite" after deciding 2 of 6 | "Noch 4 von 6 offen" with a bar | Progress, not a stale count |
| Tabs by name only, the chosen one a grey fill | Visible languages first, the chosen tab semibold, "versteckt" in words, 44 px, a swipe row on a phone, a select above six languages | As Content's chips |
| A drawn tick for "Alles geprüft" | The green status row with one next step ("Deutsch weiter übersetzen") and the languages as tiles | As Settings' status row |

Hints in plain words: "Zu kurz für Google (…)", "Wie im Original – nicht übersetzt", "Falsche Schrift für diese Sprache", "Gib eine Webadresse ein.".

### Jobs

| Before | After | Why |
|---|---|---|
| The four filters applied only after "Suchen" (React 18 never sends `onChange` for a web component) | Filters apply at once (`onInput`, deduped with `onChange`) | **Bug fixed** |
| Tabs as words with a grey pill, cut on a phone ("Comple…") | Tabs as tiles: icon, figure, name; the chosen one framed in blue; five in a row, two rows on a phone; a dot on Problems only when one needs the merchant | The app's square buttons; nothing cut |
| Search and four selects always open on a phone (the first job far down) | The selects fold behind "Filter (n)" on a narrow card | The list first |
| A stopped job's page never refreshed; "Ansehen" as a finished job's one button | It checks again after the stop's time and when the tab returns; "Im Editor öffnen" goes straight to the editor when one item is left | Promises kept, one step |
| Stats between the problems and the hero; CSV and reference inside a closed fold | Hero → what needs you → stats (each with its icon) → details; the CSV button and an 8-character support reference with "Copy" outside the fold | The page in the order it speaks |
| A silent CSV download | A spinner, an error toast on failure | Feedback |
| "Hintergrundaufträge", "Wer gestartet hat", "mit Lücken" / "unvollständig" | "Linguvas Hintergrunddienst" (app-wide), "Gestartet von", "Zeitraum", "Abgeschlossen, teils unvollständig" | One word per thing |
| A green check for a store without jobs | "Noch keine Aufträge" with what to do and "Sprache auswählen" | Never "all done" for nothing done |

The attention card and the way back to a job are drawn as Settings' tinted status row.

### The smart schedule's page

| Before | After | Why |
|---|---|---|
| "How often" as a list of radio buttons; the days as seven checkboxes in a column | Five square choice tiles (native radios in a fieldset, icon, name, one line; the chosen one framed in blue), the chosen way's time, days, zone and next checks in a panel under them; the days as one row of seven square toggles | The owner's square buttons, the same as Settings' choices |
| A schedule the server refuses said so only after saving | It says why live where the next checks would be ("Checks need to be at least an hour apart."); after a refused save the field itself says so | The problem where it is made |
| "Retry" for every failed check | Only for what a new try can fix, with the count ("Try 3 items again"), otherwise "See in the job"; the last 3 checks show, the others fold | No button that can't help |
| Exclusions by kind and Shopify number ("Product 8123456") | By their title and picture (else the area's icon), the kind under the name | Says what is left out |
| "Only manually", "measure", budgets as bare numbers | "Only on demand" / "Nur auf Knopfdruck", "count", "At most per day / month" with "No limit" and a meter each; the next check as "today, 11:00 PM" | The app's words; the numbers as pictures |
| "Every day at 23:00" beside "Next check: today, 11:00 PM", the time choices as "23:00" in every language; Spanish "a las 1:00" | The schedule's times in the interface language's clock everywhere ("Every day at 11:00 PM", "Jeden Tag um 23:00"), the form's values unchanged; Spanish with its article ("Cada día a la 1:00", `clockRef`) | One clock per language |
| A bare h1; the schedule's sign only inside the card on a wide page | `PageHeader` with the schedule's sign (`calendar-time` violet, its choice in Settings), the card without a second one | Opens like every page |

### Plan & usage

| Before | After | Why |
|---|---|---|
| Grey signs; Free with `play-circle` (Settings' "Start it yourself"), Own key with `connect` | The page's rose (Settings' tile) on the hero, the four cards and Own key; Free `nature`, Own key `key`, a language outside the plan the lock, used up `alert-circle`; "In every plan" in the tints Settings gives the same icons | One icon and colour per concept |
| "Passt zu deinem Shop" as a badge plus a legend | Said in words for the store's own plan ("Your plan fits your store."), a smaller plan "For what your store uses right now, Starter is enough too." | One sentence instead of a code to learn |
| The questions and the comparison as browser folds, the current plan's column barely marked | The app's `Disclosure` rows; the current column in the chosen blue with "Your plan" in the ring's blue | One fold, one "chosen" look |
| A renewal at "1. Dezember" that comes on the evening before in the store's zone | "30. November um 19:00" where it differs; "Used today", "Today: N of M AI characters (daily limit)" | The date the merchant will see it |
| The trail to the Overview | Back to Settings' "Plan & usage" (`?section=plan`), a 44 px back row on a phone | Back leads where the merchant came from |

### The editor

| Before | After | Why |
|---|---|---|
| The name and a grey line; back always to the old Products list | The area's list it came from ("‹ Products", "Products in German"), the item's picture or the area's icon, the name as h1 and what is open ("In German · 3 of 5 texts to translate") | Where am I, what is left |
| A list of fields | One square tile per text (Settings' `.lv-tile`) with its state's icon and word, moving the focus to the text; three in a row on a phone | The owner's square buttons as the editor's map |
| "Translate with AI" and "Fill from memory" over every text, also the merchant's own | They work on the open texts only (missing or outdated), their count in the button; with nothing open "Translate everything again" asks first | A click never overwrites the merchant's work |
| A red "Remove" under every text; HTML as code | A quiet delete icon; HTML drawn like Review, "Edit HTML" opens the code beside the original's with a live preview; history in the app's fold with "Restore this version" | Calmer, one look with Review |
| Image descriptions and extra details saved apart | Filled by the one AI button, counted in the save bar and published by the one "Publish translations" | One publish |

### Tools (glossary, memory, coverage, countries & markets, import & export)

| Before | After | Why |
|---|---|---|
| Each page its own top | `ToolHeader`: the trail Settings › Tools (a 44 px "‹ Tools" row on a phone), the tool's icon in its Settings tile's tint, the h1 and one line on what the page is for | Every tool opens the same way |
| Free and Starter filled the glossary's form and learned at "Add" that it is Pro's | The lock first (Pro and Business, "See plans"), every control disabled; the three rules as tiles with their icons; the form starts over after adding, with a toast; a search from 8 terms; one "As a CSV file" card, replacing every term only after a critical question with the count | No work that can't be saved |
| German "prüfen" for counting and for approving | Counting is "zählen" everywhere ("Shop zählen", "Zuletzt gezählt"), "prüfen" only for approving | One word, one meaning |
| Coverage's "Translate" started a job at once | It asks first (what gets translated by state, approval or live, own translations stay, the AI characters left; `CoverageConfirm`), as the language page does | No surprise jobs |
| Markets: the markets first, the checks at the end, emoji flags; the export's language select ignored (always the first language) | The checks first with their fix, flags, the markets folded; the select reacts (**bug fixed**, React 18 sends no `onChange` for a web component); import & export as three numbered steps | What needs the merchant first |

### Every page opens the same way

`PageHeader` gives the five menu pages, the Plan page and the smart schedule's page the header a tool, an area's list and the editor have: the page's icon in its tinted square (Overview `home` blue, Content `content` teal, Review `eye-check-mark` violet, Jobs `clipboard-checklist` slate, Settings the gear, Plan `gauge` rose as its Settings tile, the smart schedule `calendar-time` violet as its choice), the h1 and one line under it; Languages takes the tools' header (`language` blue, back to Settings › Tools with the phone's 44 px row). The editor is one stack like every page: s-page spaces only its own sections, so on a desktop its header, its tiles and the texts' cards touched. The AI permission is "KI-Übersetzung" / "AI translation" everywhere (the editor, the lists, Coverage, the job stops), and a job stop names the real place of its fix ("Einstellungen" → "Tarif & Nutzung", "KI-Erlaubnis").

### Reviewed before it ships

The whole diff (`2408af1..HEAD`) was reviewed in six slices (Settings and the smart schedule; Overview, Content and languages; Review and Jobs; the editor; the tools and the Plan page; the stylesheet and the texts), each finding checked by a second reviewer who tried to refute it against the code. 39 findings held and are fixed, each fix reviewed again; among them a merchant on a schedule paused for a new main language had no Save to lift it, a ticked "still correct" box in the editor wasn't published when nothing else changed, typed texts were forgotten after a memory fill, and the export's next part could start in another language. CI's browser found what the readers couldn't: duplicate headings (a Polaris section's hidden label beside the visible one), button names that didn't contain their visible words, and two timing problems in specs.

Status: **Implemented; checked in CI's browser** (screenshots `overview`, `products`, `editor`, `review-empty`, `glossary`, `settings`, `settings-style`, `plan`, `plan-none`, `language`, `category`, `content`, `jobs-completed`, `job`, `smart`, `smart-schedule`, `memory`, `coverage`, `markets` and `transfer`, desktop and phone, regenerated by `visual-baselines.yml` and looked at). Open: "Fits your store" as a band on the plan card's edge (owner decision 6.15); the French and Spanish texts for a native speaker (docs/I18N_REVIEW.md).

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
| Content page (Redesign 2) | `tests/ui/content.spec.ts`, `pages.spec.ts`, `i18n.spec.ts`, `touch.spec.ts`, `csp.spec.ts`, `visual.spec.ts` (content); `tests/integration/content-page.test.ts`, `content-hub.test.ts`, `resource-list.test.ts`; `tests/unit/content-areas.test.ts`, `content-language.test.ts` |
| Review (Redesign 2) | `tests/ui/review.spec.ts` (26 tests, desktop and phone), `confirm.spec.ts`, `keyboard.spec.ts`, `preview.spec.ts`, `states.spec.ts`, `visual.spec.ts` (review-empty); `tests/integration/review-cards.test.ts`, `review-previews.test.ts`, `review-protection.test.ts`; `tests/unit/review-areas.test.ts`, `review-cards.test.ts`, `review-hints.test.ts`, `text-box-height.test.ts` |
| Plan page with prices | `tests/ui/plan.spec.ts`, `tests/unit/plan-components.test.ts`, `plan-view`, `plan-features`, `plan-prices`; `keyboard.spec.ts`, `pages.spec.ts`, `flows.spec.ts`, `visual.spec.ts` (plan, plan-none) |

## 5. Design system rules kept

- Polaris web components and App Bridge only; no CSS framework or icon set added. Custom drawing only where Polaris has no component (segmented coverage bars, length bars), with the same information as text for screen readers.
- One colour source for coverage and progress: `STATE_COLOURS` and `TRACK_COLOUR` in `app/components/Coverage.tsx` (the progress bar and SEO length bar use them), and `MARK_COLOUR` there for numbers marked in Review's notes.
- Emphasis: `s-text type="strong"` draws at body weight, so a name or lead phrase that must stand out is set inline at 600 (650 for Review's text names), never with a new font or colour (§3d).
- Numbers that are compared down a column use tabular figures; a large standalone figure (the Overview's headline numbers) keeps proportional ones.
- Country statuses use their own status colours (`app/components/CountryStatus.tsx`), always next to their label; the bar itself is hidden from screen readers because its key says the same.
- Every page: one primary action at most per section; navigation as links, actions as buttons.

## 6. What still stands between this and a genuine Premium 10/10

1. **Seen in the real admin**: App Bridge title bar, navigation, save bar, toasts and modals inside Shopify, and the Shopify mobile app (checklist U, V). Not done.
2. **The competitor-based specification** (pending, owner): layout decisions for items 14–16 and 18 wait for it.
3. **Real merchants**: no usability session yet.
4. **Native-speaker review** of French and Spanish (I18N_REVIEW.md).
5. **Real catalog sizes**: the scan of the real dev store took 16 s for 34 API pages on an almost empty store; the per-type sequence should be measured on the fictional catalog and, later, a large store, before the progress UI can be called finished.
