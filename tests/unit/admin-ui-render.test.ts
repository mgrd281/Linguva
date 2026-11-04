/**
 * The admin console's pages rendered on the server with fictional loader
 * data, as the browser first receives them (before any JavaScript): one h1,
 * the frame's navigation and sign-out form, labelled forms that post with
 * the CSRF token, tables with captions and header cells, the empty states,
 * no inline style anywhere (the console's policy forbids it), and the
 * document root's language for the console.
 */
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { ShopRow } from "../../app/.server/admin/directory";
import type { CustomerDetail } from "../../app/.server/admin/customer";
import type { OverviewSummary } from "../../app/.server/admin/overview";
import type { PricesPageData } from "../../app/.server/admin/prices";
import type { AdminLocale } from "../../app/admin/locale";
import { ActivityView } from "../../app/components/admin/ActivityView";
import { AdminProvider, type AdminSessionView } from "../../app/components/admin/context";
import { CustomersView } from "../../app/components/admin/CustomersView";
import { CustomerNotFound, CustomerView } from "../../app/components/admin/CustomerView";
import { OverviewView } from "../../app/components/admin/OverviewView";
import { PricesView } from "../../app/components/admin/PricesView";
import { AdminErrorView, AdminShell } from "../../app/components/admin/Shell";
import { SignInView } from "../../app/components/admin/SignInView";
import { SubscriptionsView } from "../../app/components/admin/SubscriptionsView";
import { loader as rootLoader, meta } from "../../app/root";

const OWNER: AdminSessionView = { email: "owner@linguva.test", role: "OWNER", csrfToken: "csrf-token-of-the-session", can: { refresh: true, prices: true } };
const READONLY: AdminSessionView = { ...OWNER, email: "viewer@linguva.test", role: "READONLY", can: { refresh: false, prices: false } };

async function render(node: ReactNode, { url = "/admin", locale = "en", session = OWNER }: { url?: string; locale?: AdminLocale; session?: AdminSessionView | null } = {}) {
  const handler = createStaticHandler([{ id: "page", path: "*", Component: () => createElement(AdminProvider, { locale, session } as ComponentProps<typeof AdminProvider>, node) }]);
  const context = await handler.query(new Request(`http://localhost:3000${url}`));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern.source, "g"))?.length ?? 0;
