/**
 * "Your plan": which plan the store has (icon, name and state in words),
 * its one main action, and two meters: the AI characters this month (the
 * enforced allowance) and the languages the plan covers (the same rule
 * enforcement uses, said in words). No price: what a store pays is on its
 * Shopify invoice, the cards show list prices.
 */
import type { ReactNode } from "react";
import type { I18n, MessageVars } from "../../i18n/i18n";
import { INTL_LOCALE } from "../../i18n/i18n";
import { localeCountry } from "../../lib/flags";
import { languageList } from "../../lib/name-lists";
import { formatCostUsd } from "../../lib/plan-prices";
import { languageRoom, nextCharsOn, planName, smallestPlanForLanguages, splitLanguages, usagePercent, type HeroView, type Words } from "../../lib/plan-view";
import { estimatedCostUsd, type Entitlements } from "../../lib/plans";
import { usageLevel } from "../../lib/usage";
import { IconTile } from "../CategoryCard";
import { STATE_COLOURS, TRACK_COLOUR } from "../Coverage";
import { Flag } from "../Flag";
import { PLAIN_LIST } from "../LanguageLayout";
import { ProgressBar } from "../ProgressBar";
import { FIGURE, METER_LABEL, PLAN_NAME } from "./styles";

/** A message with its dates and plan names filled in. */
export function wordsText(i18n: I18n, words: Words, now: string): string {
  const vars: MessageVars = { ...words.vars };
  for (const [name, iso] of Object.entries(words.dates ?? {})) vars[name] = i18n.dayMonth(iso, now);
  for (const [name, iso] of Object.entries(words.dateTimes ?? {})) vars[name] = i18n.dateTime(iso);
  for (const [name, handle] of Object.entries(words.plans ?? {})) vars[name] = planName(handle);
  return i18n.t(words.key, vars);
}

export interface PlanLanguagesData {
  primary: string | null;
  primaryName: string | null;
  shopifyRoom: number;
  items: Array<{ locale: string; name: string; published: boolean; inPlan: boolean }>;
}

export interface PlanHeroProps {
  i18n: I18n;
  hero: HeroView;
  now: string;
  resetsOn: string;
  entitlements: Entitlements;
  usage: { month: number; today: number };
  limits: { limit: number; dailyLimit: number };
  aiAvailable: boolean;
  languages: PlanLanguagesData | null;
  costPerMillion: number | null;
  /** The main action and the refresh, built by the page (links to Shopify's page, the refresh form). */
  actions: ReactNode;
}

export function PlanHero({ i18n, hero, now, resetsOn, entitlements, usage, limits, aiAvailable, languages, costPerMillion, actions }: PlanHeroProps) {
  const { t } = i18n;
  const name = "handle" in hero.name ? planName(hero.name.handle) : t(hero.name.key);
  return (
    <s-section accessibilityLabel={t("plan.hero.label")}>
      <s-stack direction="block" gap="large">
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr auto, 1fr" gap="base" alignItems="start">
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="start">
              <IconTile icon={hero.icon} size={48} color="base" />
              <s-stack direction="block" gap="small-400">
                {/* The visual label; screen readers hear it inside the heading. */}
                <span aria-hidden="true">
                  <s-text color="subdued">{t("plan.hero.label")}</s-text>
                </span>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <h2 style={PLAN_NAME}>
                    <s-text accessibilityVisibility="exclusive">{`${t("plan.hero.label")}: `}</s-text>
                    {name}
                  </h2>
                  {hero.badge ? (
                    <s-badge tone={hero.badge.tone} icon={hero.badge.icon}>
                      {wordsText(i18n, hero.badge.words, now)}
                    </s-badge>
                  ) : null}
                </s-stack>
                {hero.lines.map((line) => (
                  <s-grid key={line.words.key} gridTemplateColumns={line.icon ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)"} gap="small-200" alignItems="start">
                    {line.icon ? <s-icon type={line.icon} color="subdued" /> : null}
                    <s-text color="subdued">{wordsText(i18n, line.words, now)}</s-text>
                  </s-grid>
                ))}
              </s-stack>
            </s-grid>
            {actions}
          </s-grid>
        </s-query-container>
        <s-divider />
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="large-200">
            {/* During a trial the plan's bigger allowance may come before the month renews. */}
            <PlanUsage i18n={i18n} now={now} resetsOn={nextCharsOn(hero, resetsOn)} usage={usage} limits={limits} aiAvailable={aiAvailable} />
            <PlanLanguages i18n={i18n} entitlements={entitlements} languages={languages} aiAvailable={aiAvailable} />
          </s-grid>
        </s-query-container>
        {costPerMillion !== null ? (
          <s-box background="subdued" borderRadius="base" padding="small-200">
            <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
              <s-icon type="receipt" color="subdued" />
              <s-text color="subdued">
                {t("plan.cost.internal", {
                  cost: formatCostUsd(i18n.locale, estimatedCostUsd(usage.month, costPerMillion)),
                  rate: formatCostUsd(i18n.locale, costPerMillion),
                })}
              </s-text>
            </s-grid>
          </s-box>
        ) : null}
      </s-stack>
    </s-section>
  );
}

