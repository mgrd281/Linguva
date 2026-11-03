/**
 * One language of the store, area by area (`/app/languages/:locale`): how
 * far it is, what to do next (exactly one primary button: the first step;
 * each step's icon says what kind of step it is), the three steps from
 * translating to live while texts wait for approval, then each area in the
 * order customers meet it, with real examples from the store, and last what
 * the percentage leaves out. Examples load after the page (their own
 * request); the page reloads every few seconds only while a count or a
 * translation of this language runs. Opened from Content (`?from=content`),
 * its trail and its links into the areas lead back there.
 */
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { loadLanguagePage, translateCategoryAction } from "../.server/languages/language-page";
import { startMeasurement } from "../.server/coverage/dashboard";
import { loadMarketCountries } from "../.server/markets/countries";
import { MARKETS_SCOPE } from "../.server/markets/markets";
import type { clientLoader as previewsLoader } from "./app.languages_.$locale_.previews";
import { AreaIcon, cardGrid, CategoryCard, categoryInSentence, categoryName, IconTile, type LanguageCategory } from "../components/CategoryCard";
import { itemsHref, percentLabel } from "../components/Coverage";
import { CoverageRing } from "../components/CoverageRing";
import { Disclosure } from "../components/Disclosure";
import { Flag } from "../components/Flag";
import { SHOWN_STATES, StateIcon, StateKey, StateLines, TextStateBar } from "../components/ItemStates";
import { Breadcrumbs, languageErrorText, NumberedSteps, PLAIN_LIST, type StepView } from "../components/LanguageLayout";
import { attachedTexts, STEP_ICON_SIZE, STEP_LOOK, StepIcon, unlockStep } from "../components/LanguageSteps";
import { ProgressBar } from "../components/ProgressBar";
import { StepStrip } from "../components/StepStrip";
import { TranslateConfirm } from "../components/TranslateConfirm";
import { Strong } from "../components/Type";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { emptyCounts } from "../lib/coverage-rules";
import { localeCountry } from "../lib/flags";
import { EXTRAS, isUnlockGate, originOf, tierOf, TIERS, withOrigin, type CategoryId, type ExtraId, type LanguageStep, type Origin } from "../lib/language-categories";
import { languageList, upperFirst } from "../lib/name-lists";
import { Button } from "../components/Button";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop, scopes, redirect } = await requireShop(request);
  return loadLanguagePage(admin, shop, params.locale ?? "", undefined, {
    markets: () => loadMarketCountries(shop.id, admin, () => scopes.query().then((s) => s.granted.includes(MARKETS_SCOPE))),
    toOverview: () => redirect("/app", { target: "_self" }),
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

/** Where the extras' texts are listed: the theme's and the notifications' parts open on Inhalte, in this language. */
const EXTRA_HREF: Record<ExtraId, (locale: string) => string> = {
  theme: (locale) => `/app/content?lang=${encodeURIComponent(locale)}&open=theme`,
  notifications: (locale) => `/app/content?lang=${encodeURIComponent(locale)}&open=notifications`,
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

/** The way back: to Content when the page was opened from there (in this language), else to the Overview. */
function backLink(i18n: I18n, locale: string, origin: Origin): { href: string; label: string } {
  return origin === "content"
    ? { href: `/app/content?lang=${encodeURIComponent(locale)}`, label: i18n.t("common.nav.content") }
    : { href: "/app", label: i18n.t("common.nav.overview") };
}

function Header({ data, i18n, title, origin }: { data: Data; i18n: I18n; title: string; origin: Origin }) {
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
      <Breadcrumbs i18n={i18n} trail={[backLink(i18n, data.language.locale, origin)]} current={title} />
      <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center">
        <Flag country={localeCountry(data.language.locale, data.marketCountries)} fallback={data.language.locale} size={40} />
        <s-stack direction="block" gap="small-500">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <h1 className="lv-h1">{title}</h1>
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
          label={t("language.hero.ringLabel", { percent, complete: figure.complete, total: figure.total, count: figure.total })}
          size={112}
        />
        <s-stack direction="block" gap="small-300">
          <s-heading>{t("language.hero.figure", { complete: figure.complete, total: figure.total, count: figure.total })}</s-heading>
          <s-text color="subdued">{t("language.hero.fallback", { primary: names.primary })}</s-text>
        </s-stack>
      </s-grid>
      <StateLines counts={figure.counts} i18n={i18n} strong />
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
  origin: Origin;
  /** Opens the confirm dialog for an area; `attached`: its image descriptions and extra details ticked. */
  confirm: (category: CategoryId, attached: boolean) => void;
  /** Counting the store: the form's fetcher. */
  counter: ReturnType<typeof useFetcher<typeof action>>;
}

function list(i18n: I18n, categories: readonly CategoryId[]) {
  return languageList(i18n, categories.map((id) => categoryName(i18n, id)));
}

/** "12 texts are missing, 4 are outdated – plus 3 image descriptions. Customers see these first." */
function categoryDetail(i18n: I18n, step: Extract<LanguageStep, { kind: "category" }>) {
  const { t } = i18n;
  const parts = [
    step.missing ? t("language.next.category.missing", { count: step.missing }) : null,
    step.outdated ? t("language.next.category.outdated", { count: step.outdated }) : null,
    step.failed ? t("language.next.category.failed", { count: step.failed }) : null,
  ].filter(Boolean);
  const open = upperFirst(parts.join(", "));
  const attached = attachedTexts(i18n, step.attached);
  return `${attached ? t("language.next.category.withAttached", { open, attached }) : open}. ${t(`language.tier.${tierOf(step.category)}.step`)}`;
}

function stepView(step: LanguageStep, first: boolean, ctx: StepContext): Omit<StepView, "key"> {
  const { data, i18n, names, counter, origin } = ctx;
  const { t } = i18n;
  const variant = first ? "primary" : "secondary";
  const countForm = (label: string) => (
    <counter.Form method="post">
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
      <Button type="submit" variant={variant} icon="chart-donut" {...(counter.state !== "idle" ? { loading: true } : {})}>
        {label}
      </Button>
    </counter.Form>
  );
  switch (step.kind) {
    case "count":
      return {
        icon: <StepIcon {...STEP_LOOK.count} />,
        title: t("language.next.count.title"),
        detail: t("language.next.count.detail", { language: names.inSentence }),
        action: countForm(t("language.next.count.action")),
      };
    case "review":
      return {
        icon: <StepIcon {...STEP_LOOK.review} />,
        title: t("language.next.review.title", { count: step.count }),
        detail: step.payoff !== null ? t("language.next.review.detail", { percent: i18n.percent(step.payoff) }) : t("language.next.review.detailNoGain"),
        action: (
          <Button variant={variant} href={step.href}>
            {t("language.next.review.action")}
          </Button>
        ),
      };
    case "unlock":
      return unlockStep(i18n, { gate: step.gate, href: step.href, language: names.inSentence, variant });
    case "category": {
      const category = data.categories.find((c) => c.id === step.category);
      const name = categoryName(i18n, step.category);
      // Opened from a step that names image descriptions or extra details: they are ticked in the dialog.
      const withAttached = step.attached.images + step.attached.customFields > 0;
      const action = category?.job ? (
        <Button variant={variant} href={category.job.href}>
          {t("language.card.jobOpen")}
        </Button>
      ) : step.action === "translate" ? (
        <Button
          variant={variant}
          icon="wand"
          commandFor={CONFIRM}
          command="--show"
          onClick={() => ctx.confirm(step.category, withAttached)}
          accessibilityLabel={`${t("language.action.translate")}: ${name}`}
        >
          {t("language.action.translate")}
        </Button>
      ) : (
        <Button variant={variant} href={withOrigin(step.href, origin)} accessibilityLabel={`${t("language.action.view")}: ${name}`}>
          {t("language.action.view")}
        </Button>
      );
      return {
        icon: <AreaIcon id={step.category} size={STEP_ICON_SIZE} />,
        title: t("language.next.category.title", { category: categoryInSentence(i18n, step.category) }),
        detail: categoryDetail(i18n, step),
        action,
      };
    }
    case "recount":
      return {
        icon: <StepIcon {...STEP_LOOK.count} />,
        title: t("language.next.recount.title"),
        detail: t("language.next.recount.detail", { categories: list(i18n, step.categories), count: step.categories.length }),
        action: countForm(t("language.next.recount.action")),
      };
    case "access":
      return {
        icon: <StepIcon {...STEP_LOOK.access} />,
        title: t("language.next.access.title", { categories: list(i18n, step.categories) }),
        detail: t("language.next.access.detail"),
        action: step.href ? (
          <Button variant={variant} href={step.href}>
            {t("coverage.types.allowAccess")}
          </Button>
        ) : undefined,
      };
    case "done":
      return { icon: <StepIcon {...STEP_LOOK.done} />, title: t("language.next.done.title"), detail: t("language.next.done.detail") };
  }
}

/** Up to three steps, each with its icon; the first one's button is the page's only primary button. */
function NextSteps(ctx: StepContext) {
  const { data, i18n } = ctx;
  const { t } = i18n;
  // A gate the merchant can lift is a step of its own; the app's own setup (jobs, the operator's AI) only said.
  const blocked = data.bulk.gate && !isUnlockGate(data.bulk.gate) && data.categories.some((c) => c.bulk) ? data.bulk.gate : null;
  // Not counted and nothing to offer: background jobs are missing, or a count of other languages runs.
  const empty = !data.measured
    ? data.measurement.state === "unavailable"
      ? t("coverage.error.JOBS_UNAVAILABLE")
      : t("language.next.counting")
    : t("language.next.empty");
  return (
    <s-stack direction="block" gap="base">
      <s-heading>{t("language.next.heading")}</s-heading>
      {data.next.length ? (
        <NumberedSteps steps={data.next.map((step, i) => ({ key: step.kind === "category" ? step.category : step.kind, ...stepView(step, i === 0, ctx) }))} />
      ) : (
        <s-text color="subdued">{empty}</s-text>
      )}
      {blocked ? <s-text color="subdued">{languageErrorText(i18n, blocked)}</s-text> : null}
    </s-stack>
  );
}

/** Shown: an area with texts, or one Linguva couldn't read in full (never hidden as "nothing to do"). */
const visible = (c: LanguageCategory) => c.tally.total > 0 || c.state.kind !== "ok";

function Areas({
  data,
  i18n,
  names,
  previews,
  translate,
  origin,
}: {
  data: Data;
  i18n: I18n;
  names: Names;
  previews: ReturnType<typeof useFetcher<typeof previewsLoader>>["data"];
  translate: (c: LanguageCategory) => { modalId: string; onOpen: () => void; loading: boolean } | null;
  origin: Origin;
}) {
  const { t } = i18n;
  const percent = data.headline && data.headline.total ? percentLabel(i18n, data.headline.complete, data.headline.total) : null;
  const tiers = TIERS.map((tier) => ({ id: tier.id, categories: data.categories.filter((c) => c.tier === tier.id && visible(c)) })).filter((tier) => tier.categories.length);
  if (!tiers.length) return null;
  const card = (c: LanguageCategory, featured: boolean) => (
    <CategoryCard
      key={c.id}
      category={c}
      i18n={i18n}
      locale={data.language.locale}
      primaryName={names.primary}
      preview={previews?.[c.id] ?? null}
      featured={featured}
      translate={translate(c)}
      origin={origin}
    />
  );
  return (
    <s-query-container>
      <s-stack direction="block" gap="base">
        <s-grid gridTemplateColumns="@container (inline-size > 760px) 1fr auto, 1fr" gap="base" alignItems="end">
          <s-stack direction="block" gap="small-500">
            <h2 className="lv-h2">{t("language.areas.heading")}</h2>
            <s-text color="subdued">{percent ? t("language.areas.intro", { percent }) : t("language.areas.introNoPercent")}</s-text>
          </s-stack>
          <StateKey i18n={i18n} />
        </s-grid>
        {tiers.map((tier) => {
          // The first tier's products lead, wide, with more pictures.
          const featured = tier.categories.find((c) => c.id === "products");
          const rest = tier.categories.filter((c) => c !== featured);
          return (
            // A tier is a group, not a step: its heading has no number.
            <s-stack key={tier.id} direction="block" gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <h3 className="lv-h3">{t(`language.tier.${tier.id}.name`)}</h3>
                <s-box display="@container (inline-size > 500px) auto, none">
                  <s-text color="subdued">– {t(`language.tier.${tier.id}.why`)}</s-text>
                </s-box>
              </s-stack>
              {featured ? card(featured, true) : null}
              {rest.length ? (
                // Rows always full (one card the full width, two or three side by side); each card as tall as its content.
                <s-grid gridTemplateColumns={cardGrid(rest.length)} gap="base" alignItems="start">
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

/** "More texts" (as on Content): what the percentage leaves out, the theme's, notifications and URL handles, each a row that opens them. */
function Extras({ data, i18n }: { data: Data; i18n: I18n }) {
  const { t } = i18n;
  const rows = data.extras.filter((e) => e.tally.total > 0 || (e.state && e.state.kind !== "ok"));
  if (!rows.length) return null;
  const percent = data.headline && data.headline.total ? percentLabel(i18n, data.headline.complete, data.headline.total) : null;
  return (
    <s-section heading={t("language.extras.heading")} padding="none">
      <s-box padding="none base base">
        <s-text color="subdued">{percent ? t("language.extras.intro", { percent }) : t("language.extras.introNoPercent")}</s-text>
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
                    <IconTile icon={EXTRAS[extra.id].icon} />
                    <s-stack direction="block" gap="small-500">
                      <Strong>{name}</Strong>
                      <s-text color="subdued">{denied ? t("language.card.noAccess") : t(`language.extra.${extra.id}.detail`)}</s-text>
                    </s-stack>
                    <s-box display="@container (inline-size > 560px) auto, none">
                      <div aria-hidden="true">{denied ? null : <TextStateBar counts={extra.tally.counts} label={name} i18n={i18n} />}</div>
                    </s-box>
                    <span className="lv-figure-row" style={{ textAlign: "end" }}>
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

/** The state words and what they mean, folded (the app's one fold). */
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
      <Disclosure summary={t("language.words.heading")}>
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 560px) 1fr 1fr, 1fr" gap="base">
            {SHOWN_STATES.map((s) => (
              <s-grid key={s} gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
                <StateIcon state={s} size="small" />
                <s-paragraph>
                  <Strong>{t(`language.state.${s}`)}</Strong> – {meaning[s]}
                </s-paragraph>
              </s-grid>
            ))}
            <s-paragraph>
              <Strong>{t("language.words.texts.term")}</Strong> – {t("language.words.texts")}
            </s-paragraph>
            <s-paragraph>
              <Strong>{t("language.words.percent.term")}</Strong> – {t("language.words.percent", { full: i18n.percent(100) })}
            </s-paragraph>
          </s-grid>
        </s-query-container>
      </Disclosure>
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
  const [searchParams] = useSearchParams();
  const origin = originOf(searchParams.get("from"));
  const [chosen, setChosen] = useState<{ category: CategoryId; attached: boolean } | null>(null);
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
  const target = chosen ? data.categories.find((c) => c.id === chosen.category) : undefined;
  // A card's "Translate": the dialog starts without the image descriptions and extra details.
  const translate = (c: LanguageCategory) =>
    data.bulk.gate === null && c.bulk !== null
      ? { modalId: CONFIRM, onOpen: () => setChosen({ category: c.id, attached: false }), loading: translator.state !== "idle" && chosen?.category === c.id }
      : null;
  const percent = data.headline ? percentLabel(i18n, data.headline.complete, data.headline.total) : "—";
  const back = backLink(i18n, locale, origin);

  return (
    <s-page heading={languageNames.title}>
      <s-link slot="breadcrumb-actions" href={back.href}>
        {back.label}
      </s-link>
      <s-stack direction="block" gap="base">
        <Header data={data} i18n={i18n} title={languageNames.title} origin={origin} />
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
                <NextSteps data={data} i18n={i18n} names={languageNames} origin={origin} confirm={(category, attached) => setChosen({ category, attached })} counter={counter} />
              </s-box>
            </s-grid>
          </s-query-container>
        </s-section>

        {/* Why the percentage rises only after approving: said while texts wait for it. */}
        {data.steps && data.steps.waiting > 0 && data.headline?.total ? (
          <StepStrip steps={data.steps} percent={percent} label={t("language.strip.label", { primary: languageNames.primary, language: languageNames.inSentence })} i18n={i18n} />
        ) : null}

        <Areas data={data} i18n={i18n} names={languageNames} previews={previews.data} translate={translate} origin={origin} />
        <Extras data={data} i18n={i18n} />
        {data.measured ? <Words i18n={i18n} names={languageNames} /> : null}
      </s-stack>

      <TranslateConfirm
        id={CONFIRM}
        target={target?.bulk ? { category: target.id, estimate: target.bulk } : null}
        languageName={languageNames.inSentence}
        publishMode={data.bulk.publishMode}
        aiRemaining={data.bulk.aiRemaining}
        attachedDefault={chosen?.attached ?? false}
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
