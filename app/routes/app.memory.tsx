import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { peekMarketCountries } from "../.server/markets/countries";
import {
  approveMemoryEntry,
  deleteMemoryEntry,
  listMemory,
  memoryStats,
} from "../.server/memory/translation-memory";
import { markupToPlainText } from "../.server/translation/segment-markup";
import { useResultToast } from "../components/app-bridge";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { Flag } from "../components/Flag";
import { IconSquare } from "../components/IconSquare";
import { SearchField } from "../components/SearchField";
import { TOOL_LOOK, ToolHeader, ToolsBreadcrumbSlot } from "../components/ToolHeader";
import type { I18n } from "../i18n/i18n";
import { useI18n } from "../i18n/react";
import { localeCountry } from "../lib/flags";
import { ALL, chosen } from "../lib/select-all";
import { Button } from "../components/Button";

/** Entries the list shows at most; a search finds the others. */
const SHOWN = 100;

function plain(markup: string): string {
  try {
    return markupToPlainText(markup);
  } catch {
    return markup;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireShop(request);
  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? "";
  const targetLocale = chosen(url.searchParams.get("lang")) ?? "";
  const [entries, stats, locales] = await Promise.all([
    // One more than shown: whether there are others to find.
    listMemory(shop.id, { search, targetLocale: targetLocale || undefined, take: SHOWN + 1 }),
    memoryStats(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
  ]);
  const inFilter = stats.filter((s) => !targetLocale || s.targetLocale === targetLocale);
  return {
    languages: locales.locales.filter((l) => !l.primary).map((l) => ({ locale: l.locale, name: l.name })),
    names: Object.fromEntries(locales.locales.map((l) => [l.locale, l.name])),
    // Flags of languages read in many countries pick one the store sells to (never a Shopify read here).
    marketCountries: peekMarketCountries(shop.id),
    search,
    targetLocale,
    entriesTotal: stats.reduce((n, s) => n + s.entries, 0),
    usesTotal: stats.reduce((n, s) => n + s.uses, 0),
    /** Entries of the chosen language (all languages without one), for "100 of 5,000". */
    inFilter: inFilter.reduce((n, s) => n + s.entries, 0),
    more: entries.length > SHOWN,
    entries: entries.slice(0, SHOWN).map((e) => ({
      id: e.id,
      sourceLocale: e.sourceLocale,
      targetLocale: e.targetLocale,
      source: plain(e.sourceText),
      target: plain(e.targetText),
      status: e.status,
      uses: e.useCount,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const id = String(form.get("entryId") ?? "");
  if (form.get("intent") === "delete") return { ok: await deleteMemoryEntry(shop.id, id), intent: "delete" as const };
  if (form.get("intent") === "approve") return { ok: await approveMemoryEntry(shop.id, id), intent: "approve" as const };
  return { ok: false, intent: null };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

/** "🇬🇧 English → 🇩🇪 German": the pair's flags and names in the interface language. */
function LanguagePair({ data, i18n, source, target }: { data: Data; i18n: I18n; source: string; target: string }) {
  const name = (locale: string) => i18n.language(locale, data.names[locale]);
  return (
    <span className="lv-tools-language">
      <Flag country={localeCountry(source, data.marketCountries)} fallback={source} size={20} />
      <span>{name(source)}</span>
      <span aria-hidden="true">→</span>
      <span className="lv-sr">{i18n.t("memory.pair.into")}</span>
      <Flag country={localeCountry(target, data.marketCountries)} fallback={target} size={20} />
      <span>{name(target)}</span>
    </span>
  );
}

/** The memory's address for a search and a language ("All languages": none). */
function memoryHref(search: string, language: string | null): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (language) params.set("lang", language);
  const query = params.toString();
  return query ? `/app/memory?${query}` : "/app/memory";
}

/**
 * A store whose memory is still empty: what fills it and the way there (Content, where translating starts),
 * instead of zero figures and a search over nothing.
 */
function EmptyMemory({ i18n }: { i18n: I18n }) {
  const { t } = i18n;
  const look = TOOL_LOOK.memory;
  return (
    <Card labelledBy="memory-empty">
      <s-box padding="large-100 none">
        <div className="lv-tools-empty">
          <IconSquare icon={look.icon} tint={look.tint} size={48} />
          <s-stack direction="block" gap="small-200" alignItems="center">
            <h2 id="memory-empty" className="lv-h2">
              {t("memory.empty.heading")}
            </h2>
            <s-text color="subdued">{t("memory.empty")}</s-text>
          </s-stack>
          <Button variant="primary" href="/app/content">
            {t("memory.empty.action")}
          </Button>
        </div>
      </s-box>
    </Card>
  );
}

export default function Memory() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const i18n = useI18n();
  const { t, number, language } = i18n;
  const result = fetcher.data;
  useResultToast(result, result?.ok ? (result.intent === "approve" ? t("memory.toast.approved") : result.intent === "delete" ? t("memory.toast.deleted") : null) : null);
  const filtered = Boolean(data.search || data.targetLocale);
  // Nothing remembered yet, and no search that found nothing: the page says what fills the memory.
  const empty = data.entriesTotal === 0 && !filtered;
  // A language applies at once, as Jobs' filters do, and the words are searched as they are typed. React 18
  // sends no onChange for a web component, so its input event goes there (and React 19's change event, once).
  const picked = useRef<string | null>(null);
  useEffect(() => {
    picked.current = null;
  }, [data.search, data.targetLocale]);
  const chooseLanguage = (value: string) => {
    const href = memoryHref(data.search, chosen(value));
    if (href === picked.current || href === memoryHref(data.search, data.targetLocale || null)) return;
    picked.current = href;
    void navigate(href, { replace: true, preventScrollReset: true });
  };

  return (
    <s-page heading={t("common.nav.memory")}>
      <ToolsBreadcrumbSlot i18n={i18n} />
      <s-stack direction="block" gap="base">
        <ToolHeader tool="memory" title={t("common.nav.memory")} lead={t("memory.intro")} i18n={i18n}>
          {empty ? null : (
            <ul className="lv-tools-figures">
              <li className="lv-tools-figures__item">
                <span className="lv-figure">{number(data.entriesTotal)}</span>
                <span className="lv-caption">{t("memory.figure.entries", { count: data.entriesTotal })}</span>
              </li>
              <li className="lv-tools-figures__item">
                <span className="lv-figure">{number(data.usesTotal)}</span>
                <span className="lv-caption">{t("memory.figure.reused", { count: data.usesTotal })}</span>
              </li>
            </ul>
          )}
        </ToolHeader>

        {empty ? (
          <EmptyMemory i18n={i18n} />
        ) : (
          <>
            <Card>
              <Form method="get" role="search" aria-label={t("common.nav.memory")}>
                <s-query-container>
                  <s-grid gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr, 1fr" gap="base" alignItems="end">
                    {/* Searches as you type (from two characters, at once on Enter), in the language chosen beside it. */}
                    <SearchField name="q" label={t("common.action.search")} labelHidden={false} placeholder={t("memory.search.placeholder")} value={data.search} />
                    <s-select
                      name="lang"
                      label={t("common.language")}
                      value={data.targetLocale || ALL}
                      onInput={(e) => chooseLanguage(e.currentTarget.value)}
                      onChange={(e) => chooseLanguage(e.currentTarget.value)}
                    >
                      <s-option value={ALL}>{t("common.allLanguages")}</s-option>
                      {data.languages.map((l) => (
                        <s-option key={l.locale} value={l.locale}>
                          {language(l.locale, l.name)}
                        </s-option>
                      ))}
                    </s-select>
                  </s-grid>
                </s-query-container>
              </Form>
            </Card>

            <Card padding="none">
              {data.entries.length === 0 ? (
                <s-box padding="base">
                  <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                    <s-icon type="search" color="subdued" />
                    <s-text color="subdued">{t("memory.search.none")}</s-text>
                  </s-grid>
                </s-box>
              ) : (
                <s-stack direction="block">
                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="primary">{t("memory.column.source")}</s-table-header>
                      <s-table-header>{t("memory.column.translation")}</s-table-header>
                      <s-table-header>{t("common.languages")}</s-table-header>
                      <s-table-header>{t("common.status")}</s-table-header>
                      <s-table-header format="numeric">{t("memory.column.uses")}</s-table-header>
                      <s-table-header>{t("memory.column.actions")}</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {data.entries.map((e) => (
                        <s-table-row key={e.id}>
                          {/* The store's own texts: never machine-translated by the browser (and no interface text). */}
                          <s-table-cell>
                            <span translate="no">{e.source}</span>
                          </s-table-cell>
                          <s-table-cell>
                            <span translate="no">{e.target}</span>
                          </s-table-cell>
                          <s-table-cell>
                            <LanguagePair data={data} i18n={i18n} source={e.sourceLocale} target={e.targetLocale} />
                          </s-table-cell>
                          <s-table-cell>
                            {e.status === "APPROVED" ? (
                              <s-badge tone="success" icon="check-circle-filled">
                                {t("memory.status.approved")}
                              </s-badge>
                            ) : (
                              <s-badge icon="wand">{t("memory.status.machine")}</s-badge>
                            )}
                          </s-table-cell>
                          <s-table-cell>{number(e.uses)}</s-table-cell>
                          <s-table-cell>
                            <s-stack direction="inline" gap="small">
                              {e.status !== "APPROVED" ? (
                                <Button variant="tertiary" icon="check" onClick={() => fetcher.submit({ intent: "approve", entryId: e.id }, { method: "post" })}>
                                  {t("memory.action.approve")}
                                </Button>
                              ) : null}
                              <Button variant="tertiary" tone="critical" icon="delete" commandFor="memory-delete" command="--show" onClick={() => setPendingDelete(e.id)}>
                                {t("common.action.delete")}
                              </Button>
                            </s-stack>
                          </s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                  {data.more ? (
                    <s-box padding="base">
                      <s-text color="subdued">
                        {data.search ? t("memory.list.moreMatches", { shown: data.entries.length }) : t("memory.list.more", { shown: data.entries.length, total: data.inFilter })}
                      </s-text>
                    </s-box>
                  ) : null}
                </s-stack>
              )}
            </Card>
          </>
        )}
      </s-stack>
      <ConfirmModal
        id="memory-delete"
        heading={t("memory.delete.heading")}
        body={t("memory.delete.body")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => pendingDelete && fetcher.submit({ intent: "delete", entryId: pendingDelete }, { method: "post" })}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
