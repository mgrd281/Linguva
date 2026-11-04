/**
 * The list of one other content type (`/app/content/<type>`: menus, legal
 * texts, the theme's parts …) with coverage per language and bulk
 * translation. See .server/translation/resource-list. Products,
 * collections, pages and blog posts have their area's list only. It opens
 * as every page does (PageHeader): the way back (a 44 px back row on a
 * phone), the area's sign and the list's name, then the languages as
 * Content picks them. Titled as the Content page names the type ("Buttons & fixed
 * texts"), each item's state as the area lists show it (an icon and the
 * same word), the whole row opening the item.
 */
import { useFetcher, useLoaderData } from "react-router";
import type { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { kindLabel, kindPlural, kindSingular } from "../i18n/labels";
import { isHubType } from "../lib/content-areas";
import { localeCountry } from "../lib/flags";
import { categoryOf, EXTRAS, isCategoryId, type ItemState } from "../lib/language-categories";
import { AreaIcon } from "./CategoryCard";
import { IconSquare } from "./IconSquare";
import { ITEM_STATE_LOOK } from "./ItemStates";
import { LanguagePicker, pickerLanguages } from "./LanguagePicker";
import { PageHeader } from "./PageHeader";
import { Button } from "./Button";

type ListLoader = () => ReturnType<typeof loadResourceList>;
type ListAction = () => ReturnType<typeof runResourceListAction>;

/** The Content page in the list's language (where every list opens from). */
const contentHref = (locale: string | null) => (locale ? `/app/content?lang=${encodeURIComponent(locale)}` : "/app/content");

/** The list's title: the Content page's name for the type, so its row and this page say the same. */
function listTitle(i18n: I18n, type: string): string {
  return isHubType(type) ? i18n.t(`content.part.${type}.name`) : kindLabel(i18n, type);
}

/** The list's sign: its area's icon in the area's tint (the area list's header), else the theme's or the notifications'. */
function ListIcon({ type }: { type: string }) {
  const area = categoryOf(type);
  if (area && isCategoryId(area)) return <AreaIcon id={area} />;
  return <IconSquare icon={area === "theme" || area === "notifications" ? EXTRAS[area].icon : "text-block"} />;
}

type ListData = ReturnType<typeof useLoaderData<ListLoader>>;

/**
 * The languages to translate into, as Content picks them (LanguagePicker): visible ones first, each with
 * its flag, the current one not a link and in the chosen look; a hidden one says so. More than six: one
 * select that opens the chosen language at once.
 */
function TargetChips({ data, current, i18n }: { data: ListData; current: string; i18n: I18n }) {
  const { t } = i18n;
  return (
    <LanguagePicker
      languages={pickerLanguages(i18n, data.targets, {
        href: (l) => `${data.kind.path}?lang=${encodeURIComponent(l.locale)}`,
        country: (l) => localeCountry(l.locale, data.marketCountries),
      })}
      current={current}
      i18n={i18n}
      label={t("resources.translateInto")}
      navLabel={t("resources.translateInto")}
      lead
      fallback={{ action: data.kind.path }}
    />
  );
}

/** An item's state badge, in the area lists' words and icons: outdated, done, or still missing (also in part). */
function StateBadge({ state, i18n }: { state: Extract<ItemState, "outdated" | "complete" | "missing">; i18n: I18n }) {
  const look = ITEM_STATE_LOOK[state];
  const tone = state === "outdated" ? "warning" : state === "complete" ? "success" : undefined;
  return (
    <s-badge icon={look.icon} {...(tone ? { tone } : {})}>
      {i18n.t(`language.state.${state}`)}
    </s-badge>
  );
}

export function ResourceList() {
  const data = useLoaderData<ListLoader>();
  const bulk = useFetcher<ListAction>();
  const permission = useFetcher();
  const i18n = useI18n();
  const { t } = i18n;
  const label = listTitle(i18n, data.kind.type);
  const plural = kindPlural(i18n, data.kind.type);

  if (data.denied) {
    return (
      <s-page heading={label}>
        <s-section heading={t("resources.denied.heading", { plural })}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {data.denied.scope
                ? t("resources.denied.needsScope", { plural })
                : t("resources.denied.unavailable", { plural })}
            </s-paragraph>
            {data.denied.scope ? (
              <permission.Form method="post" action="/app/content">
                <input type="hidden" name="intent" value="request-scope" />
                <input type="hidden" name="scope" value={data.denied.scope} />
                <Button type="submit" variant="primary" {...(permission.state !== "idle" ? { loading: true } : {})}>
                  {t("resources.denied.allow")}
                </Button>
              </permission.Form>
            ) : null}
            <s-link href={contentHref(data.target?.locale ?? null)}>{t("resources.denied.back")}</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (!data.target || !data.bulk) {
    return (
      <s-page heading={label}>
        <s-section heading={t("resources.noLanguages.heading")}>
          <s-paragraph>{t("resources.noLanguages.body", { plural })}</s-paragraph>
          <Button href="shopify://admin/settings/languages" target="_top">
            {t("resources.noLanguages.open")}
          </Button>
        </s-section>
      </s-page>
    );
  }

  const locale = data.target.locale;
  const bulkError = bulk.data && "error" in bulk.data ? bulk.data.error : null;
  const back = contentHref(locale);

  return (
    <s-page heading={label}>
      <s-link slot="breadcrumb-actions" href={back}>
        {t("common.nav.content")}
      </s-link>
      {/* One stack for the page, as on every page: s-page spaces only its own sections, so the header and the chips would touch them. */}
      <s-stack direction="block" gap="base">
        <s-query-container>
          <s-stack direction="block" gap="base">
            {/* On a phone the trail is one 44 px back row ("‹ Content"), as on the editor and the area lists. */}
            <PageHeader sign={<ListIcon type={data.kind.type} />} title={label} trail={{ i18n, links: [{ href: back, label: t("common.nav.content") }] }} />
            <TargetChips data={data} current={locale} i18n={i18n} />
          </s-stack>
        </s-query-container>
        {data.bulk.available && !data.bulk.consent ? (
          <s-banner tone="info" heading={t("resources.consent.heading")}>
            <s-paragraph>
              {t("resources.consent.before")}
              <s-link href="/app/settings?section=ai">{t("common.nav.settings")}</s-link>
              {t("resources.consent.after")}
            </s-paragraph>
          </s-banner>
        ) : null}
        {bulkError ? (
          <s-banner tone="critical" heading={t("resources.bulkError.heading")}>
            <s-paragraph>
              {bulkError === "JOBS_UNAVAILABLE"
                ? t("resources.bulkError.JOBS_UNAVAILABLE")
                : bulkError === "PLAN_BULK" || bulkError === "PLAN_LANGUAGE"
                  ? t("resources.bulkError.plan")
                  : t("resources.bulkError.generic")}
            </s-paragraph>
          </s-banner>
        ) : null}
        {!data.bulk.planAllowsBulk || !data.bulk.planAllowsLocale ? (
          <s-banner
            tone="info"
            heading={
              !data.bulk.planAllowsBulk
                ? t("resources.plan.bulkHeading")
                : t("resources.plan.localeHeading", { language: i18n.language(data.target.locale, data.target.name) })
            }
          >
            <s-paragraph>
              {t("resources.plan.body", { plural })} <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
            </s-paragraph>
          </s-banner>
        ) : null}
        {data.kind.caution ? (
          <s-banner
            tone="warning"
            heading={data.kind.caution === "legal" ? t("resources.caution.legalHeading") : t("resources.caution.liquidHeading")}
          >
            <s-paragraph>
              {data.kind.caution === "legal" ? t("resources.caution.legalBody") : t("resources.caution.liquidBody")}
            </s-paragraph>
          </s-banner>
        ) : null}

        {data.kind.bulk ? (
          <s-section heading={t("resources.bulk.heading", { plural })}>
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {t("resources.bulk.intro")}{" "}
                {data.bulk.publishMode === "AUTO_PUBLISH" ? t("resources.bulk.autoPublish") : t("resources.bulk.review")}
              </s-paragraph>
              <bulk.Form method="post">
                <input type="hidden" name="intent" value="bulk-translate" />
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="idempotencyKey" value={data.bulk.idempotencyKey} />
                {/* One column: the choice, then its options one under the other, then the button. */}
                <s-stack direction="block" gap="base">
                  <s-box maxInlineSize="400px">
                    <s-select name="fieldScope" label={t("resources.bulk.scopeLabel")}>
                      <s-option value="ALL">{t("resources.bulk.scopeAll")}</s-option>
                      <s-option value="SEO">{t("resources.bulk.scopeSeo")}</s-option>
                    </s-select>
                  </s-box>
                  <s-stack direction="block" gap="small-200">
                    <s-checkbox name="overwriteProtected" label={t("resources.bulk.overwrite")} />
                    {data.bulk.attached ? (
                      <s-checkbox
                        name="includeAttached"
                        label={t("language.confirm.attached")}
                        details={t("resources.bulk.attachedDetails", { singular: kindSingular(i18n, data.kind.type) })}
                      />
                    ) : null}
                  </s-stack>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!data.bulk.available || !data.bulk.consent || !data.bulk.planAllowsBulk || !data.bulk.planAllowsLocale}
                    {...(bulk.state !== "idle" ? { loading: true } : {})}
                  >
                    {t("resources.bulk.submit", { language: i18n.language(data.target.locale, data.target.name) })}
                  </Button>
                </s-stack>
              </bulk.Form>
            </s-stack>
          </s-section>
        ) : null}
        <s-section padding="none">
          {data.items.length === 0 ? (
            <s-box padding="large">
              <s-stack direction="block" gap="small" alignItems="center">
                <s-heading>{t("resources.empty.heading", { plural })}</s-heading>
                <s-paragraph>
                  {t("resources.empty.body", {
                    label,
                    language: data.targets.some((l) => l.locale === locale) ? i18n.language(locale, data.targets.find((l) => l.locale === locale)?.name) : t("resources.empty.yourLanguages"),
                  })}
                </s-paragraph>
              </s-stack>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{label}</s-table-header>
                <s-table-header>{t("common.status")}</s-table-header>
                <s-table-header format="numeric">{t("language.state.complete")}</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.items.map((p) => {
                  // The whole row opens the item (its name is the link keyboards and screen readers use).
                  const linkId = `resource-row-${p.id}`;
                  return (
                    <s-table-row key={p.id} clickDelegate={linkId}>
                      <s-table-cell>
                        <s-link id={linkId} href={`${data.kind.path}/${p.id}?lang=${encodeURIComponent(locale)}`}>
                          {p.title}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <StateBadge state={p.outdated > 0 ? "outdated" : p.translated === p.total ? "complete" : "missing"} i18n={i18n} />
                      </s-table-cell>
                      {/* In words, as the area cards say it: the figure reads alone in a phone's list too. */}
                      <s-table-cell>{t("language.card.figure", { complete: p.translated, total: p.total, count: p.total })}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-section>

        {!data.isFirstPage || data.nextCursor ? (
          <s-stack direction="inline" gap="base">
            {!data.isFirstPage ? <Button href={`${data.kind.path}?lang=${encodeURIComponent(locale)}`}>{t("language.list.page.first")}</Button> : null}
            {data.nextCursor ? (
              <Button href={`${data.kind.path}?lang=${encodeURIComponent(locale)}&after=${encodeURIComponent(data.nextCursor)}`}>{t("language.list.page.next")}</Button>
            ) : null}
          </s-stack>
        ) : null}
      </s-stack>
    </s-page>
  );
}

