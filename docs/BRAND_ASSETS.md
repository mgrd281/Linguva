# App icon and feature image: design specification

Requirements read on shopify.dev on 2026-10-28 ("App Store requirements", "Best practices for apps in the Shopify App Store"). Nothing is designed yet; this is the brief for a designer (or the owner).

## 1. App icon

| Requirement | Value |
|---|---|
| Size and format | 1200 × 1200 px, PNG or JPEG, square, no rounded corners baked in (Shopify applies its own mask) |
| Content | A simple mark, **no text**, no Shopify logo or Shopify-like bag, no screenshots |
| Legibility | Must read at 64 × 64 px in the App Store and in the admin's app list |

**Brief:** two overlapping speech bubbles (two languages) whose overlap forms a check mark (review before it goes live). Two colours on a solid background:

| Role | Colour | Note |
|---|---|---|
| Background | #1F2A44 (deep navy) | Contrast with the admin's light surfaces |
| Bubble A | #FFFFFF | |
| Bubble B / check | #29845A (Polaris success green, used for "Complete" in the app) | Ties the icon to the coverage colours |

Deliver the source (SVG/Figma) plus the 1200 × 1200 PNG; test at 64, 32 and 16 px.

## 2. Feature image (static, instead of a video at launch)

| Requirement | Value |
|---|---|
| Size | 1600 × 900 px (16:9) |
| Composition | One focal point, solid background, contrast at least 4.5:1, alt text |
| Not allowed | Shopify logos, the app card subtitle repeated, pricing, reviews, statistics or outcome guarantees |

**Brief:** left third: the short line "Approve every translation before it goes live" (not the card subtitle; checked against it); right two thirds: the Review queue (from `docs/app-store/screenshots/4-review.png`) cropped large, one flagged draft visible, on #F1F1F1 with a soft shadow. Alt text: "Review queue with AI translations waiting for approval; one is flagged because a number changed".

A 2–3 minute promotional video (screencast at most 25 % of it) can follow after launch.

## 3. Screenshots

Done: eight 1600 × 900 screenshots of the real app with the fictional demo catalog (`docs/app-store/screenshots/`, APP_STORE_LISTING.md). Add one of the coverage dashboard after the dev-store check (`APP_STORE_SCREENSHOTS=1`, see the spec).
