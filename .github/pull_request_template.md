## Summary

<!-- What changes and why. -->

## Status of what this PR adds

<!-- One line per feature: Implemented / Tested locally / Verified on Shopify (docs/FEATURE_STATUS.md). Don't claim "Verified on Shopify" without a dev store run recorded in docs/DEV_STORE_SETUP.md §4. -->

## Checks

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test:all`, `pnpm build`, `pnpm check:ignored` pass locally
- [ ] No secrets, tokens or customer data in the diff
- [ ] New tenant tables have RLS + FORCE + the standard policy (the posture check passes)
- [ ] **No change to a SECURITY DEFINER function**, or: the change has a security review, the reviewed hash in `app/.server/lib/db-posture.ts` is updated, and `docs/SECURITY_REVIEW_MEMORY_FUZZY.md` records it
- [ ] Nothing here touches a production store, deploys, or enables paid services
