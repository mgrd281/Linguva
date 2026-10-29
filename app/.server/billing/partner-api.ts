/**
 * Partner API client for Shopify App Pricing subscriptions. The Partner API
 * token belongs to the Partner organization (it can read data of every store
 * that installed our apps), so it is only read from the environment and
 * never logged or sent anywhere but partners.shopify.com.
 */

export interface PartnerApiSettings {
  orgId: string;
  token: string;
  appGid: string;
  version: string;
}

export class PartnerApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PartnerApiError";
  }
}

export interface ActiveSubscription {
  planHandle: string | null;
  billingPeriod: string | null;
  trialEndsAt: Date | null;
  cancelAtEndOfCycle: boolean;
  currentPeriodEnd: Date | null;
  pendingPlanHandle: string | null;
}

// Shape from the Partner API reference (activeSubscription, 2026-07+).
const QUERY = `query LinguvaActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    trialEndsAt
    currentBillingCycle { startTime endTime }
    items { handle }
    pendingUpdate { items { handle } }
  }
}`;

type Fetch = typeof fetch;

/**
 * The shop's active App Pricing subscription, or null when it has none.
 * Throws PartnerApiError on throttling or failures, so callers never treat
 * "couldn't check" as "not subscribed".
 */
export async function fetchActiveSubscription(
  settings: PartnerApiSettings,
  shopGid: string,
  fetchImpl: Fetch = fetch,
): Promise<ActiveSubscription | null> {
  if (!/^gid:\/\/shopify\/Shop\/\d+$/.test(shopGid)) throw new PartnerApiError("Invalid shop id", false);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://partners.shopify.com/${encodeURIComponent(settings.orgId)}/api/${encodeURIComponent(settings.version)}/graphql.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": settings.token },
        body: JSON.stringify({ query: QUERY, variables: { appId: settings.appGid, shopId: shopGid } }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    // Network failure or timeout: "couldn't check", never "not subscribed".
    throw new PartnerApiError("Partner API unreachable", true);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new PartnerApiError(`Partner API answered ${response.status}`, true);
  }
  if (!response.ok) throw new PartnerApiError(`Partner API answered ${response.status}`, false);
  try {
    return parse((await response.json()) as PartnerResponse);
  } catch (error) {
    if (error instanceof PartnerApiError) throw error;
    throw new PartnerApiError("Partner API returned invalid JSON", true);
  }
}

type PartnerResponse = {
  data?: {
    activeSubscription: null | {
      billingPeriod?: string | null;
      cancelAtEndOfCycle?: boolean | null;
      trialEndsAt?: string | null;
      currentBillingCycle?: { endTime?: string | null } | null;
      items?: Array<{ handle?: string | null }> | null;
      pendingUpdate?: { items?: Array<{ handle?: string | null }> | null } | null;
    };
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

function parse(body: PartnerResponse): ActiveSubscription | null {
  if (body.errors?.length) {
    const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new PartnerApiError(`Partner API errors: ${body.errors.map((e) => e.message).join("; ")}`, throttled);
  }
  if (!body.data) throw new PartnerApiError("Partner API returned no data", true);
  const sub = body.data.activeSubscription;
  if (!sub) return null;
  const date = (value: string | null | undefined) => (value ? new Date(value) : null);
  return {
    planHandle: sub.items?.[0]?.handle ?? null,
    billingPeriod: sub.billingPeriod ?? null,
    trialEndsAt: date(sub.trialEndsAt),
    cancelAtEndOfCycle: Boolean(sub.cancelAtEndOfCycle),
    currentPeriodEnd: date(sub.currentBillingCycle?.endTime),
    pendingPlanHandle: sub.pendingUpdate?.items?.[0]?.handle ?? null,
  };
}
