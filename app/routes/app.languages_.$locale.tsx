/**
 * One language of the store, area by area (`/app/languages/:locale`): how
 * far it is, what to do next (exactly one primary button: the first step),
 * the three steps from translating to live, then each area in the order
 * customers meet it, with real examples from the store, and last what the
 * percentage leaves out. Examples load after the page (their own request);
 * the page reloads every few seconds only while a count or a translation
 * of this language runs.
 */
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadLanguagePage, translateCategoryAction } from "../.server/languages/language-page";
import { startMeasurement } from "../.server/coverage/dashboard";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import type { loader as previewsLoader } from "./app.languages_.$locale_.previews";
import { CategoryCard, categoryName, type LanguageCategory } from "../components/CategoryCard";
import { itemsHref, percentLabel } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { Flag } from "../components/Flag";
import { SHOWN_STATES, StateIcon, StateKey, StateLines, TextStateBar } from "../components/ItemStates";
import { BIG_HEADING, Breadcrumbs, languageErrorText, NumberedSteps, PLAIN_LIST, StepNumber, type StepView } from "../components/LanguageLayout";
import { ProgressBar } from "../components/ProgressBar";
import { StepStrip } from "../components/StepStrip";
import { TranslateConfirm } from "../components/TranslateConfirm";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { emptyCounts } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import { EXTRAS, TIERS, type CategoryId, type ExtraId, type LanguageStep } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  return loadLanguagePage(admin, shop, params.locale ?? "", undefined, {
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
  });
};

/** Count the store again (intent "run"), or translate one area after the merchant confirmed. */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") === "run") return startMeasurement(admin, shop, { idempotencyKey: String(form.get("idempotencyKey") ?? ""), requestedBy: actorId });
  return translateCategoryAction(admin, shop, { locale: params.locale ?? "", form, requestedBy: actorId });
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const CONFIRM = "language-translate";
/** How often the page reloads while a count or a translation of this language runs (never otherwise). */
const POLL_MS = 3_000;
const LANGUAGE_SETTINGS = "shopify://admin/settings/languages";

/** Where the extras' texts are listed. */
const EXTRA_HREF: Record<ExtraId, (locale: string) => string> = {
  theme: () => "/app/content/theme",
  notifications: () => "/app/content/email-templates",
  urls: (locale) => itemsHref({ lang: locale, group: "url" }),
};

interface Names {
  /** The language as a heading ("Dänisch", "Danois") and inside sentences ("danois"). */
  title: string;
  inSentence: string;
  /** What customers see where nothing is translated ("Deutsch"). */
  primary: string;
}

function names(data: Data, i18n: I18n): Names {
  const inSentence = i18n.language(data.language.locale, data.language.name);
  return { title: upperFirst(inSentence), inSentence, primary: data.primary ? i18n.language(data.primary.locale, data.primary.name) : "" };
}

