# Admin console

Status: **Implemented and tested** (unit, integration against real PostgreSQL and Redis, security suite, the pages in a real browser; all of them run in CI; §10). **Not deployed.** Nothing here is verified on Railway, on a real domain, with a real Partner API or with a real authenticator app. Code: `app/.server/admin/`, `app/routes/admin*.tsx`, `scripts/ops/admin.ts`, migration `20261107090000_admin_console` (review: SECURITY_MODEL.md §5s, §6).

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
| List every store (name, domain, status, install and uninstall dates, plan, trial, cancellation, pending plan change, number of additional languages, Linguva's AI characters this month and their estimated cost, characters through the store's own keys, estimated revenue); search, filter, sort | Change what Shopify charges. Shopify charges the price of the plan in the Partner Dashboard; there is no API to change it (§3) |
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
   - A monthly and a yearly field per plan. An empty yearly field means "no yearly price". Free has no fields ("Always free"); Own key has a monthly field only ("Monthly only"). "." or "," as the decimal mark, at most 2 decimals, no thousands separators (`1,000` is refused).
   - A **reason** (3 to 500 characters), for the history. Characters are counted as the database counts them, in code points (📈 counts as one). Tabs and line breaks become spaces; other control characters are refused.
   - A **new 6-digit code** from your authenticator app. A code you already used (to sign in, or for an earlier save) is refused: wait for the next one (at most 30 seconds).
   - **Save.** It needs the role OWNER or FINANCE (§5). Only plans whose price changed are written.
   - **Saved by someone else in the meantime** (another admin, or the page open in another tab): if any plan's price was saved after you opened the page, nothing is saved, and usually your code is not used up (§9, "Saving prices"). The page says "The prices changed meanwhile", names the plans and shows the current prices; your reason stays. Check the prices and save again.
3. **App Store listing, the same day.** Shopify takes the price of each plan from the plan itself. Check the pricing content in English and German (display name, top features; for Own key the additional-charges text) and change any text that no longer fits (docs/APP_STORE_LISTING.md, "Pricing details"). Update the prices line there.
4. **Check.** The app's Plan page shows the new price within about 30 seconds: each process keeps the table for 30 s, and the first page after that still shows the kept table while the process reads it again. The website (`/preise`, and "ab … $" on `/`) within about 5 minutes more (`Cache-Control: public, max-age=300`). Shopify's plan page on the development store (`https://admin.shopify.com/store/linguva-test-lab/charges/<app-handle>/pricing_plans`) shows what Shopify charges.

The Prices page says this above the form: "1. Change the price in the Partner Dashboard (link): Shopify charges that price. 2. Save the same price here: the website and the app's Plan page show it within a few minutes." After a save it lists the changed plans and reminds you of the Partner Dashboard and the listing text.

**Rules the form and the save enforce.** The database's CHECK constraints (migration `20261107090000_admin_console`) cover the ranges and Free. "At least the monthly price" and Own key's "monthly only" are checked only by the form and `savePrices`, not by the database. If the database still refuses a value, nothing is saved and the form says "The database refused these prices".

| Plan | Monthly | Yearly |
|---|---|---|
| Free | stays 0 (no field) | none |
| Starter, Pro, Business | $1.00 to $100,000.00 | empty, or $1.00 to $1,200,000.00 and at least the monthly price |
| Own key | $1.00 to $100,000.00 | none (monthly only, like its plan in the Partner Dashboard) |

**Warnings** (shown, never blocking): Pro doesn't cost more a month than Starter, or Business not more than Pro; or a price's estimated margin at full use is under 40 % (monthly, and yearly ÷ 12). The margin is PRICING_DECISION.md §6.1's worst case: (price × 0.821 − included characters × $27.50 per million − $0.50) ÷ price (`estimatedMargin`, `MARGIN_MODEL` in `app/lib/plan-prices.ts`).

