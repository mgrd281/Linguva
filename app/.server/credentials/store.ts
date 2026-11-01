/**
 * The Own key plan's table of merchant engine keys (ShopEngineCredential,
 * docs/SECURITY_MODEL.md §5r). Every query runs inside withTenant. Reading
 * never writes `secret` (re-encryption is the worker's maintenance pass,
 * maintenance.ts), and every write about a used or checked key is guarded by
 * the row's keyVersion, so a result about an old key never lands on a new one.
 * Only the envelope, the hint and codes ever reach Prisma: never plaintext
 * (a Prisma validation error repeats its arguments).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { ENGINE_IDS, isEngineId, type EngineId } from "../../lib/engines";
import { usableOwnKey, type OwnKeyStatus, type OwnKeySummary } from "../../lib/own-keys";
import { DecryptionError, type TokenCipher } from "../lib/crypto";
import { prisma as defaultClient } from "../lib/db";
import { logger } from "../lib/logger";
import { SecretValue } from "../lib/secret";
import { AZURE_EU_ENDPOINT, AZURE_GLOBAL_ENDPOINT } from "../providers/azure";
import { withTenant, type TenantTx } from "../tenancy/with-tenant";
import { credentialCipher, credentialContext, ownStateKey, stateMaterial } from "./cipher";

/** A decrypted, usable key as the provider and its result bookkeeping need it. Server-only. */
export interface OwnCredential {
  id: string;
  engine: EngineId;
  /** Never a string: toJSON/inspect print [REDACTED]. */
  apiKey: SecretValue;
  dataLocation: "eu" | "global";
  region: string | null;
  /** Azure only. */
  endpoint?: typeof AZURE_EU_ENDPOINT | typeof AZURE_GLOBAL_ENDPOINT;
  /** "own:<engine>:<fingerprint>": the router's and Google's process state key. Never the key. */
  stateKey: string;
  status: "OK" | "QUOTA";
  /** The row's keyVersion when it was read: every write about this key's results is guarded by it. */
  keyVersion: number;
}

/** A row as read, for the guarded writes: which row, of which shop, in which version. */
export interface KeyRef {
  id: string;
  shopId: string;
  keyVersion: number;
}

export interface KeyMark {
  status: OwnKeyStatus;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  verifiedAt?: Date;
}

/** Everything but `secret`: what summaries are made of. */
const SUMMARY_FIELDS = {
  id: true,
  shopId: true,
  engine: true,
  hint: true,
  status: true,
  dataLocation: true,
  region: true,
  deeplPlan: true,
  verifiedAt: true,
  lastErrorCode: true,
  lastErrorAt: true,
  keyVersion: true,
} satisfies Prisma.ShopEngineCredentialSelect;

type SummaryRow = Prisma.ShopEngineCredentialGetPayload<{ select: typeof SUMMARY_FIELDS }>;
export type EngineKeyRow = Prisma.ShopEngineCredentialGetPayload<object>;

const STATUSES: readonly OwnKeyStatus[] = ["OK", "QUOTA", "REFUSED", "UNREADABLE", "RECHECK"];

function toSummary(row: SummaryRow): OwnKeySummary {
  return {
    engine: row.engine as EngineId,
    hint: row.hint,
    // The database CHECK allows only these; anything else would be unusable anyway.
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as OwnKeyStatus) : "UNREADABLE",
    dataLocation: row.dataLocation === "global" ? "global" : "eu",
    region: row.region,
    deeplPlan: row.deeplPlan === "free" || row.deeplPlan === "pro" ? row.deeplPlan : null,
    verifiedAt: row.verifiedAt.toISOString(),
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
  };
}

/** The shop's rows in ENGINE_IDS order (at most one per engine; an unknown engine can't pass the CHECK). */
function inEngineOrder<T extends { engine: string }>(rows: readonly T[]): T[] {
  return ENGINE_IDS.flatMap((engine) => rows.filter((row) => row.engine === engine));
}

/** Summaries only: `secret` is never selected. ENGINE_IDS order. */
export async function listEngineKeys(shopId: string, client: PrismaClient = defaultClient): Promise<OwnKeySummary[]> {
  const rows = await withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ where: { shopId }, select: SUMMARY_FIELDS }), client);
  return inEngineOrder(rows).map(toSummary);
}

