/**
 * One area of a language, item by item (`/app/languages/:locale/:category`):
 * how far the area is and what to do next (exactly one primary button: the
 * first step), then its items grouped by their one state, open work first,
 * with pictures, what customers see in the language and the state of each
 * text (app/components/CategoryList.tsx). Filters by state, a name search
 * and pages of 50 are links, so every view has its own address. The page
 * reloads every few seconds only while a count or a translation of this
 * area runs (each reload reads the shown names from Shopify).
 */
import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadCategoryItems, translateCategoryAction } from "../.server/languages/language-page";
import { startMeasurement } from "../.server/coverage/dashboard";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import { categoryName, IconTile } from "../components/CategoryCard";
import { CategoryList, type ListNames } from "../components/CategoryList";
import { percentLabel } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { Flag } from "../components/Flag";
import { StateCountList } from "../components/ItemStates";
import { BIG_HEADING, Breadcrumbs, languageErrorText, NumberedSteps, type StepView } from "../components/LanguageLayout";
import { ProgressBar } from "../components/ProgressBar";
import { TranslateConfirm, translateWhat } from "../components/TranslateConfirm";
import { useI18n } from "../i18n/react";
import type { I18n, MessageKey } from "../i18n/i18n";
import { emptyCounts, type StateCounts } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import { CATEGORIES, categoryPath, languagePath, type CategoryId } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, scopes, redirect } = await requireShop(request);
  const url = new URL(request.url);
  const query = { state: url.searchParams.get("state"), q: url.searchParams.get("q"), after: url.searchParams.get("after") };
  return loadCategoryItems(admin, shop, params.locale ?? "", params.category ?? "", query, undefined, {
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
    toOverview: () => redirect("/app", { target: "_self" }),
  });
};

/** Count the store (intent "run"), or translate the area after the merchant confirmed. */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") === "run") return startMeasurement(admin, shop, { idempotencyKey: String(form.get("idempotencyKey") ?? ""), requestedBy: actorId });
  return translateCategoryAction(admin, shop, { locale: params.locale ?? "", form, requestedBy: actorId });
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const CONFIRM = "category-translate";
/** How often the page reloads while a count or a translation of this area runs (never otherwise). */
const POLL_MS = 5_000;

/** "48 products": areas whose items are all of one kind name them; the others count entries. */
const ITEM_NOUNS: Partial<Record<CategoryId, { count: MessageKey; done: MessageKey }>> = {
  products: { count: "language.category.products.items", done: "language.list.done.products" },
  collections: { count: "language.category.collections.items", done: "language.list.done.collections" },
  metaobjects: { count: "language.category.metaobjects.items", done: "language.list.done.metaobjects" },
  pages: { count: "language.category.pages.items", done: "language.list.done.pages" },
  images: { count: "language.category.images.items", done: "language.list.done.images" },
};
const ENTRIES = { count: "language.list.items", done: "language.list.done.items" } as const satisfies { count: MessageKey; done: MessageKey };

interface Names extends ListNames {
  /** The language as a heading ("Dänisch"). */
  title: string;
  category: string;
}

function names(data: Data, i18n: I18n): Names {
  const language = i18n.language(data.language.locale, data.language.name);
  return {
    title: upperFirst(language),
    language,
    locale: data.language.locale,
    primary: data.primary ? i18n.language(data.primary.locale, data.primary.name) : "",
    primaryLocale: data.primary?.locale ?? null,
    category: categoryName(i18n, data.category.id),
  };
}