**Defaults.** A plan without a saved price shows its default: `PLAN_PRICES` and `OWN_KEY_PRICE` in `app/lib/plans.ts` (`DEFAULT_PRICES`). The defaults are also what a page shows when the database doesn't answer within 1.5 seconds and no table was read before (a process's first page, for example after a restart during an outage), and what the static website image always shows. To go back to a default, save the default value (a saved row is never deleted; the page then marks the plan as default). To make a new price the default too, change `PLAN_PRICES` or `OWN_KEY_PRICE`, the default texts between the website's price markers (`<!--price:…-->` in `site/index.html` and `site/preise.html`) and `tests/unit/plan-prices.test.ts` together, in a code change; the tests compare them.

**A saved price stays in force.** The website and the Plan page show a plan's saved price (its `PlanPrice` row) whether the console is on or off. Once a plan's price has been changed in the console, also back to its default value, a code change to `PLAN_PRICES` or `OWN_KEY_PRICE` changes nothing for that plan. To change its price, save it in the console (turn the console on again if it is off). Or delete that plan's row with the owner role, so the plan shows its default again (the runtime role can't delete it), for example `psql "$MIGRATION_DATABASE_URL" -c "DELETE FROM \"PlanPrice\" WHERE \"handle\" = 'starter';"`. The plan then shows its default (the Plan page within about 30 seconds, the website within about 5 minutes more). This leaves no entry in the console's history. Then check `/preise` and the Plan page.

**What follows the saved prices:** the four plan cards, the comparison table's price row and the questions on the Plan page, the Own key card, and on the website every monthly price, the yearly line ("oder 290 $ / Jahr" with "2 Monate gratis" when the yearly price is a whole number of free months; "Nur monatlich" without a yearly price), the table's yearly note, Own key's note and the home page's "ab 29 $".

**Not covered:**
- The trial ("bis zu 7 Tage", "7-day trial") is text and code, not part of the price table.
- A yearly Own key price. Own key is monthly only in the Partner Dashboard (PRICING_DECISION.md §9 step 11), and the Plan page says "monthly only" (`plan.compare.ownKeyNote`). The Prices page has no yearly field for it, and the form and `savePrices` refuse one ("Own key is monthly only, like its plan in the Partner Dashboard", `offersYearly` in `app/lib/plan-prices.ts`). A yearly Own key price needs a code change.

## 4. Pages

As specified for v1 (`app/routes/admin*.tsx`). Every page reads its data on the server; nothing is cached in the browser (`Cache-Control: no-store`).

| Page | Address | What it shows |
|---|---|---|
| Sign-in | `/admin/login` | E-mail, password, 6-digit code, language switch. One message whatever was wrong ("E-mail, password or code is wrong."); after too many attempts "Too many attempts. Try again in 15 minutes." A signed-in visitor goes to `/admin`; after signing in you return to the page you asked for (only `/admin` addresses of this site, in printable ASCII; anything else leads to `/admin`) |
| Layout | every page | "Linguva Admin", language switch EN \| العربية, your e-mail and role, Sign out; navigation Overview, Customers, Subscriptions, Prices, Activity (a sidebar from 960 px; below that a tab bar that scrolls sideways, with the current tab in view) |
| Overview | `/admin` | Active stores, paying stores, estimated monthly revenue (MRR) with ARR, stores in trial, Linguva's AI characters this month with their estimated cost (characters through the stores' own keys on a line of their own: "Plus own keys"); stores per plan; trials ending in the next 7 days (at most 10); the 5 newest stores; cancellations and pending plan changes; a banner when billing isn't configured ("every store has all features"); "Data from <time> · Reload" (Reload reads the database again, then returns to the page's address without `?refresh=1`) |
| Customers | `/admin/customers` | Every store, 50 a page: search by name or domain, filters by status and plan (the fields follow the address, also with Back and Forward), sort (newest, oldest, most AI characters with own keys, revenue, name); plan badge with trial, cancellation and "Not checked yet" marks, status, install date, additional languages (not counting the primary one), Linguva's AI characters this month (own-key characters below), estimated revenue a month |
| Store | `/admin/customers/<id>` | Name, domain, status, "Open in Shopify admin"; subscription (every cached field and when it was checked, or "Not checked yet"; "Ask Shopify again" for roles that may); usage of the current and the five previous UTC months, Linguva's characters and own-key characters apart; additional languages; complimentary access (read-only, with the `pnpm ops:complimentary` hint); installations (newest 20); jobs of the last 30 days by status; automatic translation and smart schedule on or off. Unknown ids answer 404 |
| Subscriptions | `/admin/subscriptions` | Counts per plan and billing period; the stores with a subscription (plan, period, state, trial end, period end, cancelling, pending plan, checked at or "Not checked yet"); filters (plan, in trial, cancelling); revenue totals |
| Prices | `/admin/prices` | Per plan: monthly and yearly price (Own key: "Monthly only"), the default, the last change, the estimated margin; the two-step notice (§3); the form for OWNER and FINANCE, a read-only table for the others; the last 20 changes |
| Activity | `/admin/activity` | The last 50 price changes and the last 30 sign-ins (sessions: active or ended) |

