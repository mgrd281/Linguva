# AI translation engines: DeepL, Microsoft Azure, Google Cloud

Linguva translates with **DeepL** and, when the owner sets them up, **Microsoft Azure AI Translator** and **Google Cloud Translation** as further engines. With only DeepL configured (KARINEX production today) nothing changes: `getTranslationProvider()` returns exactly the `DeepLProvider` / `DeepLKeyPool` it returned before engines could be combined, every text, consent version, ledger row and log line stays the same (`tests/unit/provider-index.test.ts`, `tests/unit/public-pages.test.ts`, the unchanged visual baselines).

Code: `app/.server/providers/` (`deepl*.ts`, `azure.ts`, `google.ts`, `google-auth.ts`, `html-transport.ts`, `engine-http.ts`, `engine-router.ts`, `engines.ts`, `engine-status.ts`, `index.ts`), configuration in `app/.server/lib/config.ts`, consent in `app/.server/settings/ai-consent.ts` and `shop-settings.ts`, charges in `app/.server/usage/engine-charge.ts`.

## Engines and order

- Order: **DeepL → Microsoft Azure → Google Cloud**, configured engines only. `TRANSLATION_ENGINES` (commas or spaces) picks which are used and the order of Azure and Google; **DeepL, when used, is always first** (listed later, it is moved to the front with a warning). So the legal and settings texts ("only if DeepL can't translate them…") are true by construction.
- One engine in use: that engine's own object (no router). Two or more: `EngineRouter`, whose `id` is the first engine (so existing `provider.id` uses stay a real engine id) and whose `label` (`deepl+azure+google`) appears only in logs and the worker heartbeat.
- DeepL's several keys stay a pool inside the router: key failover first, then engine failover.

## Routing