function Header({ data, i18n, title }: { data: Data; i18n: I18n; title: string }) {
  const { t } = i18n;
  const countries = data.countries.map((c) => i18n.country(c.code, c.name));
  const line = [
    countries.length ? t("language.countries", { countries: languageList(i18n, countries, 4) }) : null,
    data.scanning ? t("language.counting") : data.measuredAt ? t("language.countedAt", { date: i18n.dateTime(data.measuredAt) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <s-stack direction="block" gap="small-200">
      <Breadcrumbs i18n={i18n} trail={[{ href: "/app", label: t("common.nav.overview") }]} current={title} />
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
        <Flag country={localeCountry(data.language.locale, data.marketCountries)} fallback={data.language.locale} size={40} />
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <h1 style={BIG_HEADING}>{title}</h1>
            {data.language.published ? (
              <s-badge tone="success" icon="check-circle">
                {t("language.published")}
              </s-badge>
            ) : (
              <s-badge icon="hide">{t("language.hidden")}</s-badge>
            )}
          </s-stack>
          {line ? <s-text color="subdued">{line}</s-text> : null}
          {data.language.published ? null : (
            <s-text color="subdued">
              {t("language.hiddenHelp")}{" "}
              <s-link href={LANGUAGE_SETTINGS} target="_top">
                {t("language.publishInShopify")}
              </s-link>
            </s-text>
          )}
        </s-stack>
      </s-grid>
    </s-stack>
  );
}

/** How far the language is: the ring, the figure in words and each state with what it means. */
function Figure({ data, i18n, names }: { data: Data; i18n: I18n; names: Names }) {
  const { t } = i18n;
  const m = data.measurement;
  if (!data.headline || !data.headline.total) {
    const counting = data.scanning;
    const title = data.headline ? t("language.hero.nothing") : counting ? t("language.hero.counting") : t("language.hero.notCounted");
    return (
      <s-grid gridTemplateColumns="auto 1fr" gap="large" alignItems="center">
        <CoverageRing counts={emptyCounts()} figure="—" caption={t("language.hero.translated")} label={title} size={112} />
        <s-stack direction="block" gap="small-200">
          <s-heading>{title}</s-heading>
          <s-text color="subdued">
            {data.headline
              ? t("language.hero.nothingHelp")
              : counting
                ? t("language.hero.countingHelp")
                : m.state === "unavailable"
                  ? t("coverage.error.JOBS_UNAVAILABLE")
                  : t("language.hero.notCountedHelp")}
          </s-text>
          {counting && m.state === "running" ? (
            <s-stack direction="block" gap="small-300">
              <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("language.hero.progressLabel")} />
              <s-text color="subdued">{t("language.hero.progress", { done: m.done, total: m.total })}</s-text>
            </s-stack>
          ) : null}
          {!counting && (m.state === "stalled" || m.state === "failed") ? (
            <s-text color="subdued">{m.state === "stalled" ? t("language.hero.stalled") : t("language.hero.countFailed")}</s-text>
          ) : null}
        </s-stack>
      </s-grid>
    );
  }
  const figure = data.headline;
  const percent = percentLabel(i18n, figure.complete, figure.total);
  return (
    <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="auto 1fr" gap="large" alignItems="center">
        <CoverageRing
          counts={figure.counts}
          figure={percent}
          caption={t("language.hero.translated")}
          label={t("language.hero.ringLabel", { percent, complete: figure.complete, total: figure.total })}
          size={112}
        />
        <s-stack direction="block" gap="small-300">
          <s-heading>{t("language.hero.figure", { complete: figure.complete, total: figure.total })}</s-heading>
          <s-text color="subdued">{t("language.hero.fallback", { primary: names.primary })}</s-text>
        </s-stack>
      </s-grid>
      <StateLines counts={figure.counts} i18n={i18n} />
      {data.payoff !== null && data.steps ? (
        <s-stack direction="inline">
          <s-badge tone="info" icon="arrow-up-right">
            {t("language.hero.payoff", { count: data.steps.waiting, percent: i18n.percent(data.payoff) })}
          </s-badge>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

interface StepContext {
  data: Data;
  i18n: I18n;
  names: Names;
  /** Opens the confirm dialog for an area. */
  confirm: (category: CategoryId) => void;
  /** Counting the store: the form's fetcher. */
  counter: ReturnType<typeof useFetcher<typeof action>>;
}

function list(i18n: I18n, categories: readonly CategoryId[]) {
  return languageList(i18n, categories.map((id) => categoryName(i18n, id)));
}

/** "12 texts are missing, 4 are outdated. Customers see these first." */
function categoryDetail(i18n: I18n, step: Extract<LanguageStep, { kind: "category" }>) {
  const { t } = i18n;
  const parts = [
    step.missing ? t("language.next.category.missing", { count: step.missing }) : null,
    step.outdated ? t("language.next.category.outdated", { count: step.outdated }) : null,
    step.failed ? t("language.next.category.failed", { count: step.failed }) : null,
  ].filter(Boolean);
  const tier = TIERS.find((tier) => (tier.categories as readonly CategoryId[]).includes(step.category))!.id;
  return `${upperFirst(parts.join(", "))}. ${t(`language.tier.${tier}.step`)}`;
}

function stepView(step: LanguageStep, first: boolean, ctx: StepContext): Omit<StepView, "key"> {
  const { data, i18n, names, counter } = ctx;
  const { t } = i18n;
  const variant = first ? "primary" : "secondary";
  const countForm = (label: string) => (
    <counter.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <s-button type="submit" variant={variant} {...(counter.state !== "idle" ? { loading: true } : {})}>
        {label}
      </s-button>
    </counter.Form>
  );
  switch (step.kind) {
    case "count":
      return { title: t("language.next.count.title"), detail: t("language.next.count.detail", { language: names.inSentence }), action: countForm(t("language.next.count.action")) };
    case "review":
      return {
        title: t("language.next.review.title", { count: step.count }),
        detail: step.payoff !== null ? t("language.next.review.detail", { percent: i18n.percent(step.payoff) }) : t("language.next.review.detailNoGain"),
        action: (
          <s-button variant={variant} href={step.href}>
            {t("language.next.review.action")}
          </s-button>
        ),
      };
    case "category": {
      const category = data.categories.find((c) => c.id === step.category);
      const name = categoryName(i18n, step.category);
      const action = category?.job ? (
        <s-button variant={variant} href={category.job.href}>
          {t("language.card.jobOpen")}
        </s-button>
      ) : step.action === "translate" ? (
        <s-button variant={variant} icon="wand" commandFor={CONFIRM} command="--show" onClick={() => ctx.confirm(step.category)} accessibilityLabel={`${t("language.action.translate")}: ${name}`}>
          {t("language.action.translate")}
        </s-button>
      ) : (
        <s-button variant={variant} href={step.href} accessibilityLabel={`${t("language.action.view")}: ${name}`}>
          {t("language.action.view")}
        </s-button>
      );
      return { title: t("language.next.category.title", { category: name }), detail: categoryDetail(i18n, step), action };
    }
    case "recount":
      return {
        title: t("language.next.recount.title"),
        detail: t("language.next.recount.detail", { categories: list(i18n, step.categories), count: step.categories.length }),
        action: countForm(t("language.next.recount.action")),
      };
    case "access":
      return {
        title: t("language.next.access.title", { categories: list(i18n, step.categories) }),
        detail: t("language.next.access.detail"),
        action: step.href ? (
          <s-button variant={variant} href={step.href}>
            {t("coverage.types.allowAccess")}
          </s-button>
        ) : undefined,
      };
    case "done":
      return {
        title: (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="check-circle" tone="success" />
            <s-text type="strong">{t("language.next.done.title")}</s-text>
          </s-stack>
        ),
        detail: t("language.next.done.detail"),
      };
  }
}

/** Up to three numbered steps; the first one's button is the page's only primary button. */
function NextSteps(ctx: StepContext) {
  const { data, i18n } = ctx;
  const { t } = i18n;
  const gate = data.bulk.gate && data.categories.some((c) => c.bulk) ? data.bulk.gate : null;
  const empty = !data.measured
    ? data.scanning
      ? t("language.next.counting")
      : t("coverage.error.JOBS_UNAVAILABLE")
    : t("language.next.empty");
  return (
    <s-stack direction="block" gap="base">
      <s-heading>{t("language.next.heading")}</s-heading>
      {data.next.length ? (
        <NumberedSteps steps={data.next.map((step, i) => ({ key: step.kind === "category" ? step.category : step.kind, ...stepView(step, i === 0, ctx) }))} />
      ) : (
        <s-text color="subdued">{empty}</s-text>
      )}
      {gate ? (
        <s-text color="subdued">
          {languageErrorText(i18n, gate)} {gate === "CONSENT_REQUIRED" ? <s-link href="/app/settings">{t("common.nav.settings")}</s-link> : null}
        </s-text>
      ) : null}
    </s-stack>
  );
}

/** Shown: an area with texts, or one Linguva couldn't read in full (never hidden as "nothing to do"). */
const visible = (c: LanguageCategory) => c.tally.total > 0 || c.state.kind !== "ok";

function Areas({ data, i18n, names, previews, translate }: { data: Data; i18n: I18n; names: Names; previews: ReturnType<typeof useFetcher<typeof previewsLoader>>["data"]; translate: (c: LanguageCategory) => { modalId: string; onOpen: () => void; loading: boolean } | null }) {
  const { t } = i18n;
  const percent = data.headline && data.headline.total ? percentLabel(i18n, data.headline.complete, data.headline.total) : null;
  const tiers = TIERS.map((tier) => ({ id: tier.id, categories: data.categories.filter((c) => c.tier === tier.id && visible(c)) })).filter((tier) => tier.categories.length);
  if (!tiers.length) return null;
  const card = (c: LanguageCategory, featured: boolean) => (
    <CategoryCard key={c.id} category={c} i18n={i18n} locale={data.language.locale} primaryName={names.primary} preview={previews?.[c.id] ?? null} featured={featured} translate={translate(c)} />
  );
  return (
    <s-query-container>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="@container (inline-size > 760px) 1fr auto, 1fr" gap="base" alignItems="end">
          <s-stack direction="block" gap="small-500">
            <h2 style={{ ...BIG_HEADING, fontSize: 17, lineHeight: "24px", fontWeight: 650 }}>{t("language.areas.heading")}</h2>
            <s-text color="subdued">{percent ? t("language.areas.intro", { percent }) : t("language.areas.introNoPercent")}</s-text>
          </s-stack>
          <StateKey i18n={i18n} />
        </s-grid>
        {tiers.map((tier, n) => {
          // The first tier's products lead, wide, with more pictures.
          const featured = tier.categories.find((c) => c.id === "products");
          const rest = tier.categories.filter((c) => c !== featured);
          return (
            <s-stack key={tier.id} direction="block" gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <StepNumber n={n + 1} first />
                <h3 style={{ ...BIG_HEADING, fontSize: 15, lineHeight: "22px", fontWeight: 650 }}>{t(`language.tier.${tier.id}.name`)}</h3>
                <s-box display="@container (inline-size > 500px) auto, none">
                  <s-text color="subdued">– {t(`language.tier.${tier.id}.why`)}</s-text>
                </s-box>
              </s-stack>
              {featured ? card(featured, true) : null}
              {rest.length ? (
                // Each card as tall as its content: no empty card halves beside a longer one.
                <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, (inline-size > 860px) 1fr 1fr 1fr, 1fr" gap="base" alignItems="start">
                  {rest.map((c) => card(c, false))}
                </s-grid>
              ) : null}
            </s-stack>
          );
        })}
      </s-stack>
    </s-query-container>
  );
}

/** Texts the percentage leaves out: the theme's, notifications and URL handles, each a row that opens them. */
function Extras({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const rows = data.extras.filter((e) => e.tally.total > 0 || (e.state && e.state.kind !== "ok"));
  if (!rows.length) return null;
  const percent = data.headline && data.headline.total ? percentLabel(i18n, data.headline.complete, data.headline.total) : null;
  return (
    <s-section heading={percent ? t("language.extras.heading", { percent }) : t("language.extras.headingNoPercent")} padding="none">
      <s-box padding="none base base">
        <s-text color="subdued">{t("language.extras.intro")}</s-text>
      </s-box>
      <s-query-container>
        <ul style={PLAIN_LIST}>
          {rows.map((extra) => {
            const name = t(`language.extra.${extra.id}.name`);
            const denied = extra.state?.kind === "no-access";
            return (
              <li key={extra.id}>
                <s-divider />
                <s-clickable href={EXTRA_HREF[extra.id](data.language.locale)} padding="small-100 base" minBlockSize="44px">
                  <s-grid gridTemplateColumns="@container (inline-size > 560px) auto 1fr 140px 48px auto, auto 1fr auto auto" gap="base" alignItems="center">
                    <s-stack background="subdued" borderRadius="base" inlineSize="36px" blockSize="36px" alignItems="center" justifyContent="center">
                      <s-icon type={EXTRAS[extra.id].icon} color="subdued" />
                    </s-stack>
                    <s-stack direction="block" gap="small-500">
                      <s-text type="strong">{name}</s-text>
                      <s-text color="subdued">{denied ? t("language.card.noAccess") : t(`language.extra.${extra.id}.detail`)}</s-text>
                    </s-stack>
                    <s-box display="@container (inline-size > 560px) auto, none">
                      <div aria-hidden="true">{denied ? null : <TextStateBar counts={extra.tally.counts} label={name} i18n={i18n} />}</div>
                    </s-box>
                    <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums", textAlign: "end", whiteSpace: "nowrap" }}>
                      {denied ? "—" : percentLabel(i18n, extra.tally.complete, extra.tally.total)}
                    </span>
                    <s-icon type="chevron-right" color="subdued" />
                  </s-grid>
                </s-clickable>
              </li>
            );
          })}
        </ul>
      </s-query-container>
    </s-section>
  );
}

/** The state words and what they mean, folded. */
function Words({ i18n, names }: { i18n: I18n; names: Names }) {
  const { t } = i18n;
  const meaning = {
    complete: t("language.words.complete", { language: names.inSentence }),
    waiting: t("language.words.waiting"),
    outdated: t("language.words.outdated"),
    failed: t("language.words.failed"),
    missing: t("language.words.missing", { primary: names.primary }),
  };
  return (
    <s-section>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: 24 }}>{t("language.words.heading")}</summary>
        <s-box paddingBlockStart="base">
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, 1fr" gap="base">
              {SHOWN_STATES.map((s) => (
                <s-grid key={s} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                  <StateIcon state={s} size="small" />
                  <s-paragraph>
                    <s-text type="strong">{t(`language.state.${s}`)}</s-text> – {meaning[s]}
                  </s-paragraph>
                </s-grid>
              ))}
              <s-paragraph>
                <s-text type="strong">{t("language.words.texts.term")}</s-text> – {t("language.words.texts")}
              </s-paragraph>
              <s-paragraph>
                <s-text type="strong">{t("language.words.percent.term")}</s-text> – {t("language.words.percent", { full: i18n.percent(100) })}
              </s-paragraph>
            </s-grid>
          </s-query-container>
        </s-box>
      </details>
    </s-section>
  );
}

export default function LanguagePage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const revalidator = useRevalidator();
  const counter = useFetcher<typeof action>();
  const translator = useFetcher<typeof action>();
  const previews = useFetcher<typeof previewsLoader>();
  const [chosen, setChosen] = useState<CategoryId | null>(null);
  const languageNames = names(data, i18n);
  const locale = data.language.locale;

  // Follow a count or a translation of this language while it runs; nothing to follow otherwise.
  const live = data.scanning || data.activeJobs > 0;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  // The areas' examples, once the page is shown (Shopify is read for them).
  const hasAreas = data.categories.length > 0;
  const loadPreviews = previews.load;
  useEffect(() => {
    if (hasAreas) loadPreviews(`/app/languages/${encodeURIComponent(locale)}/previews`);
  }, [hasAreas, locale, loadPreviews]);

  const error = [counter.data, translator.data].find((d): d is { error: string } => Boolean(d && "error" in d));
  const target = chosen ? data.categories.find((c) => c.id === chosen) : undefined;
  const translate = (c: LanguageCategory) =>
    data.bulk.gate === null && c.bulk !== null ? { modalId: CONFIRM, onOpen: () => setChosen(c.id), loading: translator.state !== "idle" && chosen === c.id } : null;
  const percent = data.headline ? percentLabel(i18n, data.headline.complete, data.headline.total) : "—";

  return (
    <s-page heading={languageNames.title}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("common.nav.overview")}
      </s-link>
      <s-stack direction="block" gap="base">
        <Header data={data} i18n={i18n} title={languageNames.title} />
        {error ? (
          <s-banner tone="critical">
            <s-paragraph>{languageErrorText(i18n, error.error)}</s-paragraph>
          </s-banner>
        ) : null}

        <s-section padding="none" accessibilityLabel={t("language.hero.label", { language: languageNames.title })}>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr, 1fr">
              <s-box padding="large">
                <Figure data={data} i18n={i18n} names={languageNames} />
              </s-box>
              <s-box padding="large" background="subdued">
                <NextSteps data={data} i18n={i18n} names={languageNames} confirm={setChosen} counter={counter} />
              </s-box>
            </s-grid>
          </s-query-container>
        </s-section>

        {data.steps && data.headline?.total ? (
          <StepStrip steps={data.steps} percent={percent} label={t("language.strip.label", { primary: languageNames.primary, language: languageNames.inSentence })} i18n={i18n} />
        ) : null}

        <Areas data={data} i18n={i18n} names={languageNames} previews={previews.data} translate={translate} />
        <Extras data={data} i18n={i18n} />
        {data.measured ? <Words i18n={i18n} names={languageNames} /> : null}
      </s-stack>

      <TranslateConfirm
        id={CONFIRM}
        target={target?.bulk ? { category: target.id, estimate: target.bulk } : null}
        languageName={languageNames.inSentence}
        publishMode={data.bulk.publishMode}
        aiRemaining={data.bulk.aiRemaining}
        i18n={i18n}
        onConfirm={({ category, includeAttached }) =>
          translator.submit(
            { intent: "translate-category", category, idempotencyKey: data.idempotencyKey, ...(includeAttached ? { includeAttached: "on" } : {}) },
            { method: "post" },
          )
        }
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
