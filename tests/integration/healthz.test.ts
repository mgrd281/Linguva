/**
 * The health check the hosting platform polls: 200 with the database
 * reachable, never cached, nothing about the shop or the error in the body.
 */
import { afterAll, describe, expect, it } from "vitest";
import { loader } from "../../app/routes/healthz";
import { prisma } from "../../app/.server/lib/db";

afterAll(() => prisma.$disconnect());

describe("health check", () => {
  it("answers 200 ok when the database answers", async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
