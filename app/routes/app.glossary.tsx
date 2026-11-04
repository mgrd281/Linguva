import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ZodError } from "zod";
import { requireShop } from "../.server/shopify/require-shop";
import { shopBilling } from "../.server/billing/billing";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import { fetchMarkets, MARKETS_SCOPE } from "../.server/markets/markets";
import {
  deleteTerm,
  GlossaryLimitError,
  issueMessages,
  listTerms,
  MAX_TERMS_PER_SHOP,
  parseGlossaryCsv,
  upsertTerms,
} from "../.server/glossary/glossary";
import type { I18n, MessageRef } from "../i18n/i18n";
import { hasMessage } from "../i18n/labels";
import { showToast, useResultToast } from "../components/app-bridge";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { Disclosure } from "../components/Disclosure";
import { IconSquare } from "../components/IconSquare";
import { LockLine, useFreshResult } from "../components/SettingsParts";
import { ToolHeader, ToolsBreadcrumbSlot } from "../components/ToolHeader";
import { Strong } from "../components/Type";
import { useI18n } from "../i18n/react";
import { formProblems, GLOSSARY_RULES, isGlossaryRule, matchesQuery, MAX_SHOWN_TERMS, RULE_LOOK, SEARCH_FROM, type FormField, type GlossaryRule } from "../lib/glossary-form";
import { ALL, chosen } from "../lib/select-all";
import { Button } from "../components/Button";

const MAX_IMPORT_BYTES = 1024 * 1024;

function ruleLabel(i18n: I18n, rule: string): string {
  const key = `glossary.rule.${rule}`;
  return hasMessage(key) ? i18n.t(key) : rule;
}

/** A row's (or the form's) problems, joined like "translation: …; targetLocale: …". */
function problems(i18n: I18n, messages: MessageRef[]): string {
  return messages.map(i18n.msg).join("; ");
}

type MarketChoice = { id: string; name: string; active: boolean };

/**
 * Adding, deleting and importing revalidate the page, and markets rarely change: they are read at most
 * once a minute per shop (per process), as on Coverage. A missing grant isn't kept, so the choice appears
 * as soon as the merchant allows access (as on the Overview); a failed read isn't kept either.
 */
const MARKETS_CACHE_MS = 60_000;
const marketsCache = new Map<string, { at: number; value: MarketChoice[] }>();

/**
 * The store's markets by name, for a term that applies in one market only. Markets need the optional
 * read_markets scope; without it (or when Shopify doesn't answer) the form has no market choice and a
 * term applies everywhere.
 */
