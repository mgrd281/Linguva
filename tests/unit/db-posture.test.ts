import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DEFINER_FUNCTIONS } from "../../app/.server/lib/db-posture";

const reviewed = DEFINER_FUNCTIONS.linguva_memory_fuzzy!.sha256;

/** A client whose catalog says the runtime role is a superuser. */
const privileged = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM pg_roles WHERE rolname = current_user")) {
      return [{ name: "app", superuser: true, bypassrls: false, createrole: false }];
    }
    if (sql.includes("has_schema_privilege")) return [{ create: false }];
    if (sql.includes("prosecdef")) {
      return [{ name: "linguva_memory_fuzzy", config: ["search_path=pg_catalog, pg_temp"], owner_super: false, owner_bypass: false, public_exec: false, sha256: reviewed }];
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

  it("only logs outside production", async () => {
    vi.resetModules();
    const { verifyDatabasePostureOnce } = await import("../../app/.server/lib/db-posture");
    const log = vi.fn();
    await expect(verifyDatabasePostureOnce(privileged, { production: false, log })).resolves.toBeUndefined();
    expect(log.mock.calls[0]![1].map((i: { code: string }) => i.code)).toEqual(["RUNTIME_SUPERUSER"]);
  });
});
