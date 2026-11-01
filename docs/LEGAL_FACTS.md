# Legal facts for the lawyer

What the Linguva app really does with data, taken from the code (checked 2026-10-31). The app's privacy
policy (`site/privacy.html`, served at `/privacy`) and support page (`site/support.html`, `/support`) are
written only from these facts. Everything a lawyer or the owner still has to decide is listed under
"Open questions" and marked in the pages as `<mark class="open">[…]</mark>`.

The website's own pages (`/impressum`, `/datenschutz`) are separate: they come from the owner's
Softwarekey legal notice and cover the website, not the app.

## Who

| Fact | Value | Source |
|---|---|---|
| Provider | Karina Khrystych, Softwarekey (Einzelunternehmen), Havighorster Redder 51, 22115 Hamburg, Germany | `site/impressum.html` |
| VAT ID | DE452578048 | `site/impressum.html` |
| Contact and support | shop@softwarekey.de | `site/impressum.html`, `site/support.html` |
| Customers | Businesses only (Shopify merchants) | `site/impressum.html` ("Verbraucherstreitbeilegung") |

## Data inventory

| Fact | Source |
|---|---|
| **Shop:** myshopify.com domain, name, Shopify shop ID (GID), granted access scopes, plan (cached from Shopify), settings, install and uninstall events | `prisma/schema.prisma` (`Shop`, `ShopInstallation`, `ShopSettings`); `app/shopify.server.ts` (afterAuth) |
| **Staff:** only the Shopify user ID (session token `sub`), in audit entries and the "who did it" columns (`actorId`, `requestedBy`, `createdBy`, `autoPublishEnabledBy`). No names or email addresses: the app uses offline sessions only, so the `firstName`, `lastName` and `email` columns of `Session` stay empty | `app/.server/shopify/require-shop.ts:33-37`; `prisma/schema.prisma` (`Session`, `AuditLog`) |
| **Access token:** the offline token (and refresh token) Shopify issues at install, encrypted with `TOKEN_ENCRYPTION_KEYS` | `docs/SECURITY_MODEL.md` §2; `tests/ui/install.spec.ts` |
| **Store content:** texts read from Shopify for translation (products, collections, pages, blogs, articles, navigation, metafields, image alt text, theme and other translatable resources); drafts, revisions, translation memory, glossary, coverage counts. Shopify stays the store of record for content and published translations | `docs/SECURITY_MODEL.md` §5a, §5b; `prisma/schema.prisma` |
| **No customer or order data:** no customer or order scopes; `customers/data_request` and `customers/redact` are recorded as `NO_CUSTOMER_DATA_STORED` without storing the customer identifiers | `app/.server/privacy/compliance.ts:12-38`; `docs/SECURITY_MODEL.md` §1a |
| **No IP addresses** in the database (`AuditLog` has no IP column) or in the app's logs (logger redaction) | `prisma/schema.prisma` (`AuditLog`); `docs/SECURITY_MODEL.md` §3 |
| **No cookies of its own, no analytics or tracking:** the app authenticates with App Bridge session tokens; the code sets no cookie (`Set-Cookie` appears nowhere in `app/`) | `app/`; `tests/ui/public-pages.spec.ts` (no `Set-Cookie` on the public pages) |

## Recipients and processors

