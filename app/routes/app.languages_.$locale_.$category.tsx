/**
 * One area of a language, item by item (`/app/languages/:locale/:category`):
 * how far the area is and what to do next (exactly one primary button: the
 * first step; each step's icon says what kind of step it is), then its items
 * grouped by their one state, open work first, with pictures, what customers
 * see in the language and the state of each text
 * (app/components/CategoryList.tsx). Image descriptions and extra details
 * are translated with their products (or collections, pages, blog posts):
 * their list offers that translation, with them ticked. Filters by state, a
 * name search and pages of 50 are links, so every view has its own address;
 * opened from Content (`?from=content`), the trail and every link keep it.
 * The page reloads every few seconds only while a count or a translation of
 * this area runs (each reload reads the shown names from Shopify).
 */
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadCategoryItems, translateCategoryAction } from "../.server/languages/language-page";
import { startMeasurement } from "../.server/coverage/dashboard";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import { AreaIcon, categoryInSentence, categoryName } from "../components/CategoryCard";
import { CategoryList, type ListNames } from "../components/CategoryList";
import { percentLabel } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { Flag } from "../components/Flag";
import { StateCountList } from "../components/ItemStates";
import { Breadcrumbs, languageErrorText, NumberedSteps, type StepView } from "../components/LanguageLayout";
import { accessTitle, STEP_ICON_SIZE, STEP_LOOK, StepIcon, unlockStep } from "../components/LanguageSteps";
import { ProgressBar } from "../components/ProgressBar";
import { TranslateConfirm, translateWhat } from "../components/TranslateConfirm";
import { useI18n } from "../i18n/react";
import type { I18n, MessageKey } from "../i18n/i18n";
import { emptyCounts, type StateCounts } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import {
  isUnlockGate,
  languagePath,
  originOf,
  unlockHref,
  withOrigin,
  type AttachedArea,
  type AttachedPart,
  type CategoryId,
  type Origin,
} from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";
import { Button } from "../components/Button";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, scopes, redirect } = await requireShop(request);
  const url = new URL(request.url);
  const query = { state: url.searchParams.get("state"), q: url.searchParams.get("q"), after: url.searchParams.get("after") };
  return loadCategoryItems(admin, shop, params.locale ?? "", params.category ?? "", query, undefined, {
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
    toOverview: () => redirect("/app", { target: "_self" }),
  });
};

/** Count the store (intent "run"), or translate the area (or the owners of its image descriptions and extra details) after the merchant confirmed. */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireShop(request);
  const form = await request.formData();
  if (form.get("intent") === "run") return startMeasurement(admin, shop, { idempotencyKey: String(form.get("idempotencyKey") ?? ""), requestedBy: actorId });
  return translateCategoryAction(admin, shop, { locale: params.locale ?? "", form, requestedBy: actorId });
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;
type Owner = Data["bulk"]["owners"][number];

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

/** "Translate with products": the button that translates an owner with its image descriptions and extra details. */
const WITH_OWNER: Record<AttachedArea, MessageKey> = {
  products: "language.list.next.withProducts",
  collections: "language.list.next.withCollections",
  pages: "language.list.next.withPages",
  blog: "language.list.next.withBlog",
};
/** "You translate image descriptions together with your products." (the Content tiles' note). */
const OWNER_NOTE: Record<AttachedArea, MessageKey> = {
  products: "content.tile.attached.products",
  collections: "content.tile.attached.collections",
  pages: "content.tile.attached.pages",
  blog: "content.tile.attached.blog",
};
const PART_WORD: Record<AttachedPart, MessageKey> = { images: "content.tile.attachedPart.images", customFields: "content.tile.attachedPart.customFields" };
const PART_COUNT: Record<AttachedPart, MessageKey> = { images: "language.next.attached.images", customFields: "language.next.attached.customFields" };

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
    category: categoryName(i18n, data.category.id),
  };
}