/** The Azure endpoint a row's data location stands for (an enum, never a typed URL). */
export function azureEndpointFor(dataLocation: "eu" | "global"): typeof AZURE_EU_ENDPOINT | typeof AZURE_GLOBAL_ENDPOINT {
  return dataLocation === "global" ? AZURE_GLOBAL_ENDPOINT : AZURE_EU_ENDPOINT;
}

/** The envelope stored for a key: `{ v: 1, apiKey }` encrypted under the row's context. */
export function sealEngineKey(
  row: { shopId: string; engine: EngineId; dataLocation: "eu" | "global"; region: string | null },
  apiKey: SecretValue,
  cipher: TokenCipher = credentialCipher(),
): string {
  return cipher.encrypt(JSON.stringify({ v: 1, apiKey: apiKey.reveal() }), credentialContext(row));
}

/**
 * What a stored envelope holds. "unknown-kid": under a key id this process doesn't have (a keyring
 * difference, never the key's fault: skip, write nothing). "unreadable": real loss or tampering (a
 * malformed envelope, an authentication failure under a known key id, a malformed payload).
 */
export type OpenedKey = { kind: "ok"; apiKey: SecretValue } | { kind: "unknown-kid"; kid: string } | { kind: "unreadable" };

export function openEngineKey(
  row: { shopId: string; engine: string; dataLocation: string; region: string | null; secret: string },
  cipher: TokenCipher = credentialCipher(),
): OpenedKey {
  const kid = cipher.keyIdOf(row.secret);
  if (kid === null || !isEngineId(row.engine)) return { kind: "unreadable" };
  if (!cipher.knows(kid)) return { kind: "unknown-kid", kid };
  let plaintext: string;
  try {
    plaintext = cipher.decrypt(row.secret, credentialContext({ shopId: row.shopId, engine: row.engine, dataLocation: row.dataLocation === "global" ? "global" : "eu", region: row.region }));
  } catch (error) {
    if (error instanceof DecryptionError && error.cause === "unknown-kid") return { kind: "unknown-kid", kid };
    return { kind: "unreadable" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(plaintext);
  } catch {
    return { kind: "unreadable" };
  }
  const apiKey = (payload as { v?: unknown; apiKey?: unknown } | null)?.apiKey;
  if ((payload as { v?: unknown } | null)?.v !== 1 || typeof apiKey !== "string" || apiKey === "") return { kind: "unreadable" };
  return { kind: "ok", apiKey: new SecretValue(apiKey) };
}

/** Key ids already reported by this process (the kid is a label, not a secret). */
const reportedKids = new Set<string>();

/** One error line per process and key id: an envelope names a key id this keyring doesn't have. */
export function reportUnknownKid(engine: EngineId, kid: string): void {
  if (reportedKids.has(kid)) return;
  reportedKids.add(kid);
  logger.error({ engine, kid }, "own engine key under a key id this process doesn't have");
}

/** Tests only: report every key id again. */
export function resetUnknownKidReports(): void {
  reportedKids.clear();
}

function credentialOf(row: EngineKeyRow, apiKey: SecretValue, cipher: TokenCipher): OwnCredential {
  const engine = row.engine as EngineId;
  const dataLocation = row.dataLocation === "global" ? "global" : "eu";
  const endpoint = engine === "azure" ? azureEndpointFor(dataLocation) : undefined;
  const material = stateMaterial(engine, apiKey.reveal(), endpoint ? { region: row.region, endpoint } : undefined);
  return {
    id: row.id,
    engine,
    apiKey,
    dataLocation,
    region: row.region,
    ...(endpoint ? { endpoint } : {}),
    stateKey: ownStateKey(engine, material, cipher),
    status: row.status === "QUOTA" ? "QUOTA" : "OK",
    keyVersion: row.keyVersion,
  };
}

const UNREADABLE_CODE = "OWN_KEY_UNREADABLE";

async function markWith(tx: TenantTx, ref: KeyRef, mark: KeyMark): Promise<number> {
  const { count } = await tx.shopEngineCredential.updateMany({
    where: { id: ref.id, shopId: ref.shopId, keyVersion: ref.keyVersion },
    data: { status: mark.status, lastErrorCode: mark.lastErrorCode, lastErrorAt: mark.lastErrorAt, ...(mark.verifiedAt ? { verifiedAt: mark.verifiedAt } : {}) },
  });
  return count;
}

/**
 * Server-only. One withTenant transaction, one findMany of the shop's rows: the summaries and the
 * decrypted keys describe the same rows. `credentials`: usable rows (OK/QUOTA) that decrypted, in
 * ENGINE_IDS order. `transient`: usable rows whose envelope names a key id this process doesn't
 * have (skipped for now, nothing written). A usable row that doesn't decrypt under a known key id
 * (or isn't an envelope, or holds no key) is marked UNREADABLE, guarded by its keyVersion.
 */
export async function loadEngineKeys(
  shopId: string,
  client: PrismaClient = defaultClient,
  cipher: TokenCipher = credentialCipher(),
): Promise<{ summaries: OwnKeySummary[]; credentials: OwnCredential[]; transient: EngineId[] }> {
  return withTenant(
    shopId,
    async (tx) => {
      const rows = inEngineOrder(await tx.shopEngineCredential.findMany({ where: { shopId } }));
      const summaries: OwnKeySummary[] = [];
      const credentials: OwnCredential[] = [];
      const transient: EngineId[] = [];
      for (const row of rows) {
        const summary = toSummary(row);
        summaries.push(summary);
        if (!usableOwnKey(summary)) continue;
        const opened = openEngineKey(row, cipher);
        if (opened.kind === "ok") {
          credentials.push(credentialOf(row, opened.apiKey, cipher));
        } else if (opened.kind === "unknown-kid") {
          transient.push(summary.engine);
          reportUnknownKid(summary.engine, opened.kid);
        } else {
          const now = new Date();
          const marked = await markWith(tx, { id: row.id, shopId, keyVersion: row.keyVersion }, { status: "UNREADABLE", lastErrorCode: UNREADABLE_CODE, lastErrorAt: now });
          logger.warn({ engine: summary.engine }, "own engine key unreadable");
          if (marked) Object.assign(summary, { status: "UNREADABLE", lastErrorCode: UNREADABLE_CODE, lastErrorAt: now.toISOString() });
        }
      }
      return { summaries, credentials, transient };
    },
    client,
  );
}

/** One row with its envelope (server-only: the key check and maintenance decrypt it). */
export async function findEngineKey(shopId: string, engine: EngineId, client: PrismaClient = defaultClient): Promise<EngineKeyRow | null> {
  return withTenant(shopId, (tx) => tx.shopEngineCredential.findUnique({ where: { shopId_engine: { shopId, engine } } }), client);
}

/** Whether the shop has a saved key for the engine (no envelope read). */
export async function hasEngineKey(shopId: string, engine: EngineId, client: PrismaClient = defaultClient): Promise<boolean> {
  const row = await withTenant(shopId, (tx) => tx.shopEngineCredential.findUnique({ where: { shopId_engine: { shopId, engine } }, select: { id: true } }), client);
  return row !== null;
}

/** A key that passed its check, as the save writes it. */
export interface NewEngineKey {
  engine: EngineId;
  apiKey: SecretValue;
  hint: string;
  dataLocation: "eu" | "global";
  region: string | null;
  deeplPlan: "free" | "pro" | null;
  status: "OK" | "QUOTA";
  verifiedAt: Date;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
}

/**
 * Saves a key for the shop, or replaces the engine's key (keyVersion + 1). Inside one transaction:
 * the Shop row is read FOR SHARE first, and anything but ACTIVE writes nothing ("SHOP_INACTIVE"),
 * so an uninstall that ran during the live check can't be undone by the save (it marks the shop
 * UNINSTALLED before it deletes the keys; a save that locked the row first commits before that).
 * Insert-if-missing, then update: two first saves at once never hit the unique index.
 */
export async function insertOrReplaceEngineKey(
  shopId: string,
  row: NewEngineKey,
  client: PrismaClient = defaultClient,
  cipher: TokenCipher = credentialCipher(),
): Promise<{ replaced: boolean; keyVersion: number } | "SHOP_INACTIVE"> {
  return withTenant(
    shopId,
    async (tx) => {
      const [shop] = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"::text AS "status" FROM "Shop" WHERE "id" = ${shopId}::uuid FOR SHARE`;
      if (shop?.status !== "ACTIVE") return "SHOP_INACTIVE" as const;
      const data = {
        secret: sealEngineKey({ shopId, engine: row.engine, dataLocation: row.dataLocation, region: row.region }, row.apiKey, cipher),
        hint: row.hint,
        dataLocation: row.dataLocation,
        region: row.region,
        deeplPlan: row.deeplPlan,
        status: row.status,
        verifiedAt: row.verifiedAt,
        lastErrorCode: row.lastErrorCode,
        lastErrorAt: row.lastErrorAt,
      };
      // ON CONFLICT DO NOTHING: a second first save waits for the first, then updates.
      const created = await tx.shopEngineCredential.createMany({ data: [{ shopId, engine: row.engine, ...data, keyVersion: 1 }], skipDuplicates: true });
      if (created.count === 1) return { replaced: false, keyVersion: 1 };
      const updated = await tx.shopEngineCredential.update({
        where: { shopId_engine: { shopId, engine: row.engine } },
        data: { ...data, keyVersion: { increment: 1 } },
        select: { keyVersion: true },
      });
      return { replaced: true, keyVersion: updated.keyVersion };
    },
    client,
  );
}

/**
 * A result about a key that was used or checked: updateMany guarded by id, shop and keyVersion.
 * Returns the count; 0 means the key was replaced or removed after it was read, so the result
 * belongs to the old key and the caller must not apply it to the new one.
 */
export async function markEngineKey(ref: KeyRef, mark: KeyMark, client: PrismaClient = defaultClient): Promise<number> {
  return withTenant(ref.shopId, (tx) => markWith(tx, ref, mark), client);
}

/** Whether the row is still the one that was read (same id and keyVersion). Reads, never writes. */
export async function isCurrentEngineKey(ref: KeyRef, client: PrismaClient = defaultClient): Promise<boolean> {
  const count = await withTenant(ref.shopId, (tx) => tx.shopEngineCredential.count({ where: { id: ref.id, shopId: ref.shopId, keyVersion: ref.keyVersion } }), client);
  return count > 0;
}

/** Removes the shop's key for the engine; true when a row was deleted. */
export async function deleteEngineKey(shopId: string, engine: EngineId, client: PrismaClient = defaultClient): Promise<boolean> {
  const { count } = await withTenant(shopId, (tx) => tx.shopEngineCredential.deleteMany({ where: { shopId, engine } }), client);
  return count > 0;
}

/** Removes every key of the shop (app/uninstalled, a reinstall's leftovers); returns the deleted engines. */
export async function deleteShopEngineKeys(shopId: string, client: PrismaClient = defaultClient): Promise<EngineId[]> {
  return withTenant(
    shopId,
    async (tx) => {
      const rows = await tx.shopEngineCredential.findMany({ where: { shopId }, select: { engine: true } });
      if (rows.length === 0) return [];
      await tx.shopEngineCredential.deleteMany({ where: { shopId } });
      return inEngineOrder(rows).map((row) => row.engine as EngineId);
    },
    client,
  );
}

/**
 * Re-encryption under the active key id (maintenance pass only): compare-and-swap on id, shop,
 * keyVersion and the old envelope. 0 rows: replaced meanwhile, ignored by the caller.
 */
export async function reencryptEngineKey(
  ref: KeyRef & { oldSecret: string },
  newSecret: string,
  client: PrismaClient = defaultClient,
): Promise<number> {
  const { count } = await withTenant(
    ref.shopId,
    (tx) => tx.shopEngineCredential.updateMany({ where: { id: ref.id, shopId: ref.shopId, keyVersion: ref.keyVersion, secret: ref.oldSecret }, data: { secret: newSecret } }),
    client,
  );
  return count;
}
