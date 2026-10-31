# Interface languages: review status

| Language | Texts | Written by | Reviewed by a native speaker |
|---|---|---|---|
| English | about 1,770 | Source | — |
| German | about 1,770 | Translated and checked in the UI tests | No |
| French | about 1,770 (since phase G; later texts machine-assisted too) | Machine-assisted translation | **No** |
| Spanish (neutral, Latin American style like Shopify's) | about 1,770 (since phase G; later texts machine-assisted too) | Machine-assisted translation | **No** |

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

**Review page (`review.*`, Redesign 2)**
- `review.page.heading`: "Réviser les traductions" / "Revisar traducciones"; the menu item stays "Révision" / "Revisión".
- `review.filter.areaLabel`, `review.filter.allAreas`: French calls the areas "Domaines" here, while the language page says "Partie par partie" (`language.areas.heading`); one word for both would be better. Spanish uses "Áreas" on both.
- `review.lang.hidden`: "masquée" (feminine, for "langue") / "oculto" (masculine, for "idioma"), as `content.language.hidden`.
- `review.hint.NUMBERS_*`: "Chiffre modifié", "Chiffres manquants" / "Número cambiado", "Faltan números". French "chiffre" is a digit, so "nombre" may fit better. `NUMBERS_ADDED` says "Número añadido": "añadido" is the word in Spain, the convention above asks for "agregado".
- `review.done.approved`, `review.done.rejected`, `review.done.notPublished` and `review.result.partial.heading` have one form only: with 1 they read "1 approuvées" / "1 aprobadas" (English has no plural there either).
- `review.approve.*` (the page's approval dialog): `review.approve.hints` "{count} d'entre elles a une remarque" / "{count} de ellas tiene un aviso"; `review.approve.handlesLeft` "La nueva dirección web la apruebas por separado."
- `review.reject.body`, `review.field.rejectNote`: "Cette action est irréversible." / "Esta acción no se puede deshacer." and "No se puede deshacer."
- `review.result.*`: one line per outcome, "Obsolète" / "Desactualizado" for outdated. `review.result.approvedHidden` puts the language in parentheses in French ("la langue ({language}) est encore masquée") to avoid its gender; Spanish says "el {language} aún está oculto".
- `review.payoff`: "la traduction en {language} atteindra {percent}" / "la traducción al {language} llegará al {percent}" (the language name in lower case).
- `review.field.customField`: "Information complémentaire : {name}" / "Información adicional: {name}", as `content.tile.attachedPart.customFields`.
- `review.empty.heading` "Tout est vérifié" / "Todo revisado"; `review.leave.*` "Abandonner vos modifications ?" / "¿Descartar tus cambios?".
- `overview.banner.exhausted.headingTrial` and `bodyTrial`: the Overview's banner when a trial's AI allowance is used up ("Le quota d'IA de votre essai est épuisé" / "La cuota de IA de tu prueba está agotada").

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
- Consent and publishing texts (translated literally, please confirm): `settings.publish.confirm.body` (French and Spanish say "traductions par IA" / "traducciones de IA", the same term as everywhere else), `settings.auto.consent.body`, `settings.publish.auto.body`, `settings.ai.revoke.body`, `settings.ai.withdraw`.
- Gender guessed from context: `overview.languages.unknown`, `resources.status.partial`.
- `settings.style.formalWith` / `informalWith`: the pronoun in brackets comes from `app/lib/formality.ts` and is the store language's own (vous/tu, usted/tú, Lei/tu, u/jij, Pan/Pani/ty, você/tu), not the interface language's.
- `resources.caution.legalBody` (Spanish "calificada", Spain: "cualificada").
- Counts are written as "label: number" ("Étapes terminées : {done} sur {total}") so singular and plural both read correctly.
