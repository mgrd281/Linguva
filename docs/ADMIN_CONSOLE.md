# Admin console

Status: **Implemented and tested locally** (unit, integration against real PostgreSQL and Redis, security suite; §10). **Not deployed.** Nothing here is verified on Railway, on a real domain, with a real Partner API or with a real authenticator app. Code: `app/.server/admin/`, `app/routes/admin*.tsx`, `scripts/ops/admin.ts`, migration `20261107090000_admin_console` (review: SECURITY_MODEL.md §5s, §6).

## 1. What it is

A control panel for the operator at `/admin`: the stores that installed Linguva, their subscriptions as Shopify last reported them, their AI usage, an estimated revenue, and the list prices Linguva shows.

- It is part of the app and of the same image. It is **off by default** (`ADMIN_CONSOLE=off`): every `/admin` address then answers 404 before any database access.
- It is meant to run as a **second Railway service** with its own domain (`ADMIN_HOST`), while the merchant-facing `web` service keeps it off (§6).
- It reads stores, plans, counts, dates and usage figures. It never shows merchant content (no product texts, no translations) and never reads Shopify access tokens.
- It writes only: list prices and their history, a store's subscription cache ("Ask Shopify again"), its own sessions and sign-in counters, and audit entries.
- Accounts are created and changed only with the operator tool `pnpm ops:admin`, with the owner database role. There is no sign-up and no password reset by e-mail.

## 2. What it can and cannot do

| It can | It cannot |
|---|---|
| List every store (name, domain, status, install and uninstall dates, plan, trial, cancellation, pending plan change, number of languages, AI characters this month, estimated AI cost, estimated revenue); search, filter, sort | Change what Shopify charges. Shopify charges the price of the plan in the Partner Dashboard; there is no API to change it (§3) |
| Show one store's subscription, six months of usage, languages, complimentary access (read-only), installations, jobs of the last 30 days and two settings flags | Change a store's plan, cancel a subscription, refund, or extend a trial (Partner Dashboard) |
| Ask the Partner API again for one store's subscription ("Ask Shopify again") | Show product texts, translations or any other merchant content (by design) |
| Change the list prices shown on the website (`/`, `/preise`) and on the app's Plan page | Change the prices on the separate static website image (`site/Dockerfile`): it always shows the defaults in the HTML |
| Show the history of price changes (who, when, why, before and after) and the recent sign-ins | Change the trial (`TRIAL_DAYS`, `TRIAL_AI_CHARS`), the allowances or the features of a plan (`app/lib/plans.ts`, a code change) |
| Estimate monthly revenue from the current list prices | Know what each store really pays: a store can keep an older price, and discounts, proration and taxes aren't known here |
| | Grant or revoke complimentary access (`pnpm ops:complimentary`, BILLING_DESIGN.md §4) |
| | Create, change, disable or unlock accounts (`pnpm ops:admin`, §7) |
| | Show failed sign-ins or the audit log: the app's database role can't read `AuditLog` (§7, "Failed sign-ins") |
| | Sign in as a merchant or open a store's admin as that merchant. "Open in Shopify admin" is a plain link to `admin.shopify.com`; it needs your own Shopify access to that store |

## 3. Changing a price: two steps

Shopify charges what the Partner Dashboard says. The console only changes what Linguva **shows**. Both must say the same, so a price change always has two steps, on the same day, in this order.

**Before you start:** read Shopify's current rules for price changes on a live plan and for existing subscribers (PRICING_DECISION.md §9 step 8). A store can keep an older price after a change; Shopify's charge history is authoritative.

