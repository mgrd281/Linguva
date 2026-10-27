# Security review: `linguva_memory_fuzzy()` and `TranslationMemory` without FORCE RLS

Date: 2026-10-28. Scope: migrations `20261027180000_memory_fuzzy_function` and `20261028090000_security_hardening`, `app/.server/memory/translation-memory.ts`, database roles and grants.

**Verdict:** the function grants no access beyond what row-level security already grants for the same transaction state. This is proven by tests that compare it against a direct RLS-filtered query for every `app.shop_id` state, and by adversarial tests. The review found and fixed three hardening gaps and one unrelated over-broad grant (§5). The remaining risks are listed in §6.

## 1. Why a SECURITY DEFINER function

Fuzzy matching uses `pg_trgm` (`"sourceText" % $text`). Under RLS, PostgreSQL evaluates a query's own conditions after the security policy unless they are `LEAKPROOF`. The trigram operator isn't, so no index can serve it. Every search computed `similarity()` for all of a shop's entries.

| Measurement (100,000 entries for one shop + 100,000 for another) | Time |
|---|---|
| Direct query under RLS (before) | 446 ms |
| Function + shop/trigram GIN index (now) | 37 ms median, 49 ms p95, recall 10/10 |

The function runs as the table owner, which RLS doesn't force on `TranslationMemory`, so the planner may use the index. In exchange, the function must enforce tenant isolation itself, and it must not be redirectable.

## 2. The function as reviewed

| Property | State | Test |
|---|---|---|
| Owner | `linguva_owner` (migration role): not superuser, no BYPASSRLS. The migration refuses to run as a superuser or BYPASSRLS role | posture check `DEFINER_OWNER_PRIVILEGED`, migration guard |
| `SECURITY DEFINER`, `VOLATILE`, plpgsql, no dynamic SQL | Parameters are bound values; nothing is concatenated into SQL | injection payloads test |
| `search_path` | `pg_catalog, pg_temp`. Every object from `public` is schema-qualified: `public."TranslationMemory"`, `public.similarity`, `OPERATOR(public.%)`, `public."MemoryStatus"`. PostgreSQL never resolves functions or operators from `pg_temp`, and with qualified names a temp table can't shadow the real one | pg_temp hijack test (temp table, temp `similarity`, temp `length`); mutation with `pg_temp` first is detected |
| Tenant | Read only from `current_setting('app.shop_id')`, with the same expression as the RLS policy. There is **no shop parameter**. Unset or empty → no rows. Malformed → error, no rows | equivalence and fail-closed tests |
| Grants | `EXECUTE` revoked from PUBLIC, granted only to `linguva_app` | posture check `DEFINER_PUBLIC_EXECUTE`; the probe role is denied |
| Input bounds | Text over 2,000 characters, threshold under 0.3, or NULL parameters → empty result. Limit is clamped to 1–10 | parameter abuse test |
| Side effect | Sets `pg_trgm.similarity_threshold` transaction-locally. This only affects later `%` operators in the same transaction | documented |
| Output | `id`, `sourceText`, `targetText`, `status`, `score` of the current tenant's entries: the same columns the app reads directly | — |

## 3. Proof that no other shop's data can be read

All tests are in `tests/security/postgres-privileges.test.ts` (and `memory-glossary-review-security.test.ts`) and run in CI against PostgreSQL 16 with real roles:

1. **Equivalence with RLS.** For `app.shop_id` unset, empty, shop A, shop B and a random UUID, the function returns exactly the rows a direct RLS-filtered query returns in the same transaction.
2. **Attacker sets `app.shop_id` (SQL-level control).** Whoever can set `app.shop_id` to shop B sees B's rows through RLS anyway. The function gives exactly that and no more. The trust boundary is unchanged: only `withTenant()` sets the value, from the verified Shopify session, transaction-locally.
3. **Malformed values** (`not-a-uuid`, `<uuid>' OR '1'='1`) raise an error and return no data.
4. **Pooled connections.** After a `withTenant()` transaction, the same pool without a tenant gets nothing (repeated 5×).
5. **`pg_temp` redirection.** A temp table named `TranslationMemory` with planted rows, a temp `similarity()` returning 0.99, and a temp `length()` are all ignored.
6. **Parameter abuse.** SQL payloads, `%`/`_` as text and as a market name, limit 1000 and −5, threshold 0.1, NULLs, and a 100,000-character text all stay within the tenant and the bounds. Nothing is deleted.
7. **Third role.** `linguva_probe` (a database user with no grants) can't read any tenant or global table and can't execute the function, whatever `app.shop_id` says.
8. **Runtime role can't weaken security.** It can't `SET ROLE` to the owner, disable or unforce RLS, drop policies or add permissive ones, replace the function or change its owner, create objects in `public` (for example a shadowing `similarity`), truncate or delete append-only data, read the audit log, or grant itself privileges.

**Mutation checks** (deliberately weakened function, re-run, restored):

| Weakening | Tests that failed |
|---|---|
| `search_path = pg_temp, public, …` and unqualified table | posture, pg_temp hijack |
| Tenant filter removed | equivalence, pg_temp, parameter, `app.shop_id` tests |
| `EXECUTE` granted to PUBLIC | posture, probe role |