**On a phone** (below 720 px): the header has two rows (the name and the language switch, then your e-mail, role and Sign out). Tables show each row as a card: its name on top, then every value under its column's name (Customers, Subscriptions' store list, a store's usage, the sign-ins and both price histories; the plan mix on Subscriptions stays a table). Below 960 px, and on any touch screen, the language links and the navigation links are at least 44 px high.

**Languages:** English and Arabic (right to left), Western digits in both, dates in UTC with the zone shown. The choice is kept in the `lv_admin_lang` cookie (Path `/`, so the pages' data requests to `/admin.data` carry it too; one year; `?lang=en` or `?lang=ar` sets it); the first visit follows the browser's language.

**Plans as the console names them:** free, starter, pro, business, own-key (every Own key handle), complimentary (an active grant that `COMPLIMENTARY_SHOP_GIDS` lists), unknown (a handle the app doesn't map, or no subscription checked while billing is configured: never, or not since the store was uninstalled or reinstalled, "Not checked yet"). Without billing configured (`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_TOKEN`, `SHOPIFY_APP_GID`) such a store counts as free.

**A billing cycle that has ended** by the cache's own dates (Shopify answered before the period end, and the period end has passed) counts as what followed it: a subscription cancelled at the end of that cycle counts as free (no revenue), a pending plan change as the new plan at its price. The Overview leaves such stores out of its cancellations and pending plan changes. The "Cancelling" marks and the Subscriptions page's "cancelling" filter leave such stores out too; the next plan and the store's page still show Shopify's last answer as it is, with its past period end; "Ask Shopify again" brings the cache up to date. An answer given after the period end stands as it is.

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
   | Pre-deploy command | empty (`web` runs the migrations). `node scripts/migrate.mjs` here would need `MIGRATION_DATABASE_URL`, which this service doesn't get (step 3): without it the step stops with "MIGRATION_DATABASE_URL is not set" and the deploy fails |
   | Health check path | `/healthz` |
   | Restart policy | On failure |
   | Replicas | 1 (each process keeps its own 60-second directory cache, §9) |
   | Automatic deploys | as on `web` |

3. **Variables.** Every variable of `web`, with the same values (copy them, or reference them as `${{web.NAME}}`), **except** `MIGRATION_DATABASE_URL` (the console never needs the owner role, and this service runs no migrations) and the translation engine keys (`DEEPL_API_KEY`, `DEEPL_API_KEY_2`, `DEEPL_API_KEY_3` … if set, `DEEPL_API_KEYS`, `AZURE_TRANSLATOR_KEY`, `GOOGLE_TRANSLATE_API_KEY`, `GOOGLE_TRANSLATE_CREDENTIALS`: the console translates nothing, and the app starts without them). Keep in particular:
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
| `list` | Every account: role, state (active, locked, disabled), failed attempts (wrong passwords and codes since the last accepted code; a record only, the lock is decided by the count in Redis, §8), last sign-in, active sessions, created | — |

Roles: `OWNER`, `FINANCE`, `SUPPORT`, `READONLY`. E-mails are stored in lower case. There is no command that deletes an account: disable it.

- **Someone leaves, or an account may be misused:** `disable` at once. Its sessions end with the next request.
- **Locked account** (every 5th wrong password or code in a run, at sign-in and when saving prices together; §8): it unlocks by itself after 15 minutes; `enable` (or `set-password`) unlocks it at once. They don't reset the run's count, which is kept in Redis: a lock still comes with every 5th wrong attempt of that run. While it is locked, its sessions don't work either. Anyone who knows the e-mail can lock it this way again and again (§9).
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
- **Turning the console off:** set `ADMIN_CONSOLE=off` on `admin` (or remove the service) and redeploy. Every `/admin` address then answers 404; the accounts stay in the database. Saved prices stay in force: the website and the Plan page keep showing them, and a code change to `PLAN_PRICES` or `OWN_KEY_PRICE` affects only plans without a saved price (§3, "A saved price stays in force").

## 8. Security model (summary)

Full review: SECURITY_MODEL.md §5s (database) and §6 (the console).

- **Where it answers:** only with `ADMIN_CONSOLE=on`, only on `ADMIN_HOST` (when set), and on a hosted stage only over https (the request URL, or the right-most `X-Forwarded-Proto` that Railway's proxy adds). Otherwise 404, before any database access.
- **Sign-in:** e-mail, password and a TOTP code in one form, always required. Passwords: scrypt (N = 32768, r = 8, p = 3, 16-byte salt) from Node's crypto. Codes: RFC 6238 (SHA-1, 6 digits, 30 s, one step of drift either way); each code works once per account. One generic error. Wrong passwords and codes (at sign-in and when saving prices) are counted in runs, in Redis: every 5th wrong attempt of a run locks for 15 minutes. A run ends with an accepted code, or 24 hours after its last attempt. Unknown and disabled e-mails are counted and locked the same way, so the answers, and when they change, don't tell which accounts exist. An account's lock is its `lockedUntil` in the database; an e-mail without an enabled account is locked in Redis for as long. Every attempt is counted before it is checked: while Redis can't be reached, signing in and saving prices fail and no password or code is checked. At most 20 attempts per client address in 15 minutes (Redis; the client is the right-most `X-Forwarded-For` entry).
- **Sessions:** a random token in the `__Host-lv_admin` cookie (HttpOnly, Secure, SameSite=Strict, Path=/); the database keeps only its SHA-256. A session ends after 8 hours, after 30 idle minutes, on sign-out, and when the account is disabled, locked, or gets a new password or TOTP secret.
- **Signing out** is the frame's form (POST with the CSRF token). `GET /admin/logout` (a typed or followed link) signs nobody out: it answers like any console address (404 while the console is off or on another host, else the sign-in page or `/admin`).
- **Every write:** the browser's Origin (when sent) must be the console's own, and the form must carry the session's CSRF token. Saving prices also needs a fresh code and a reason.
- **Accounts:** only the operator tool with the owner role can create or change them; the app's database role can't (grants, checked at start by the posture check).
- **Data:** every store's figures are read inside that store's tenant (`withTenant`, row-level security), never with a bypass role. No merchant content, no Shopify tokens.
- **Audit:** `admin.signed_in`, `admin.sign_in_failed`, `admin.signed_out`, `admin.prices.changed`, `admin.subscription.refreshed`, and the operator tool's `admin.account.*`.
- **Headers:** a strict Content-Security-Policy, `X-Frame-Options: DENY`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: same-origin` (SECURITY_MODEL.md §5e), on the pages and on the console's own redirects and refusals (404, 403) too.

## 9. Limits and scale

- **The store list is built shop by shop.** The console lists every store (`Shop` is a global table), then reads each store's figures in that store's tenant: one transaction with one SQL statement per store, at most 4 stores at a time. The result is kept in the process for 60 seconds; "Reload" rebuilds it. Plan, trial and revenue are worked out again on every request from the current list prices, so a price change shows at once. A store's own page is read fresh each time.
- **Scale:** a rebuild costs one transaction per store, so it grows with the number of stores. It hasn't been measured. Searching, filtering, sorting and paging happen in memory over all rows. The first request after the 60 seconds waits for the rebuild (requests at the same moment share it), which uses up to 4 database connections at once. If a rebuild becomes too slow, the figures would have to come from a summary the worker keeps up to date (not built).
- **One cache per process:** with more than one replica each builds its own; run one.
- **Revenue is an estimate:** current list prices × the stores' plans (yearly billing = the yearly price ÷ 12); 0 for free, trial, complimentary, unknown and uninstalled stores. It is not what Shopify charges: older prices, discounts, proration, taxes and Shopify's share aren't included.
- **Subscriptions are a cache:** the Partner API's answer as of "checked at". It is asked again when Linguva needs the store's plan (an app page, a job) and the answer is older than 6 hours, after Shopify's welcome link, with Refresh on the Plan page, or with "Ask Shopify again". Shopify sends no billing webhooks, so an inactive store keeps its last answer.
- **Usage** is the current UTC month (the store page: six months). Costs are estimates from `AI_COST_USD_PER_MILLION_CHARS` and the other engines' rates.
- **Lists:** Activity shows the last 50 price changes and the last 30 sign-ins; the Prices page the last 20 changes. Ended sessions stay 30 days after they expired and are deleted at the account's next sign-in.
- **Prices:** US dollars only (Shopify App Pricing is USD only). Each process reads the table at most every 30 seconds, one read at a time for all its pages. Once it has a table, no page waits: the page gets the kept table while it is read again in the background. A process's first page (and the first after a save in that process) waits at most 1.5 seconds. Without an answer by then, or when the read fails, pages show the last table read, else the defaults (logged once), and the next try comes at least 5 seconds later, in the background. A read that answers late replaces that fallback. The trial isn't part of the table (§3).
- **Saving prices:** one save at a time (an advisory lock, the rows read `FOR UPDATE`). Every plan's version (when its row was last saved, and its amounts; "default" without a row) goes into the form. A form read before another save is refused (409) and nothing is written. The route checks this before the code, so the code is not used up; `savePrices` checks it again under its lock, which also catches a save that came in between (then the code was used).
- **Sign-in limits:** if a request carries no `X-Forwarded-For`, all such requests share one limit ("local"). That Railway's proxy appends the client address as the right-most entry is not verified on Railway.
- **The sign-in counts live in Redis:** while Redis can't be reached, nobody can sign in or save prices (§8). Emptying Redis ends the runs of wrong attempts and the locks of e-mails without an account; the locks of accounts (`lockedUntil`) stay.
- **Lockout as a nuisance:** anyone who knows an admin's e-mail can keep that account locked with 5 attempts every 15 minutes. The own, unlinked domain makes this harder; `enable` unlocks.
- **Not built in v1:** WebAuthn (security keys, passkeys), recovery codes, changing your own password or code in the console, alerts on sign-in, the client address in audit rows.
- **The pages' code is public:** the console's route modules are part of the app's browser bundle on every service, also where the console is off (paths and interface texts, no data).

## 10. Tests

All of them run in CI (unit, integration, security and UI jobs).

| What | Where |
|---|---|
| Passwords (format, verification, malformed hashes, the dummy hash's timing), TOTP (RFC 4226 and 6238 test vectors, the drift window, base32, encrypted secrets), where the console answers, roles, `next` redirects (only printable `/admin` paths that read back as written), cookies, Origin, the client address, log redaction | `tests/unit/admin-auth-password.test.ts`, `admin-auth-totp.test.ts`, `admin-auth-console.test.ts` |
| Sign-in, lockout (one count for accounts, unknown and disabled e-mails alike, forgotten 24 hours after the last attempt; an accepted code starts a new run; wrong fresh codes and wrong sign-ins count together; nothing is checked when the count fails), per-client limit, code reuse, sessions (expiry, idle, revoke), CSRF and Origin, fresh codes | `tests/integration/admin-auth.test.ts` |
| The sign-in, sign-out and frame routes through React Router's own request handler: the console's headers on every answer, its redirects included; `GET` and `HEAD /admin/logout` sign nobody out; a `next` that can't be a `Location` header ends on `/admin` | `tests/integration/admin-auth-routes.test.ts` |
| The operator tool, bundled and run as the owner role | `tests/integration/admin-cli.test.ts` |
| Directory, overview figures, revenue in cents, filters, ended billing cycles, a store not checked since a reinstall | `tests/unit/admin-data-directory.test.ts`, `tests/integration/admin-data.test.ts` |
| Price form (Own key monthly only, the reason's rules, versions), warnings, cache (a hanging database, the 1.5-second limit, one shared read, background refresh), Plan page and website with other prices, the static image's defaults; stale forms refused with nothing written, the database's refusals as form errors | `tests/unit/admin-data-prices.test.ts`, `tests/unit/plan-prices.test.ts`, `tests/unit/public-pages-own-key.test.ts`, `tests/integration/admin-prices.test.ts` |
| The Prices page's save end to end: a stale form answers 409 before the code is used, the same save goes through after a reload, refused reasons and a yearly Own key price are form errors | `tests/integration/admin-prices-route.test.ts` |
| The texts (English and Arabic with the same keys and placeholders, every key used), language and formats, the pages rendered on the server (one h1, labelled forms with the CSRF token, tables, no inline style), the frame's parts (focus moves of the skip link and the error summary, filters that follow the address, the current tab in view, card tables with their table roles, own-key lines, "Not checked yet", contrast and touch targets from `admin.css`), the Reload and language redirects | `tests/unit/admin-ui-messages.test.ts`, `admin-ui-locale.test.ts`, `admin-ui-render.test.ts`, `admin-ui-shell.test.ts`, `admin-ui-routes.test.ts` |
| In a real browser (production build, desktop and phone): the sign-in page with axe and the generic message for a wrong code, the way to sign-in without a session and back, every page in English and Arabic, light and dark, with axe and no sideways scroll (cards on a phone, the current tab in view), navigation and filters (Back and Forward), Reload without a parameter left, error summary and skip link, a wrong code saves no price, the language cookie's path, sign-out | `tests/ui/admin.spec.ts` |
| Every admin route calls `requireAdmin` itself (the sign-in page `requireAdminConsole`), no other route does; admin routes build no redirect or `Response` without the console's headers | `tests/security/structure.test.ts` |
| The runtime role can't write accounts or rewrite the price history, also through a grant on single columns | `tests/security/postgres-privileges.test.ts` |
| The console's headers (also on `adminResponse` and `adminRedirect`); everything outside `/admin` unchanged | `tests/unit/security-headers.test.ts` |
| `ADMIN_CONSOLE` and `ADMIN_HOST` documented for production | `tests/unit/deploy-config.test.ts` |

## 11. ملخص بالعربية

- **ما هي:** لوحة تحكم على العنوان `/admin` تعرض المتاجر التي ثبّتت التطبيق، واشتراكاتها كما أبلغ عنها Shopify آخر مرة، واستهلاكها للذكاء الاصطناعي، وإيرادًا تقديريًا، وأسعار الخطط التي يعرضها Linguva. اللوحة معطّلة افتراضيًا (`ADMIN_CONSOLE=off`)، ولا تعرض أي محتوى من متاجر التجار (لا نصوص منتجات ولا ترجمات).
- **الأسعار:** حفظ سعر في اللوحة لا يغيّر إلا ما يعرضه Linguva: الموقع وصفحة الخطة في التطبيق. أما المبلغ الذي يدفعه التاجر فيحدده Shopify وفق Partner Dashboard، ولا توجد واجهة برمجية لتغييره. خطة «مفتاح خاص» (Own key) شهرية فقط، فلا تقبل اللوحة لها سعرًا سنويًا.
- **تغيير السعر بخطوتين في اليوم نفسه:** (1) غيّر السعر في Partner Dashboard أولًا. (2) احفظ السعر نفسه في صفحة «الأسعار» مع سبب (من 3 إلى 500 حرف) ورمز جديد من تطبيق المصادقة. ثم راجع نصوص الأسعار في صفحة التطبيق على App Store بالإنجليزية والألمانية. إذا حفظ أحد غيرك الأسعار بعد أن فتحتَ الصفحة، فلا يُحفظ شيء وتظهر رسالة «تغيّرت الأسعار في هذه الأثناء» مع الأسعار الحالية، فراجعها ثم احفظ من جديد.
- **السعر المحفوظ يبقى نافذًا:** يبقى ظاهرًا على الموقع وفي صفحة الخطة حتى بعد تعطيل اللوحة، ولا يغيّره تعديل `PLAN_PRICES` أو `OWN_KEY_PRICE` في الكود. لتغييره احفظ سعرًا جديدًا في اللوحة.
- **التشغيل على Railway:** خدمة ثانية باسم `admin` من الصورة نفسها ولها نطاقها الخاص. تأخذ متغيرات `web` نفسها ما عدا `MIGRATION_DATABASE_URL` ومفاتيح محركات الترجمة، وتُضاف إليها `ADMIN_CONSOLE=on` و`ADMIN_HOST` (اسم نطاقها) و`LINGUVA_EMBEDDED_WORKER=off`. تبقى اللوحة معطّلة على خدمة `web`. انشر `web` أولًا، فهي التي تطبّق ترحيل قاعدة البيانات (migration)، أما `admin` فلا تشغّل أي ترحيل.
- **أول حساب:** من جهازك، بدور مالك قاعدة البيانات: `pnpm ops:admin add --email … --role OWNER`. أضف المفتاح الذي تطبعه الأداة إلى تطبيق مصادقة يعطي رمزًا من 6 أرقام كل 30 ثانية، ولا تلصقه في أي موقع أو محادثة.
- **الدخول:** البريد الإلكتروني وكلمة المرور ورمز المصادقة معًا. كل خمس محاولات خاطئة تُقفل الحساب مدة 15 دقيقة، ويبدأ العدّ من جديد بعد رمز مقبول أو بعد 24 ساعة من آخر محاولة. ويُعامَل البريد غير المعروف أو المعطّل بالطريقة نفسها، فلا تكشف الإجابات أي الحسابات موجودة.
- **الأدوار:** OWNER («مالك») وFINANCE («المالية»): العرض وزر «اسأل Shopify مجددًا» وتغيير الأسعار. SUPPORT («الدعم»): العرض و«اسأل Shopify مجددًا». READONLY («قراءة فقط»): العرض فقط. تُدار الحسابات من سطر الأوامر فقط.
- **فقدان الهاتف:** نفّذ `disable`، ثم `reset-totp` وأضف الحساب إلى الهاتف الجديد، ثم `enable`. لا توجد رموز استرداد.
- **الحالة:** مُنفّذة ومختبرة، وتعمل اختباراتها كلها في CI. لم تُنشر بعد، ولم يُتحقق منها على Railway.