/** "Content › German › Products" when opened from Content, else "Overview › German › Products". */
function trail(i18n: I18n, data: Data, names: Names, origin: Origin) {
  const locale = data.language.locale;
  const first = origin === "content" ? { href: `/app/content?lang=${encodeURIComponent(locale)}`, label: i18n.t("common.nav.content") } : { href: "/app", label: i18n.t("common.nav.overview") };
  return [
    first,
    { href: withOrigin(languagePath(locale), origin), label: names.title, before: <Flag country={localeCountry(locale, data.marketCountries)} fallback={locale} size={20} /> },
  ];
}

function Header({ data, i18n, names, origin }: { data: Data; i18n: I18n; names: Names; origin: Origin }) {
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
      <Breadcrumbs i18n={i18n} trail={trail(i18n, data, names, origin)} current={names.category} />
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
        <AreaIcon id={data.category.id} size={44} />
        <s-stack direction="block" gap="small-500">
          <h1 className="lv-h1">{t("language.list.heading", { category: names.category, language: names.language })}</h1>
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
          label={t("language.hero.ringLabel", { percent, complete: figure.complete, total: figure.total, count: figure.total })}
          size={112}
        />
        <s-stack direction="block" gap="small-300">
          <s-heading>{t("language.hero.figure", { complete: figure.complete, total: figure.total, count: figure.total })}</s-heading>
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
  /** Translating is starting, for this area (the area itself, or an owner of its image descriptions and extra details). */
  translating: CategoryId | null;
  /** Opens the confirm dialog for an area; `attached`: its image descriptions and extra details ticked. */
  confirm: (category: CategoryId, attached: boolean) => void;
}

/**
 * Image descriptions' and extra details' steps: one per owner that can be translated now, with its
 * button (its image descriptions and extra details ticked in the dialog) or its running job; the texts of
 * owners with nothing else to translate are translated one by one in the editor. `before`: the steps
 * above them (the first step's button is the page's one primary button).
 */
function ownerSteps(ctx: StepContext, part: AttachedPart, before: number): StepView[] {
  const { data, i18n, translating } = ctx;
  const { t } = i18n;
  const steps: StepView[] = [];
  const variant = () => (before + steps.length ? "secondary" : "primary");
  const texts = (count: number) => t(PART_COUNT[part], { count });
  const bulk = (owner: Owner) => owner.job !== null || owner.estimate !== null;
  for (const owner of data.bulk.owners.filter(bulk)) {
    const note = upperFirst(t(OWNER_NOTE[owner.id], { parts: t(PART_WORD[part]) }));
    steps.push({
      key: `owner-${owner.id}`,
      icon: <AreaIcon id={owner.id} size={STEP_ICON_SIZE} />,
      title: t("language.list.next.translate", { what: texts(owner.open) }),
      detail: note,
      action: owner.job ? (
        <Button variant={variant()} href={owner.job.href}>
          {t("language.card.jobOpen")}
        </Button>
      ) : data.bulk.gate === null ? (
        <Button variant={variant()} icon="wand" commandFor={CONFIRM} command="--show" onClick={() => ctx.confirm(owner.id, true)} {...(translating === owner.id ? { loading: true } : {})}>
          {t(WITH_OWNER[owner.id])}
        </Button>
      ) : undefined,
    });
  }
  const alone = data.bulk.owners.filter((owner) => !bulk(owner)).reduce((n, owner) => n + owner.open, 0);
  if (alone > 0) {
    steps.push({ key: "one-by-one", icon: <AreaIcon id={data.category.id} size={STEP_ICON_SIZE} />, title: t("language.list.next.translate", { what: texts(alone) }), detail: t("language.list.next.oneByOne") });
  }
  return steps;
}

/**
 * Up to three steps for the area: count the language first; approve what
 * waits; lift what keeps translating from starting (the AI permission, a key,
 * the plan); translate what is open (or follow its running job); count again
 * where it wasn't read completely; allow access. The first step's button is
 * the page's primary button.
 */
