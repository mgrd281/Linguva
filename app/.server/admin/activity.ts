/**
 * The admin console's activity page: who changed which list price when and
 * why, and the recent sign-ins (sessions). The audit log itself stays
 * write-only for the runtime role; these come from the console's own tables.
 */
import type { AdminRole, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "../lib/db";
import { settleAll } from "../lib/settle";
import { priceChangeHistory, type PriceChangeView } from "./prices";

/** A session unused this long has ended (the idle timeout of app/.server/admin/session.ts). */
const IDLE_MS = 30 * 60 * 1000;

export interface SignInView {
  email: string;
  role: AdminRole;
  /** When the session started (the sign-in). */
  at: string;
  lastSeenAt: string;
  /** active: it would still be accepted now (not signed out, expired, idle, or the account disabled or locked). */
  state: "active" | "ended";
}

export async function loadActivity(opts: { client?: PrismaClient; now?: Date } = {}): Promise<{ priceChanges: PriceChangeView[]; signIns: SignInView[] }> {
  const client = opts.client ?? defaultClient;
  const now = (opts.now ?? new Date()).getTime();
  const [priceChanges, sessions] = await settleAll([
    priceChangeHistory(50, client),
    client.adminSession.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
      select: {
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        // Never the token hash, password hash or TOTP secret.
        adminUser: { select: { email: true, role: true, disabledAt: true, lockedUntil: true } },
      },
    }),
  ]);
  const signIns = sessions.map((s): SignInView => {
    const user = s.adminUser;
    const active =
      s.revokedAt === null &&
      s.expiresAt.getTime() > now &&
      now - s.lastSeenAt.getTime() < IDLE_MS &&
      user.disabledAt === null &&
      (user.lockedUntil === null || user.lockedUntil.getTime() <= now);
    return { email: user.email, role: user.role, at: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), state: active ? "active" : "ended" };
  });
  return { priceChanges, signIns };
}
