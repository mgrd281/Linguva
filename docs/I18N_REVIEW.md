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

**Content page (`content.*`, Redesign 2)**
- `content.part.*.name`: the merchant's names for Shopify's 26 content types, e.g. "Fiche de la boutique sur Google" / "Ficha de la tienda en Google" (the store's search listing), "Guides des tailles et plus" / "Tablas de tallas y más" (metaobjects), "Intégrations d'applications" / "Integraciones de apps" (app embeds), "Bordereau de livraison" / "Albarán" (as `common.kind.PACKING_SLIP_TEMPLATE`, Spain; Latin America: "lista de empaque").
- `content.part.SELLING_PLAN_GROUP.name` / `SELLING_PLAN.name`: "Abonnements", "Options d'abonnement" / "Suscripciones", "Opciones de suscripción" (German uses the short "Abos").
- `content.part.ONLINE_STORE_THEME_*.hint`: one line per theme part ("Par exemple le bouton « Ajouter au panier »" / "Por ejemplo, el botón «Agregar al carrito»"); compare with what Dawn's French and Spanish themes say.
- `content.tile.attached.*`: "Les {parts} se traduisent avec vos produits." / "Traduces {parts} junto con tus productos.", with `content.tile.attachedPart.*` "descriptions d'images", "informations complémentaires" / "descripciones de imágenes", "información adicional".
- `content.language.hidden` and `resources.hiddenLanguage`: "masquée" (feminine, for "langue") / "oculto" (masculine, for "idioma").
- `content.tile.new`, `content.tile.recount`: "comptage" / "recuento" for a count of the store, as on the language page.
- `content.unavailable.note`: names Shopify's translation app without its English name.

**Jobs, glossary, memory, markets, plan**
- `jobs.detail.timing.remaining`, `started`, `finished`: built so either value of `{duration}` fits.
- `jobs.outcome.TRANSLATION_CHANGED`, `PROTECTED`: read as "the existing translation was kept".
- `jobs.itemStatus.*` (CSV column): masculine forms for élément / elemento.
- `glossary.error.uploadTooLarge` / `fileTooLarge` / `csvTooLarge`: the difference is subtle in English too.
- `memory.stats.reused`: rendered as a count of reuses.
- `markets.finding.*`: "la langue {language}" reads "la langue allemand"; better wording welcome.
- `plan.current.cost`: amounts aren't localised (`1.23`); French writes "{cost} $".
- `plan.complimentary.heading`: "Accès offert" / "Acceso gratuito", also used as a plan name.

**Overview, lists, Review, Settings, coverage**
- Consent and publishing texts (translated literally, please confirm): `settings.publish.confirm` ("traductions automatiques" is also the name of the automatic translation feature; alternative "traductions générées par machine"), `settings.auto.consent.body`, `settings.publish.autoBody` / `autoBodySince`, `settings.ai.withdraw`.
- `coverage.byLanguage.translateGaps`: "Combler les lacunes" / "Traducir lo pendiente".
- `overview.store.installed`: "Date d'installation : {date}".
- Gender guessed from context: `overview.languages.hidden` / `unknown`, `resources.status.partial`, `review.saved.published` / `failed`.
- `settings.style.body`: the examples (Sie/du, vous/tu) aren't extended with usted/tú.
- `resources.caution.legalBody` (Spanish "calificada", Spain: "cualificada").
- Counts are written as "label: number" ("Étapes terminées : {done} sur {total}") so singular and plural both read correctly.
