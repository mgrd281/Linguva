/**
 * A job's page opens as every page does (PageHeader): the trail to Jobs, the language's flag as its sign,
 * the job's name as the one h1 with its state beside it (in the one word per state), when and by whom it
 * started under it.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../app/i18n/react";
import JobDetail from "../../app/routes/app.jobs.$id";

const NOW = "2026-11-04T12:00:00.000Z";
const JOB: {
  id: string;
  resourceType: string;
  targetLocale: string;
  status: string;
  requestedBy: string | null;
  smartRunId: string | null;
  discoveryDone: boolean;
  failedItems: number;
  errorCode: string | null;
  publishMode: string;
  fieldScope: string;
  charsBilled: number;
  charsSaved: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
} = {
  id: "0123abcd-0000-4000-8000-000000000001",
  resourceType: "PRODUCT",
  targetLocale: "fr",
  status: "RUNNING",
  requestedBy: "42",
  smartRunId: null,
  discoveryDone: true,
  failedItems: 0,
  errorCode: null,
  publishMode: "AUTO_PUBLISH",
  fieldScope: "ALL",
  charsBilled: 0,
  charsSaved: 0,
  createdAt: "2026-11-04T11:00:00.000Z",
  startedAt: "2026-11-04T11:01:00.000Z",
  finishedAt: null,
  updatedAt: "2026-11-04T11:30:00.000Z",
};

async function render(job: Partial<typeof JOB> = {}): Promise<string> {
  const data = {
    now: NOW,
    actorId: "42",
    names: {},
    marketCountries: null,
    job: { ...JOB, ...job },
    outcomes: [{ status: "SUCCEEDED", code: null, count: 4 }, { status: "PENDING", code: null, count: 6 }],
    pending: { translations: 0, items: 0 },
    stop: null,
    eta: null,
    settling: false,
    workerDown: false,
    ownKeyPlan: false,
    problems: [],
  };
  const url = `http://localhost/app/jobs/${JOB.id}`;
  const handler = createStaticHandler([{ id: "job", path: "/app/jobs/:id", loader: () => data, Component: JobDetail }]);
  const context = await handler.query(new Request(url));
  if (context instanceof Response) throw new Error("unexpected response");
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en", timeZone: "UTC" } as ComponentProps<typeof I18nProvider>, createElement(StaticRouterProvider, { router, context, hydrate: false })),
  );
}

describe("a job's header", () => {
  it("is every page's header: the trail to Jobs, the flag as its sign, the name with its state, when it started", async () => {
    const html = await render();
    // PageHeader's markup: the trail first, then the sign beside the heading and its lead.
    expect(html).toMatch(/<s-query-container><s-stack direction="block" gap="small-200"><nav aria-label="Breadcrumb">/);
    expect(html).toContain('<s-link href="/app/jobs">Jobs</s-link>');
    expect(html).toContain(
      '<div class="lv-page-head"><s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems="center"><span class="lv-icon-square" data-tint="grey" aria-hidden="true"><span aria-hidden="true"',
    );
    expect(html).toContain('<img src="/flags/FR.svg"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<s-stack direction="inline" gap="small-200" alignItems="center"><h1 class="lv-h1">French · Products<\/h1><s-badge [^>]*>Translating<\/s-badge><\/s-stack>/);
    expect(html).toMatch(/<s-text color="subdued">Started today at [^<]+ · by you<\/s-text>/);
  });

  it("says a finished job is Done, and the discovery phase Finding texts", async () => {
    expect(await render({ status: "COMPLETED", finishedAt: "2026-11-04T11:40:00.000Z" })).toMatch(/<h1 class="lv-h1">French · Products<\/h1><s-badge [^>]*>Done<\/s-badge>/);
    expect(await render({ status: "RUNNING", discoveryDone: false })).toMatch(/<s-badge [^>]*>Finding texts<\/s-badge>/);
  });
});