/** What every console page must hold to. */
function checkPage(html: string) {
  expect(count(html, /<h1\b/)).toBe(1);
  // style-src without 'unsafe-inline': an inline style would be dropped by the browser.
  expect(html).not.toMatch(/\sstyle="/);
  // Every table has a caption and column headers.
  expect(count(html, /<table\b/)).toBe(count(html, /<caption\b/));
}

function shopRow(domain: string, extra: Partial<ShopRow> = {}): ShopRow {
  return {
    id: `00000000-0000-4000-8000-${String(domain.length).padStart(12, "0")}`,
    shopDomain: `${domain}.myshopify.com`,
    name: domain === "nameless" ? null : `Store ${domain}`,
    status: "ACTIVE",
    installedAt: "2026-10-01T09:00:00.000Z",
    uninstalledAt: null,
    hasGid: true,
    subscription: {
      state: "ACTIVE",
      planHandle: "pro",
      billingPeriod: "EVERY_30_DAYS",
      trialEndsAt: null,
      cancelAtEndOfCycle: false,
      currentPeriodEnd: "2026-11-20T00:00:00.000Z",
      pendingPlanHandle: null,
      checkedAt: "2026-11-04T08:00:00.000Z",
    },
    plan: "pro",
    inTrial: false,
    cancelling: false,
    complimentary: false,
    usage: { chars: 824_310, ownKeyChars: 0, costUsd: 20.61 },
    languages: 4,
    lastJobAt: "2026-11-03T22:50:00.000Z",
    monthlyRevenueUsd: 99,
    ...extra,
  };
}

const PLANS = { free: 3, starter: 2, pro: 3, business: 2, "own-key": 0, complimentary: 1, unknown: 0 } as const;
function summary(extra: Partial<OverviewSummary> = {}): OverviewSummary {
  return {
    stores: { active: 11, uninstalled: 1, new30: 5, lost30: 1 },
    plans: { ...PLANS },
    trials: { count: 2, endingSoon: [shopRow("kiko", { plan: "starter", inTrial: true })] },
    cancelling: 1,
    pendingChanges: 1,
    revenue: { mrrUsd: 802.67, arrUsd: 9632, payingStores: 6, arpuUsd: 133.78 },
    usage: { chars: 7_612_000, costUsd: 188.96, ownKeyChars: 1_240_000 },
    recent: [shopRow("nameless", { plan: "free" }), shopRow("gone", { status: "UNINSTALLED", uninstalledAt: "2026-10-20T00:00:00.000Z" })],
    billingConfigured: true,
    ...extra,
  };
}

describe("the frame", () => {
  it("marks the current page, posts sign-out with the CSRF token and switches the language with a link", async () => {
    const html = await render(createElement(AdminShell, null, createElement("h1", null, "Page")), { url: "/admin/customers/abc?x=1" });
    checkPage(html);
    expect(html).toContain('<a class="adm-skip" href="#main">Skip to content</a>');
    expect(html).toMatch(/<nav class="adm-nav" aria-label="Console">/);
    // NavLink: Customers is current on a store's page; Overview only on /admin itself.
    expect(html).toMatch(/<a aria-current="page" class="adm-nav__link[^"]*" href="\/admin\/customers"/);
    expect(count(html, /aria-current="page"/)).toBe(1);
    expect(html).toMatch(/<form class="adm-signout" method="post" action="\/admin\/logout"><input type="hidden" name="_csrf" value="csrf-token-of-the-session"\/>/);
    expect(html).toContain('href="/admin/customers/abc?x=1&amp;lang=ar"');
    expect(html).toMatch(/<a class="adm-lang__link" href="[^"]*lang=en" lang="en" hrefLang="en" aria-current="true">/);
    expect(html).toContain("owner@linguva.test");
    expect(html).toContain("Owner");
    expect(html).toContain('<main class="adm-main" id="main" tabindex="-1">');
  });

  it("shows a role's error inside the page", async () => {
    const html = await render(createElement(AdminErrorView, { kind: "forbidden" }));
    checkPage(html);
    expect(html).toContain("Not allowed");
    expect(html).toContain('href="/admin"');
  });
});

describe("Overview", () => {
  it("shows the KPIs, the plan mix, trials, newest stores and the data's time", async () => {
    const html = await render(createElement(OverviewView, { summary: summary(), builtAt: "2026-11-04T10:54:00.000Z" }));
    checkPage(html);
    // "AI characters" are Linguva's (with their cost) on every page; own keys on a line of their own.
    for (const text of ["Active stores", ">11<", "Paying stores", "$802.67", "$9,632 a year (ARR)", "Ending within 7 days: 1", "AI characters (Linguva)", "7.6M", "Plus own keys: 1.2M", "Data from 10:54 UTC"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/admin?refresh=1"');
    // The main plans always, others only when a store has them.
    expect(html).toContain("Complimentary");
    expect(html).not.toContain(">Own key<");
    expect(html).toContain("Unnamed store");
    expect(html).not.toContain("Shopify billing isn&#x27;t configured");
  });

  it("says when billing isn't configured, and shows empty lists plainly", async () => {
    const html = await render(
      createElement(OverviewView, { summary: summary({ billingConfigured: false, recent: [], trials: { count: 0, endingSoon: [] } }), builtAt: "2026-11-04T10:54:00.000Z" }),
    );
    expect(html).toContain("Shopify billing isn&#x27;t configured");
    expect(html).toContain("No trial ends in the next 7 days.");
    expect(html).toContain("No store has installed Linguva yet.");
  });

  it("speaks Arabic with Western digits", async () => {
    const html = await render(createElement(OverviewView, { summary: summary(), builtAt: "2026-11-04T10:54:00.000Z" }), { locale: "ar" });
    checkPage(html);
    expect(html).toContain("نظرة عامة");
    expect(html).toContain("المتاجر النشطة");
    expect(html).toContain("\u2066$802.67\u2069");
    expect(html).not.toMatch(/[\u0660-\u0669]/);
  });
});

describe("Customers", () => {
  const filters = { q: "", status: "all", plan: "all", sort: "newest" } as const;

  it("lists the stores in a table with a search form that is the URL", async () => {
    const rows = [shopRow("alpha"), shopRow("beta", { plan: "starter", inTrial: true, monthlyRevenueUsd: 0 })];
    const html = await render(createElement(CustomersView, { rows, total: 120, totalAll: 130, page: 2, pages: 3, filters: { ...filters, q: "a", sort: "usage" } }), {
      url: "/admin/customers",
    });
    checkPage(html);
    expect(html).toMatch(/<form method="get" action="\/admin\/customers" class="adm-toolbar" role="search"[^>]*>/);
    expect(html).toMatch(/<label class="adm-sr" for="q">Search<\/label>/);
    // A card per store on a phone: every part keeps its table role (admin.css lays the rows out as blocks there).
    expect(html).toContain('<table class="adm-table adm-table--cards adm-table--cards-2" role="table">');
    expect(html).toContain('<th scope="col" class="adm-num" role="columnheader">Revenue / month</th>');
    expect(count(html, /<th scope="row" role="rowheader">/)).toBe(2);
    expect(html).toContain('href="/admin/customers/00000000-0000-4000-8000-000000000005"');
    expect(html).toContain("51–100 of 120");
    expect(html).toContain("$99.00");
    // Pages keep the filters.
    expect(html).toContain('href="/admin/customers?q=a&amp;sort=usage"');
    expect(html).toContain('href="/admin/customers?q=a&amp;sort=usage&amp;page=3"');
    expect(html).toContain("Clear filters");
    expect(html).toContain(">Trial<");
  });

  it("tells an empty directory from no match", async () => {
    const none = await render(createElement(CustomersView, { rows: [], total: 0, totalAll: 0, page: 1, pages: 1, filters }));
    expect(none).toContain("No stores yet");
    expect(none).not.toContain("<table");
    const noMatch = await render(createElement(CustomersView, { rows: [], total: 0, totalAll: 4, page: 1, pages: 1, filters: { ...filters, q: "zzz" } }));
    expect(noMatch).toContain("No stores match");
    expect(noMatch).toContain('href="/admin/customers"');
  });
});

function detail(extra: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    shop: shopRow("atelier", { subscription: { ...shopRow("x").subscription!, cancelAtEndOfCycle: true, pendingPlanHandle: "starter" } }),
    shopifyShopGid: "gid://shopify/Shop/1",
    adminUrl: "https://admin.shopify.com/store/atelier",
    complimentary: null,
    usageByMonth: ["2026-11", "2026-10", "2026-09", "2026-08", "2026-07", "2026-06"].map((period, i) => ({ period, chars: 1000 * (6 - i), ownKeyChars: 0, costUsd: 0.1 })),
    locales: [
      { locale: "de", primary: true, published: true },
      { locale: "fr", primary: false, published: false },
    ],
    installations: [{ event: "INSTALLED", occurredAt: "2026-04-08T10:50:00.000Z" }],
    jobs: { last30: { PENDING: 0, DISCOVERING: 0, RUNNING: 0, COMPLETED: 14, CANCELLED: 0, FAILED: 1 }, lastAt: "2026-11-03T22:50:00.000Z" },
    settings: { autoTranslateNew: true, smartAuto: false },
    ...extra,
  };
}

describe("One customer", () => {
  it("shows the subscription, usage, languages and the rest, and asks Shopify again with the CSRF token", async () => {
    const html = await render(createElement(CustomerView, { detail: detail() }), { url: "/admin/customers/abc" });
    checkPage(html);
    expect(html).toContain('<h1 class="adm-h1"><bdi>Store atelier</bdi></h1>');
    expect(html).toMatch(/<a class="adm-btn adm-btn--secondary" href="https:\/\/admin.shopify.com\/store\/atelier" target="_blank" rel="noopener noreferrer">/);
    expect(html).toMatch(
      /<form method="post" action="\/admin\/customers\/abc" class="adm-inline-form"[^>]*><input type="hidden" name="_csrf" value="csrf-token-of-the-session"\/>/,
    );
    expect(html).toContain("Ask Shopify again");
    for (const text of [
      "Cancelling",
      "Changing to Starter",
      "German",
      "Hidden",
      "Primary",
      "Done",
      "pnpm ops:complimentary",
      "This store has no complimentary access.",
      "Nov 2026",
    ])
      expect(html).toContain(text);
  });

  it("offers no refresh to a role without it, and shows the result of one", async () => {
    const readonly = await render(createElement(CustomerView, { detail: detail() }), { session: READONLY });
    expect(readonly).not.toContain("Ask Shopify again");
    const done = await render(createElement(CustomerView, { detail: detail(), refresh: { ok: false, reason: "NO_GID" } }));
    expect(done).toContain("This store&#x27;s Shopify ID isn&#x27;t known yet.");
    const notFound = await render(createElement(CustomerNotFound));
    checkPage(notFound);
    expect(notFound).toContain("Store not found");
  });
});

describe("Subscriptions", () => {
  it("shows the revenue, the mix and the subscribed stores with their filters", async () => {
    const rows = [shopRow("alpha"), shopRow("beta", { plan: "starter", inTrial: true, subscription: { ...shopRow("x").subscription!, trialEndsAt: "2026-11-07T00:00:00.000Z" } })];
    const html = await render(
      createElement(SubscriptionsView, {
        revenue: summary().revenue,
        billingConfigured: true,
        mix: { rows: [{ plan: "pro", monthly: 1, yearly: 0, trial: 0, total: 1 }], total: { monthly: 1, yearly: 0, trial: 0, total: 1 } },
        rows,
        totalAll: 2,
        filters: { plan: "all", trial: true, cancelling: false },
      }),
      { url: "/admin/subscriptions" },
    );
    checkPage(html);
    expect(html).toContain("<tfoot>");
    expect(html).toMatch(/<form method="get" action="\/admin\/subscriptions" class="adm-toolbar"/);
    expect(html).toContain('<input type="checkbox" name="trial" checked="" value="1"/>');
    expect(html).toContain("Nov 7, 2026");
    expect(html).toContain("$133.78");
  });
});

const PRICES: PricesPageData = {
  plans: [
    {
      handle: "free",
      monthlyUsd: 0,
      yearlyUsd: null,
      isDefault: true,
      updatedAt: null,
      version: "default",
      offersYearly: false,
      defaultMonthlyUsd: 0,
      defaultYearlyUsd: null,
      margin: { monthly: null, yearly: null },
      monthlyChars: 20_000,
      lastChange: null,
    },
    {
      handle: "starter",
      monthlyUsd: 29,
      yearlyUsd: 290,
      isDefault: true,
      updatedAt: null,
      version: "default",
      offersYearly: true,
      defaultMonthlyUsd: 29,
      defaultYearlyUsd: 290,
      margin: { monthly: 0.52, yearly: 0.46 },
      monthlyChars: 300_000,
      lastChange: null,
    },
    {
      handle: "pro",
      monthlyUsd: 99,
      yearlyUsd: 990,
      isDefault: true,
      updatedAt: null,
      version: "default",
      offersYearly: true,
      defaultMonthlyUsd: 99,
      defaultYearlyUsd: 990,
      margin: { monthly: 0.48, yearly: 0.41 },
      monthlyChars: 1_200_000,
      lastChange: null,
    },
    {
      handle: "business",
      monthlyUsd: 149,
      yearlyUsd: null,
      isDefault: false,
      updatedAt: "2026-11-04T10:50:00.000Z",
      version: "2026-11-04T10:50:00.000Z/14900/-",
      offersYearly: true,
      defaultMonthlyUsd: 299,
      defaultYearlyUsd: null,
      margin: { monthly: 0.07, yearly: null },
      monthlyChars: 4_000_000,
      lastChange: {
        id: "c1",
        handle: "business",
        oldMonthlyUsd: 299,
        oldYearlyUsd: null,
        newMonthlyUsd: 149,
        newYearlyUsd: null,
        reason: "Test",
        by: "finance@linguva.test",
        at: "2026-11-04T10:50:00.000Z",
      },
    },
    {
      handle: "own-key",
      monthlyUsd: 49,
      yearlyUsd: null,
      isDefault: true,
      updatedAt: null,
      version: "default",
      offersYearly: false,
      defaultMonthlyUsd: 49,
      defaultYearlyUsd: null,
      margin: { monthly: 0.81, yearly: null },
      monthlyChars: 0,
      lastChange: null,
    },
  ],
  history: [
    { id: "c1", handle: "business", oldMonthlyUsd: 299, oldYearlyUsd: null, newMonthlyUsd: 149, newYearlyUsd: null, reason: "Q4 offer", by: null, at: "2026-11-04T10:50:00.000Z" },
  ],
  warnings: [{ code: "LOW_MARGIN", handle: "business", period: "monthly", margin: 0.07 }],
  partnerDashboardUrl: "https://partners.shopify.com/1/apps",
};

describe("Prices", () => {
  it("says Shopify charges what the Partner Dashboard says, and posts one form with a reason, a fresh code and the CSRF token", async () => {
    const html = await render(createElement(PricesView, { page: PRICES, canEdit: true }), { url: "/admin/prices" });
    checkPage(html);
    expect(html).toContain("Change the price in the Partner Dashboard. Shopify charges that price.");
    expect(html).toMatch(/<a class="adm-link" href="https:\/\/partners.shopify.com\/1\/apps" target="_blank" rel="noopener noreferrer">/);
    expect(html).toMatch(
      /<form method="post" action="\/admin\/prices" class="adm-priceform" novalidate=""[^>]*><input type="hidden" name="_csrf" value="csrf-token-of-the-session"\/>/,
    );
    for (const handle of ["starter", "pro", "business", "own-key"]) {
      for (const period of handle === "own-key" ? ["monthly"] : ["monthly", "yearly"]) {
        expect(html).toMatch(new RegExp(`<label class="adm-pricegrid__label" for="price-${handle}-${period}">`));
        expect(html).toContain(`id="price-${handle}-${period}" name="${handle}.${period}"`);
      }
    }
    // Free stays free: no fields. Own key is monthly only (its plan in the Partner Dashboard): no yearly field.
    expect(html).not.toContain('name="free.monthly"');
    expect(html).not.toContain('name="own-key.yearly"');
    // Every plan's version goes back with the form: a save after someone else's is refused.
    for (const plan of PRICES.plans) expect(html).toContain(`<input type="hidden" name="${plan.handle}.version" value="${plan.version}"/>`);
    expect(html).toContain('value="149"');
    expect(html).toMatch(/<input class="adm-input adm-input--code" id="prices-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"/);
    expect(html).toMatch(/<textarea class="adm-input adm-textarea" id="prices-reason" name="reason"/);
    // The margin under 40 % is flagged with words, and listed above the form.
    expect(html).toContain("Under 40%");
    expect(html).toContain("Business, Monthly: estimated margin 7%, under 40%.");
    expect(html).toContain("Deleted account");
  });

  it("links every refused field from the summary, keeps what was typed (never the code)", async () => {
    const html = await render(
      createElement(PricesView, {
        page: PRICES,
        canEdit: true,
        result: { ok: false, errors: { "starter.monthly": "NOT_A_PRICE", code: "CODE_WRONG" }, values: { "starter.monthly": "abc", reason: "Because" } },
      }),
    );
    expect(html).toMatch(/<div class="adm-notice adm-notice--critical adm-errsum" role="alert" id="prices-errors" tabindex="-1"/);
    expect(html).toContain('<a href="#price-starter-monthly">Starter, Monthly: Enter an amount like 29 or 9.99.</a>');
    expect(html).not.toContain('id="prices-conflict"');
    expect(html).toContain('<a href="#prices-code">That code is wrong or was already used. Wait for the next one.</a>');
    expect(html).toMatch(/id="price-starter-monthly" name="starter.monthly"[^>]*aria-invalid="true" aria-describedby="price-starter-monthly-error"[^>]*value="abc"/);
    expect(html).toContain(">Because</textarea>");
  });

  it("confirms a save with the plans changed and the Partner Dashboard reminder", async () => {
    const html = await render(
      createElement(PricesView, { page: PRICES, canEdit: true, result: { ok: true, changed: ["starter", "own-key"], savedAt: "2026-11-04T11:00:00.000Z" } }),
    );
    expect(html).toContain("Changed: Starter and Own key.");
    expect(html).toContain("Make sure the Partner Dashboard has the same prices");
  });

  it("in Arabic, joins lists and the error's parts with the language's own separators", async () => {
    const refused = await render(
      createElement(PricesView, { page: PRICES, canEdit: true, result: { ok: false, errors: { "starter.monthly": "NOT_A_PRICE", "pro.yearly": "TOO_LOW" }, values: {} } }),
      { locale: "ar" },
    );
    expect(refused).toContain('<a href="#price-starter-monthly">Starter، شهريًا: أدخل مبلغًا مثل 29 أو 9.99.</a>');
    expect(refused).not.toMatch(/Starter, |Pro, /);
    const saved = await render(createElement(PricesView, { page: PRICES, canEdit: true, result: { ok: true, changed: ["pro", "business"], savedAt: "2026-11-04T11:00:00.000Z" } }), { locale: "ar" });
    expect(saved).toContain("تغيّرت: Pro وBusiness.");
    const three = await render(createElement(PricesView, { page: PRICES, canEdit: true, result: { ok: true, changed: ["starter", "pro", "business"], savedAt: "2026-11-04T11:00:00.000Z" } }));
    expect(three).toContain("Changed: Starter, Pro, and Business.");
  });

  it("says when the prices changed meanwhile: nothing saved, the current prices in the form, the reason kept", async () => {
    const html = await render(
      createElement(PricesView, { page: PRICES, canEdit: true, result: { ok: false, conflict: ["pro", "business"], errors: {}, values: { reason: "Pro up" } } }),
    );
    checkPage(html);
    expect(html).toMatch(/<div class="adm-notice adm-notice--critical" role="alert" id="prices-conflict" tabindex="-1">/);
    expect(html).toContain("The prices changed meanwhile");
    expect(html).toContain("Pro and Business changed after you opened this page, so nothing was saved.");
    // The form shows the prices read now (the loader's), not the refused ones; no field is marked.
    expect(html).toMatch(/id="price-business-monthly" name="business.monthly"[^>]*value="149"/);
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('id="prices-errors"');
    expect(html).toContain(">Pro up</textarea>");
  });

  it("names a refused Own key yearly price, a refused reason and a table the database refused", async () => {
    const html = await render(
      createElement(PricesView, {
        page: PRICES,
        canEdit: true,
        result: { ok: false, errors: { "own-key.yearly": "MONTHLY_ONLY", reason: "REASON_INVALID", prices: "SAVE_REFUSED" }, values: {} },
      }),
    );
    expect(html).toContain("Own key, Yearly: Own key is monthly only, like its plan in the Partner Dashboard.");
    expect(html).toContain('<a href="#prices-reason">Remove the invisible control characters from the reason.</a>');
    expect(html).toContain('<a href="#price-starter-monthly">The database refused these prices. Reload the page and check them.</a>');
  });

  it("isolates free text in the history (a Latin reason in an Arabic page keeps its punctuation)", async () => {
    const page = { ...PRICES, history: [{ ...PRICES.history[0]!, reason: "Price cut (Q4).", by: "finance@linguva.test" }] };
    const html = await render(createElement(PricesView, { page, canEdit: false }), { locale: "ar", session: READONLY });
    expect(html).toContain('<td class="adm-reason"><bdi>Price cut (Q4).</bdi></td>');
    expect(html).toContain('<bdi class="adm-truncate">finance@linguva.test</bdi>');
  });

  it("shows a role without the capability the prices, without a form", async () => {
    const html = await render(createElement(PricesView, { page: PRICES, canEdit: false }), { session: READONLY });
    checkPage(html);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).toContain("Your role can see the prices but not change them.");
    expect(html).toContain("$149");
  });
});

describe("Activity", () => {
  it("lists price changes and sign-ins", async () => {
    const html = await render(
      createElement(ActivityView, {
        priceChanges: PRICES.history,
        signIns: [
          { email: "owner@linguva.test", role: "OWNER", at: "2026-11-04T10:00:00.000Z", lastSeenAt: "2026-11-04T10:30:00.000Z", state: "active" },
          { email: "support@linguva.test", role: "SUPPORT", at: "2026-11-03T10:00:00.000Z", lastSeenAt: "2026-11-03T10:30:00.000Z", state: "ended" },
        ],
      }),
    );
    checkPage(html);
    expect(count(html, /<table\b/)).toBe(2);
    expect(html).toContain(">Active<");
    expect(html).toContain(">Ended<");
    expect(html).toContain(">Support<");
  });
});

describe("Sign-in", () => {
  it("is one plain form with the browser's own autofill hints", async () => {
    const html = await render(createElement(SignInView, { next: "/admin/prices", error: "LOCKED", email: "owner@linguva.test" }), { session: null, url: "/admin/login" });
    checkPage(html);
    expect(html).toMatch(/<form class="adm-signin__form" method="post" action="\/admin\/login\?next=%2Fadmin%2Fprices">/);
    expect(html).toContain('<input type="hidden" name="next" value="/admin/prices"/>');
    expect(html).not.toContain('name="_csrf"');
    expect(html).toMatch(/id="email" name="email" type="email" autoComplete="username"/);
    expect(html).toMatch(/id="password" name="password" type="password" autoComplete="current-password"/);
    expect(html).toMatch(/id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"/);
    expect(html).toContain('value="owner@linguva.test"');
    expect(html).toContain("Too many attempts. Try again in 15 minutes.");
    expect(html).not.toContain('type="password" autoComplete="current-password" required="" dir="ltr" value');
  });
});

describe("the document root", () => {
  const load = (url: string, headers: Record<string, string> = {}) =>
    rootLoader({ request: new Request(`http://localhost:3000${url}`, { headers }), params: {}, context: {} } as Parameters<typeof rootLoader>[0]);

  it("decides the console's language for /admin only, and titles it", () => {
    expect(load("/admin/prices", { cookie: "lv_admin_lang=ar" }).adminLocale).toBe("ar");
    expect(load("/admin/login", { "accept-language": "en-GB" }).adminLocale).toBe("en");
    expect(load("/app?locale=de").adminLocale).toBeNull();
    expect(load("/app?locale=de").locale).toBe("de");
    const title = (pathname: string) => (meta as (args: { location: { pathname: string } }) => Array<{ title: string }>)({ location: { pathname } });
    expect(title("/admin/customers")).toEqual([{ title: "Linguva Admin" }]);
    expect(title("/app")).toEqual([{ title: "Linguva" }]);
  });
});
