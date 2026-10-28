# Phase J: verification on the development store

Store: **linguva-test-lab.myshopify.com** (organization "Mein Shop", Partner development store). Never KARINEX or SOFTWAREFACH; the live tests refuse those names and any store that isn't a Partner development store.

This runbook turns each check into recorded evidence. A check counts as **Verified on Shopify** only when it was performed on this store and its outcome is written in the results log (DEV_STORE_TEST_PLAN.md §3) with the evidence named: command output, a screenshot file, or a note of what was seen. Until then it stays "Tested Locally".

Rules for every session:

- No paid AI: `TRANSLATION_PROVIDER=mock` and no DeepL key in `.env` (the mock writes "[fr] …"-style text). A DeepL key only after the owner's explicit approval.
- No production store, no deployment, no merge of PR #1, no purchases.
- Never paste tokens, keys or `.env` contents into chats, issues or screenshots.
- Test content is fictional (recipe in §2). No real customer data.

## 0. Status before phase J

| Item | Status | Evidence |
|---|---|---|
| Development store `linguva-test-lab.myshopify.com` in "Mein Shop" | Exists | Owner report, 2026-10-28 |
| Shopify CLI link, PostgreSQL, Redis, migrations, `pnpm preflight` | Working on the owner's machine | Owner report, 2026-10-28 |
| Linguva opens as an embedded app in the Shopify admin | Seen by the owner | Owner report, 2026-10-28 (A1 partly: install and first open; details in §3) |
| Commit `0904246`, all 21 migrations applied, preflight passes, worker starts with the mock provider (launched by Shopify CLI) | Working | Owner report, 2026-10-28 |
| First live test runs (`LIVE_TARGET_LOCALE=de`, then `fr`) | **Not run**: stopped with `LiveTestRefused` because the store had no additional language; all 20 tests skipped. Nothing verified | Owner report, 2026-10-28. Since then: the setup check names the problem and the fix once, instead of skipping every suite (§4) |
| French added as an additional, **unpublished** language; English primary | Done | Owner report, 2026-10-28 |
| Read-only live run (`pnpm test:live`, app session, French) | **Passed**: 2 files, 7 passed, 13 skipped, 0 failed, 31.65 s | Owner report, 2026-10-28; details in §0b |
| Everything else (writing, publishing, bulk, automation, UI in the admin) | Not yet performed on the store | — |

## 0b. Verified on the store: read-only live run, 2026-10-28

The owner's run against linguva-test-lab with French unpublished. Exact figures as reported:

| Measurement | Result |
|---|---|
| Test files | 2 passed |
| Tests | 7 passed, 13 skipped, 0 failed |
| Duration | 31.65 s |
| Coverage scan | 34 Shopify API pages in 16,003 ms |
| Linguva's coverage figures against the independent recount of Shopify's data | Equal for every recounted type |
| Dashboard summary query (local database) | 8 ms |
| Items page query (local database) | 2 ms |
| Products | 0 |
| Collections | 1, 2 fields, both missing |
| Pages | 2, 5 fields: 2 complete, 3 missing |
| Blogs | 1, 2 fields, both missing |
| Blog posts | 0 |
| Product images | 0 |
| CSV import | Not exercised: no product title to import (the store has no products) |

**What this verifies on Shopify (read-only):**

- The dev-store gate and the read-only guard work against the real store; an unpublished additional language is accepted as the target.
- The app's own expiring offline session reads the Admin API 2026-10.
- `translatableResources` for collections, pages and blogs: GID types, 64-character digests, field keys as Linguva expects.
- The content-type probe across all translatable types completes and every GID it lists round-trips through the editor's URL reference.
- The coverage scan over every type completes without a failed or unfinished type, and its complete/outdated/missing counts equal an independent recount for products, collections, pages, blog posts, blogs and product images (on this small store: 9 fields with an original, 2 of them translated).
- Kept counts equal counts rebuilt from the stored items.
- The product CSV export runs against the real API (0 rows, equal to the recount).

**Observation:** 2 page fields already had a French translation right after French was added; Linguva didn't write them (it has never published on this store). Whoever wrote them (Shopify, a theme or another app), Linguva counts them as complete and treats them as translations made outside Linguva, which bulk translation keeps unless replacing is explicitly allowed. Please note in the log which pages they are, if you look.