function areaSteps(ctx: StepContext): StepView[] {
  const { data, i18n, names, counter, translating } = ctx;
  const { t } = i18n;
  const { category } = data;
  const steps: StepView[] = [];
  const variant = () => (steps.length ? "secondary" : "primary");
  const countForm = (label: string) => (
    <counter.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <Button type="submit" variant={variant()} icon="chart-donut" {...(counter.state !== "idle" ? { loading: true } : {})}>
        {label}
      </Button>
    </counter.Form>
  );

  const figure = category.tally;
  if (!figure) {
    if (data.canCount) {
      steps.push({
        key: "count",
        icon: <StepIcon {...STEP_LOOK.count} />,
        title: t("language.next.count.title"),
        detail: t("language.next.count.detail", { language: names.language }),
        action: countForm(t("language.next.count.action")),
      });
    }
    return steps;
  }
  if (category.review) {
    steps.push({
      key: "review",
      icon: <StepIcon {...STEP_LOOK.review} />,
      title: t("language.next.review.title", { count: category.review.count }),
      detail: category.payoff !== null ? t("language.next.review.detail", { percent: i18n.percent(category.payoff) }) : t("language.next.review.detailNoGain"),
      action: (
        <Button variant={variant()} href={category.review.href}>
          {t("language.next.review.action")}
        </Button>
      ),
    });
  }
  const { estimate, owners, gate } = data.bulk;
  // What keeps translating from starting comes first, where the merchant can lift it.
  const wouldTranslate = (estimate !== null && !category.job) || owners.some((owner) => owner.estimate !== null && !owner.job);
  if (isUnlockGate(gate) && wouldTranslate) {
    steps.push({ key: "unlock", ...unlockStep(i18n, { gate, href: unlockHref(gate), language: names.language, variant: variant() }) });
  }
  const open = figure.counts.missing + figure.counts.outdated + figure.counts.failed;
  const areaIcon = <AreaIcon id={category.id} size={STEP_ICON_SIZE} />;
  if (category.job) {
    const { job } = category;
    const counted = job.discoveryDone && job.total > 0;
    steps.push({
      key: "job",
      icon: areaIcon,
      title: counted ? t("language.card.job", { done: job.done, total: job.total }) : t("language.card.jobFinding"),
      action: (
        <s-stack direction="block" gap="small-200">
          {counted ? <ProgressBar value={(job.done / job.total) * 100} label={t("language.card.jobLabel", { category: names.category })} /> : null}
          <s-stack direction="inline">
            <Button variant={variant()} href={job.href}>
              {t("language.card.jobOpen")}
            </Button>
          </s-stack>
        </s-stack>
      ),
    });
  } else if (estimate) {
    steps.push({
      key: "translate",
      icon: areaIcon,
      title: t("language.list.next.translate", { what: translateWhat(i18n, category.id, estimate) }),
      detail: `${openTexts(i18n, estimate.texts)}. ${t("language.list.next.keep")}`,
      action:
        gate === null ? (
          <Button
            variant={variant()}
            icon="wand"
            commandFor={CONFIRM}
            command="--show"
            onClick={() => ctx.confirm(category.id, false)}
            {...(translating === category.id ? { loading: true } : {})}
          >
            {t("language.action.translate")}
          </Button>
        ) : undefined,
    });
  } else if (owners.length && (category.id === "images" || category.id === "customFields")) {
    // Image descriptions and extra details go with their products (or collections, pages, blog posts).
    steps.push(...ownerSteps(ctx, category.id, steps.length));
  } else if (open > 0) {
    // Legal texts: one by one, and the merchant checks them.
    steps.push({ key: "translate", icon: areaIcon, title: t("language.next.category.title", { category: categoryInSentence(i18n, category.id) }), detail: `${openTexts(i18n, figure.counts)}. ${t("language.list.next.oneByOne")}` });
  }
  if (category.state.kind === "incomplete" && data.canCount) {
    steps.push({
      key: "recount",
      icon: <StepIcon {...STEP_LOOK.count} />,
      title: t("language.next.recount.title"),
      detail: t("language.next.recount.detail", { categories: names.category, count: 1 }),
      action: countForm(t("language.next.recount.action")),
    });
  }
  if (category.state.kind === "no-access") {
    const { href, types } = category.state;
    steps.push({
      key: "access",
      icon: <StepIcon {...STEP_LOOK.access} />,
      title: accessTitle(i18n, { href, categories: names.category, types }),
      detail: t("language.next.access.detail"),
      action: href ? (
        <Button variant={variant()} href={href}>
          {t("coverage.types.allowAccess")}
        </Button>
      ) : undefined,
    });
  }
  // Done only when everything was read and every counted text is live (COVERAGE_RULES §6).
  if (!steps.length && figure.total > 0 && figure.complete === figure.total && category.state.kind === "ok" && !data.scanning) {
    steps.push({ key: "done", icon: <StepIcon {...STEP_LOOK.done} />, title: t("language.next.done.title"), detail: t("language.next.done.detail") });
  }
  return steps.slice(0, 3);
}

