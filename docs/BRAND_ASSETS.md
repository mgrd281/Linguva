# App icon and feature image: design specification

Requirements read on shopify.dev on 2026-10-28 ("App Store requirements", "Best practices for apps in the Shopify App Store"). The app icon is done (§1); the feature image is still a brief.

## 1. App icon

**Done (chosen by the owner on 2026-10-30).** Files in `docs/brand/`:

| File | Use |
|---|---|
| `linguva-icon.svg` | Source (vector, 1200 × 1200 view box) |
| `linguva-icon-1200.png` | App icon for the Partner Dashboard and the App Store listing |
| `linguva-icon-512.png` | Smaller copy for documents and slides |
| `public/favicon.ico` | Browser tab icon (16, 32, 48, 64 px), served by the app |

**The mark:** a letter L drawn as a folded ribbon (green to turquoise above, violet to blue below) beside two cards: a light card with "A" (the original) and a green card with "文" (the translation). The full square background runs from green (top left) to dark navy (bottom right).

| Role | Colour |
|---|---|
| Background | #0C8A62 → #0A3D4C → #151C4D |
| L, upright | #5BF5BE → #1CC2DC |
| L, foot | #5A4CF0 → #2E8EF0 → #2BE0C8 |
| Original card / letter | #EEF1FF / #1B2350 |
| Translation card / letter | #2FDDA0 → #11946C / #FFFFFF |

Rules met: 1200 × 1200 PNG, square, no rounded corners baked in (Shopify applies its own mask), no Shopify logo. It contains the letters A and 文: Shopify recommends no text in icons, but it is not a rejection reason (Shopify Translate & Adapt and other translation apps use the same symbol), and the owner chose this version. Checked at 64, 32 and 16 px: the L and the green card stay recognisable; the letters become dots at 16 px.

**Owner step:** upload `linguva-icon-1200.png` in the Partner Dashboard, where the app icon is set. The admin's app list shows it from there; the app code cannot set it.

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
