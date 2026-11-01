/**
 * Upkeep of the Own key plan's stored engine keys, a step of the worker's
 * lock-guarded 5-minute sweep (worker/index.ts; docs/SECURITY_MODEL.md §3).
 * Reads never write secrets, so this is where keys move to the active key id
 * after a rotation, where UNREADABLE rows heal once the keyring decrypts them
 * again, and where the keys per key id are counted for the rotation procedure.
 * Per run: the next MAX_SHOPS active shops after a cursor kept in Redis, at
 * most MAX_CHANGES row changes, each a compare-and-swap (a key replaced
 * meanwhile is left as it is). Logs carry key ids and counts only.
 */
import type { PrismaClient } from "@prisma/client";
import { isEngineId } from "../../lib/engines";
import type { TokenCipher } from "../lib/crypto";
import { logger } from "../lib/logger";
import { withTenant } from "../tenancy/with-tenant";
import { credentialCipher } from "./cipher";
import { markEngineKey, openEngineKey, reencryptEngineKey, sealEngineKey, type EngineKeyRow } from "./store";

export const MAX_SHOPS = 200;
export const MAX_CHANGES = 50;

/** The Redis commands the step uses (a cursor and one hash per cycle). */
export interface MaintenanceRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  hincrby(key: string, field: string, increment: number): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface MaintenanceDeps {
  prisma: PrismaClient;
  redis: MaintenanceRedis;
  prefix: string;
  cipher?: TokenCipher;
  log?: Pick<typeof logger, "info" | "error">;
  /** Tests only: runs between a row's read and its write. */
  beforeWrite?: (row: EngineKeyRow) => Promise<void>;
}

export interface MaintenanceSummary {
  shops: number;
  reencrypted: number;
  healed: number;
  /** Rows under a key id this keyring doesn't have (untouched). */
  unknownKid: number;
  /** The cursor wrapped: a full cycle ended with this run (and was logged). */
  wrapped: boolean;
}

/** Label of an envelope that names no key id. */
const MALFORMED = "(malformed)";

type ShopCounts = { perKid: Map<string, number>; unknownKid: Map<string, number> };

function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function maintainEngineKeys(deps: MaintenanceDeps): Promise<MaintenanceSummary> {
  const cipher = deps.cipher ?? credentialCipher();
  const log = deps.log ?? logger;
  const cursorKey = `${deps.prefix}:engine-keys-cursor`;
  const cycleKey = `${deps.prefix}:engine-keys-cycle`;
  const active = cipher.activeKeyId();
  const cursor = await deps.redis.get(cursorKey);
  // Shop is a global table: the runtime role reads it without a tenant.
  const shops = await deps.prisma.shop.findMany({
    where: { status: "ACTIVE", ...(cursor ? { id: { gt: cursor } } : {}) },
    orderBy: { id: "asc" },
    take: MAX_SHOPS,
    select: { id: true },
  });

  const summary: MaintenanceSummary = { shops: 0, reencrypted: 0, healed: 0, unknownKid: 0, wrapped: false };
  let changes = 0;
  let last: string | null = cursor;
  let exhausted = false;

  for (const { id: shopId } of shops) {
    const rows = await withTenant(shopId, (tx) => tx.shopEngineCredential.findMany({ where: { shopId } }), deps.prisma);
    const counts: ShopCounts = { perKid: new Map(), unknownKid: new Map() };
    let shopUnknown = 0;
    for (const row of rows) {
      const kid = cipher.keyIdOf(row.secret);
      count(counts.perKid, kid ?? MALFORMED);
      if (kid === null) continue;
      if (!cipher.knows(kid)) {
        count(counts.unknownKid, kid);
        shopUnknown += 1;
        continue;
      }
      const heal = row.status === "UNREADABLE";
      const rotate = kid !== active;
      if (!heal && !rotate) continue;
      const opened = openEngineKey(row, cipher);
      // Real loss or tampering stays UNREADABLE (the load path and "Check again" handle it).
      if (opened.kind !== "ok" || !isEngineId(row.engine)) continue;
      const needed = (heal ? 1 : 0) + (rotate ? 1 : 0);
      if (changes + needed > MAX_CHANGES) {
        exhausted = true;
        break;
      }
      await deps.beforeWrite?.(row);
      const ref = { id: row.id, shopId, keyVersion: row.keyVersion };
      if (heal) {
        changes += 1;
        if ((await markEngineKey(ref, { status: "OK", lastErrorCode: null, lastErrorAt: null }, deps.prisma)) > 0) summary.healed += 1;
      }
      if (rotate) {
        changes += 1;
        const dataLocation = row.dataLocation === "global" ? "global" : "eu";
        const newSecret = sealEngineKey({ shopId, engine: row.engine, dataLocation, region: row.region }, opened.apiKey, cipher);
        // Compare-and-swap on the old envelope: 0 rows (replaced meanwhile) is ignored.
        if ((await reencryptEngineKey({ ...ref, oldSecret: row.secret }, newSecret, deps.prisma)) > 0) summary.reencrypted += 1;
      }
    }
    // A shop cut short is visited again (and counted) by the next run.
    if (exhausted) break;
    for (const [kid, n] of counts.perKid) await deps.redis.hincrby(cycleKey, `kid:${kid}`, n);
    for (const [kid, n] of counts.unknownKid) await deps.redis.hincrby(cycleKey, `unknown:${kid}`, n);
    summary.unknownKid += shopUnknown;
    summary.shops += 1;
    last = shopId;
  }

  if (!exhausted && shops.length < MAX_SHOPS) {
    // The end of the active shops: the cycle is complete.
    const totals = await deps.redis.hgetall(cycleKey);
    const perKid: Record<string, number> = {};
    const unknownKid: Record<string, number> = {};
    for (const [field, value] of Object.entries(totals)) {
      if (field.startsWith("kid:")) perKid[field.slice(4)] = Number(value);
      else if (field.startsWith("unknown:")) unknownKid[field.slice(8)] = Number(value);
    }
    log.info({ perKid, unknownKid }, "engine keys per key id");
    if (Object.keys(unknownKid).length) log.error({ unknownKid }, "engine keys under key ids this keyring doesn't have");
    await deps.redis.del(cycleKey, cursorKey);
    summary.wrapped = true;
  } else if (last) {
    await deps.redis.set(cursorKey, last);
  }
  return summary;
}
