# UI/UX review and premium improvement plan (phase J)

Status 2026-10-28. Everything here is **Tested Locally** (production build, simulated Shopify, Playwright). Nothing in this document is verified inside the real Shopify admin yet; that is checklist U and V in DEV_STORE_VERIFICATION.md §3.6–3.7.

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
