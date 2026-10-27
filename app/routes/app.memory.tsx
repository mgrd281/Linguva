import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireShop } from "../.server/shopify/require-shop";
import { fetchAndSyncShopLocales } from "../.server/locales/shop-locales";
import {
  approveMemoryEntry,
  deleteMemoryEntry,
  listMemory,
  memoryStats,
} from "../.server/memory/translation-memory";
import { markupToPlainText } from "../.server/translation/segment-markup";

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
  const targetLocale = url.searchParams.get("locale") ?? "";
  const [entries, stats, locales] = await Promise.all([
    listMemory(shop.id, { search, targetLocale: targetLocale || undefined, take: 100 }),
    memoryStats(shop.id),
    fetchAndSyncShopLocales(admin, shop.id),
  ]);
  return {
    languages: locales.locales.filter((l) => !l.primary).map((l) => ({ locale: l.locale, name: l.name })),
    search,
    targetLocale,
    stats,
    entries: entries.map((e) => ({
      id: e.id,
      pair: `${e.sourceLocale} → ${e.targetLocale}`,
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
  if (form.get("intent") === "delete") return { ok: await deleteMemoryEntry(shop.id, id) };
  if (form.get("intent") === "approve") return { ok: await approveMemoryEntry(shop.id, id) };
  return { ok: false };
};

export default function Memory() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const totalEntries = data.stats.reduce((s, r) => s + r.entries, 0);
  const totalUses = data.stats.reduce((s, r) => s + r.uses, 0);

  return (
    <s-page heading="Translation memory">
      <s-section>
        <s-paragraph>
          Every translation you publish is remembered sentence by sentence.
          Identical text is reused automatically and isn&apos;t sent to AI
          again, so it costs nothing. Your memory is private to your store.
        </s-paragraph>
        <s-paragraph>
          {totalEntries.toLocaleString()} entries · reused {totalUses.toLocaleString()} times
        </s-paragraph>
      </s-section>

      <s-section>
        <Form method="get">
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 560px) 2fr 1fr auto, 1fr" gap="base" alignItems="end">
              <s-search-field name="q" label="Search" placeholder="Original or translation" value={data.search} />
              <s-select name="locale" label="Language" value={data.targetLocale}>
                <s-option value="">All languages</s-option>
                {data.languages.map((l) => (
                  <s-option key={l.locale} value={l.locale}>
                    {l.name}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit">Search</s-button>
            </s-grid>
          </s-query-container>
        </Form>
      </s-section>

      <s-section padding="none">
        {data.entries.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>No entries yet. Publish translations to build your memory.</s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Source</s-table-header>
              <s-table-header>Translation</s-table-header>
              <s-table-header>Languages</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header format="numeric">Uses</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.entries.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.source}</s-table-cell>
                  <s-table-cell>{e.target}</s-table-cell>
                  <s-table-cell>{e.pair}</s-table-cell>
                  <s-table-cell>
                    {e.status === "APPROVED" ? <s-badge tone="success">Approved</s-badge> : <s-badge>Machine</s-badge>}
                  </s-table-cell>
                  <s-table-cell>{e.uses}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {e.status !== "APPROVED" ? (
                        <s-button
                          variant="tertiary"
                          onClick={() => fetcher.submit({ intent: "approve", entryId: e.id }, { method: "post" })}
                        >
                          Approve
                        </s-button>
                      ) : null}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => fetcher.submit({ intent: "delete", entryId: e.id }, { method: "post" })}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Clear error page that keeps the navigation (Shopify auth responses pass through).
export { RouteErrorBoundary as ErrorBoundary } from "../components/RouteError";
