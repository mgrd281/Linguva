# Storefront language selector: strategy

**Decision (proposal for the owner): Linguva does not inject a language switcher, script or redirect into the storefront.** It relies on Shopify's native language selector and Markets, explains to the merchant how to turn them on, and checks the setup. A theme app extension (app embed) is a later option only for themes without a selector.

## Why

| Reason | Source / evidence |
|---|---|
| Themes already provide the selector: a `localization` form with `language_code`, listing `localization.available_languages` (Dawn has it in the header and footer). | shopify.dev, "Support multiple currencies and languages" (read 2026-10-28) |
| Shopify recommends separate URLs per language (subfolders such as `/fr`, or domains); Shopify then outputs `hreflang` and the right `lang` itself. Linguva writes only Shopify's native translations, so every language has its own crawlable URL. | shopify.dev, "Internationalization with Shopify Markets" |
| No storefront script means no page-speed cost, no layout shift, nothing to leave behind after uninstall, and no visitor data processed (ADR-007). Leftover code and SEO damage are a top complaint about a competitor (COMPETITIVE_ANALYSIS.md §2). | |
| Automatic redirects by browser language or IP can keep search engines and travellers from reaching a language version; a visible choice is the safer default. Shopify's own Markets settings decide redirection where the merchant wants it. | General guidance; not implemented by Linguva |

## What Linguva does instead (implemented or planned)

| Step | Status |
|---|---|
| Markets page: which languages each market offers, under which URLs, unpublished languages, languages in no market (optional `read_markets` scope) | Implemented (Tested locally) |
| Coverage: unpublished languages marked and left out of the whole-store figure; market filter | Implemented (Tested locally) |
| Overview checklist step "Publish a language" with a link to Shopify's language settings | Implemented (Tested locally) |
| Help text: "Turn on the language selector in your theme (Online Store → Themes → Customize → header or footer → Language selector)" | To write in the help center; wording depends on the theme, verify on the dev store |
| Check whether the live theme shows a selector | Not possible reliably through the Admin API without reading theme files (`read_themes`), and theme markup varies; **not planned** |

## Later option: theme app extension (app embed)

Only if beta merchants use themes without a selector. An app embed block can render Shopify's `localization` form (no own logic: it submits to Shopify, which switches the language and URL). It must stay optional, off by default, without tracking, and be removed with the app (Shopify removes app embeds on uninstall). Effort about one week plus theme testing; needs the dev store.
