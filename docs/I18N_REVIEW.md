# Interface languages: review status

| Language | Texts | Written by | Reviewed by a native speaker |
|---|---|---|---|
| English | about 800 | Source | — |
| German | about 800 | Translated and checked in the UI tests | No |
| French | about 800 (phase G) | Machine-assisted translation | **No** |
| Spanish (neutral, Latin American style like Shopify's) | about 800 (phase G) | Machine-assisted translation | **No** |

Automated checks for every language (`tests/unit/i18n.test.ts`, `tests/ui/i18n.spec.ts`): same keys, same placeholders and plural forms as English, no English left over, no irregular whitespace, and each main page shown in the language passes the accessibility check (accessible names contain the visible labels). These checks can't judge tone or terminology. **Before French or Spanish is advertised in the App Store listing, a native speaker should read the texts in the app**, starting with the points below.

## Conventions used

- French: "vous", sentence case, a space before `: ; ? !` and inside « » (a plain space, the linter rejects non-breaking spaces).
- Spanish: "tú", as Shopify's Spanish admin; neutral Latin American vocabulary (agregar, costo, configuración).
- Language names: lower case in French and Spanish ("allemand", "alemán"), capitalised in German (`languageName()`).
- German on the Plan page: "KI-" compounds ("KI-Zeichen", "KI-Übersetzung") are written with a non-breaking hyphen (`\u2011`, drawn like "-"), so a narrow card or a phone never ends a line in "KI-". Keep it when editing those texts (`app/i18n/messages/plan.ts`).
- Shared terms: Révision / Revisión (Review), Tâches / Tareas (Jobs), Mémoire de traduction / Memoria de traducción, Forfait / Plan, quota d'IA / cuota de IA, champ personnalisé / campo personalizado, texte alternatif / texto alternativo, référencement / listado en buscadores.

## Points to check first

**Navigation and shared texts (`common`)**
- `common.field.summary_html`: "Résumé" / "Resumen". Shopify's admin may call a post's excerpt "Extrait" / "Extracto"; "Resumen" is also the Overview menu item.
- `common.kind.SHOP.*`: "Référencement de la boutique" / "Listado en buscadores de la tienda"; the French plural reads unusually.
- `common.kind.ONLINE_STORE_THEME_APP_EMBED.*`: "intégrations d'applications" / "inserciones de aplicaciones"; compare with Shopify's theme editor.
- `common.kind.PACKING_SLIP_TEMPLATE.*`: "Bordereau d'expédition" / "Albarán" (Spain; Latin America: "lista de empaque").
- `common.group.Checkout`: "Paiement" / "Pantalla de pago".
- `common.issue.FORMALITY_MISMATCH`, `WRONG_SCRIPT`, `SEO_TOO_SHORT`: free renderings.
- `common.nav.content` and `common.nav.jobs`: the short menu items "Contenus" / "Contenido" and "Tâches" / "Tareas" (the pages keep their longer headings).
- `settings.tools.*`: the tool names "Pays et marchés" / "Países y mercados", "Couverture en détail" / "Cobertura en detalle" and their one-line explanations.

**Editor, content, languages, landing page**
- `content.table.area` / `content.table.how`: "Domaine" / "Área", "Méthode" / "Método".
- `editor.badge.manualOnly`: "Manuel uniquement" / "Solo manual".
- `editor.discard`: "Ignorer" / "Descartar" (Shopify's own save bar wording).
- `editor.seo.heading`: "Aperçu du référencement" / "Listado en buscadores".
- `editor.valueType.*`: translated from the English, not from Shopify's metafield type names.
- `{singular}` sentences use "cet élément ({singular})" / "este elemento ({singular})" because the noun's gender varies.
- `landing.feature.control.text`, `landing.feature.seo.title`: marketing wording, free renderings.

**Jobs, glossary, memory, markets, plan**
- `jobs.detail.timing.remaining`, `started`, `finished`: built so either value of `{duration}` fits.
- `jobs.outcome.TRANSLATION_CHANGED`, `PROTECTED`: read as "the existing translation was kept".
- `jobs.itemStatus.*` (CSV column): masculine forms for élément / elemento.
- `glossary.error.uploadTooLarge` / `fileTooLarge` / `csvTooLarge`: the difference is subtle in English too.
- `memory.stats.reused`: rendered as a count of reuses.
- `markets.finding.*`: "la langue {language}" reads "la langue allemand"; better wording welcome.
- The Plan page with prices (`plan.*`, rewritten 2026-10-30; machine-assisted like the rest):
  - `plan.price.*`: "Gratuit" / "Gratis" as the price of Free; "/ mois" / "/ mes"; "ou {amount} / an" / "o {amount} / año". The amounts come from `Intl.NumberFormat` ("29 $US", "29 US$"), not from the texts.
  - `plan.price.monthsFree` ("2 mois offerts" / "2 meses gratis") and `plan.price.monthlyOnly` ("Mensuel uniquement" / "Solo mensual").
  - `plan.price.trial`: "Jusqu'à … jours d'essai gratuit" / "Hasta … días de prueba gratis" ("up to": Shopify may shorten a trial); `plan.status.trial`, `plan.current.trialAllowance`.
  - `plan.price.footnote` and `plan.price.usd`: "dollars américains" / "dólares estadounidenses".
  - `plan.recommend.*`: "Adapté à votre boutique" / "Se adapta a tu tienda". The reasons are joined by `Intl.ListFormat` ("vos 4 langues et la publication automatique"); check the articles in each `plan.recommend.part.*`.
  - `plan.hero.name.*`: "Accès propriétaire" / "Acceso de propietario" (the owner's own stores), "Toutes les fonctionnalités incluses" / "Todas las funciones incluidas" (billing not set up).
  - `plan.languages.besides`: "Original : {language}, plus {count} autres" / "Original: {language}, más {count} otros".
  - `plan.cost.internal`: amounts are now localised ("2,20 $").
  - `plan.audience.*`, `plan.everyPlan.*`, `plan.row.*`, `plan.table.*` ("{value} M" for millions), `plan.faq.*`.
- `automatic.budget.trial`: the trial note next to the smart budgets ("Essai jusqu'au {date} : …" / "Prueba hasta el {date}: …").

**Overview, lists, Review, Settings, coverage**
- Consent and publishing texts (translated literally, please confirm): `settings.publish.confirm` ("traductions automatiques" is also the name of the automatic translation feature; alternative "traductions générées par machine"), `settings.auto.consent.body`, `settings.publish.autoBody` / `autoBodySince`, `settings.ai.withdraw`.
- `coverage.byLanguage.translateGaps`: "Combler les lacunes" / "Traducir lo pendiente".
- `overview.store.installed`: "Date d'installation : {date}".
- Gender guessed from context: `overview.languages.hidden` / `unknown`, `resources.status.partial`, `review.saved.published` / `failed`.
- `settings.style.body`: the examples (Sie/du, vous/tu) aren't extended with usted/tú.
- `resources.caution.legalBody` (Spanish "calificada", Spain: "cualificada").
- Counts are written as "label: number" ("Étapes terminées : {done} sur {total}") so singular and plural both read correctly.
