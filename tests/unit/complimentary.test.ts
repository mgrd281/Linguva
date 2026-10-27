import type { ComplimentaryAccess } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { complimentaryEntitlements, isActiveGrant } from "../../app/.server/billing/complimentary";
import { estimatedCostUsd } from "../../app/lib/plans";

const GID = "gid://shopify/Shop/1";
const grant = (extra: Partial<ComplimentaryAccess> = {}): ComplimentaryAccess => ({
  shopId: "s",
  shopifyShopGid: GID,
  reason: "own",
  grantedBy: "owner",
  monthlyCharLimit: 1000,
  grantedAt: new Date("2026-10-01T00:00:00Z"),
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  ...extra,
});
const now = new Date("2026-10-28T00:00:00Z");

describe("complimentary grant check", () => {
  it("needs the row, a matching Shopify GID and the server allowlist, every one of them", () => {
    expect(isActiveGrant(grant(), { shopifyShopGid: GID }, [GID], now)).toBe(true);
    expect(isActiveGrant(null, { shopifyShopGid: GID }, [GID], now)).toBe(false);
    expect(isActiveGrant(grant(), { shopifyShopGid: GID }, [], now)).toBe(false);
    expect(isActiveGrant(grant(), { shopifyShopGid: GID }, ["gid://shopify/Shop/2"], now)).toBe(false);
    expect(isActiveGrant(grant(), { shopifyShopGid: "gid://shopify/Shop/2" }, [GID, "gid://shopify/Shop/2"], now)).toBe(false);
    expect(isActiveGrant(grant(), { shopifyShopGid: null }, [GID], now)).toBe(false);
  });

  it("ends when revoked or expired", () => {
    expect(isActiveGrant(grant({ revokedAt: now }), { shopifyShopGid: GID }, [GID], now)).toBe(false);
    expect(isActiveGrant(grant({ expiresAt: now }), { shopifyShopGid: GID }, [GID], now)).toBe(false);
    expect(isActiveGrant(grant({ expiresAt: new Date(now.getTime() + 1) }), { shopifyShopGid: GID }, [GID], now)).toBe(true);
  });

  it("includes every feature with the grant's character allowance", () => {
    expect(complimentaryEntitlements({ monthlyCharLimit: 5 })).toEqual({
      plan: "complimentary",
      monthlyChars: 5,
      maxTargetLocales: 20,
      bulk: true,
      glossary: true,
      autoPublish: true,
    });
  });

  it("estimates provider cost per million characters", () => {
    expect(estimatedCostUsd(1_000_000, 25)).toBe(25);
    expect(estimatedCostUsd(123_456, 20)).toBe(2.47);
    expect(estimatedCostUsd(0, 25)).toBe(0);
  });
});