- **Consent filter first:** a request uses only the engines the shop's AI consent covers (`request.engines`, from `consentedEngines(settings)`). No list or an empty one: nothing is called (`CONFIGURATION`, fail closed). Exactly one allowed engine (a DeepL-only consent on a multi-engine deployment): that engine's own call, unchanged: no language pre-check, no rests, no error wrapping, no signal.
- **Per-language support:** each engine's own language list (DeepL `/v2/languages`, Azure's documented global `/languages` URL without a key, Google `languages` / `supportedLanguages`), each cached for a day, asked lazily in order (a DeepL success never reads Google's list). A list that can't be read counts as "unknown": the engine stays a candidate and the adapter sends a guessed code.
- **Failover** (the whole request goes to the next engine): quota used up, credentials refused, outage (network, timeout, 5xx, malformed answer, after the engine's own 3 retries), a language the engine doesn't offer, a segment too large for it.
- **Rate limits never switch engines** (DeepL 429/529, Azure 429xxx, Google's rate-limit reasons, also as 403; only retryable errors count, `isRateLimit`): the error goes back to the queue, which waits; the same engine serves the language afterwards. One job's language isn't split across engines under normal bulk load. Google reports every rate quota as `RATE_LIMIT_EXCEEDED`; a **per-day** limit (`ErrorInfo.metadata.quota_limit` containing `PerDay`, reset at midnight Pacific) and a used-up quota answered with HTTP 429 are **quota**: Google rests and the request fails over.
- **Rests** (per process, by engine id, like the DeepL key pool): quota 1 h; refused 6 h (Google's token endpoint refusing the signed assertion: 1 h, usually clock skew); outage 2 min doubling to 15 min per consecutive outage (a circuit breaker; failures of requests that were already running when the engine was rested count as the same outage); "language refused although listed" 24 h per (engine, source, target). A success clears the engine's rest, whatever its kind, and its outage count, unless another request rested it while that call was running. Resting engines are skipped; if nothing else works, engines resting for quota or auth are tried again (a limit may have been lifted), and an outage-resting engine is still reached when it is the only one for the language. A language list that can't be read isn't asked again for 5 minutes (a hanging host doesn't hold every job item). The planned engine of a job item, a discovery page or a smart plan skips an engine that refused the pair, as the translation does.
- **Total failure:** one error with every engine's partial bill attached, chosen by precedence retryable > a segment too large for an engine that serves the language (it wasn't resting) > quota > auth > the rest, so a job retries while any engine is only down, an item too large for the engine still serving the language fails alone (`PROVIDER_REJECTED`), and the job stops with `PROVIDER_QUOTA` / `PROVIDER_AUTH` only when no engine is left for the language. That stop is **per language**: while another consented engine still works (it serves the shop's other languages), the error is marked `scope: "language"`; the job stops, but automatic and smart translation don't pause for the whole shop. Only when every consented engine rests for quota or auth is the shop-wide pause applied, as with DeepL alone. A language no allowed engine offers fails per item with `PROVIDER_REJECTED`, as DeepL's 400 did.
- **Request scope:** one request (one resource's pending segments in a job, one editor action) is translated completely by one engine. Across requests a job's language can move between engines when one is down or used up.
- **Stop and deadline:** jobs pass a signal aborted by a cancel poll (every 10 s while the call runs), the worker's shutdown, or 180 s; the editor passes the request's signal and 60 s. The router checks it before each engine and never passes it into one (aborting an engine mid-request would lose what its earlier batches billed). With a bare provider no poll starts and no signal is passed: DeepL-only behaves as before.

## What each engine applies

| | DeepL | Microsoft Azure | Google Cloud |
|---|---|---|---|
| Form of address (`formality`) | yes, for DeepL's formality languages (`app/lib/formality.ts`) | no | no |
| Context (title, store description) | yes, not billed | no (never prepended to the text: it would be translated and billed) | no |
| Markup | XML (`<g id>`, `<x id/>`) | HTML transport | HTML transport |

A result from an engine that couldn't apply a chosen form of address carries `FORMALITY_NOT_APPLIED` (a warning): it is never published automatically and waits in Review. Settings shows "Translated with {engine}: no choice" for a formality language another engine serves (with Azure or Google as the only engine: every language), and "If DeepL can't translate, another service steps in…" when DeepL and another engine are in use and a form (formal or informal) is chosen for a language DeepL serves ("DeepL decides" sends none, so nothing waits). Without DeepL, the store description's hint says the services in use don't read it.

## Markup on the HTML engines (`html-transport.ts`)

Segments with inline codes go in HTML mode as `<span id="lgN">…</span>` / `<img id="lxN"/>`, segments without codes as plain text (plain text containing `<mstrans:` goes escaped in HTML mode, so it can't steer Azure's dynamic dictionary). The decoder pre-tokenises stray `<` and `&`, parses with parse5 and accepts only our codes; anything else **fails closed**: the segment becomes an unmappable marker, the field is refused with reason `ENGINE_MARKUP` ("The translation service couldn't keep the formatting"), never published, and tried again once another engine is planned for the language (`pendingDraftDigests(…, { engine })`). A lost word separator next to a code (`Kaufe<g>zwei</g>jetzt`) is kept as written with the warning `SPACING_CHANGED` (waits in Review; no silent fix, German compounds legitimately lose the space); a placeholder (a protected term, URL, e-mail, Liquid code, an image) counts as a word, so one lost side is enough (`Kaufen Sie <x/>heute`). Also refused: a group the engine self-closed (`<span id="lg1"/>`) or left unclosed (HTML would stretch it over the rest of the sentence; only a group that was empty in the source, such as an icon, may come back self-closed), a group that held only a placeholder and comes back without it (an empty link next to an unlinked URL), and the source's own tag text (`&lt;/span&gt;`, `&lt;br&gt;`) that the engine un-escaped (parse5 would drop it or turn it into a break). Line breaks in HTML fields are soft whitespace (`softBreaks`), in plain fields real `<br/>`.

## Translation memory

MACHINE memory is written only by automatic publishing, and only for results without issues: a result whose form of address was dropped never becomes MACHINE memory (`tests/integration/engine-failover.test.ts`); approving it writes APPROVED memory. Memory has no engine or formality key (`memory/translation-memory.ts`), so with "reuse machine memory" an Azure/Google segment published without a formality setting can be reused inside a DeepL-translated field.

## Billing and cost

| Engine | What the engine bills | What the shop is counted |
|---|---|---|
| DeepL | `billed_characters` per text; tags and context not billed | DeepL's number (unchanged) |
| Microsoft Azure | every code point of each text incl. markup, surrogate pairs = 2, per target | the text without inline codes |
| Google Cloud | every code point incl. markup; an empty query = 1 | the text without inline codes |

Only the **answering** engine's count is charged to the shop; partials of engines that failed before go to the platform counter only (`PlatformUsageDay`), and a total failure charges at most the reservation. Ledger: the reservation names the planned engine; when another engine answered, settlement writes `…:settle` for the planned engine and `…:settle:<engine>` for the one that answered. Cost estimates: `AI_COST_USD_PER_MILLION_CHARS` (DeepL, Growth 27.5 in production), `AI_COST_USD_PER_MILLION_CHARS_AZURE` (S1 list price 10), `AI_COST_USD_PER_MILLION_CHARS_GOOGLE` (NMT 20 after the free 500,000 a month). Azure and Google bill markup too, which the estimate doesn't include (docs/COST_MODEL.md).

## Data location

| Configuration | Consent token | Where texts are processed |
|---|---|---|
| DeepL | `deepl` | DeepL SE (Germany) |
| Azure, `AZURE_TRANSLATOR_ENDPOINT` empty (default) | `azure-eu` | Microsoft's EU endpoint `api-eur`: France Central or West Europe |
| Azure, global endpoint | `azure-global` | the closest data centre, may leave the EU |
| Google, `GOOGLE_TRANSLATE_CREDENTIALS` (service account, v3) | `google-eu` | `translate-eu.googleapis.com`, `europe-west1` |
| Google, `GOOGLE_TRANSLATE_API_KEY` (v2) | `google-global` | global processing, no EU option on this path |

A change of data location is a change of token: the shop's consent must cover it again.

## Consent

DeepL alone keeps the consent version every shop accepted (`2026-10-deepl-v1`): KARINEX never has to consent again. Any other set is stored as `2026-11-engines-v1:<tokens>`. A shop whose consent covers DeepL only keeps translating with DeepL only after an engine is added; Settings shows "More translation services" with "Allow these too", and the Languages page says "Available with {engine} once you allow it in Settings" for a language only the new engine serves. Jobs never stop for a missing fallback consent. A language that only a service the shop hasn't allowed serves is refused before any text is sent (no text goes to DeepL, which would refuse it): the editor names that service with a link to Settings, the language page refuses bulk translation, and its jobs stop with `ENGINE_CONSENT` for that language only (no shop-wide pause). The "allow" forms post the services they showed; a page from before an engine was added stores nothing and shows the new list. Allowing adds to what the consent already covers: a service that is off for a moment (a typo in its variables) keeps its consent.

## Owner setup per engine

Each starts with this order:

1. **The lawyer resolves this engine's privacy section first**: no `<mark class="open">` left inside its `<!--engine:azure-->` or `<!--engine:google-->` block of `site/privacy.html` (docs/LEGAL_FACTS.md), and that commit is deployed.
2. **Then** set the engine's variables in Railway (web service).
3. Redeploy and check the web service's start log: there must be no line "PUBLIC_PAGES=on: the privacy page's <tag> section still has open points" (`siteConfigWarnings`, logged at every start).

`pnpm preflight` reads the local `.env` only: it is a development check and doesn't see Railway's variables. A check before the deploy has to be run on purpose, with the production stage values set in the shell (they win over `.env`): `LINGUVA_STAGE=production PUBLIC_PAGES=on LEGAL_TEXTS_REVIEWED=yes AZURE_TRANSLATOR_KEY=… AZURE_TRANSLATOR_REGION=westeurope pnpm preflight` (or the Google variable), then read only its "Translation engines" line; the other lines then describe your machine, not production.

### Microsoft Azure Translator

1. Azure portal → Create a resource → "Translator". Region **West Europe**. Pricing tier S1 (or F0 for a free trial: 2,000,000 characters a month, a hard cap).
2. Keys and Endpoint → copy **Key 1** and **Location/Region**.
3. Railway (web service; the worker reads the same variables): `AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION=westeurope`. Leave `AZURE_TRANSLATOR_ENDPOINT` empty: the EU endpoint (the portal shows the global one; setting it allows processing outside the EU). Never in staging (refused).
4. Redeploy → the Overview's "Translation services" card (operator's stores) shows "Key accepted" → Settings: allow the new service.
5. Budget: an alert in Azure Cost Management (an alert, not a cap: S1 has no hard cap). The real backstop is `AI_PLATFORM_DAILY_CHAR_LIMIT`, which counts text without markup (Azure bills markup too).

### Google Cloud Translation, simple (API key, global)

1. console.cloud.google.com → new project → billing on → enable "Cloud Translation API".
2. Credentials → Create API key → restrict it to the Cloud Translation API.
3. Railway: `GOOGLE_TRANSLATE_API_KEY` (global processing; say so to the lawyer).
4. Lower the "characters per day" quota in the console as a budget cap. When the day's cap is used up, Google rests until the next check and another engine steps in.
5. Redeploy → the Overview's "Translation services" card (operator's stores) shows "Key accepted" → Settings: allow the new service. A store whose consent covers DeepL only (KARINEX) keeps translating with DeepL only until then.

### Google Cloud Translation, professional (service account, EU)

1. console.cloud.google.com → create a project (or use the one from the simple path) → turn billing on → enable "Cloud Translation API" for that project. The service account below must belong to this project: its `project_id` is the project Linguva calls. Without billing or the API, Google refuses every call (`SERVICE_DISABLED` / `BILLING_DISABLED`) and the Overview card shows "Refused by Google Cloud".
2. IAM → Service accounts → create one with role "Cloud Translation API User" → Keys → Add key → JSON.
3. Railway: `GOOGLE_TRANSLATE_CREDENTIALS` = the whole file (or the file in base64). It wins over an API key.
4. Organisations created after 2024-05-03 block JSON keys by default (`iam.disableServiceAccountKeyCreation`); an organisation admin has to allow them for this project.
5. Redeploy → the Overview's "Translation services" card (operator's stores) shows "Key accepted" → Settings: allow the new service. A store whose consent covers DeepL only (KARINEX) keeps translating with DeepL only until then.

"Refused by Google Cloud" right after setup usually means the Cloud Translation API isn't enabled or billing is off in that project.

### Order and turning an engine off

`TRANSLATION_ENGINES=deepl,azure,google` (default) or a subset; turning an engine off = remove it from `TRANSLATION_ENGINES` or delete its key. A variable that doesn't validate turns its engine off with a warning at start and a preflight `fail`; it never stops the start.

## Operator card

The operator's own stores (`OPERATOR_SHOPS`) see, when an engine beside DeepL is set up, "Translation services": the order, DeepL's key rings, and per Azure/Google engine its state (free checks only: Azure's key check, an empty translate call through the configured endpoint (0 characters), Google's language list / token; cached 2 min), access (region or Global resource, API key or service account), the key's last four characters or the project id, the data location, and for how many of the store's languages it is first choice or can step in, counted among the engines this store's consent covers (as its requests are; before any consent, every engine). An engine the store hasn't allowed yet shows "Not allowed in this store yet" with a link to Settings instead of its counts. Usage figures for Azure and Google aren't shown (no usage API on the key: the Azure portal and Google console are the source of truth). Rests are this process's view; a separate worker keeps its own.

## Tests and the live contract check

Every test uses fake `fetch` functions with fictional keys; `tests/support/no-real-engines.ts` refuses DeepL, Microsoft and Google hosts in the unit, integration, security and performance suites, and `tests/support/env.ts` blanks every engine credential. The UI tests run a second server with all three engines configured with fictional keys (`tests/ui/engines.spec.ts`); `tests/ui/server/preload.ts` answers only their free checks and language lists.

The markup contract with the real engines is checked on the owner's machine only: `LINGUVA_ENGINE_CONTRACT=yes pnpm test:engines` (with that engine's real credentials in the local environment; never in CI; budget `ENGINE_CONTRACT_MAX_CHARS`, default 3,000 wire characters per engine; synthetic samples only). It writes `docs/quality/ENGINE_CONTRACT.md`. DeepL's quality harness is `tests/quality/deepl.quality.test.ts` (`pnpm test:deepl`).

Which engine wrote a draft is recorded on every draft and revision (`provider`, per field: `provider:<key>`); the Languages page shows which engine serves each language. Review doesn't show the engine yet.

## Not verified until the owner's live contract run

How each engine returns unknown or self-closing elements and which dialect survives; which entities come back besides `&#39;`; whitespace and line breaks around tags; how often `SPACING_CHANGED` and `ENGINE_MARKUP` occur per language; Google's status for an invalid key and an unsupported language; what Google's bare `pt` means; whether Azure meters the key check's empty translate call at 0 characters (`X-metered-usage`, recorded by the harness); the exact `quota_limit` names Google reports when a daily character cap is reached (the classifier looks for `PerDay`).
