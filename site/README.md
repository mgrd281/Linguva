# Linguva marketing website — v1 preview

This is the first real build of the public website, from the design the owner approved on the
canvas (https://claude.ai/artifact/AE1wwoRsMB3qdxNwsj9hsC). It is plain, static HTML and CSS: no
JavaScript framework, no cookies, no browser storage, no network requests except Google Fonts and
the two images it shows. The only script is a few inline lines that open and close the phone menu;
it reads and writes nothing, so it does not affect the privacy posture.

## What is here

- `index.html` — the home page (hero variant **A**, light).
- `preise.html` — the pricing page, with the decided prices from `app/lib/plans.ts` /
  `docs/PRICING_DECISION.md` (Free; Starter $29 or $290/year; Pro $99 or $990/year; Business $299
  a month only).
- `assets/` — the shared stylesheet (`style.css`, built from the design's tokens) and the real
  screenshots of the redesigned app pages that the home page shows.

Both pages are fluid from 1440 px down to 390 px (checked: no sideways scroll at 1440, 1024, 768
or 390 px) and pass an automated accessibility check (axe, WCAG 2.1 A/AA and 2.1 A/AA) with zero
violations.

## Known gaps (not done yet)

- **`meta name="robots" content="noindex, nofollow"`** is set on both pages on purpose: this build
  is for the owner's review, not for search engines or for linking from anywhere public yet.
- **No real domain.** Links use `mailto:support@[Domain]` and the footer reads
  `© 2026 [Anbieter laut Impressum]` — placeholders until the owner names a domain and provider.
- **No legal pages yet.** The footer's Impressum/Datenschutz/AGB/AVV/Unterauftragsverarbeiter links
  point to `#` anchors with no page behind them. Building them needs the owner's legal data and a
  lawyer's review (see `docs/OWNER_DECISIONS.md` §5); that work was started separately
  (in-app legal pages, not part of this site) and is not finished.
- **German only.** The design has an English/French/Spanish rollout planned
  (`docs/research/website.md` §2.2); only German is built.
- **Fonts load from Google Fonts**, not self-hosted yet (the design's plan is to self-host Inter so
  the site makes zero third-party requests; see `docs/research/website.md` §7, "no cookies, no
  banner").
- **Hero variant B (night)** exists only as a design board (`Web-Hero-Nacht.dc.html` on the canvas),
  not as a second real page. Build it once the owner picks A or B.
- **Not deployed anywhere.** This folder is not yet wired into Railway as its own service (the
  design's recommendation: a separate static service and domain, so pushes to it never redeploy
  the embedded app). It is not referenced by the app server, so adding it here does not change
  what Railway builds or runs for the app.

## Next steps, in order

1. Owner picks hero A or B, the domain, and the provider name for the footer and Impressum.
2. Finish the in-app legal pages (support, privacy) separately, or write real `impressum.html`,
   `datenschutz.html`, `agb.html` for this site once the owner's lawyer has reviewed the text.
3. Self-host Inter; drop the Google Fonts request.
4. Build the English/French/Spanish versions once native speakers have reviewed the app's own
   French and Spanish texts (the site should not be ahead of the app on translation quality).
5. Create a separate Railway service for this folder (Caddy, no build step), point the domain at
   it, then remove `noindex` and link to it from the App Store listing.
