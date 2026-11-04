/**
 * The console's frame and shared parts after the review: in-page links that
 * move the focus without a navigation (the skip link, the error summary),
 * filters that follow the URL, the phone's tab bar that brings the current
 * tab into view, tables that become cards on a phone (with their table
 * roles), one meaning of "AI characters", the additional-languages count,
 * a subscription not checked since a reinstall, and the dark theme's
 * filled controls (contrast) and touch targets in admin.css.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CustomerDetail } from "../../app/.server/admin/customer";
import type { ShopRow } from "../../app/.server/admin/directory";
import type { AdminLocale } from "../../app/admin/locale";
import { ActivityView } from "../../app/components/admin/ActivityView";
import { AdminProvider, type AdminSessionView } from "../../app/components/admin/context";
import { CustomersView } from "../../app/components/admin/CustomersView";
import { CustomerView } from "../../app/components/admin/CustomerView";
import { applyFormValues, jumpTo, revealCurrent } from "../../app/components/admin/dom";
import { AdminShell, StandalonePage } from "../../app/components/admin/Shell";
import { SubscriptionsView } from "../../app/components/admin/SubscriptionsView";
import { Bar, ErrorSummary, StoreCell, Table } from "../../app/components/admin/ui";

const OWNER: AdminSessionView = { email: "finance@linguva.test", role: "FINANCE", csrfToken: "csrf", can: { refresh: true, prices: true } };

async function render(node: ReactNode, { url = "/admin", locale = "en" }: { url?: string; locale?: AdminLocale } = {}) {
  const handler = createStaticHandler([{ id: "page", path: "*", Component: () => createElement(AdminProvider, { locale, session: OWNER } as ComponentProps<typeof AdminProvider>, node) }]);
  const context = await handler.query(new Request(`http://localhost:3000${url}`));
  if (context instanceof Response) throw new Error("unexpected response");
  return renderToString(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context, hydrate: false }));
}

const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern.source, "g"))?.length ?? 0;

function shopRow(domain: string, extra: Partial<ShopRow> = {}): ShopRow {
  return {
    id: `00000000-0000-4000-8000-${String(domain.length).padStart(12, "0")}`,
    shopDomain: `${domain}.myshopify.com`,
    name: `Store ${domain}`,
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
    lastJobAt: null,
    monthlyRevenueUsd: 99,
    ...extra,
  };
}

/** The reset answer an uninstall or reinstall leaves: state NONE, never checked since. */
const RESET = { ...shopRow("x").subscription!, state: "NONE" as const, planHandle: null, billingPeriod: null, currentPeriodEnd: null, checkedAt: null };
const OWN_KEY = shopRow("oak", { plan: "own-key", usage: { chars: 0, ownKeyChars: 1_240_000, costUsd: 0 }, monthlyRevenueUsd: 49 });