| Recipient | What | Where | Source |
|---|---|---|---|
| Railway Corporation (USA) | Hosting of the app, PostgreSQL and Redis (job queue) | Region EU West | `docs/RAILWAY_STAGING.md` §2 |
| DeepL SE (Cologne, Germany) | Texts to translate, with a short context (the item's title and the "About your store" text from Settings) and the formality. Only after a staff member's consent in Settings (`aiDataProcessingConsentAt`); revocable there; without consent nothing is sent | `app/.server/providers/deepl.ts:177-189`; `app/.server/translation/product-translation-service.ts:133`; `app/routes/app.settings.tsx` (`grant-consent`, `revoke-consent`) |
| Microsoft Ireland Operations Ltd. (Dublin, Ireland): Azure AI Translator, **only when the owner sets it up** | Texts to translate only: no context (no title, no store description), no form of address. EU endpoint by default (`api-eur`, processed in France Central or West Europe); the global endpoint only with `AZURE_TRANSLATOR_ENDPOINT` set (consent token `azure-global`). Microsoft states No-Trace (texts not stored, not used for training). Only after the store's consent covering that service | `app/.server/providers/azure.ts` (`azureTranslateRequest`, `AZURE_EU_ENDPOINT`); `app/.server/settings/ai-consent.ts`; `app/.server/providers/engine-router.ts` (consent filter) |
| Google Cloud EMEA Ltd. (Dublin, Ireland): Cloud Translation, **only when the owner sets it up** | Texts to translate only: no context, no form of address. API key: v2, global processing (`google-global`); service account: v3 on `translate-eu.googleapis.com`, `europe-west1` (`google-eu`). Google states the content is used only to provide the service and not for training. Only after the store's consent covering that service | `app/.server/providers/google.ts` (`googleTranslateRequest`, `googleEndpoints`); `app/.server/settings/ai-consent.ts` |
| Shopify | Platform the app runs in; billing of the plans (Shopify App Pricing) | — | `docs/BILLING_DESIGN.md` |

**Order of the translation services** (when more than one is set up): DeepL → Microsoft Azure → Google
Cloud, DeepL always first (`app/.server/lib/config.ts`, `parseEngineList`). A text goes to the next
service only when the one before can't translate it (it doesn't offer the language, its limit is used
up, it refuses the key, or it doesn't answer), so **a text may have been sent to more than one service**.
The privacy page states this in a generated paragraph (`<!--engines:order:en-->`); no engine section
claims a fixed order. Each page names only the services in use (`<!--engine:…-->` blocks,
`app/.server/site/engine-blocks.ts`); with DeepL alone the pages are exactly as before.

Third-party loads in the browser: inside the Shopify admin, the app loads App Bridge, Polaris and the
Inter font from Shopify's CDN (`app/root.tsx:27-31`) and product images from the store. The website and
the `/privacy` and `/support` pages load nothing from another host (strict CSP `default-src 'none'`,
`app/.server/site/pages.ts`; `tests/ui/public-pages.spec.ts`).

## Publishing

Nothing Linguva translates is published in the store until someone approves it in Review, unless the store
has turned on automatic publishing in Settings (`autoPublishEnabledAt`, `autoPublishEnabledBy`). A
translation changed in Shopify after Linguva read it is never overwritten (`docs/FEATURE_STATUS.md`,
"Safety").

## Retention

| Data | Kept until | Source |
|---|---|---|
| Sessions and access token | Deleted at uninstall (`app/uninstalled`) | `app/.server/tenancy/shop-service.ts:107` |
| Everything held for the shop (settings, content, drafts, revisions, memory, glossary, jobs; tenant tables cascade from `Shop`) | Deleted at `shop/redact`, which Shopify sends 48 hours after the uninstall. A shop that is installed again is never erased | `app/.server/privacy/compliance.ts:40-90` |
| Webhook delivery log | 14 days | `app/.server/webhooks/process-webhook.ts:120` (`WEBHOOK_LOG_RETENTION_DAYS`) |
| Smart schedule run records | 90 days | `app/.server/smart/runs.ts:31` (`RUN_RETENTION_DAYS`) |
| Audit entries | Kept, detached from the shop at `shop/redact` (`onDelete: SetNull`); no deletion job | `prisma/schema.prisma` (`AuditLog`); no `auditLog.deleteMany` in `app/` |
| Privacy requests (Shopify compliance webhooks) | Kept as evidence; no deletion job | `app/.server/privacy/compliance.ts`; no `privacyRequest.deleteMany` in `app/` |
| Database backups at the host | Unknown (Railway settings) | — |

## Open questions (marked in the pages)

1. **Role for store content:** processor for the merchant (then a data processing agreement, AVV, offered
   to merchants) or controller.
2. **Legal bases** (for example Art. 6(1)(b) GDPR for providing the app, Art. 6(1)(f) for security and the
   audit trail).
3. **US hosting:** the safeguard for Railway Corporation (EU-US Data Privacy Framework or standard
   contractual clauses), and the data processing agreement with Railway.
4. **DeepL:** the API terms (how long DeepL keeps texts) and the data processing agreement with DeepL.
4a. **Microsoft and Google** (before either key is added): the contracting entities (Microsoft Ireland
   Operations Ltd., Google Cloud EMEA Ltd.), their data processing terms (Microsoft Products and Services
   DPA, Google Cloud Data Processing Addendum) and subprocessors; the transfer mechanism for global
   processing (`azure-global`, `google-global`); the wording of the multi-engine notice in Settings and
   the editor (`settings.ai.lead.multi`, `editor.consent.body.multi`, consent version
   `2026-11-engines-v1`); and whether an outdated multi-engine consent still covers DeepL (the code keeps
   DeepL running for such shops: `consentTokens` in `app/.server/settings/ai-consent.ts`).
5. **Retention** of audit entries and privacy request records (today: no deletion job).
6. **Host logs:** what Railway's own request logs contain (IP addresses?) and for how long. **Owner.**
7. **Backups:** whether database backups are enabled at Railway and for how long. **Owner.**
8. **Support reply time** promised on `/support` (two working days). **Owner.**

## Switching the pages on

1. The lawyer reviews `site/privacy.html` and `site/support.html` (English and German) and resolves every
   `<mark class="open">`.
2. Set `LEGAL_TEXTS_REVIEWED=yes` and `PUBLIC_PAGES=on`. In production (`LINGUVA_STAGE=production`) the app
   refuses to start with `PUBLIC_PAGES=on` unless `LEGAL_TEXTS_REVIEWED=yes`, and the draft notice stays as
   long as any open point is left in a page (`app/.server/site/pages.ts`, `pageHtml`).
3. Use `https://<app domain>/privacy` as the listing's privacy policy URL and
   `https://<app domain>/support#faq` as its FAQ URL (`docs/APP_STORE_SUBMISSION.md`).