/** A meter's head: its icon in a tile, its name (a heading under "Your plan: …"), and a short figure on the right. */
function MeterHead({ icon, label, aside }: { icon: "gauge" | "language"; label: string; aside: string | null }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <IconTile icon={icon} size={28} color="base" />
        <h3 style={METER_LABEL}>{label}</h3>
      </s-stack>
      {aside ? <s-text color="subdued">{aside}</s-text> : null}
    </s-stack>
  );
}

function PlanUsage({ i18n, now, resetsOn, usage, limits, aiAvailable }: Pick<PlanHeroProps, "i18n" | "now" | "resetsOn" | "usage" | "limits" | "aiAvailable">) {
  const { t } = i18n;
  if (!aiAvailable) {
    return (
      <s-stack direction="block" gap="small-200">
        <MeterHead icon="gauge" label={t("plan.usage.label")} aside={null} />
        <s-box background="subdued" borderRadius="base" padding="small-200">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
            <s-icon type="info" color="subdued" />
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{t("plan.usage.notConfiguredHeading")}</s-text>
              <s-text color="subdued">{t("plan.usage.notConfiguredBody")}</s-text>
            </s-stack>
          </s-grid>
        </s-box>
      </s-stack>
    );
  }
  const { percent, tiny } = usagePercent(usage.month, limits.limit);
  const level = usageLevel(usage.month, limits.limit);
  const date = i18n.dayMonth(resetsOn, now);
  const note =
    level === "exhausted"
      ? { tone: "critical" as const, text: t("plan.usage.exhausted", { date }) }
      : level === "high"
        ? { tone: "caution" as const, text: t("plan.usage.high", { left: Math.max(0, limits.limit - usage.month), date }) }
        : null;
  return (
    <s-stack direction="block" gap="small-200">
      <MeterHead icon="gauge" label={t("plan.usage.label")} aside={tiny ? t("plan.usage.percentTiny") : t("plan.usage.percent", { percent })} />
      <s-stack direction="inline" gap="small-200" alignItems="baseline">
        <span style={FIGURE}>{i18n.number(usage.month)}</span>
        <s-text color="subdued">{t("plan.usage.ofLimit", { limit: limits.limit })}</s-text>
      </s-stack>
      <ProgressBar value={percent} label={t("plan.usage.label")} tone={level === "exhausted" ? "critical" : level === "high" ? "warning" : "success"} />
      {note ? (
        <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
          <s-icon type="alert-triangle" tone={note.tone} />
          <s-text tone={note.tone}>{note.text}</s-text>
        </s-grid>
      ) : null}
      <s-stack direction="inline" justifyContent="space-between" gap="small-200">
        <s-text color="subdued">
          {limits.dailyLimit < limits.limit ? t("plan.usage.todayOfLimit", { used: usage.today, limit: limits.dailyLimit }) : t("plan.usage.today", { count: usage.today })}
        </s-text>
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-icon type="calendar" size="small" color="subdued" />
          <s-text color="subdued">{t("plan.usage.resets", { date })}</s-text>
        </s-stack>
      </s-stack>
    </s-stack>
  );
}

/** One of the store's languages: its flag and name (in the interface language), hidden or outside the plan in words. */
function LanguagePill({ i18n, locale, label, published, outside }: { i18n: I18n; locale: string; label: string; published: boolean; outside: boolean }) {
  return (
    <li>
      <s-box border={outside ? "base base dashed" : "base"} background={outside ? "subdued" : "transparent"} borderRadius="base" paddingInline="small-200" paddingBlock="small-400">
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <Flag country={localeCountry(locale)} fallback={locale} size={20} />
          <s-text color={outside ? "subdued" : undefined}>{label}</s-text>
          {published ? null : <s-badge icon="hide">{i18n.t("language.hidden")}</s-badge>}
          {outside ? (
            <s-stack direction="inline" gap="small-400" alignItems="center">
              <s-icon type="minus-circle" size="small" color="subdued" />
              <s-text color="subdued">{i18n.t("plan.languages.outside")}</s-text>
            </s-stack>
          ) : null}
        </s-stack>
      </s-box>
    </li>
  );
}