**What it does not verify:** anything with products, blog posts or images (the store has none, so those checks had nothing to check), the CSV import, any write to Shopify (publishing, removing, restoring, digest refusal, outdated detection after a change, protection of translations made outside Linguva), bulk jobs, automatic translation and webhooks, Markets (most likely the one read-only test that skipped itself: the app has no `read_markets` access), the interface inside the admin, and the scan time on a real catalog.

**Changes after this run** (so the next run says plainly what it couldn't check):

- A check with nothing to check now reports **skipped with the reason** instead of passing: the image alt text check on a store without images. On the unchanged store the same run now shows 6 passed, 14 skipped.
- The CSV check exports **every type with titles** (products, collections, pages, blog posts, blogs), compares each with the recount, and imports the first missing title it finds as a draft. On the unchanged store that is the collection title. The draft is rejected again at the end, so the next run starts clean.
- The live suites run in CI against a simulated store shaped like this one (§4.4), so a mistake in a live test shows up before a store run. The rehearsal reproduces the figures above exactly.

## 0a. Fixed before the first store run

| Defect | Effect on a real store | Fix and evidence |
|---|---|---|
| A missing optional scope thrown by Shopify's library (not returned in the response, as the simulated store did) wasn't recognised by the coverage scan | First scan fails as a whole at the first type without access (for example Menus) | Recognised in both forms; regression tests failed before the fix, pass after (QUALITY_AUDIT.md §4j) |
| A type that keeps failing ended the whole report | One bad type hides every type after it | Type marked "scan didn't finish", the others scanned (worker test) |

## 1. Terminal setup (owner's machine)

Run from the project folder. Commands print no secrets.

### 1.1 Update to the latest branch (once per session)

```bash
git fetch origin
git checkout claude/gallant-pasteur-8opy75
git pull --ff-only
pnpm install
pnpm db:migrate          # applies new migrations (phase I added the coverage tables)
```

### 1.2 Safety check of `.env` (no values printed)

```bash
grep -E '^TRANSLATION_PROVIDER=' .env                        # expect: TRANSLATION_PROVIDER=mock
grep -cE '^DEEPL_API_KEY=.+' .env                            # expect: 0  (no key set)
grep -cE '^NODE_ENV=production' .env                          # expect: 0
grep -E '^SHOPIFY_DEV_STORE=' .env                            # expect: SHOPIFY_DEV_STORE=linguva-test-lab.myshopify.com (optional)
pnpm preflight                                                # expect: no ✗; "Translation provider: mock (no costs, marked pseudo-translations)"
```

If the first line shows `deepl`, change it to `TRANSLATION_PROVIDER=mock` before continuing.

### 1.3 Three terminals

| Terminal | Command | Keep running | What to watch |
|---|---|---|---|
| T1 app and worker | `pnpm dev` (choose linguva-test-lab when asked) | Yes | Requests and errors; the preview URL; the worker's `"worker started"` line, job progress |
| T2 evidence | `pnpm ops:coverage-check --shop linguva-test-lab.myshopify.com` | Run after steps | Figures, scan state, ✓ consistency line |
| T3 live tests | see §4 | Run when asked | The setup line, pass/fail, the printed summary |

**The worker:** on the owner's machine Shopify CLI starts the worker together with the app (a worker web configuration). Check once that `pnpm dev`'s output contains the worker's `"worker started"` line (with `provider: "mock"`). **Don't also run `pnpm worker:dev`**: two workers would take jobs from the same queues (no wrong results, but twice the Shopify API use and confusing logs). Only if the line is missing, start it yourself in another terminal with `pnpm worker:dev`.

PostgreSQL and Redis must be running (`pnpm db:up` with Docker, or your local services).

## 2. Test catalog recipe (fictional, about 20 minutes, once)

In the store admin (Settings → Languages): add **French** and leave it **unpublished** (customers don't see it; Shopify still stores its translations, so every check works with it). French is the working language of these checks; where a step below says "French", use whichever additional language you added. Optional later: a second language published (for example German) to check that only published languages count in the whole-store figure, and Arabic for right-to-left.

**Products, in one step:** Products → Import → choose [`docs/dev-store/demo-catalog-products.csv`](dev-store/demo-catalog-products.csv) → Upload and preview → Import products. It adds 8 fictional outdoor products (title, HTML description, URL handle, SEO title and SEO description each), tagged `linguva-demo` (filter Products by that tag to find or delete them all). The columns follow Shopify's current product CSV template, where only Title is required; this file has not been imported on a real store yet, so if Shopify's preview reports a problem, send the message and create the products by hand. The same catalog is used by the live test rehearsal and the App Store screenshots.

Then add by hand:

| What | How many | Details to include |
|---|---|---|
| Product images | 2 products | Merino Wool Sweater and Waterproof Hiking Jacket: one image each (any photo of your own) with alt text |
| Product metafields | 1 product | Settings → Custom data → Products: a single-line and a multi-line text field (translatable by default); fill both on the Merino Wool Sweater |
| Collections | 1 more | "Winter essentials" with a description, SEO title and an image with alt text; add 3 demo products (the existing "Home page" collection stays as it is) |
| Pages | keep the 2 | Already there |
| Blog posts | 2, in the existing blog | Excerpt (summary) on one post, featured image with alt text |
| Menu | Main menu | Default items are fine (needs the optional navigation scope when Linguva asks) |
| One "human" translation | 1 field | With Shopify's free **Translate & Adapt** app: translate one product title into French by hand (for the overwrite-protection checks) |

Record the counts you created in the results log: they are the expected values for the coverage checks.

## 3. Checklist

Each line: do it, then write Pass / Fail / Blocked with evidence in DEV_STORE_TEST_PLAN.md §3. IDs refer to DEV_STORE_TEST_PLAN.md §1.

### 3.1 Authentication, install, permissions (A, J, K7)

- [ ] **A1** Open Linguva from Apps: Overview loads inside the admin without a second login; reload the page (stays logged in); open in a new tab from the admin.
- [ ] **A2** T2 shows the shop (`pnpm ops:coverage-check …` prints "Shop linguva-test-lab…", not "isn't installed").
- [ ] **A3** Uninstall Linguva, reinstall from the preview URL: opens again; jobs of the old install are cancelled (Jobs page).
- [ ] **J1/K7** Coverage → a "No access" row (for example Menus) → "Allow access" → Shopify's permission screen → approve → back in the app; rescan → the row is counted.

### 3.2 Coverage dashboard (K1–K11)

- [ ] **K1a** Coverage → "Scan store". T1 (worker) shows coverage pages; the page shows progress, then "Last full scan". Note the duration from T2 ("Last scan: COMPLETED, N items, S s").
- [ ] **K1b** Compare with your catalog: Products row "x of y" where y = fields with text (titles + descriptions + SEO fields; URLs shown separately). T2 lists the same numbers per type.
- [ ] **K1c** Run the live check (§4.1): it scans the store again and compares Linguva's numbers with an independent recount of Shopify's data. Paste its summary into the log.
- [ ] **K3** "Translate missing" on Products (French) → job page; T1 (worker) shows items; the dashboard shows the job with progress; the remaining time appears only after about 10 items and 30 seconds.
- [ ] **K4** Review → approve one French draft → back on Coverage: Products' complete count +1 **without rescanning**; reject one → stays missing. T2: ✓ consistency line.
- [ ] **K5** In Shopify, change the English title of a translated product and save → within about a minute (webhook + 30 s delay) the field shows "Outdated" in Coverage → Show items. T2 `--webhooks` lists `PRODUCTS_UPDATE … PROCESSED`. Note the delay.
- [ ] **K6** Change a page's text in Shopify → not changed in Coverage until "Rescan store" (pages have no webhook); after the rescan it is outdated.
- [ ] **K8** French (unpublished) has a card marked "Not published" and is not in the whole-store figure; with French as the only additional language, the whole-store card says no translated language is published yet. (If you also publish a second language: only that one counts in the whole-store figure.)
- [ ] **K11** Theme content rows say "Not in the totals".
- [ ] **K-ui** Click a state in a language card (for example "Missing") → the exact items; filter by field and state; search a product title; next page (if more than 50).

### 3.3 Import and export (K2)

- [ ] **K2.1** Import & export → French, Products, only missing → "Download CSV" → open in a spreadsheet: no formula warnings; columns as described on the page.
- [ ] **K2.2** Fill 3 translations, save as CSV (UTF-8), import → "3 translations wait on Review"; nothing changed in the store yet (check the storefront or Translate & Adapt); approve on Review → live.
- [ ] **K2.3** Export again, change one product's English title in Shopify, import a filled row for it → listed as "The original changed since the export".
- [ ] **K2.4** Live check §4.1 includes an export of all products compared with the recount and a draft-only import.

### 3.4 Translation flows (C, D, I)

- [ ] **C1** Products → a product → French: original and translation side by side; "Translate with AI" (mock) fills a draft; edit; Save → the admin's save bar appears while editing; after saving, reload: the value comes from Shopify.
- [ ] **C-col/page/blog** The same for a collection, a page, a blog post and a blog.
- [ ] **D1** SEO title and description: length checks and the search result preview; save.
- [ ] **I1** Product with images: alt texts listed, translated, saved; Coverage → Product images complete +1.
- [ ] **I4** Product with metafields: listed by their names; translate and save; Coverage → Product custom fields complete +1.
- [ ] **E4** Bulk "Translate all" for Products into French: the title you translated with Translate & Adapt is **kept** (protected), the job report counts it as kept.

### 3.5 Webhooks and automatic translation (P)

- [ ] **P1** Settings → Automatic translation on for French, "Review first". Edit a product description and save → about a minute later Jobs shows an "Automatic" job, Review a draft, nothing published. T2 `--webhooks` shows the delivery and the automatic job.
- [ ] **P2** Save the same product three times within a minute → one item.
- [ ] **P3** The hand-written title (Translate & Adapt) stays after changing the English title.
- [ ] **P5** Automatic translation off → saving queues nothing.
- [ ] **N1** Uninstall → T2 `--webhooks` shows `APP_UNINSTALLED PROCESSED`. (Run it right after uninstalling: the shop's data is removed later by `shop/redact`.)

### 3.6 Polaris and App Bridge inside the real admin (U, new)

- [ ] **U1** Navigation menu (left in the admin) lists all Linguva pages; the current page is highlighted.
- [ ] **U2** Save bar: change a field in the editor → Shopify's save bar at the top; Discard restores; leaving with changes asks first.
- [ ] **U3** Toasts after save, approve, import; modals for reject and replace confirmations.
- [ ] **U4** Loading bar during page changes; no white flashes; no layout jumps on Coverage while it refreshes.
- [ ] **U5** Browser console (right-click → Inspect → Console) on Overview, Coverage, Editor, Review: no red errors, no CSP violations. Note any message text.
- [ ] **U6** Admin language German (your user profile → Language): Linguva switches to German.

### 3.7 Mobile, accessibility, visual quality (V, new)

- [ ] **V1** Shopify mobile app (iOS/Android) → Apps → Linguva: Overview, Coverage, Editor, Review usable without sideways scrolling; buttons easy to tap.
- [ ] **V2** Desktop browser at 375 px width (DevTools device toolbar): same pages.
- [ ] **V3** Keyboard only: Tab through Coverage and the editor; focus always visible; Enter activates.
- [ ] **V4** Screenshots for the design review: Overview, Coverage (whole store + one language), Coverage items, Editor, Review, Import & export, each desktop and phone. Remove the store name and email before sharing; send them in the chat or attach them to the PR.

### 3.8 Isolation and protection (S)

- [ ] **S1** In the editor, change an image or metafield id with DevTools before saving → refused; nothing written elsewhere.
- [ ] **S2** Optional, needs a second development store: install Linguva there; neither store shows the other's coverage, drafts, glossary or jobs.

## 4. Automated checks against the store

The live tests use a **separate test database** (`linguva_test`), never your app data. Before any test, one setup check runs and prints one line, for example:

```
Live tests against linguva-test-lab.myshopify.com (Partner development store), target language fr (unpublished), read-only: Shopify mutations are refused.
```

It stops the run with one clear message (no failed suites) when: the store isn't the configured Partner development store; the store has no additional language (the message links to Settings → Languages); `LIVE_TARGET_LOCALE` names a language the store doesn't have (the message lists the ones it has); or the app's stored token has expired (open Linguva once, then run again). `LIVE_TARGET_LOCALE` is optional: without it the store's first additional language is used, unpublished is fine.

**Read-only by construction:** without `LIVE_ALLOW_WRITES=yes`, the live tests' Shopify client refuses every GraphQL mutation before sending it (unit-tested), so a read-only run cannot change the store even through a mistake in a test.

### 4.1 Read-only (uses the Linguva app's own session; no extra app needed)

Requires that Linguva was opened on the store with `pnpm dev` running, recently: Linguva uses Shopify's expiring offline tokens, renewed when the app is opened (the setup check tells you if the stored one has expired).

```bash
LIVE_SHOPIFY_SHOP=linguva-test-lab.myshopify.com \
LIVE_USE_APP_SESSION=yes \
pnpm test:live
```

Add `LIVE_TARGET_LOCALE=fr` to pick the language explicitly.

What it does, read-only on Shopify: the API contract checks; a full coverage scan compared with an independent recount (products, collections, pages, blog posts, blogs, product images); kept counts versus counts rebuilt from items; timings; a CSV export of every type with titles compared with the recount; an import of the first missing title into a draft in the test database (Shopify unchanged; the draft is rejected again at the end). A check that needs a scope the app wasn't granted, or content the store doesn't have yet (images), is reported as **skipped with its reason** (`--reporter=verbose` shows it), never as passed. Copy the printed summary ("Coverage scan of …", "CSV export …", "CSV import …") into the log.

Expected on the store as of 2026-10-28 (no products): 6 passed, 14 skipped. After the catalog of §2: 7 passed (image alt text checked), 13 skipped (12 fixture-write tests, Markets).

### 4.2 With fixture writes (optional; needs the "Linguva live tests" app, DEV_STORE_SETUP.md §2)

Creates a **draft** product and an unpublished collection named "Linguva live test …", tagged `linguva-live-test`, writes translations only to them, and deletes them afterwards.

```bash
LIVE_SHOPIFY_SHOP=linguva-test-lab.myshopify.com \
LIVE_SHOPIFY_CLIENT_ID=<from the Dev Dashboard> \
LIVE_SHOPIFY_CLIENT_SECRET=<from the Dev Dashboard> \
LIVE_ALLOW_WRITES=yes \
pnpm test:live
```

Type the two values only in your terminal (or a local `.env.live` you `source`), never in chat. Adds: digest-checked publishing, outdated detection, protection of translations made outside Linguva, history and restore, and "an approved imported draft turns complete in coverage".

### 4.3 Evidence after any manual step

```bash
pnpm ops:coverage-check --shop linguva-test-lab.myshopify.com              # all languages
pnpm ops:coverage-check --shop linguva-test-lab.myshopify.com --lang fr --type PRODUCT
pnpm ops:coverage-check --shop linguva-test-lab.myshopify.com --webhooks   # + deliveries and jobs
```

Read-only; prints counts and statuses, never store text. Exit code 1 if the kept counts differ from the items (that would be a defect: please send the output).

### 4.4 Rehearsal (no store; runs in CI)

```bash
pnpm test:live:rehearsal
```

The same live suites, client and guards, with `fetch` answered by a simulated store in two shapes: linguva-test-lab as measured on 2026-10-28, and the same plus the catalog of §2. Any request to another host fails, so nothing leaves the machine. It checks the live tests themselves, not Shopify: a rehearsal pass is never evidence for "Verified on Shopify".

## 5. Comparing with Langify and Transcy (optional, evidence only)

Claims about competitors come only from their public listings (COMPETITIVE_ANALYSIS.md) or from a test you ran. If you want a hands-on comparison, it needs your approval because it installs third-party apps on the development store (free on development stores; don't accept any charge). Protocol, same store and catalog for each app:

| Task | Measure |
|---|---|
| From install to the first French product title translated | Minutes, clicks, did anything go live without approval? |
| See what is still untranslated in French | Can you find it? How many clicks? Exact items? |
| Translate all products, then review before going live | Possible? What was published automatically? |
| Change an English description; does the app notice? | Shown as outdated? After how long? |
| Export and re-import translations | Possible? Safety checks? |
| A hand-written translation: is it kept by bulk translation? | Kept / overwritten |

Record the results in COMPETITIVE_ANALYSIS.md §2 with the date; only then can the listing or the help center mention a difference.

## 6. What to send back after a session

1. The filled results log rows (DEV_STORE_TEST_PLAN.md §3), or the checklist with Pass/Fail per ID.
2. The live test output (§4.1: the setup line and the summary) and T2 output after K4, K5.
3. Screenshots (V4), with store name and email hidden.
4. For every failure: the ID, what you did, what you expected, what happened, and the console or terminal error text (no tokens).
