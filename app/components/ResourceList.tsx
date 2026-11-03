/**
 * List of translatable resources (products, collections) with coverage
 * per language and bulk translation. See .server/translation/resource-list.
 * Titled as the Content page names the type ("Buttons & fixed texts"), each
 * item's state as the area lists show it (an icon and the same word).
 */
import { useFetcher, useLoaderData } from "react-router";
import type { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { kindLabel, kindPlural, kindSingular } from "../i18n/labels";
import { isHubType } from "../lib/content-areas";
import type { ItemState } from "../lib/language-categories";
import { ITEM_STATE_LOOK } from "./ItemStates";
import { Breadcrumbs } from "./LanguageLayout";
import { Button } from "./Button";

type ListLoader = () => ReturnType<typeof loadResourceList>;
type ListAction = () => ReturnType<typeof runResourceListAction>;

/** The Content page in the list's language (where every list opens from). */
const contentHref = (locale: string | null) => (locale ? `/app/content?lang=${encodeURIComponent(locale)}` : "/app/content");

/** The list's title: the Content page's name for the type, so its row and this page say the same. */
function listTitle(i18n: I18n, type: string): string {
  return isHubType(type) ? i18n.t(`content.part.${type}.name`) : kindLabel(i18n, type);
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
  const { t, number } = i18n;
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
      <Breadcrumbs i18n={i18n} trail={[{ href: back, label: t("common.nav.content") }]} current={label} />
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
      <s-section>
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text>{t("resources.translateInto")}</s-text>
          {data.targets.map((target) => {
            // Hidden languages say so: customers can't choose them yet.
            const name = target.published ? i18n.language(target.locale, target.name) : t("resources.hiddenLanguage", { language: i18n.language(target.locale, target.name) });
            return target.locale === locale ? (
              <s-badge key={target.locale} tone="info">
                {name}
              </s-badge>
            ) : (
              <s-link key={target.locale} href={`${data.kind.path}?lang=${encodeURIComponent(target.locale)}`}>
                {name}
              </s-link>
            );
          })}
        </s-stack>
      </s-section>

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
              <s-stack direction="block" gap="base">
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base" alignItems="end">
                    <s-select name="fieldScope" label={t("resources.bulk.scopeLabel")}>
                      <s-option value="ALL">{t("resources.bulk.scopeAll")}</s-option>
                      <s-option value="SEO">{t("resources.bulk.scopeSeo")}</s-option>
                    </s-select>
                    <s-checkbox name="overwriteProtected" label={t("resources.bulk.overwrite")} />
                    {data.bulk.attached ? (
                      <s-checkbox
                        name="includeAttached"
                        label={t("language.confirm.attached")}
                        details={t("resources.bulk.attachedDetails", { singular: kindSingular(i18n, data.kind.type) })}
                      />
                    ) : null}
                  </s-grid>
                </s-query-container>
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
              <s-table-header format="numeric">{t("resources.table.translatedFields")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.items.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-link href={`${data.kind.path}/${p.id}?lang=${encodeURIComponent(locale)}`}>
                      {p.title}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <StateBadge state={p.outdated > 0 ? "outdated" : p.translated === p.total ? "complete" : "missing"} i18n={i18n} />
                  </s-table-cell>
                  <s-table-cell>
                    {number(p.translated)} / {number(p.total)}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-stack direction="inline" gap="base">
        {!data.isFirstPage ? (
          <Button href={`${data.kind.path}?lang=${encodeURIComponent(locale)}`}>{t("language.list.page.first")}</Button>
        ) : null}
        {data.nextCursor ? (
          <Button
            href={`${data.kind.path}?lang=${encodeURIComponent(locale)}&after=${encodeURIComponent(data.nextCursor)}`}
          >
            {t("language.list.page.next")}
          </Button>
        ) : null}
      </s-stack>
    </s-page>
  );
}