function NextSteps(ctx: StepContext) {
  const { data, i18n } = ctx;
  const { t } = i18n;
  const steps = areaSteps(ctx);
  // The app's own setup (background jobs, the operator's AI) is only said: nothing here fixes it.
  const wouldTranslate = (data.bulk.estimate !== null && !data.category.job) || data.bulk.owners.some((owner) => owner.estimate !== null);
  const blocked = wouldTranslate && data.bulk.gate && !isUnlockGate(data.bulk.gate) ? data.bulk.gate : null;
  const empty = !data.measured ? (data.measurement.state === "unavailable" ? t("coverage.error.JOBS_UNAVAILABLE") : t("language.next.counting")) : t("language.next.empty");
  return (
    <s-stack direction="block" gap="base">
      <s-heading>{t("language.next.heading")}</s-heading>
      {steps.length ? <NumberedSteps steps={steps} /> : <s-text color="subdued">{empty}</s-text>}
      {blocked ? <s-text color="subdued">{languageErrorText(i18n, blocked)}</s-text> : null}
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
  const [searchParams] = useSearchParams();
  const origin = originOf(searchParams.get("from"));
  const [chosen, setChosen] = useState<{ category: CategoryId; attached: boolean } | null>(null);
  const areaNames = names(data, i18n);

  // Follow a count or a translation of this area while it runs; nothing to follow otherwise.
  const live = data.scanning || data.category.job !== null || data.bulk.owners.some((owner) => owner.job !== null);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [live, revalidator]);

  const error = [counter.data, translator.data].find((d): d is { error: string } => Boolean(d && "error" in d));
  // The dialog's area: this one, or the owner a step chose (with its image descriptions and extra details ticked).
  const owner = chosen ? data.bulk.owners.find((o) => o.id === chosen.category) : undefined;
  const target = owner?.estimate ? { category: owner.id, estimate: owner.estimate } : data.bulk.estimate ? { category: data.category.id, estimate: data.bulk.estimate } : null;
  const ctx: StepContext = {
    data,
    i18n,
    names: areaNames,
    counter,
    translating: translator.state !== "idle" ? (chosen?.category ?? data.category.id) : null,
    confirm: (category, attached) => setChosen({ category, attached }),
  };
  // The list once the language is counted and the area has items read (or a search found none).
  const listed = data.measured && (data.counts.all > 0 || Boolean(data.filter.q));
  const back = trail(i18n, data, areaNames, origin)[1]!;

  return (
    <s-page heading={t("language.list.heading", { category: areaNames.category, language: areaNames.language })}>
      <s-link slot="breadcrumb-actions" href={back.href}>
        {areaNames.title}
      </s-link>
      <s-stack direction="block" gap="base">
        <Header data={data} i18n={i18n} names={areaNames} origin={origin} />
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

        {listed ? <CategoryList data={data} i18n={i18n} names={areaNames} origin={origin} /> : null}
      </s-stack>

      <TranslateConfirm
        id={CONFIRM}
        target={target}
        languageName={areaNames.language}
        publishMode={data.bulk.publishMode}
        aiRemaining={data.bulk.aiRemaining}
        attachedDefault={Boolean(owner && chosen?.attached)}
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