## 4. Effect of removing FORCE RLS on `TranslationMemory`

- **Who changes:** only the table owner, `linguva_owner`, which runs migrations. It now reads and writes all shops' rows in this table without setting a tenant. The owner can already alter or disable RLS on its tables, so FORCE was a guard against mistakes, not a security boundary against the owner.
- **Who doesn't change:** `linguva_app`, the only role the app and worker use (verified: the app's client connects as `linguva_app`). It stays under RLS for every operation: reads without a tenant return nothing; reads, updates and deletes only touch the tenant's rows; inserts for another shop are refused by the `WITH CHECK` (tested).
- **Other operations:**
  - `shop/redact` deletes via `ON DELETE CASCADE` from `Shop`. Referential actions bypass RLS with or without FORCE, so this is unchanged (tested in the webhook suite).
  - No migration reads translation memory.
  - Test helpers that use the owner connection already filter by shop.
- **All other tenant tables** still force RLS. The test "is the only tenant table without FORCE" and the posture check enforce that.

## 5. Findings of this review (fixed)

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | The function's `search_path` included `public`, and names were unqualified. Not exploitable today (the runtime role has no `CREATE` on `public`, and `pg_temp` was last), but any future `CREATE` grant would have allowed shadowing `similarity` or the operator | Medium (defense in depth) | `search_path = pg_catalog, pg_temp`, everything schema-qualified |
| F2 | Nothing prevented the function from being created by a superuser, for example if an operator ran migrations as `postgres`. A superuser-owned definer function turns any future flaw into a full bypass | Medium | The migration refuses superuser/BYPASSRLS. The runtime posture check flags it |
| F3 | No runtime verification that the deployment matches the reviewed posture (roles, RLS, FORCE, policies, definer functions) | Medium | `checkDatabasePosture()`, run once per process by the web app, webhooks and the worker. **In production a failed check stops serving** |
| F4 | `AuditLog` (no RLS, entries of all shops) was readable by the runtime role, although the app never reads it | Medium | `SELECT` revoked. Audit writes use `createMany` (no `RETURNING`) |
| F5 | Input size wasn't bounded inside the function | Low | Over 2,000 characters → empty |

## 6. Remaining risks

| # | Risk | Assessment |
|---|---|---|
| R1 | Whoever can run arbitrary SQL as `linguva_app` can set `app.shop_id` to any shop | Same as plain RLS. Mitigated by parameterized queries only, `withTenant()` as the single place that sets it, and the absence of user SQL |
| R2 | A compromised owner role controls everything (tables, function, policies) | Inherent to any owner. Keep its credentials out of the runtime: only migrations use it |
| R3 | A future migration could replace the function body with a weaker one | The posture check verifies owner, search path and grants, not the body. The equivalence and adversarial tests run in CI on every change; any change to this function needs a security review |
| R4 | `pg_trgm` and `btree_gin` live in `public`; their functions are owned by the installing role | Not callable in unexpected ways from the function (qualified names). Moving the extensions to their own schema is possible later |
| R5 | Production roles are created by the operator | The posture check fails closed in production if the runtime role is superuser, BYPASSRLS, owns tables or can create in `public` |

## 7. Alternatives considered

| Alternative | Why not (now) |
|---|---|
| Keep the RLS-only scan | 446 ms at 100k entries, growing linearly; acceptable only for small shops |
| Mark `pg_trgm` operator functions `LEAKPROOF` | Needs superuser and changes the extension globally; not available on most managed PostgreSQL; a leakproof claim for third-party C functions is itself a risk |
| Dedicated role with `BYPASSRLS` owning the function | Needs superuser to create; broader than "owner of one table without FORCE" |
| MinHash/LSH band keys (equality lookups, which are leakproof, so no definer function) | No bypass at all, but about 25 extra index entries per memory entry and approximate recall (~97% at similarity 0.6). **Fallback if a security policy forbids definer functions** |
| External search engine per tenant | New infrastructure, cost and data processor |
| Partition by shop | Pruning doesn't remove the RLS barrier for the operator |

Revisit if: the function needs a second caller, managed PostgreSQL offers leakproof trigram operators, or memory per shop exceeds ~1M entries.

## 8. Changing the function (or adding a definer function)

1. Write the change as a new migration (`CREATE OR REPLACE`), keeping the hardening of §2.
2. The posture check and CI then fail with `DEFINER_CHANGED_WITHOUT_REVIEW` (or `UNREVIEWED_SECURITY_DEFINER` for a new function). A comment-only edit counts too (tested).
3. Run a security review of the new version: the threats in §3, plus anything the change introduces. Record it in this document.
4. Update the reviewed SHA-256 in `app/.server/lib/db-posture.ts` (`DEFINER_FUNCTIONS`) in the same PR. `CODEOWNERS` routes these files to the owner. Once branch protection requires code owner review on `main`, the PR can't be merged without the owner's approval.

## 9. Verification

- **CI** runs the security suite (including this review's tests), the performance suite (100,000 entries) and the posture check against PostgreSQL 16 with the three roles created by `scripts/db/init-roles.sql`, on a clean checkout.
- **Locally,** `pnpm check:ignored` fails if a source file is hidden by `.gitignore`. That is the class of mistake that once left `app/.server/coverage` out of the repository.
