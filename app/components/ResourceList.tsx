/**
 * List of translatable resources (products, collections) with coverage
 * per language and bulk translation. See .server/translation/resource-list.
 */
import { useFetcher, useLoaderData } from "react-router";
import type { loadResourceList, runResourceListAction } from "../.server/translation/resource-list";
import { useI18n } from "../i18n/react";
import { kindLabel, kindPlural, kindSingular } from "../i18n/labels";
import { Breadcrumbs } from "./LanguageLayout";

type ListLoader = () => ReturnType<typeof loadResourceList>;
type ListAction = () => ReturnType<typeof runResourceListAction>;

/** The Content page in the list's language (where every list opens from). */
const contentHref = (locale: string | null) => (locale ? `/app/content?lang=${encodeURIComponent(locale)}` : "/app/content");

export function ResourceList() {
  const data = useLoaderData<ListLoader>();
  const bulk = useFetcher<ListAction>();
  const permission = useFetcher();
  const i18n = useI18n();
  const { t, number } = i18n;
  const label = kindLabel(i18n, data.kind.type);
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
                <s-button type="submit" variant="primary" {...(permission.state !== "idle" ? { loading: true } : {})}>
                  {t("resources.denied.allow")}
                </s-button>
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
          <s-button href="shopify://admin/settings/languages" target="_top">
            {t("resources.noLanguages.open")}
          </s-button>
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
            <s-link href="/app/settings">{t("common.nav.settings")}</s-link>
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
                        label={t("resources.bulk.attached")}
                        details={t("resources.bulk.attachedDetails", { singular: kindSingular(i18n, data.kind.type) })}
                      />
                    ) : null}
                  </s-grid>
                </s-query-container>
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!data.bulk.available || !data.bulk.consent || !data.bulk.planAllowsBulk || !data.bulk.planAllowsLocale}
                  {...(bulk.state !== "idle" ? { loading: true } : {})}
                >
                  {t("resources.bulk.submit", { language: i18n.language(data.target.locale, data.target.name) })}
                </s-button>
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
                    {p.outdated > 0 ? (
                      <s-badge tone="warning">{t("common.translationStatus.outdated")}</s-badge>
                    ) : p.translated === p.total ? (
                      <s-badge tone="success">{t("common.translationStatus.translated")}</s-badge>
                    ) : p.translated > 0 ? (
                      <s-badge tone="info">{t("resources.status.partial")}</s-badge>
                    ) : (
                      <s-badge>{t("common.translationStatus.missing")}</s-badge>
                    )}
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
          <s-button href={`${data.kind.path}?lang=${encodeURIComponent(locale)}`}>{t("resources.paging.first")}</s-button>
        ) : null}
        {data.nextCursor ? (
          <s-button
            href={`${data.kind.path}?lang=${encodeURIComponent(locale)}&after=${encodeURIComponent(data.nextCursor)}`}
          >
            {t("resources.paging.next")}
          </s-button>
        ) : null}
      </s-stack>
    </s-page>
  );
}

