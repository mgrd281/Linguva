# Linguva

AI translation and multilingual SEO app for Shopify merchants (public app, planned for the Shopify App Store).

**Current status: Phase 0 (discovery and architecture). There is no application code yet.** Everything in `docs/` is a proposal unless it explicitly says otherwise.

## Documentation

| Document | Content |
|---|---|
| [docs/SHOPIFY_API_MATRIX.md](docs/SHOPIFY_API_MATRIX.md) | Verified Shopify API findings (Admin API 2026-10) and open assumptions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, repository structure, ADRs |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Proposed data model, RLS, retention |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | Tenant isolation, secrets, threat model |
| [docs/TRANSLATION_ENGINE.md](docs/TRANSLATION_ENGINE.md) | Feature feasibility matrix, translation pipeline |
| [docs/BILLING_DESIGN.md](docs/BILLING_DESIGN.md) | Shopify App Pricing, entitlements, usage metering |
| [docs/COST_MODEL.md](docs/COST_MODEL.md) | Unit economics (assumptions) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones, risk register, open decisions, next task |
| [CHANGELOG.md](CHANGELOG.md) | Change history |

## Project boundaries

This repository is independent from all existing production systems (SOFTWAREFACH, KARINEX storefronts, accounting apps, existing Railway services). It never accesses a production store without explicit authorization, and nothing is deployed without explicit approval.