describe("in-page links (skip link, error summary)", () => {
  const target = () => ({ focus: vi.fn(), scrollIntoView: vi.fn(), hasAttribute: vi.fn(() => false), setAttribute: vi.fn(), tabIndex: 0 });

  it("move the focus to the target without a navigation (which would drop the page's action result)", () => {
    const field = target();
    const event = { preventDefault: vi.fn(), button: 0 };
    expect(jumpTo(event, "price-starter-monthly", { doc: { getElementById: (id) => (id === "price-starter-monthly" ? field : null) } })).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(field.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(field.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    // A plain element (the main area has its own tabindex; a card doesn't) is made focusable first.
    const card = { ...target(), tabIndex: -1 };
    jumpTo({ preventDefault: vi.fn() }, "card", { block: "start", doc: { getElementById: () => card } });
    expect(card.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
  });

  it("leave a new-tab click and a missing target to the browser", () => {
    const field = target();
    const doc = { getElementById: () => field };
    for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const click = { preventDefault: vi.fn(), ...event };
      expect(jumpTo(click, "x", { doc })).toBe(false);
      expect(click.preventDefault).not.toHaveBeenCalled();
    }
    const click = { preventDefault: vi.fn() };
    expect(jumpTo(click, "gone", { doc: { getElementById: () => null } })).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(field.focus).not.toHaveBeenCalled();
  });

  it("keep their fragment, so they work without JavaScript", async () => {
    const summary = await render(createElement(ErrorSummary, { id: "e", title: "Fix", errors: [{ field: "prices-code", message: "Enter the code." }] }));
    expect(summary).toContain('<a href="#prices-code">Enter the code.</a>');
    const frame = await render(createElement(AdminShell, null, createElement("h1", null, "Page")));
    expect(frame).toContain('<a class="adm-skip" href="#main">Skip to content</a>');
    const standalone = await render(createElement(StandalonePage, null, createElement("h1", null, "Sign in")));
    expect(standalone).toContain('<a class="adm-skip" href="#main">Skip to content</a>');
  });
});

describe("filters that follow the URL", () => {
  function form(fields: Record<string, { value?: string; checked?: boolean }>) {
    return { elements: { namedItem: (name: string) => fields[name] ?? null } };
  }

  it("set the fields to the URL's filters after Clear filters, Back or Forward", () => {
    const fields = { q: { value: "zzzz" }, plan: { value: "pro" }, sort: { value: "name" }, trial: { checked: true } };
    applyFormValues(form(fields), { q: "", plan: "all", sort: "name", trial: false, missing: "x" });
    expect(fields).toEqual({ q: { value: "" }, plan: { value: "all" }, sort: { value: "name" }, trial: { checked: false } });
  });

  it("leave a field that already shows its filter alone (the caret stays)", () => {
    let writes = 0;
    const q = {
      get value() {
        return "nord";
      },
      set value(_v: string) {
        writes += 1;
      },
    };
    applyFormValues(form({ q }), { q: "nord" });
    expect(writes).toBe(0);
  });
});

describe("the phone's tab bar", () => {
  const strip = (tab: { left: number; right: number } | null, overflows = true) => {
    const scrollBy = vi.fn();
    return {
      strip: { scrollWidth: overflows ? 580 : 300, clientWidth: 390, getBoundingClientRect: () => ({ left: 0, right: 390 }), querySelector: () => (tab ? { getBoundingClientRect: () => tab } : null), scrollBy },
      scrollBy,
    };
  };

  it("scrolls the current tab into view, with a bit of the next one showing", () => {
    // Prices at x=392 (off-screen to the right, as measured at 390 px).
    const prices = strip({ left: 392, right: 480 });
    expect(revealCurrent(prices.strip)).toBe(130);
    expect(prices.scrollBy).toHaveBeenCalledWith({ left: 130 });
    // Right to left: the current tab off-screen at the left edge.
    const arabic = strip({ left: -120, right: -20 });
    expect(revealCurrent(arabic.strip)).toBe(-160);
  });

  it("leaves the row alone when it fits or the tab is in view", () => {
    for (const { strip: s, scrollBy } of [strip({ left: 392, right: 480 }, false), strip({ left: 100, right: 200 }), strip(null)]) {
      expect(revealCurrent(s)).toBe(0);
      expect(scrollBy).not.toHaveBeenCalled();
    }
    expect(revealCurrent(null)).toBe(0);
  });
});

describe("tables as cards on a phone", () => {
  it("label every body cell with its column and keep the table roles", async () => {
    const html = await render(
      createElement(
        Table,
        { caption: "Things", cards: 3 } as ComponentProps<typeof Table>,
        createElement("thead", null, createElement("tr", null, createElement("th", { scope: "col" }, "Name"), null, createElement("th", { scope: "col" }, createElement("span", null, "Total")))),
        createElement("tbody", null, createElement("tr", null, createElement("th", { scope: "row" }, "One"), null, createElement("td", null, "3"))),
      ),
    );
    expect(html).toContain('<table class="adm-table adm-table--cards adm-table--cards-3" role="table">');
    expect(html).toContain('<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Name</th>');
    // The row header names the card; a cell's label is its column's text, also past an empty slot.
    expect(html).toContain('<tbody role="rowgroup"><tr role="row"><th scope="row" role="rowheader">One</th><td role="cell" data-label="Total">3</td></tr></tbody>');
  });

  it("are the frame's default (a table added later can't hide columns off a phone), a narrow one opting out", async () => {
    const subscriptions = createElement(SubscriptionsView, {
      revenue: { mrrUsd: 99, arrUsd: 1188, payingStores: 1, arpuUsd: 99 },
      billingConfigured: true,
      mix: { rows: [{ plan: "pro", monthly: 1, yearly: 0, trial: 0, total: 1 }], total: { monthly: 1, yearly: 0, trial: 0, total: 1 } },
      rows: [shopRow("nord")],
      totalAll: 1,
      filters: { plan: "all", trial: false, cancelling: false },
    });
    const html = await render(createElement(AdminShell, null, subscriptions, createElement(Table, { caption: "Later" } as ComponentProps<typeof Table>, createElement("tbody", null))));
    // The plan mix (five short columns) stays a table; the stores and a table without its own setting are cards.
    expect(html).toContain('<table class="adm-table"><caption class="adm-sr">Active subscriptions per plan and billing period</caption>');
    expect(count(html, /<table class="adm-table adm-table--cards adm-table--cards-2" role="table">/)).toBe(2);
  });

  it("stay plain tables without `cards`", async () => {
    const html = await render(createElement(Table, { caption: "Mix" } as ComponentProps<typeof Table>, createElement("tbody", null, createElement("tr", null, createElement("td", null, "1")))));
    expect(html).toContain('<table class="adm-table"><caption class="adm-sr">Mix</caption><tbody><tr><td>1</td></tr></tbody></table>');
  });
});

describe("Customers", () => {
  const filters = { q: "", status: "all", plan: "all", sort: "newest" } as const;

  it("shows a card per store on a phone, Linguva's characters with own keys apart, and the additional languages", async () => {
    const rows = [shopRow("nord"), OWN_KEY, shopRow("reset", { plan: "unknown", subscription: RESET, monthlyRevenueUsd: 0 })];
    const html = await render(createElement(CustomersView, { rows, total: 3, totalAll: 3, page: 1, pages: 1, filters }), { url: "/admin/customers" });
    expect(html).toContain('role="columnheader">Additional languages</th>');
    expect(html).toContain('role="columnheader">AI chars this month (Linguva)</th>');
    for (const label of ["Installed", "Additional languages", "AI chars this month (Linguva)", "Revenue / month"]) expect(count(html, new RegExp(`data-label="${label.replace(/[()]/g, "\\$&")}"`))).toBe(3);
    // Plan and status speak for themselves: no label over them.
    expect(count(html, /<td class="adm-cell--plain" role="cell" data-label="(Plan|Status)">/)).toBe(6);
    // The own-key store: 0 of Linguva's, its own keys on a second line (not added to the figure).
    expect(html).toContain('<span class="adm-stacked"><span>0</span><span class="adm-muted adm-small">Plus own keys: 1,240,000</span></span>');
    expect(html).not.toContain("1,240,000</td>");
    // Not asked since a reinstall: said so, next to the unknown plan.
    expect(count(html, />Not checked yet</)).toBe(1);
    expect(html).not.toContain("1970");
  });

  it("in Arabic, names the columns the same way", async () => {
    const html = await render(createElement(CustomersView, { rows: [OWN_KEY], total: 1, totalAll: 1, page: 1, pages: 1, filters }), { locale: "ar" });
    expect(html).toContain('data-label="لغات إضافية"');
    expect(html).toContain("أحرف AI هذا الشهر عبر Linguva");
    expect(html).toContain("وبالمفاتيح الخاصة: 1,240,000");
  });
});

function detail(shop: ShopRow): CustomerDetail {
  return {
    shop,
    shopifyShopGid: "gid://shopify/Shop/1",
    adminUrl: "https://admin.shopify.com/store/oak",
    complimentary: null,
    usageByMonth: [
      { period: "2026-11", chars: 0, ownKeyChars: 1_240_000, costUsd: 0 },
      { period: "2026-10", chars: 600_000, ownKeyChars: 600_000, costUsd: 15 },
    ],
    locales: [{ locale: "en", primary: true, published: true }],
    installations: [],
    jobs: { last30: {}, lastAt: null },
    settings: { autoTranslateNew: false, smartAuto: false },
  };
}

describe("One customer", () => {
  it("shows Linguva's characters with their cost, own keys apart, and the usage as two-part bars in cards", async () => {
    const html = await render(createElement(CustomerView, { detail: detail(OWN_KEY) }), { url: "/admin/customers/oak" });
    expect(html).toContain("AI characters (Linguva)");
    expect(html).toMatch(/<div class="adm-kpi__value" title="0">0<\/div><div class="adm-kpi__context"><span>This month · est. cost \$0\.00<\/span><span>Plus own keys: 1\.2M<\/span><\/div>/);
    expect(html).toContain('<table class="adm-table adm-table--cards adm-table--cards-3" role="table">');
    expect(html).toContain('data-label="Own keys"');
    // The bars' colours are named above the table (the cards show the columns' names without them).
    expect(html).toMatch(/<span class="adm-legend"><span class="adm-dot adm-dot--teal" aria-hidden="true"><\/span>Own keys<\/span>/);
    // November: own keys only (the second segment), on the scale of the largest month.
    expect(html).toMatch(/<rect class="adm-bar__extra" x="0" y="0" width="100\.00%"/);
    expect(html).toMatch(/<rect class="adm-bar__extra" x="0" y="0" width="96\.77%" height="8" rx="4"><\/rect><rect class="adm-bar__fill" x="0" y="0" width="48\.39%"/);
  });

  it("says a subscription wasn't checked since a reinstall instead of a check on Jan 1, 1970", async () => {
    const html = await render(createElement(CustomerView, { detail: detail(shopRow("reset", { plan: "unknown", subscription: RESET })) }));
    expect(html).toContain("<dt>Checked</dt><dd>Not checked yet</dd>");
    expect(html).not.toContain("1970");
  });
});

describe("Subscriptions", () => {
  it("shows a card per store on a phone, and a missing check plainly", async () => {
    const html = await render(
      createElement(SubscriptionsView, {
        revenue: { mrrUsd: 99, arrUsd: 1188, payingStores: 1, arpuUsd: 99 },
        billingConfigured: true,
        mix: { rows: [], total: { monthly: 0, yearly: 0, trial: 0, total: 0 } },
        rows: [shopRow("nord"), shopRow("odd", { subscription: { ...shopRow("x").subscription!, checkedAt: null } })],
        totalAll: 2,
        filters: { plan: "all", trial: false, cancelling: false },
      }),
    );
    expect(html).toContain('<table class="adm-table adm-table--cards adm-table--cards-2" role="table">');
    expect(html).toContain('<td class="adm-cell--plain adm-cell--wide" role="cell" data-label="Plan">');
    expect(html).toContain('data-label="Checked">Nov 4, 08:00</td>');
    expect(html).toContain('data-label="Checked">Not checked yet</td>');
  });
});

describe("Activity", () => {
  it("shows a card per sign-in and per price change on a phone (the Prices page's history table, as cards here)", async () => {
    const html = await render(
      createElement(ActivityView, {
        priceChanges: [
          { id: "c1", handle: "business", oldMonthlyUsd: 299, oldYearlyUsd: null, newMonthlyUsd: 279, newYearlyUsd: null, reason: "Q4 offer", by: "finance@linguva.test", at: "2026-11-04T10:50:00.000Z" },
        ],
        signIns: [{ email: "owner@linguva.test", role: "OWNER", at: "2026-11-04T10:00:00.000Z", lastSeenAt: "2026-11-04T10:30:00.000Z", state: "active" }],
      }),
    );
    expect(html).toContain('<th scope="row" role="rowheader"><bdi class="adm-truncate">owner@linguva.test</bdi></th>');
    expect(html).toContain('data-label="Last active"');
    expect(count(html, /<table class="adm-table adm-table--cards adm-table--cards-2" role="table">/)).toBe(2);
    expect(html).toContain('<th scope="row" class="adm-nowrap" role="rowheader">Business</th>');
    expect(html).toMatch(/<td class="adm-reason" role="cell" data-label="Reason"><bdi>Q4 offer<\/bdi><\/td>/);
  });
});

describe("the frame on a phone", () => {
  it("names the signed-in admin and role in the markup the phone's row shows", async () => {
    const html = await render(createElement(AdminShell, null, createElement("h1", null, "Page")));
    expect(html).toMatch(
      /<p class="adm-account"><span class="adm-account__label">Signed in as <\/span><bdi class="adm-account__email">finance@linguva\.test<\/bdi><span class="adm-badge adm-badge--neutral">.*Finance<\/span><\/p>/,
    );
  });

  it("isolates a store's name for right-to-left pages, in lists and as a page's title", async () => {
    const cell = await render(createElement(StoreCell, { id: "1", name: "Oak & Ember!", domain: "oak.myshopify.com" }), { locale: "ar" });
    expect(cell).toContain('<bdi class="adm-store__name">Oak &amp; Ember!</bdi>');
    const page = await render(createElement(CustomerView, { detail: detail(OWN_KEY) }), { locale: "ar" });
    expect(page).toContain('<h1 class="adm-h1"><bdi>Store oak</bdi></h1>');
  });

  it("draws an empty bar without a segment", async () => {
    const html = await render(createElement(Bar, { value: 0, max: 0, extra: 0 }));
    expect(html).not.toMatch(/adm-bar__(fill|extra)/);
  });
});

describe("admin.css", () => {
  const css = readFileSync(join(__dirname, "..", "..", "app", "styles", "admin.css"), "utf8");
  const block = (selector: string, from = 0) => {
    const at = css.indexOf(`${selector} {`, from);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  const tokens = (body: string) => Object.fromEntries([...body.matchAll(/(--adm-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = tokens(block(":root"));
  const dark = { ...light, ...tokens(block(":root", css.indexOf("@media (prefers-color-scheme: dark)"))) };

  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("fills the primary button and the skip link with a colour white text reads on (4.5:1), hovered too, in both themes", () => {
    expect(block(".adm-btn--primary")).toContain("background: var(--adm-accent-fill);");
    expect(block(".adm-btn--primary:hover")).toContain("background: var(--adm-accent-fill-hover);");
    expect(block(".adm-skip")).toContain("background: var(--adm-accent-fill);");
    for (const theme of [light, dark]) {
      for (const fill of ["--adm-accent-fill", "--adm-accent-fill-hover"]) expect(contrast(theme["--adm-on-accent"]!, theme[fill]!), fill).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps links readable (4.5:1) on every surface, the blue-tinted notices included, hovered too", () => {
    expect(block(".adm-link")).toContain("color: var(--adm-link);");
    expect(block(".adm-link:hover")).toContain("color: var(--adm-link-hover);");
    // A tint (rgba) over the page's background, as the Prices page's steps sit on it.
    const over = (tint: string, base: string) => {
      const [r, g, b, a] = tint.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
      const under = [1, 3, 5].map((i) => Number.parseInt(base.slice(i, i + 2), 16));
      return `#${[r, g, b].map((c, i) => Math.round(a * c + (1 - a) * under[i]!).toString(16).padStart(2, "0")).join("")}`;
    };
    for (const theme of [light, dark]) {
      const tinted = theme["--adm-info-bg"]!.startsWith("rgba") ? over(theme["--adm-info-bg"]!, theme["--adm-bg"]!) : theme["--adm-info-bg"]!;
      for (const surface of [theme["--adm-bg"]!, theme["--adm-surface"]!, tinted]) {
        for (const link of ["--adm-link", "--adm-link-hover"]) expect(contrast(theme[link]!, surface), `${link} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives the language links 44 px touch targets on phones and touch screens, and keeps the account on a phone", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse.slice(0, coarse.indexOf("@media", 10))).toMatch(/\.adm-lang__link \{\s*min-inline-size: 44px;/);
    expect(coarse).toMatch(/\.adm-nav__link,\s*\.adm-lang__link \{\s*min-height: 44px;/);
    const phone = css.slice(css.indexOf("@media (max-width: 959px)"), css.indexOf("@media (max-width: 719px)"));
    expect(phone).toMatch(/\.adm-lang__link \{\s*min-height: 44px;/);
    expect(css).not.toMatch(/\.adm-account \{\s*display: none;/);
  });

  it("hints at more tabs on the phone's bar, and lays card tables out without sideways scrolling", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 959px)"));
    expect(phone).toMatch(/\.adm-nav \{[^}]*no-repeat local,[^}]*no-repeat scroll;/);
    const cards = css.slice(css.indexOf(".adm-table--cards,"));
    expect(cards).toMatch(/\.adm-table--cards tr \{\s*display: grid;/);
    expect(cards).toContain('content: attr(data-label) / "";');
  });
});
