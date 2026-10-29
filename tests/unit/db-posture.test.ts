import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DEFINER_FUNCTIONS } from "../../app/.server/lib/db-posture";

/** A client whose catalog says the runtime role is a superuser. */
const privileged = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM pg_roles WHERE rolname = current_user")) {
      return [{ name: "app", superuser: true, bypassrls: false, createrole: false }];
    }
    if (sql.includes("has_schema_privilege")) return [{ create: false }];
    if (sql.includes("prosecdef")) {
      // The reviewed definer functions, unchanged.
      return Object.entries(DEFINER_FUNCTIONS).map(([name, reviewed]) => ({
        name,
        config: [reviewed.searchPath],
        owner_super: false,
        owner_bypass: false,
        public_exec: false,
        sha256: reviewed.sha256,
      }));
    }
    return [];
  }),
} as unknown as PrismaClient;

describe("verifyDatabasePostureOnce", () => {
  it("refuses to run in production when the posture is weak", async () => {
    vi.resetModules();
    const { verifyDatabasePostureOnce } = await import("../../app/.server/lib/db-posture");
    const log = vi.fn();
    await expect(verifyDatabasePostureOnce(privileged, { production: true, log })).rejects.toThrow(/RUNTIME_SUPERUSER/);
    expect(log).toHaveBeenCalled();
  });

  it("tries again after the database didn't answer, but keeps refusing a weak posture", async () => {
    vi.resetModules();
    const { verifyDatabasePostureOnce } = await import("../../app/.server/lib/db-posture");
    let down = true;
    const flaky = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (down) throw new Error("Can't reach database server");
        return (privileged.$queryRaw as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
      }),
    } as unknown as PrismaClient;
    const log = vi.fn();
    await expect(verifyDatabasePostureOnce(flaky, { production: true, log })).rejects.toThrow(/reach database/);
    down = false;
    await expect(verifyDatabasePostureOnce(flaky, { production: true, log })).rejects.toThrow(/RUNTIME_SUPERUSER/);
    const calls = (flaky.$queryRaw as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    // A real posture problem is decided once and stays refused.
    await expect(verifyDatabasePostureOnce(flaky, { production: true, log })).rejects.toThrow(/RUNTIME_SUPERUSER/);
    expect((flaky.$queryRaw as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });

  it("only logs outside production", async () => {
    vi.resetModules();
    const { verifyDatabasePostureOnce } = await import("../../app/.server/lib/db-posture");
    const log = vi.fn();
    await expect(verifyDatabasePostureOnce(privileged, { production: false, log })).resolves.toBeUndefined();
    expect(log.mock.calls[0]![1].map((i: { code: string }) => i.code)).toEqual(["RUNTIME_SUPERUSER"]);
  });
});