async function readMarkets(
  shopId: string,
  admin: Parameters<typeof fetchMarkets>[0],
  scopes: Awaited<ReturnType<typeof requireShop>>["scopes"],
  now = Date.now(),
): Promise<MarketChoice[]> {
  const cached = marketsCache.get(shopId);
  if (cached && now - cached.at < MARKETS_CACHE_MS) return cached.value;
  try {
    if (!(await scopes.query()).granted.includes(MARKETS_SCOPE)) return [];
    const value = (await fetchMarkets(admin)).map((m) => ({ id: m.id, name: m.name, active: m.status === "ACTIVE" }));
    marketsCache.delete(shopId);
    marketsCache.set(shopId, { at: now, value });
    if (marketsCache.size > 1000) marketsCache.delete(marketsCache.keys().next().value!);
    return value;
  } catch {
    return [];
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop, scopes } = await requireShop(request);
  const [terms, locales, billing, markets] = await Promise.all([
    listTerms(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
    shopBilling(admin, shop),
    readMarkets(shop.id, admin, scopes),
  ]);
  return {
    /** Free and Starter have no glossary to edit (the action refuses it too): the page says so before the form. */
    editable: billing.entitlements.glossary,
    languages: locales.locales.filter((l) => !l.primary).map((l) => ({ locale: l.locale, name: l.name })),
    markets,
    terms: terms.map((t) => ({
      id: t.id,
      rule: t.rule,
      term: t.term,
      translation: t.translation,
      targetLocale: t.targetLocale,
      market: t.market,
      caseSensitive: t.caseSensitive,
    })),
  };
};

type Result =
  | { kind: "added" }
  | { kind: "deleted" }
  | { kind: "imported"; count: number; errors: Array<{ line: number; messages: MessageRef[] }> }
  | { kind: "error"; messages: MessageRef[] };

const failure = (ref: MessageRef): Result => ({ kind: "error", messages: [ref] });

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { admin, shop } = await requireShop(request);
  if (!(await shopBilling(admin, shop)).entitlements.glossary) {
    return failure({ key: "glossary.error.notOnPlan" });
  }
  // Refuse oversized uploads before the body is read into memory.
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return failure({ key: "glossary.error.uploadTooLarge" });
  const form = await request.formData();
  const intent = form.get("intent");

  try {
    if (intent === "add") {
      await upsertTerms(shop.id, [
        {
          rule: String(form.get("rule")) as "DO_NOT_TRANSLATE",
          term: String(form.get("term") ?? ""),
          translation: String(form.get("translation") ?? "") || null,
          targetLocale: chosen(form.get("targetLocale")) ?? "",
          market: chosen(form.get("market")) ?? "",
          caseSensitive: form.get("caseSensitive") === "on",
        },
      ]);
      return { kind: "added" };
    }
    if (intent === "delete") {
      await deleteTerm(shop.id, String(form.get("termId") ?? ""));
      return { kind: "deleted" };
    }
    if (intent === "import") {
      const file = form.get("file");
      const pasted = form.get("csv");
      let text = typeof pasted === "string" ? pasted : "";
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_IMPORT_BYTES) return failure({ key: "glossary.error.fileTooLarge" });
        text = await file.text();
      }
      if (text.length > MAX_IMPORT_BYTES) return failure({ key: "glossary.error.csvTooLarge" });
      const parsed = parseGlossaryCsv(text);
      // Nothing is imported unless every row is valid.
      if (parsed.errors.length) return { kind: "imported", count: 0, errors: parsed.errors.slice(0, 20) };
      const count = await upsertTerms(shop.id, parsed.terms, { replaceAll: form.get("replaceAll") === "on" });
      return { kind: "imported", count, errors: [] };
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return { kind: "error", messages: issueMessages(error.issues) };
    }
    if (error instanceof GlossaryLimitError) return failure({ key: "glossary.error.limit", vars: { max: MAX_TERMS_PER_SHOP } });
    throw error;
  }
  return failure({ key: "glossary.error.unknownAction" });
};

