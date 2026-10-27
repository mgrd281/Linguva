/** Stand-in for the Partner API activeSubscription query (no network, no charges). */
export type FakeSubscription = {
  handle: string;
  trialEndsAt?: string | null;
  cancelAtEndOfCycle?: boolean;
  endTime?: string;
  pendingHandle?: string | null;
} | null;

export function fakePartnerApi(initial: FakeSubscription | Error | { status: number }) {
  let next: FakeSubscription | Error | { status: number } = initial;
  const calls: Array<{ url: string; token: string | null; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), token: headers.get("X-Shopify-Access-Token"), body: JSON.parse(String(init?.body)) });
    if (next instanceof Error) throw next;
    if (next && "status" in next) return new Response("{}", { status: next.status });
    const sub = next;
    return Response.json({
      data: {
        activeSubscription: sub
          ? {
              billingPeriod: "EVERY_30_DAYS",
              cancelAtEndOfCycle: sub.cancelAtEndOfCycle ?? false,
              trialEndsAt: sub.trialEndsAt ?? null,
              currentBillingCycle: { startTime: "2026-10-01T00:00:00Z", endTime: sub.endTime ?? "2026-11-01T00:00:00Z" },
              items: [{ handle: sub.handle }],
              pendingUpdate: sub.pendingHandle ? { items: [{ handle: sub.pendingHandle }] } : null,
            }
          : null,
      },
    });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    set(value: FakeSubscription | Error | { status: number }) {
      next = value;
    },
  };
}

export const PARTNER_SETTINGS = {
  orgId: "1234567",
  token: "prtapi_test_token_not_real",
  appGid: "gid://shopify/App/42",
  version: "2026-10",
};
