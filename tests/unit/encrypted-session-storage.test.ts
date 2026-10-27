import { describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { TokenCipher } from "../../app/.server/lib/crypto";
import { EncryptedSessionStorage } from "../../app/.server/shopify/encrypted-session-storage";

class MemoryStorage implements SessionStorage {
  readonly rows = new Map<string, Session>();
  async storeSession(session: Session) {
    this.rows.set(session.id, session);
    return true;
  }
  async loadSession(id: string) {
    return this.rows.get(id);
  }
  async deleteSession(id: string) {
    return this.rows.delete(id);
  }
  async deleteSessions(ids: string[]) {
    ids.forEach((id) => this.rows.delete(id));
    return true;
  }
  async findSessionsByShop(shop: string) {
    return [...this.rows.values()].filter((s) => s.shop === shop);
  }
}

const cipher = TokenCipher.fromKeyring(`k1:${Buffer.alloc(32, 3).toString("base64")}`);

function session() {
  return new Session({
    id: "offline_example.myshopify.com",
    shop: "example.myshopify.com",
    state: "state",
    isOnline: false,
    scope: "read_products",
    accessToken: "shpat_access",
    refreshToken: "shprt_refresh",
    refreshTokenExpires: new Date(Date.now() + 60_000),
  });
}

describe("EncryptedSessionStorage", () => {
  it("never hands plaintext tokens to the inner storage", async () => {
    const inner = new MemoryStorage();
    const storage = new EncryptedSessionStorage(inner, cipher);
    await storage.storeSession(session());

    const raw = inner.rows.get("offline_example.myshopify.com")!;
    expect(raw.accessToken).toMatch(/^v1\.k1\./);
    expect(raw.refreshToken).toMatch(/^v1\.k1\./);
    expect(JSON.stringify(raw.toObject())).not.toContain("shpat_access");
    expect(JSON.stringify(raw.toObject())).not.toContain("shprt_refresh");
  });

  it("returns decrypted sessions from load and findSessionsByShop", async () => {
    const storage = new EncryptedSessionStorage(new MemoryStorage(), cipher);
    await storage.storeSession(session());

    const loaded = await storage.loadSession("offline_example.myshopify.com");
    expect(loaded?.accessToken).toBe("shpat_access");
    expect(loaded?.refreshToken).toBe("shprt_refresh");
    expect(loaded?.scope).toBe("read_products");

    const found = await storage.findSessionsByShop("example.myshopify.com");
    expect(found.map((s) => s.accessToken)).toEqual(["shpat_access"]);
  });

  it("treats undecryptable sessions as missing instead of throwing", async () => {
    const inner = new MemoryStorage();
    const storage = new EncryptedSessionStorage(inner, cipher);
    const bad = session();
    bad.accessToken = "v1.retired-key.aaa.bbb.ccc";
    await inner.storeSession(bad);
    expect(await storage.loadSession(bad.id)).toBeUndefined();
    expect(await storage.findSessionsByShop(bad.shop)).toEqual([]);
  });

  it("returns undefined for a missing session and deletes through", async () => {
    const storage = new EncryptedSessionStorage(new MemoryStorage(), cipher);
    expect(await storage.loadSession("missing")).toBeUndefined();
    await storage.storeSession(session());
    await storage.deleteSession("offline_example.myshopify.com");
    expect(await storage.loadSession("offline_example.myshopify.com")).toBeUndefined();
  });
});