function Header({ data, i18n, names }: { data: Data; i18n: I18n; names: Names }) {
  const { t } = i18n;
  const nouns = ITEM_NOUNS[data.category.id] ?? ENTRIES;
  const countries = data.countries.map((c) => i18n.country(c.code, c.name));
  // A search narrows the counts to its matches: the area's own count only without one.
  const line = [
    data.measured && !data.filter.q && data.counts.all ? t(nouns.count, { count: data.counts.all }) : null,
    countries.length ? t("language.countries", { countries: languageList(i18n, countries, 4) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <s-stack direction="block" gap="small-200">
      <Breadcrumbs
        i18n={i18n}
        trail={[
          { href: "/app", label: t("common.nav.overview") },
          { href: languagePath(data.language.locale), label: names.title, before: <Flag country={localeCountry(data.language.locale, data.marketCountries)} fallback={data.language.locale} size={20} /> },
        ]}
        current={names.category}
      />
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
        <IconTile icon={CATEGORIES[data.category.id].icon} size={44} />
        <s-stack direction="block" gap="small-500">
          <h1 style={BIG_HEADING}>{t("language.list.heading", { category: names.category, language: names.language })}</h1>
          {line ? <s-text color="subdued">{line}</s-text> : null}
        </s-stack>
      </s-grid>
    </s-stack>
  );
}

/** How far the area is: the ring, the figure in words, its items done and each state. */
function Figure({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const { category, measurement: m } = data;
  const figure = category.tally;
  const empty = (title: string, help: string) => (
    <s-grid gridTemplateColumns="auto 1fr" gap="large" alignItems="center">
      <CoverageRing counts={emptyCounts()} figure="—" caption={t("language.hero.translated")} label={title} size={112} />
      <s-stack direction="block" gap="small-200">
        <s-heading>{title}</s-heading>
        <s-text color="subdued">{help}</s-text>
        {data.scanning && m.state === "running" ? (
          <s-stack direction="block" gap="small-300">
            <ProgressBar value={(m.done / Math.max(1, m.total)) * 100} label={t("language.hero.progressLabel")} />
            <s-text color="subdued">{t("language.hero.progress", { done: m.done, total: m.total })}</s-text>
          </s-stack>
        ) : null}
      </s-stack>
    </s-grid>
  );
  if (!figure) {
    if (data.scanning) return empty(t("language.hero.counting"), t("language.hero.countingHelp"));
    return empty(t("language.hero.notCounted"), m.state === "unavailable" ? t("coverage.error.JOBS_UNAVAILABLE") : t("language.hero.notCountedHelp"));
  }
  // Nothing was read without access: no figure, only how to allow it.
  if (category.state.kind === "no-access") return empty(t("language.card.noAccess"), t("language.next.access.detail"));
  if (!figure.total) return empty(t("language.hero.nothing"), t("language.list.empty"));

  const percent = percentLabel(i18n, figure.complete, figure.total);
  const nouns = ITEM_NOUNS[category.id] ?? ENTRIES;
  const waiting = figure.counts.draft + figure.counts.review;
  return (
    <s-stack direction="block" gap="base">
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="large" alignItems="center">
        <CoverageRing
          counts={figure.counts}
          figure={percent}
          caption={t("language.hero.translated")}
          label={t("language.hero.ringLabel", { percent, complete: figure.complete, total: figure.total })}
          size={112}
        />
        <s-stack direction="block" gap="small-300">
          <s-heading>{t("language.hero.figure", { complete: figure.complete, total: figure.total })}</s-heading>
          {/* In items: the filters below count items, the figure counts texts. */}
          {!data.filter.q && data.counts.all ? <s-text color="subdued">{t(nouns.done, { done: data.counts.complete, count: data.counts.all })}</s-text> : null}
        </s-stack>
      </s-grid>
      <StateCountList counts={figure.counts} i18n={i18n} />
      {category.state.kind === "counting" ? <s-text color="subdued">{t("language.card.counting")}</s-text> : null}
      {category.state.kind === "incomplete" ? <s-text color="subdued">{t("language.card.incomplete")}</s-text> : null}
      {category.payoff !== null && waiting > 0 ? (
        <s-stack direction="inline">
          <s-badge tone="info" icon="arrow-up-right">
            {t("language.hero.payoff", { count: waiting, percent: i18n.percent(category.payoff) })}
          </s-badge>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

/** "12 texts are missing, 4 are outdated, 1 failed". */
function openTexts(i18n: I18n, texts: Pick<StateCounts, "missing" | "outdated" | "failed">): string {
  const { t } = i18n;
  return upperFirst(
    [
      texts.missing ? t("language.next.category.missing", { count: texts.missing }) : null,
      texts.outdated ? t("language.next.category.outdated", { count: texts.outdated }) : null,
      texts.failed ? t("language.next.category.failed", { count: texts.failed }) : null,
    ]
      .filter(Boolean)
      .join(", "),
  );
}

interface StepContext {
  data: Data;
  i18n: I18n;
  names: Names;
  /** Counting the store: the form's fetcher. */
  counter: ReturnType<typeof useFetcher<typeof action>>;
  /** Translating the area is starting. */
  translating: boolean;
}

/**
 * Up to three steps for the area: count the language first; approve what
 * waits; translate what is open (or follow its running job); count again
 * where it wasn't read completely; allow access. The first step's button
 * is the page's primary button.
 */
function areaSteps({ data, i18n, names, counter, translating }: StepContext): StepView[] {
  const { t } = i18n;
  const { category } = data;
  const steps: StepView[] = [];
  const variant = () => (steps.length ? "secondary" : "primary");
  const countForm = (label: string) => (
    <counter.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <s-button type="submit" variant={variant()} {...(counter.state !== "idle" ? { loading: true } : {})}>
        {label}
      </s-button>
    </counter.Form>
  );

  const figure = category.tally;
  if (!figure) {
    if (data.canCount) steps.push({ key: "count", title: t("language.next.count.title"), detail: t("language.next.count.detail", { language: names.language }), action: countForm(t("language.next.count.action")) });
    return steps;
  }
  if (category.review) {
    steps.push({
      key: "review",
      title: t("language.next.review.title", { count: category.review.count }),
      detail: category.payoff !== null ? t("language.next.review.detail", { percent: i18n.percent(category.payoff) }) : t("language.next.review.detailNoGain"),
      action: (
        <s-button variant={variant()} href={category.review.href}>
          {t("language.next.review.action")}
        </s-button>
      ),
    });
  }
  const estimate = data.bulk.estimate;
  const open = figure.counts.missing + figure.counts.outdated + figure.counts.failed;
  if (category.job) {
    const { job } = category;
    const counted = job.discoveryDone && job.total > 0;
    steps.push({
      key: "job",
      title: counted ? t("language.card.job", { done: job.done, total: job.total }) : t("language.card.jobFinding"),
      action: (
        <s-stack direction="block" gap="small-200">
          {counted ? <ProgressBar value={(job.done / job.total) * 100} label={t("language.card.jobLabel", { category: names.category })} /> : null}
          <s-stack direction="inline">
            <s-button variant={variant()} href={job.href}>
              {t("language.card.jobOpen")}
            </s-button>
          </s-stack>
        </s-stack>
      ),
    });
  } else if (estimate) {
    steps.push({
      key: "translate",
      title: t("language.list.next.translate", { what: translateWhat(i18n, category.id, estimate) }),
      detail: `${openTexts(i18n, estimate.texts)}. ${t("language.list.next.keep")}`,
      action:
        data.bulk.gate === null ? (
          <s-button variant={variant()} icon="wand" commandFor={CONFIRM} command="--show" {...(translating ? { loading: true } : {})}>
            {t("language.action.translate")}
          </s-button>
        ) : undefined,
    });
  } else if (open > 0) {
    // Image descriptions and custom fields go with their products; legal texts one by one.
    const withOwners = category.id === "images" || category.id === "customFields";
    steps.push({
      key: "translate",
      title: t("language.next.category.title", { category: names.category }),
      detail: withOwners ? t("language.card.withOwners") : `${openTexts(i18n, figure.counts)}. ${t("language.list.next.oneByOne")}`,
      action: withOwners ? (
        <s-button variant={variant()} href={categoryPath(data.language.locale, "products")}>
          {t("language.list.next.toProducts")}
        </s-button>
      ) : undefined,
    });
  }
  if (category.state.kind === "incomplete" && data.canCount) {
    steps.push({ key: "recount", title: t("language.next.recount.title"), detail: t("language.next.recount.detail", { categories: names.category, count: 1 }), action: countForm(t("language.next.recount.action")) });
  }
  if (category.state.kind === "no-access") {
    const { href } = category.state;
    steps.push({
      key: "access",
      title: t("language.next.access.title", { categories: names.category }),
      detail: t("language.next.access.detail"),
      action: href ? (
        <s-button variant={variant()} href={href}>
          {t("coverage.types.allowAccess")}
        </s-button>
      ) : undefined,
    });
  }
  // Done only when everything was read and every counted text is live (COVERAGE_RULES §6).
  if (!steps.length && figure.total > 0 && figure.complete === figure.total && category.state.kind === "ok" && !data.scanning) {
    steps.push({
      key: "done",
      title: (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="check-circle" tone="success" />
          <s-text type="strong">{t("language.next.done.title")}</s-text>
        </s-stack>
      ),
      detail: t("language.next.done.detail"),
    });
  }
  return steps.slice(0, 3);
}

function NextSteps(ctx: StepContext) {
  const { data, i18n } = ctx;
  const { t } = i18n;
  const steps = areaSteps(ctx);
  const gate = data.bulk.estimate && !data.category.job ? data.bulk.gate : null;
  const empty = !data.measured ? (data.measurement.state === "unavailable" ? t("coverage.error.JOBS_UNAVAILABLE") : t("language.next.counting")) : t("language.next.empty");
  return (
    <s-stack direction="block" gap="base">
      <s-heading>{t("language.next.heading")}</s-heading>
      {steps.length ? <NumberedSteps steps={steps} /> : <s-text color="subdued">{empty}</s-text>}
      {gate ? (
        <s-text color="subdued">
          {languageErrorText(i18n, gate)} {gate === "CONSENT_REQUIRED" || gate === "ENGINE_CONSENT" ? <s-link href="/app/settings">{t("common.nav.settings")}</s-link> : null}
        </s-text>
      ) : null}
    </s-stack>
  );
}

export default function CategoryPage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const revalidator = useRevalidator();
  const counter = useFetcher<typeof action>();
  const translator = useFetcher<typeof action>();
  const areaNames = names(data, i18n);

  // Follow a count or a translation of this area while it runs; nothing to follow otherwise.
  const live = data.scanning || data.category.job !== null;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  const error = [counter.data, translator.data].find((d): d is { error: string } => Boolean(d && "error" in d));
  const estimate = data.bulk.estimate;
  const ctx = { data, i18n, names: areaNames, counter, translating: translator.state !== "idle" };
  // The list once the language is counted and the area has items read (or a search found none).
  const listed = data.measured && (data.counts.all > 0 || Boolean(data.filter.q));

  return (
    <s-page heading={t("language.list.heading", { category: areaNames.category, language: areaNames.language })}>
      <s-link slot="breadcrumb-actions" href={languagePath(data.language.locale)}>
        {areaNames.title}
      </s-link>
      <s-stack direction="block" gap="base">
        <Header data={data} i18n={i18n} names={areaNames} />
        {error ? (
          <s-banner tone="critical">
            <s-paragraph>{languageErrorText(i18n, error.error)}</s-paragraph>
          </s-banner>
        ) : null}

        <s-section padding="none" accessibilityLabel={t("language.list.hero.label", { category: areaNames.category })}>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 720px) 1fr 1fr, 1fr">
              <s-box padding="large">
                <Figure data={data} i18n={i18n} />
              </s-box>
              <s-box padding="large" background="subdued">
                <NextSteps {...ctx} />
              </s-box>
            </s-grid>
          </s-query-container>
        </s-section>

        {listed ? <CategoryList data={data} i18n={i18n} names={areaNames} /> : null}
      </s-stack>

      <TranslateConfirm
        id={CONFIRM}
        target={estimate ? { category: data.category.id, estimate } : null}
        languageName={areaNames.language}
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
