# AI translation engines: today and the plan for a second engine

## Today

- One engine: **DeepL** (`app/.server/providers/deepl.ts`), behind the `TranslationProvider` interface (`types.ts`), so jobs, memory, glossary codes, quality checks and Review don't depend on the engine.
- Which target languages AI covers is **read from DeepL** at runtime (`GET /v2/languages?type=target`, cached for a day) and shown per language on the Languages page: "Available", "Not available with DeepL: translate in the editor or import a CSV", "Couldn't check right now" or "Not set up". No list is hard-coded, so the page never claims a language DeepL doesn't offer (`tests/unit/deepl.test.ts`).
- **Several keys:** `DEEPL_API_KEY`, then `DEEPL_API_KEY_2`, `DEEPL_API_KEY_3`, ... (one variable per extra key, in numeric order) and `DEEPL_API_KEYS` (commas, spaces or line breaks, any number) form one pool (`providers/deepl-pool.ts`). A request goes to the first key that works; a key whose quota is used up (456) or that is refused (401/403) rests for an hour (quota) or six hours (refused) and the same request goes to the next one. Other errors don't switch keys. The pause is kept in memory, per process, by a hash of the key. Use keys the DeepL terms allow, for example the several keys of one paid account; free keys are one per account and a free quota is not meant to be multiplied. Staging refuses both variables.
- Languages without AI can still be translated: manually in the editor, or by CSV import (drafts on Review).
- Not measured yet: DeepL's quality on real store content (no key in this environment; harness: `scripts/deepl-quality.mjs`, runs only with a local `DEEPL_API_KEY`).

## Plan for a second engine (not implemented, no paid service used)

| Option | Strength | Concern | Fit |
|---|---|---|---|
| Google Cloud Translation | Very wide language coverage; glossary support | Quality behind DeepL for European languages in many comparisons (to verify on our reference set); separate data processing terms | Fallback for languages DeepL lacks |
| Microsoft Azure Translator | Wide coverage, EU data residency options | Same as Google | Alternative fallback |
| An LLM (for example Claude) with the glossary and tone in the prompt | Context, tone, brand voice; can explain choices | Cost per character higher and less predictable; must keep inline codes intact (our segment markup is checked after every call); latency | Premium "style" option, or second opinion on flagged drafts |

**Routing rule (proposal):** DeepL for every language it supports; the fallback engine only for languages it doesn't; never mix engines within one field. The engine is recorded on every draft and revision (`provider`), so merchants see which engine wrote what.

**Before building:** owner decision on provider and data processing agreement; measured quality and cost on the reference set; the same quality checks, glossary enforcement and Review flow apply unchanged. Effort about 1–2 weeks including tests.
