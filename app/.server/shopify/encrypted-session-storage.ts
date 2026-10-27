import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { DecryptionError, type TokenCipher } from "../lib/crypto";
import { logger } from "../lib/logger";

/**
 * Wraps another SessionStorage and encrypts access and refresh tokens before
 * they are persisted. A database dump or backup therefore never contains
 * usable Shopify tokens. See ADR-006.
 *
 * A session that can't be decrypted (for example after its key was retired)
 * is treated as missing, so the app re-authenticates through token exchange
 * instead of failing every request and webhook for that shop.
 */
export class EncryptedSessionStorage implements SessionStorage {
  constructor(
    private readonly inner: SessionStorage,
    private readonly cipher: TokenCipher,
  ) {}

  storeSession(session: Session): Promise<boolean> {
    return this.inner.storeSession(this.transform(session, "encrypt"));
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const stored = await this.inner.loadSession(id);
    return stored ? this.tryDecrypt(stored) : undefined;
  }

  deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    return sessions
      .map((s) => this.tryDecrypt(s))
      .filter((s): s is Session => s !== undefined);
  }

  private tryDecrypt(session: Session): Session | undefined {
    try {
      return this.transform(session, "decrypt");
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
      logger.warn(
        { sessionId: session.id, shop: session.shop, reason: error.message },
        "stored session could not be decrypted; treating as missing",
      );
      return undefined;
    }
  }

  private transform(session: Session, op: "encrypt" | "decrypt"): Session {
    const apply = (value: string | undefined) =>
      value ? this.cipher[op](value) : value;
    const params = session.toObject();
    return new Session({
      ...params,
      accessToken: apply(params.accessToken),
      refreshToken: apply(params.refreshToken),
    });
  }
}