function PlanLanguages({ i18n, entitlements, languages, aiAvailable }: Pick<PlanHeroProps, "i18n" | "entitlements" | "languages" | "aiAvailable">) {
  const { t } = i18n;
  const max = entitlements.maxTargetLocales;
  if (!languages) {
    return (
      <s-stack direction="block" gap="small-200">
        <MeterHead icon="language" label={t("plan.languages.label")} aside={null} />
        <s-stack direction="inline" gap="small-200" alignItems="baseline">
          <span style={FIGURE}>{i18n.number(max)}</span>
          <s-text color="subdued">{t("plan.languages.label")}</s-text>
        </s-stack>
        <s-text color="subdued">{t("plan.languages.unavailable")}</s-text>
      </s-stack>
    );
  }
  const label = (item: { locale: string; name: string }) => i18n.language(item.locale, item.name);
  const collator = new Intl.Collator(INTL_LOCALE[i18n.locale]);
  const primaryName = languages.primary ? i18n.language(languages.primary, languages.primaryName) : null;
  // Without AI, the plan's language number limits nothing yet: only the store's languages.
  if (!aiAvailable) {
    const sorted = [...languages.items].sort((a, b) => collator.compare(label(a), label(b)));
    return (
      <s-stack direction="block" gap="small-200">
        <MeterHead
          icon="language"
          label={t("plan.languages.yours")}
          aside={primaryName && sorted.length ? t("plan.languages.besides", { count: sorted.length, language: primaryName }) : null}
        />
        {sorted.length ? (
          <ul aria-label={t("plan.languages.listLabel")} style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sorted.map((item) => (
              <LanguagePill key={item.locale} i18n={i18n} locale={item.locale} label={label(item)} published={item.published} outside={false} />
            ))}
          </ul>
        ) : (
          <s-text color="subdued">{t("plan.languages.none")}</s-text>
        )}
        <s-text color="subdued">{t("plan.languages.manualAlways")}</s-text>
      </s-stack>
    );
  }
  const { inside, outside } = splitLanguages(languages.items, label, collator);
  const room = languageRoom(max, inside.length, languages.shopifyRoom);
  const needed = outside.length ? smallestPlanForLanguages(languages.items.length) : null;
  const outsideNames = languageList(i18n, outside.map(label), Infinity);
  return (
    <s-stack direction="block" gap="small-200">
      <MeterHead
        icon="language"
        label={t("plan.languages.label")}
        aside={room ? (room.kind === "full" ? t("plan.languages.full") : t("plan.languages.room", { count: room.count })) : null}
      />
      <s-stack direction="inline" gap="small-200" alignItems="baseline">
        <span style={FIGURE}>{i18n.number(inside.length)}</span>
        <s-text color="subdued">{t("plan.languages.ofMax", { max })}</s-text>
      </s-stack>
      {/* The slots say what the figure says. */}
      <div aria-hidden="true" style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: Math.min(max, 20) }, (_, i) => (
          <div key={i} style={{ flex: 1, height: 8, borderRadius: 2, background: i < inside.length ? STATE_COLOURS.complete : TRACK_COLOUR }} />
        ))}
      </div>
      {languages.items.length ? (
        <ul aria-label={t("plan.languages.listLabel")} style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {inside.map((item) => (
            <LanguagePill key={item.locale} i18n={i18n} locale={item.locale} label={label(item)} published={item.published} outside={false} />
          ))}
          {outside.map((item) => (
            <LanguagePill key={item.locale} i18n={i18n} locale={item.locale} label={label(item)} published={item.published} outside />
          ))}
        </ul>
      ) : (
        <s-text color="subdued">{t("plan.languages.none")}</s-text>
      )}
      {outside.length ? (
        <s-box background="subdued" borderRadius="base" padding="small-200">
          <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="start">
            <s-icon type="info" size="small" color="subdued" />
            <s-text>
              {[
                t("plan.languages.rule", { count: max }),
                needed ? t("plan.languages.outsideAiPlan", { languages: outsideNames, plan: planName(needed) }) : t("plan.languages.outsideAi", { languages: outsideNames }),
                t("plan.languages.manualAlways"),
              ].join(" ")}
            </s-text>
          </s-grid>
        </s-box>
      ) : null}
      {primaryName ? <s-text color="subdued">{t("plan.languages.original", { language: primaryName })}</s-text> : null}
    </s-stack>
  );
}
