# Security Model

Status: **Phase 0 — proposal and threat model.** Controls listed here aren't implemented yet. Each control becomes "implemented" only when its test in `tests/security/` passes.

## 1. Trust boundaries

| Boundary | Trusted? | Verification |
|---|---|---|
| Browser (embedded iframe) | **No** | Shopify ID token (JWT, HS256 with app secret) validated server-side by `authenticate.admin` |
| Shopify webhooks | Only after HMAC | `authenticate.webhook` (HMAC-SHA256 over the raw body). Invalid → 401 |
| Shopify Admin API responses | Yes (TLS) | — |
| AI provider responses | **No** | Treated as untrusted text: sanitized and validated before storage or publication |
| Admin control center users | After auth + MFA + RBAC | Separate session, separate DB role |
| Workers | Yes, but re-authorize | Re-check Shop status + entitlement from the DB on every job |

## 2. Multi-tenant controls

1. **Shop resolution:** `shopId` comes only from `session.shop` (verified token) → `Shop.myshopifyDomain` lookup. Request params never select a tenant.
2. **Scoped queries:** all tenant data access goes through repositories that take a `TenantContext`. Raw `prisma.*` on tenant tables is banned by an ESLint `no-restricted-syntax` rule outside `server/tenancy`.
3. **RLS:** fail-closed policies (see DATABASE_SCHEMA.md §3).
4. **Object references:** every ID from the client (job ID, entry ID) is looked up with `WHERE id = $1 AND shopId = ctx.shopId`. A miss returns 404, never 403, so existence doesn't leak.
5. **Caches/queues:** Redis keys are prefixed `lv:{env}:shop:{shopId}:…`. Job payloads carry `shopId`, and the worker asserts that it matches the loaded rows.
6. **Translation memory:** every query filters `shopId` first. There is no global memory. Cross-merchant sharing is out of scope unless explicitly authorized later.
7. **Rate limits:** per-shop limits on mutating endpoints (Redis sliding window). Per-shop job concurrency caps.

## 3. Secrets and tokens

- Secrets come from environment variables only (Railway variables). `.env` is git-ignored, and `.env.example` contains names only.
- Config is validated at boot (zod). The app refuses to start if a secret is missing or `TOKEN_ENCRYPTION_KEY` is weak.
- Shopify access/refresh tokens are encrypted with AES-256-GCM, with a random 96-bit IV and a key ID (`kid`) prefix for rotation. Decryption happens only in `server/shopify/client.ts`.
- Rotation: support two active keys (`TOKEN_ENCRYPTION_KEYS=kid1:…,kid2:…`). A re-encryption job migrates data to the newest key.
- AI provider keys never reach the browser or the database.
- CI runs secret scanning (gitleaks) and `pnpm audit` / Dependabot.

## 4. Output safety (XSS)

- AI output for HTML fields is never trusted. The pipeline (TRANSLATION_ENGINE.md §3) translates **text nodes only** and rebuilds the HTML from the source DOM structure, so the provider can't introduce tags or attributes.
- A final pass runs a sanitizer allow-list (no `<script>`, no `on*` attributes, no `javascript:` URLs). The output tag/attribute set must be a subset of the source's.
- The admin UI renders translations as text or inside a sandboxed preview. It never uses `dangerouslySetInnerHTML` with unsanitized content.
- CSP and security headers are set (`frame-ancestors https://*.myshopify.com https://admin.shopify.com` as required for embedded apps).

## 5. Webhooks

- HMAC is verified before parsing. Invalid → 401 (required by Shopify for compliance topics).
- Duplicate suppression: `unique(webhookId)` on `WebhookEvent`. A duplicate gets a 200 and is not processed again.
- Replay window: reject events whose `X-Shopify-Triggered-At` is older than a configurable window (the default must allow Shopify retries, which can take up to ~48h — **ASSUMPTION, verify**). Duplicates are still caught by the ID check.
- Handlers only persist and enqueue. They respond within a few hundred ms.

## 6. Admin control center

- Separate deployment and domain. Email + password (argon2id) **plus mandatory TOTP/WebAuthn**.
- RBAC roles: OWNER, SUPPORT, FINANCE, READONLY.
- Sensitive actions (grant/revoke owner entitlement, view merchant content, change feature flags) require re-authentication and a reason. Each one writes an AuditLog entry.
- No impersonation of merchant sessions. Support views of content are read-only, time-boxed, and logged.

## 7. Threat model (STRIDE summary)

| # | Threat | Vector | Mitigation | Severity |
|---|---|---|---|---|
| T1 | Cross-tenant data access (IDOR) | Tampered job/entry ID in API call | Tenant-scoped repos, RLS, 404 on miss, IDOR test suite | Critical |
| T2 | Session forgery | Forged ID token / stolen cookie | Library token validation, short-lived ID tokens, no custom auth | Critical |
| T3 | Webhook forgery / replay | Unsigned POST, replayed payload | HMAC, webhookId uniqueness, timestamp window | High |
| T4 | Token theft from DB dump/backup | DB compromise | AES-GCM encryption at rest, backup encryption, key outside DB | High |
| T5 | Stored XSS via AI output | Malicious/hallucinated HTML in translation | Structure-preserving translation + sanitizer + subset check | High |
| T6 | Prompt injection via merchant content | Product text instructing the LLM | Text treated as data, delimited, output-validated; LLM gets no tools; output can only replace text nodes | Medium |
| T7 | Quota/billing abuse | Parallel requests racing quota | Reservation in the same transaction as job creation (`SELECT … FOR UPDATE` on the period balance) | High |
| T8 | Entitlement escalation | Client sets plan flag | Entitlements resolved server-side only. OWNER grants need admin approval and audit | High |
| T9 | Admin account takeover | Phishing / password reuse | MFA mandatory, separate domain, rate-limited login, alerts on login | High |
| T10 | Worker processes job for uninstalled/redacted shop | Stale queue | Worker re-checks Shop.status. Uninstall cancels queued jobs | Medium |
| T11 | Translation loop | Our write triggers `products/update`, which triggers re-translation | Compare source digest/hash, ignore if unchanged; ignore events attributable to translation-only changes; debounce | Medium |
| T12 | Sensitive data sent to AI provider | Merchant content includes personal data | No customer scopes; consent recorded in ShopSettings; DPA per provider; EU-region endpoints where available | Medium (legal review) |
| T13 | Dependency compromise | Malicious npm package | Lockfile, pinned versions, audit in CI, minimal deps | Medium |
| T14 | Log leakage | Logging translated text or tokens | Structured logger with redaction allow-list; no request bodies logged | Medium |

## 8. Items flagged for qualified review

- GDPR basis for sending merchant content to AI providers (Art. 28 processor role, subprocessor list, SCCs for non-EU providers).
- Retention periods for billing records under German law (HGB §257 / AO §147).
- Privacy policy and DPA wording.

Nothing in this document is a legal compliance claim.