// fetch() inside the embedded app carries the session token (App Bridge),
// which a plain link to a new tab wouldn't.
async function downloadCsv(): Promise<boolean> {
  try {
    const response = await fetch("/app/glossary/export");
    if (!response.ok) return false;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "linguva-glossary.csv";
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

/**
 * "Never translate · Always translate as · Never use" as equal tiles with their icon, one native radio each (the
 * arrow keys move between them). The legend is a field's label, as "Term" and "Language" under it. On a narrow
 * card the three stay side by side as their sign, radio and name (ui.css, .lv-tools-rules__tiles), so the term
 * field is on the first screen; the chosen rule's sentence is then one line under them.
 */
function RuleTiles({ value, onChange, disabled, i18n }: { value: GlossaryRule; onChange: (rule: GlossaryRule) => void; disabled: boolean; i18n: I18n }) {
  const { t } = i18n;
  const id = useId();
  return (
    <fieldset className="lv-tools-rules" disabled={disabled}>
      <legend className="lv-tools-rules__legend">{t("glossary.field.rule")}</legend>
      <div className="lv-tools-rules__tiles">
        <div className="lv-options">
          {GLOSSARY_RULES.map((rule) => {
            const look = RULE_LOOK[rule];
            const checked = rule === value;
            return (
              <label key={rule} className={["lv-option", "lv-tools-rule", checked ? "lv-option--current" : null].filter(Boolean).join(" ")}>
                <span className="lv-option__top">
                  <IconSquare icon={look.icon} tint={look.tint} />
                  <input
                    type="radio"
                    name="rule"
                    value={rule}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange(rule)}
                    className="lv-tools-rule__radio"
                    aria-labelledby={`${id}-${rule}`}
                    aria-describedby={`${id}-${rule}-help`}
                  />
                </span>
                <span id={`${id}-${rule}`} className="lv-option__title">
                  {ruleLabel(i18n, rule)}
                </span>
                <span id={`${id}-${rule}-help`} className="lv-option__body">
                  {t(look.help)}
                </span>
              </label>
            );
          })}
        </div>
        {/* Seen on a narrow card only, where the tiles' sentences are hidden; screen readers hear each tile's own. */}
        <p className="lv-tools-rules__help" aria-hidden="true">
          {t(RULE_LOOK[value].help)}
        </p>
      </div>
    </fieldset>
  );
}

/** The market of a term by its name (the number where the store's markets can't be read). */
function marketLabel(data: Data, i18n: I18n, market: string): string {
  if (!market) return i18n.t("common.state.all");
  return data.markets.find((m) => m.id === market)?.name ?? market.replace("gid://shopify/Market/", "#");
}

export default function GlossaryPage() {
  const data = useLoaderData<typeof loader>();
  const i18n = useI18n();
  const { t } = i18n;
  const { terms } = data;
  const locked = !data.editable;
  const languageNames = Object.fromEntries(data.languages.map((l) => [l.locale, i18n.language(l.locale, l.name)]));
  const addFetcher = useFetcher<typeof action>();
  const importFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rule, setRule] = useState<GlossaryRule>("DO_NOT_TRANSLATE");
  // A new form after each added term (the rule chosen stays), so the next one starts empty.
  const [formRound, setFormRound] = useState(0);
  const [query, setQuery] = useState("");
  const [replaceAll, setReplaceAll] = useState(false);
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");
  const importForm = useRef<HTMLFormElement>(null);
  const addResult = addFetcher.data;
  const importResult = importFetcher.data;

  useFreshResult(addFetcher, (result) => {
    if (result.kind !== "added") return;
    setFormRound((n) => n + 1);
    showToast(t("glossary.toast.added"));
  });
  // The term field takes the focus for the next term.
  useEffect(() => {
    if (formRound === 0) return;
    document.querySelector<HTMLElement>('#glossary-add s-text-field[name="term"]')?.focus();
  }, [formRound]);
  useResultToast(
    importResult,
    importResult?.kind === "imported" && !importResult.errors.length ? t("glossary.import.count", { count: importResult.count }) : null,
  );
  useResultToast(deleteFetcher.data, deleteFetcher.data?.kind === "deleted" ? t("glossary.toast.deleted") : null);

  const placed = addResult?.kind === "error" ? formProblems(addResult.messages) : null;
  const fieldError = (field: FormField) => {
    const ref = placed?.fields[field];
    return ref ? { error: i18n.msg(ref) } : {};
  };
  // A store whose plan lost the glossary: the lock says so, not a banner after the fact.
  const rest = (placed?.rest ?? []).filter((ref) => !(locked && ref.key === "glossary.error.notOnPlan"));

  // The search filters only while its field is shown. Below SEARCH_FROM (after a delete or "Replace all")
  // it is forgotten, so the list isn't filtered by words nobody can see, and a field that comes back starts
  // empty. Reset while rendering, not in an effect: React renders again before any filtered list is shown.
  const searchable = terms.length >= SEARCH_FROM;
  if (!searchable && query) setQuery("");
  const matching = useMemo(() => terms.filter((term) => matchesQuery(term, query)), [terms, query]);
  const shown = matching.slice(0, MAX_SHOWN_TERMS);
  const activeMarkets = data.markets.filter((m) => m.active);
  // The market column only where a term applies in one market.
  const anyMarket = terms.some((term) => term.market);
  const preferred = rule === "PREFERRED";

  return (
    <s-page heading={t("common.nav.glossary")}>
      <ToolsBreadcrumbSlot i18n={i18n} />
      <s-stack direction="block" gap="base">
        <ToolHeader tool="glossary" title={t("common.nav.glossary")} lead={t("glossary.page.lead")} i18n={i18n} />

        <Card heading={t("glossary.add.heading")}>
          <s-stack direction="block" gap="base">
            {locked ? <LockLine plan="Pro" text={t("glossary.error.notOnPlan")} link={{ href: "/app/plan", label: t("common.action.seePlans") }} /> : null}
            <addFetcher.Form method="post" id="glossary-add" key={formRound}>
              <input type="hidden" name="intent" value="add" />
              <s-stack direction="block" gap="base">
                <RuleTiles value={rule} onChange={setRule} disabled={locked} i18n={i18n} />
                <s-query-container>
                  <s-grid gridTemplateColumns={preferred ? "@container (inline-size > 640px) 1fr 1fr 1fr, 1fr" : "@container (inline-size > 640px) 2fr 1fr, 1fr"} gap="base">
                    <s-text-field name="term" label={t("glossary.field.term")} details={t(RULE_LOOK[rule].term)} required {...fieldError("term")} {...(locked ? { disabled: true } : {})} />
                    {/* Only "Always translate as" has a translation of its own. */}
                    {preferred ? (
                      <s-text-field name="translation" label={t("glossary.field.translation")} details={t("glossary.field.translationDetails")} {...fieldError("translation")} {...(locked ? { disabled: true } : {})} />
                    ) : null}
                    {/* "Always translate as" is for one language: no "All languages" then (a new select, so it starts at the first language). */}
                    <s-select key={preferred ? "one" : "all"} name="targetLocale" label={t("common.language")} {...fieldError("targetLocale")} {...(locked ? { disabled: true } : {})}>
                      {preferred ? null : <s-option value={ALL}>{t("common.allLanguages")}</s-option>}
                      {data.languages.map((l) => (
                        <s-option key={l.locale} value={l.locale}>
                          {i18n.language(l.locale, l.name)}
                        </s-option>
                      ))}
                    </s-select>
                  </s-grid>
                </s-query-container>
                <Disclosure summary={t("glossary.more.summary")}>
                  {activeMarkets.length ? (
                    <s-select name="market" label={t("glossary.field.market")} details={t("glossary.field.marketDetails")} {...fieldError("market")} {...(locked ? { disabled: true } : {})}>
                      <s-option value={ALL}>{t("glossary.field.allMarkets")}</s-option>
                      {activeMarkets.map((m) => (
                        <s-option key={m.id} value={m.id}>
                          {m.name}
                        </s-option>
                      ))}
                    </s-select>
                  ) : null}
                  <s-checkbox name="caseSensitive" label={t("glossary.field.caseSensitive")} details={t("glossary.field.caseSensitiveDetails")} {...(locked ? { disabled: true } : {})} />
                </Disclosure>
                <s-stack direction="inline">
                  <Button type="submit" variant="primary" icon="plus" disabled={locked} {...(addFetcher.state !== "idle" ? { loading: true } : {})}>
                    {t("glossary.add.submit")}
                  </Button>
                </s-stack>
              </s-stack>
            </addFetcher.Form>
            {rest.length ? (
              <s-banner tone="critical" heading={t("glossary.add.failed")}>
                <s-paragraph>{problems(i18n, rest)}</s-paragraph>
              </s-banner>
            ) : null}
          </s-stack>
        </Card>

        <Card heading={t("glossary.terms.heading", { count: terms.length })} padding="none">
          {terms.length === 0 ? (
            <s-box padding="small-200 base base">
              <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="small-200" alignItems="center">
                <s-icon type="book-open" color="subdued" />
                <s-text color="subdued">{t("glossary.terms.empty")}</s-text>
              </s-grid>
            </s-box>
          ) : (
            <s-stack direction="block">
              {searchable ? (
                <s-box padding="small-200 base none">
                  <s-search-field label={t("glossary.search.label")} placeholder={t("glossary.search.placeholder")} onInput={(e) => setQuery(e.currentTarget.value)} />
                </s-box>
              ) : null}
              {shown.length ? (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">{t("glossary.field.term")}</s-table-header>
                    <s-table-header>{t("glossary.field.rule")}</s-table-header>
                    <s-table-header>{t("glossary.field.translation")}</s-table-header>
                    <s-table-header>{t("common.language")}</s-table-header>
                    {anyMarket ? <s-table-header>{t("glossary.terms.market")}</s-table-header> : null}
                    <s-table-header>{t("glossary.terms.actions")}</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {shown.map((term) => (
                      <s-table-row key={term.id}>
                        <s-table-cell>
                          <Strong>{term.term}</Strong>
                          {term.caseSensitive ? <s-text color="subdued"> {t("glossary.terms.caseSensitive")}</s-text> : null}
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-300" alignItems="center">
                            {isGlossaryRule(term.rule) ? <s-icon type={RULE_LOOK[term.rule].icon} color="subdued" size="small" /> : null}
                            <s-text>{ruleLabel(i18n, term.rule)}</s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{term.translation ?? "—"}</s-table-cell>
                        <s-table-cell>
                          {term.targetLocale ? (languageNames[term.targetLocale] ?? term.targetLocale) : t("common.state.all")}
                        </s-table-cell>
                        {anyMarket ? <s-table-cell>{marketLabel(data, i18n, term.market)}</s-table-cell> : null}
                        <s-table-cell>
                          <Button
                            variant="tertiary"
                            tone="critical"
                            icon="delete"
                            disabled={locked}
                            commandFor="glossary-delete"
                            command="--show"
                            accessibilityLabel={`${t("common.action.delete")}: ${term.term}`}
                            onClick={() => setPendingDelete(term.id)}
                          >
                            {t("common.action.delete")}
                          </Button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : (
                <s-box padding="base">
                  <s-text color="subdued">{t("glossary.search.none")}</s-text>
                </s-box>
              )}
              {matching.length > shown.length ? (
                <s-box padding="base">
                  <s-text color="subdued">{t("glossary.search.more", { shown: shown.length, total: matching.length })}</s-text>
                </s-box>
              ) : null}
            </s-stack>
          )}
        </Card>

        <Card heading={t("glossary.csv.heading")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("glossary.csv.lead")}</s-text>
            <importFetcher.Form method="post" encType="multipart/form-data" ref={importForm}>
              <input type="hidden" name="intent" value="import" />
              <s-stack direction="block" gap="base">
                <s-drop-zone name="file" accept=".csv,text/csv" label={t("glossary.import.file")} {...(locked ? { disabled: true } : {})} />
                <Disclosure summary={t("glossary.import.paste")}>
                  <s-text-area name="csv" label={t("glossary.import.pasteLabel")} rows={4} {...(locked ? { disabled: true } : {})} />
                </Disclosure>
                <s-checkbox
                  name="replaceAll"
                  label={t("glossary.import.replaceAll")}
                  details={t("glossary.import.replaceAllDetails")}
                  {...(locked ? { disabled: true } : {})}
                  // React 18 sends no onChange for a web component; its input event comes through.
                  onInput={(e) => setReplaceAll(e.currentTarget.checked)}
                  onChange={(e) => setReplaceAll(e.currentTarget.checked)}
                />
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  {/* Replacing every term asks first, with how many go. */}
                  {replaceAll && terms.length ? (
                    <Button icon="import" commandFor="glossary-replace" command="--show" disabled={locked} {...(importFetcher.state !== "idle" ? { loading: true } : {})}>
                      {t("glossary.import.submit")}
                    </Button>
                  ) : (
                    <Button type="submit" icon="import" disabled={locked} {...(importFetcher.state !== "idle" ? { loading: true } : {})}>
                      {t("glossary.import.submit")}
                    </Button>
                  )}
                  <Button
                    icon="export"
                    onClick={async () => {
                      setExporting("busy");
                      setExporting((await downloadCsv()) ? "idle" : "failed");
                    }}
                    {...(exporting === "busy" ? { loading: true } : {})}
                  >
                    {t("glossary.exportCsv")}
                  </Button>
                </s-stack>
              </s-stack>
            </importFetcher.Form>
            {exporting === "failed" ? <s-text tone="critical">{t("glossary.export.failed")}</s-text> : null}
            {importResult?.kind === "imported" && importResult.errors.length ? (
              <s-banner tone="critical" heading={t("glossary.import.rejected")}>
                <s-unordered-list>
                  {importResult.errors.map((e) => (
                    <s-list-item key={e.line}>
                      {t("glossary.import.line", { line: e.line, message: problems(i18n, e.messages) })}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              </s-banner>
            ) : null}
            {importResult?.kind === "error" && !(locked && importResult.messages.every((m) => m.key === "glossary.error.notOnPlan")) ? (
              <s-banner tone="critical" heading={t("glossary.import.failed")}>
                <s-paragraph>{problems(i18n, importResult.messages)}</s-paragraph>
              </s-banner>
            ) : null}
            <Disclosure summary={t("glossary.file.heading")}>
              <s-text>{t("glossary.file.rows")}</s-text>
              <s-unordered-list>
                <s-list-item>{t("glossary.file.rule")}</s-list-item>
                <s-list-item>{t("glossary.file.term")}</s-list-item>
                <s-list-item>{t("glossary.file.translation")}</s-list-item>
                <s-list-item>{t("glossary.file.language")}</s-list-item>
                <s-list-item>{t("glossary.file.more")}</s-list-item>
              </s-unordered-list>
              <s-text color="subdued">{t("glossary.file.invalid")}</s-text>
            </Disclosure>
          </s-stack>
        </Card>
      </s-stack>
      <ConfirmModal
        id="glossary-delete"
        heading={t("glossary.delete.heading")}
        body={t("glossary.delete.body")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => pendingDelete && deleteFetcher.submit({ intent: "delete", termId: pendingDelete }, { method: "post" })}
      />
      <ConfirmModal
        id="glossary-replace"
        heading={t("glossary.replace.heading", { count: terms.length })}
        body={t("glossary.replace.body", { count: terms.length })}
        confirmLabel={t("glossary.replace.confirm")}
        onConfirm={() => importForm.current && importFetcher.submit(importForm.current, { method: "post", encType: "multipart/form-data" })}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