1. **Partner Dashboard (what Shopify charges).** Open the Partner Dashboard (the Prices page links to `https://partners.shopify.com/<SHOPIFY_PARTNER_ORG_ID>/apps`, or to `https://partners.shopify.com/` when the organization id isn't configured). Open the app's pricing (the path is in PRICING_DECISION.md §9 step 1) and change the plan's monthly or yearly charge. Save.
2. **Console → Prices (what Linguva shows).** Enter the same price, in US dollars:
   - Monthly and yearly field per plan. An empty yearly field means "no yearly price". "." or "," as the decimal mark, at most 2 decimals, no thousands separators (`1,000` is refused).
   - A **reason** (3 to 500 characters), for the history.
   - A **new 6-digit code** from your authenticator app. A code you already used (to sign in, or for an earlier save) is refused: wait for the next one (at most 30 seconds).
   - **Save.** It needs the role OWNER or FINANCE (§5). Only plans whose price changed are written.
3. **App Store listing, the same day.** Shopify takes the price of each plan from the plan itself. Check the pricing content in English and German (display name, top features; for Own key the additional-charges text) and change any text that no longer fits (docs/APP_STORE_LISTING.md, "Pricing details"). Update the prices line there.
4. **Check.** The app's Plan page shows the new price within 30 seconds (each process keeps the table for 30 s). The website (`/preise`, and "ab … $" on `/`) within about 5 minutes more (`Cache-Control: public, max-age=300`). Shopify's plan page on the development store (`https://admin.shopify.com/store/linguva-test-lab/charges/<app-handle>/pricing_plans`) shows what Shopify charges.

The Prices page says this above the form: "1. Change the price in the Partner Dashboard (link): Shopify charges that price. 2. Save the same price here: the website and the app's Plan page show it within a few minutes." After a save it lists the changed plans and reminds you of the Partner Dashboard and the listing text.

**Rules the form enforces** (also CHECK constraints in the database):

| Plan | Monthly | Yearly |
|---|---|---|
| Free | stays 0 (the field may be left out) | none |
| Starter, Pro, Business, Own key | $1.00 to $100,000.00 | empty, or $1.00 to $1,200,000.00 and at least the monthly price |

**Warnings** (shown, never blocking): Pro doesn't cost more a month than Starter, or Business not more than Pro; or a price's estimated margin at full use is under 40 % (monthly, and yearly ÷ 12). The margin is PRICING_DECISION.md §6.1's worst case: (price × 0.821 − included characters × $27.50 per million − $0.50) ÷ price (`estimatedMargin`, `MARGIN_MODEL` in `app/lib/plan-prices.ts`).

**Defaults.** A plan without a saved price shows its default: `PLAN_PRICES` and `OWN_KEY_PRICE` in `app/lib/plans.ts` (`DEFAULT_PRICES`). The defaults are also what a page shows when the database can't be read and no table was read before (after a restart during an outage), and what the static website image always shows. To go back to a default, save the default value (a saved row is never deleted; the page then marks the plan as default). To make a new price the default too, change `PLAN_PRICES` or `OWN_KEY_PRICE`, the default texts between the website's price markers (`<!--price:…-->` in `site/index.html` and `site/preise.html`) and `tests/unit/plan-prices.test.ts` together, in a code change; the tests compare them.

**What follows the saved prices:** the four plan cards, the comparison table's price row and the questions on the Plan page, the Own key card, and on the website every monthly price, the yearly line ("oder 290 $ / Jahr" with "2 Monate gratis" when the yearly price is a whole number of free months; "Nur monatlich" without a yearly price), the table's yearly note, Own key's note and the home page's "ab 29 $".

**Not covered:**
- The trial ("bis zu 7 Tage", "7-day trial") is text and code, not part of the price table.
- Own key is monthly only in the Partner Dashboard (PRICING_DECISION.md §9 step 11). The console accepts a yearly Own key price and the cards and the website show it, but the Plan page's comparison note still says "monthly only" (`plan.compare.ownKeyNote`). Don't save a yearly Own key price before that text is changed.

## 4. Pages

As specified for v1 (`app/routes/admin*.tsx`). Every page reads its data on the server; nothing is cached in the browser (`Cache-Control: no-store`).

| Page | Address | What it shows |
|---|---|---|
| Sign-in | `/admin/login` | E-mail, password, 6-digit code, language switch. One message whatever was wrong ("E-mail, password or code is wrong."); after too many attempts "Too many attempts. Try again in 15 minutes." A signed-in visitor goes to `/admin`; after signing in you return to the page you asked for (only `/admin` addresses) |
| Layout | every page | "Linguva Admin", language switch EN \| العربية, your e-mail and role, Sign out; navigation Overview, Customers, Subscriptions, Prices, Activity (a sidebar from 960 px, a scrollable tab bar on phones) |
| Overview | `/admin` | Active stores, paying stores, estimated monthly revenue (MRR) with ARR, stores in trial, AI characters this month with their estimated cost; stores per plan; trials ending in the next 7 days (at most 10); the 5 newest stores; cancellations and pending plan changes; a banner when billing isn't configured ("every store has all features"); "Data from <time> · Reload" |
| Customers | `/admin/customers` | Every store, 50 a page: search by name or domain, filters by status and plan, sort (newest, oldest, usage, revenue, name); plan badge with trial and cancellation marks, status, install date, languages, AI characters this month, estimated revenue a month |
| Store | `/admin/customers/<id>` | Name, domain, status, "Open in Shopify admin"; subscription (every cached field and when it was checked, "Ask Shopify again" for roles that may); usage of the current and the five previous UTC months; languages; complimentary access (read-only, with the `pnpm ops:complimentary` hint); installations (newest 20); jobs of the last 30 days by status; automatic translation and smart schedule on or off. Unknown ids answer 404 |
| Subscriptions | `/admin/subscriptions` | Counts per plan and billing period; the stores with a subscription (plan, period, state, trial end, period end, cancelling, pending plan, checked at); filters (plan, in trial, cancelling); revenue totals |
| Prices | `/admin/prices` | Per plan: monthly and yearly price, the default, the last change, the estimated margin; the two-step notice (§3); the form for OWNER and FINANCE, a read-only table for the others; the last 20 changes |
| Activity | `/admin/activity` | The last 50 price changes and the last 30 sign-ins (sessions: active or ended) |

**Languages:** English and Arabic (right to left), Western digits in both, dates in UTC with the zone shown. The choice is kept in the `lv_admin_lang` cookie (Path `/admin`, one year; `?lang=en` or `?lang=ar` sets it); the first visit follows the browser's language.

**Plans as the console names them:** free, starter, pro, business, own-key (every Own key handle), complimentary (an active grant that `COMPLIMENTARY_SHOP_GIDS` lists), unknown (a handle the app doesn't map, or no subscription checked yet while billing is configured). Without billing configured (`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_GID`) a store never checked counts as free.

**"Ask Shopify again"** asks the Partner API for the store's subscription now and stores the answer in its cache (the same check as Refresh on the store's Plan page). Possible results: done; billing isn't configured; the store has no Shopify shop id yet (it is stored when the store first opens the app with billing configured; the console has no Shopify session to ask for it); Shopify didn't answer (the cache stays as it was). Only a successful check is audited.

## 5. Roles

| Role | See every page | Ask Shopify again | Change prices |
|---|---|---|---|
| OWNER | Yes | Yes | Yes |
| FINANCE | Yes | Yes | Yes |
| SUPPORT | Yes | Yes | No |
| READONLY | Yes | No | No |

- In v1, OWNER and FINANCE can do the same things in the console. No role can manage accounts there: that is the operator tool's job (§7), whoever runs it with the owner database role.
- A role change applies from the account's next request.
- A page or action the role may not use answers 403.

## 6. Setup on Railway

Recommended: a second service `admin` in the same project and environment as `web`, from the same repository, branch and image, with its own domain. The console stays off on `web`. Production refuses `ADMIN_CONSOLE=on` without `ADMIN_HOST`.

Try it in staging first: the same steps in the staging environment (`ADMIN_HOST` is optional there, but set it).

1. **Migrate first.** Deploy `web` with this code. Its pre-deploy step (`node scripts/migrate.mjs`) applies `20261107090000_admin_console`; the deploy log says `All migrations have been successfully applied.` The `admin` service has no pre-deploy step, so later releases with a migration also go to `web` first.
2. **Create the service.** Project → **+ New** → GitHub repo → the same repository and branch as `web` → rename it `admin`. Settings:

   | Setting | `admin` |
   |---|---|
   | Builder | Dockerfile (detected) |
   | Custom start command | empty (the image's `react-router-serve ./build/server/index.js`) |
   | Pre-deploy command | empty (`web` runs the migrations) |
   | Health check path | `/healthz` |
   | Restart policy | On failure |
   | Replicas | 1 (each process keeps its own 60-second directory cache, §9) |
   | Automatic deploys | as on `web` |

3. **Variables.** Every variable of `web`, with the same values (copy them, or reference them as `${{web.NAME}}`), **except** `MIGRATION_DATABASE_URL` (the console never needs the owner role) and the translation engine keys (`DEEPL_API_KEY`, `DEEPL_API_KEYS`, `AZURE_TRANSLATOR_KEY`, `GOOGLE_TRANSLATE_API_KEY`, `GOOGLE_TRANSLATE_CREDENTIALS`: the console translates nothing). Keep in particular:
   - `DATABASE_URL` (the runtime role `linguva_app`), `REDIS_URL` (sign-in limits; required in production), `TOKEN_ENCRYPTION_KEYS` (the TOTP secrets are encrypted with it).
   - `SHOPIFY_APP_URL` as on `web` (the app's address, not the console's), `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `LINGUVA_STAGE`, `LINGUVA_PRODUCTION_APPROVED`.
   - `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_GID` (plans, "Ask Shopify again", the Partner Dashboard link), `COMPLIMENTARY_SHOP_GIDS`, the cost rates `AI_COST_USD_PER_MILLION_CHARS` (and `_AZURE`, `_GOOGLE` if set).

   Then add:

   | Variable | Value |
   |---|---|
   | `ADMIN_CONSOLE` | `on` |
   | `ADMIN_HOST` | the console's host name from step 4, lower case, without `https://`, port or path (for example `admin.example.com`) |
   | `LINGUVA_EMBEDDED_WORKER` | `off` (production would otherwise start a second worker inside this service) |

   On `web`, `ADMIN_CONSOLE` stays unset (`off`) and `ADMIN_HOST` unset (RAILWAY_STAGING.md §10).
4. **Domain.** `admin` → Settings → Networking: add a custom domain (for example `admin.<your domain>`; create the DNS record Railway shows at your DNS provider) or **Generate Domain**. `ADMIN_HOST` must be exactly this host name: `/admin` answers 404 on every other host. Don't link the address from anywhere public.
5. **Deploy `admin`** and check:
   - `https://<ADMIN_HOST>/admin` opens the sign-in page.
   - `https://<web's domain>/admin` answers 404.
   - The health check passes.
6. **First OWNER account**, from the project folder on your computer (after `pnpm install`; `pnpm ops:admin` builds the tool first):
   - The owner role's URL: `postgresql://linguva_owner:<LINGUVA_OWNER_PASSWORD>@<host>:<port>/linguva`, with the host and port of the Postgres service's public connection (as for the roles, RAILWAY_STAGING.md §5.2). If you turn Postgres's public TCP proxy on only for this, turn it off afterwards.
   - `TOKEN_ENCRYPTION_KEYS`: the `admin` service's value. With another keyring the account can never sign in (its code is always wrong).
   - Paste both without leaving them in your shell history, then run the tool:
     ```bash
     read -rs MIGRATION_DATABASE_URL && export MIGRATION_DATABASE_URL   # paste, Enter
     read -rs TOKEN_ENCRYPTION_KEYS && export TOKEN_ENCRYPTION_KEYS     # paste, Enter
     pnpm ops:admin add --email you@example.com --role OWNER
     ```
   - It asks for a password twice (12 to 256 characters, nothing shown while you type; a passphrase of several words is best; `ADMIN_PASSWORD` works too but is less safe). It prints `Created you@example.com (OWNER).` and the authenticator setup **once**:
     ```
     Add the account to an authenticator app now (shown only this once):
       otpauth://totp/Linguva%20Admin:you%40example.com?secret=…&issuer=Linguva%20Admin&algorithm=SHA1&digits=6&period=30
       Secret: ABCD EFGH …
     ```
7. **Authenticator app.** Any app for time-based codes (TOTP). The tool prints no QR code:
   - Either add the account by hand: "enter a setup key", account name your e-mail, key the printed secret (spaces don't matter), time-based.
   - Or turn the `otpauth://` line into a QR code on your own computer (for example `qrencode -t ansiutf8 'otpauth://…'`, if `qrencode` is installed) and scan it.
   - Never paste the line or the secret into a website, a chat or an e-mail. Then clear the terminal and close it.
   - The app shows "Linguva Admin" with your e-mail and a new 6-digit code every 30 seconds.
8. **Sign in** at `https://<ADMIN_HOST>/admin/login` with e-mail, password and the current code.
9. **More accounts:** `pnpm ops:admin add --email … --role FINANCE` (or `SUPPORT`, `READONLY`), the same way. The person can't change their own password or code in the console; hand the password and the authenticator setup over in person, not by e-mail or chat.

**Locally:** add `ADMIN_CONSOLE=on` to `.env`, run the app as usual, create an account with `pnpm ops:admin add --email you@example.com --role OWNER` (it reads `MIGRATION_DATABASE_URL` and `TOKEN_ENCRYPTION_KEYS` from `.env`; variables set in the shell win), and open `/admin` on the dev server's address. Without `LINGUVA_STAGE`, plain http works and the cookie is `lv_admin` instead of `__Host-lv_admin`.

## 7. Accounts and operations

All account changes go through `pnpm ops:admin`, with `MIGRATION_DATABASE_URL` (owner role) set as in §6 step 6. Every change is audited (`AuditLog`, actor `cli:<your computer's user name>`).

| Command | Effect | Audit action |
|---|---|---|
| `add --email E --role R` | New account with a password (prompt or `ADMIN_PASSWORD`) and a new TOTP secret (printed once). Needs `TOKEN_ENCRYPTION_KEYS` | `admin.account.created` |
| `set-password --email E` | New password; unlocks the account; ends its sessions | `admin.account.password_set` |
| `reset-totp --email E` | New TOTP secret (printed once); the old codes stop working; ends its sessions. Needs `TOKEN_ENCRYPTION_KEYS` | `admin.account.totp_reset` |
| `set-role --email E --role R` | New role, from the next request on | `admin.account.role_set` |
| `disable --email E` | The account can't sign in; its sessions end at once | `admin.account.disabled` |
| `enable --email E` | Enabled again, and unlocked | `admin.account.enabled` |
| `list` | Every account: role, state (active, locked, disabled), failed attempts, last sign-in, active sessions, created | — |

Roles: `OWNER`, `FINANCE`, `SUPPORT`, `READONLY`. E-mails are stored in lower case. There is no command that deletes an account: disable it.

- **Someone leaves, or an account may be misused:** `disable` at once. Its sessions end with the next request.
- **Locked account** (5 wrong passwords or codes in a row, at sign-in and when saving prices together): it unlocks by itself after 15 minutes; `enable` unlocks it at once. While it is locked, its sessions don't work either. Anyone who knows the e-mail can lock it this way again and again (§9).
- **Forgotten password:** `set-password`.
- **New phone, or the codes are wrong:** `reset-totp`, then add the new entry to the authenticator app and delete the old one. Codes from one step before or after the current one are accepted, so a phone clock more than 30 seconds off can produce refused codes: set the phone's time automatically.
- **Lost or stolen phone:**
  1. `disable` (ends every session of the account at once).
  2. `reset-totp` and set up the new phone (the old phone's codes stop working).
  3. `set-password` too, if the password was stored on the phone.
  4. `enable`.

  There are no recovery codes. If the only OWNER loses the phone, whoever has the owner database role does these steps; that is the recovery path.
- **Rotating `TOKEN_ENCRYPTION_KEYS`** (SECURITY_MODEL.md §3): TOTP secrets are encrypted with the keyring's first key and are not re-encrypted by any job. After the new key is first on every service, run `reset-totp` with the new keyring for every account (`list` shows them) before removing the old key; otherwise those accounts can't sign in.
- **Failed sign-ins:** not shown in the console. With the owner role, for example in `psql "$MIGRATION_DATABASE_URL"`:
  ```sql
  SELECT "createdAt", "action", "actorId", "metadata"
  FROM "AuditLog" WHERE "action" LIKE 'admin.%' ORDER BY "createdAt" DESC LIMIT 50;
  ```
  `admin.sign_in_failed` carries only a reason (`unknown_account`, `disabled`, `locked`, `wrong_password`, `wrong_code`, `reused_code`, `rate_limited`), never the e-mail or password; `actorId` is the account's id, or empty for an unknown e-mail and for the rate limit.
- **Turning the console off:** set `ADMIN_CONSOLE=off` on `admin` (or remove the service) and redeploy. Every `/admin` address then answers 404; the accounts stay in the database.

## 8. Security model (summary)

Full review: SECURITY_MODEL.md §5s (database) and §6 (the console).

- **Where it answers:** only with `ADMIN_CONSOLE=on`, only on `ADMIN_HOST` (when set), and on a hosted stage only over https (the request URL, or the right-most `X-Forwarded-Proto` that Railway's proxy adds). Otherwise 404, before any database access.
- **Sign-in:** e-mail, password and a TOTP code in one form, always required. Passwords: scrypt (N = 32768, r = 8, p = 3, 16-byte salt) from Node's crypto. Codes: RFC 6238 (SHA-1, 6 digits, 30 s, one step of drift either way); each code works once per account. One generic error. 5 wrong attempts in a row lock the account for 15 minutes; unknown and disabled e-mails behave the same. At most 20 attempts per client address in 15 minutes (Redis; the client is the right-most `X-Forwarded-For` entry).
- **Sessions:** a random token in the `__Host-lv_admin` cookie (HttpOnly, Secure, SameSite=Strict, Path=/); the database keeps only its SHA-256. A session ends after 8 hours, after 30 idle minutes, on sign-out, and when the account is disabled, locked, or gets a new password or TOTP secret.
- **Every write:** the browser's Origin (when sent) must be the console's own, and the form must carry the session's CSRF token. Saving prices also needs a fresh code and a reason.
- **Accounts:** only the operator tool with the owner role can create or change them; the app's database role can't (grants, checked at start by the posture check).
- **Data:** every store's figures are read inside that store's tenant (`withTenant`, row-level security), never with a bypass role. No merchant content, no Shopify tokens.
- **Audit:** `admin.signed_in`, `admin.sign_in_failed`, `admin.signed_out`, `admin.prices.changed`, `admin.subscription.refreshed`, and the operator tool's `admin.account.*`.
- **Headers:** a strict Content-Security-Policy, `X-Frame-Options: DENY`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: same-origin` (SECURITY_MODEL.md §5e).

## 9. Limits and scale

- **The store list is built shop by shop.** The console lists every store (`Shop` is a global table), then reads each store's figures in that store's tenant: one transaction with one SQL statement per store, at most 4 stores at a time. The result is kept in the process for 60 seconds; "Reload" rebuilds it. Plan, trial and revenue are worked out again on every request from the current list prices, so a price change shows at once. A store's own page is read fresh each time.
- **Scale:** a rebuild costs one transaction per store, so it grows with the number of stores. It hasn't been measured. Searching, filtering, sorting and paging happen in memory over all rows. The first request after the 60 seconds waits for the rebuild (requests at the same moment share it), which uses up to 4 database connections at once. If a rebuild becomes too slow, the figures would have to come from a summary the worker keeps up to date (not built).
- **One cache per process:** with more than one replica each builds its own; run one.
- **Revenue is an estimate:** current list prices × the stores' plans (yearly billing = the yearly price ÷ 12); 0 for free, trial, complimentary, unknown and uninstalled stores. It is not what Shopify charges: older prices, discounts, proration, taxes and Shopify's share aren't included.
- **Subscriptions are a cache:** the Partner API's answer as of "checked at". It is asked again when Linguva needs the store's plan (an app page, a job) and the answer is older than 6 hours, after Shopify's welcome link, with Refresh on the Plan page, or with "Ask Shopify again". Shopify sends no billing webhooks, so an inactive store keeps its last answer.
- **Usage** is the current UTC month (the store page: six months). Costs are estimates from `AI_COST_USD_PER_MILLION_CHARS` and the other engines' rates.
- **Lists:** Activity shows the last 50 price changes and the last 30 sign-ins; the Prices page the last 20 changes. Ended sessions stay 30 days after they expired and are deleted at the account's next sign-in.
- **Prices:** US dollars only (Shopify App Pricing is USD only); each process reads the table at most every 30 seconds; when the database can't be read, pages show the last table read, else the defaults (logged once). The trial isn't part of the table (§3).
- **Sign-in limits:** if a request carries no `X-Forwarded-For`, all such requests share one limit ("local"). That Railway's proxy appends the client address as the right-most entry is not verified on Railway.
- **Lockout as a nuisance:** anyone who knows an admin's e-mail can keep that account locked with 5 attempts every 15 minutes. The own, unlinked domain makes this harder; `enable` unlocks.
- **Not built in v1:** WebAuthn (security keys, passkeys), recovery codes, changing your own password or code in the console, alerts on sign-in, the client address in audit rows.
- **The pages' code is public:** the console's route modules are part of the app's browser bundle on every service, also where the console is off (paths and interface texts, no data).

## 10. Tests

| What | Where |
|---|---|
| Passwords (format, verification, malformed hashes, the dummy hash's timing), TOTP (RFC 4226 and 6238 test vectors, the drift window, base32, encrypted secrets), where the console answers, roles, `next` redirects, cookies, Origin, the client address, log redaction | `tests/unit/admin-auth-password.test.ts`, `admin-auth-totp.test.ts`, `admin-auth-console.test.ts` |
| Sign-in, lockout, per-client limit, code reuse, sessions (expiry, idle, revoke), CSRF and Origin, fresh codes | `tests/integration/admin-auth.test.ts` |
| The operator tool, bundled and run as the owner role | `tests/integration/admin-cli.test.ts` |
| Directory, overview figures, revenue in cents, filters | `tests/unit/admin-data-directory.test.ts`, `tests/integration/admin-data.test.ts` |
| Price form, warnings, cache, Plan page and website with other prices, the static image's defaults | `tests/unit/admin-data-prices.test.ts`, `tests/unit/plan-prices.test.ts`, `tests/unit/public-pages-own-key.test.ts`, `tests/integration/admin-prices.test.ts` |
| Every admin route calls `requireAdmin` itself (the sign-in page `requireAdminConsole`), no other route does | `tests/security/structure.test.ts` |
| The runtime role can't write accounts or rewrite the price history | `tests/security/postgres-privileges.test.ts` |
| The console's headers; everything outside `/admin` unchanged | `tests/unit/security-headers.test.ts` |
| `ADMIN_CONSOLE` and `ADMIN_HOST` documented for production | `tests/unit/deploy-config.test.ts` |

## 11. ملخص بالعربية

- **ما هي:** لوحة تحكم على العنوان `/admin` ترى فيها المتاجر التي ثبّتت التطبيق، واشتراكاتها كما أبلغ عنها Shopify آخر مرة، واستهلاك الذكاء الاصطناعي، وإيرادًا تقديريًا، وأسعار الخطط التي يعرضها Linguva. اللوحة مغلقة افتراضيًا ولا تعرض أي محتوى للتجار.
- **الأسعار:** حفظ سعر في اللوحة يغيّر فقط ما يعرضه Linguva (الموقع وصفحة الخطة في التطبيق). المبلغ الذي يدفعه التاجر يحدده Shopify من لوحة الشركاء (Partner Dashboard)، ولا توجد واجهة برمجية لتغييره.
- **تغيير السعر بخطوتين في اليوم نفسه:** (1) غيّر السعر في Partner Dashboard أولًا. (2) احفظ السعر نفسه في صفحة Prices مع سبب (من 3 إلى 500 حرف) ورمز جديد من تطبيق المصادقة. ثم راجع نصوص التسعير في قائمة App Store بالإنجليزية والألمانية.
- **التشغيل على Railway:** خدمة ثانية باسم `admin` من الصورة نفسها، بنطاق خاص بها، مع `ADMIN_CONSOLE=on` و`ADMIN_HOST` (اسم النطاق) و`LINGUVA_EMBEDDED_WORKER=off`. تبقى اللوحة مغلقة على خدمة `web`. انشر `web` أولًا لتطبيق الترحيل (migration).
- **أول حساب:** من جهازك وباستخدام دور مالك قاعدة البيانات: `pnpm ops:admin add --email … --role OWNER`. أضف المفتاح المطبوع إلى تطبيق مصادقة (رمز من 6 أرقام كل 30 ثانية). لا تلصقه في أي موقع أو محادثة.
- **الأدوار:** OWNER وFINANCE: عرض، و«Ask Shopify again»، وتغيير الأسعار. SUPPORT: عرض و«Ask Shopify again». READONLY: عرض فقط. إدارة الحسابات من سطر الأوامر فقط.
- **فقدان الهاتف:** `disable` ثم `reset-totp` على الهاتف الجديد ثم `enable`. لا توجد رموز استرداد.
- **الحالة:** مُنفّذة ومختبرة محليًا فقط. لم تُنشر بعد، ولم يُتحقق منها على Railway.
