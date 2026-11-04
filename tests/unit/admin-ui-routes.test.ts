/**
 * The console's frame and Overview loaders (the admin and the directory
 * stubbed): `?refresh=1` rebuilds the directory and redirects to the plain
 * URL, so a later reload, bookmark or language switch reads the kept one;
 * `?lang=` keeps the choice in a cookie every console request carries
 * (Path=/, so /admin.data too). Both redirects carry the console's headers.
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadDirectory = vi.fn();
vi.mock("../../app/.server/admin/auth", () => ({
  requireAdmin: vi.fn(async () => ({
    user: { id: "u1", email: "owner@linguva.test", role: "OWNER" },
    session: { id: "s1", expiresAt: "2026-11-04T18:00:00.000Z" },
    csrfToken: "csrf",
    can: () => true,
  })),
}));
vi.mock("../../app/.server/admin/directory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/.server/admin/directory")>()),
  loadDirectory: (...args: unknown[]) => loadDirectory(...args),
}));

const { loader: overviewLoader } = await import("../../app/routes/admin._index");
const { loader: frameLoader } = await import("../../app/routes/admin");

const args = (url: string) => ({ request: new Request(`http://localhost:3000${url}`), params: {}, context: {} }) as unknown as LoaderFunctionArgs;
const DIRECTORY = { rows: [], builtAt: "2026-11-04T10:54:00.000Z", billingConfigured: true, prices: {} };

async function thrown(run: () => Promise<unknown>): Promise<Response> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("expected a thrown Response");
}

beforeEach(() => {
  loadDirectory.mockReset();
  loadDirectory.mockResolvedValue(DIRECTORY);
});

describe("Overview's Reload (?refresh=1)", () => {
  it("rebuilds the directory, then redirects to the URL without the parameter", async () => {
    const response = await thrown(() => overviewLoader(args("/admin?refresh=1")));
    expect([response.status, response.headers.get("Location")]).toEqual([302, "/admin"]);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(loadDirectory).toHaveBeenCalledTimes(1);
    expect(loadDirectory.mock.calls[0]![0]).toMatchObject({ force: true });
  });

  it("keeps the other parameters, and drops an odd refresh value without rebuilding", async () => {
    const response = await thrown(() => overviewLoader(args("/admin?refresh=yes&x=1")));
    expect(response.headers.get("Location")).toBe("/admin?x=1");
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it("reads the kept directory on the plain URL", async () => {
    const data = await overviewLoader(args("/admin"));
    expect(loadDirectory).toHaveBeenCalledTimes(1);
    expect(loadDirectory.mock.calls[0]![0]).not.toHaveProperty("force");
    expect(data).toMatchObject({ builtAt: DIRECTORY.builtAt });
  });
});

describe("the frame's language switch (?lang=)", () => {
  it("stores the choice for every console request (Path=/) and redirects without the parameter, with the console's headers", async () => {
    const response = await thrown(() => frameLoader(args("/admin/customers?q=nord&lang=ar")));
    expect([response.status, response.headers.get("Location")]).toEqual([302, "/admin/customers?q=nord"]);
    expect(response.headers.get("Set-Cookie")).toBe("lv_admin_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("answers the frame's data otherwise, in the cookie's language", async () => {
    const request = new Request("http://localhost:3000/admin", { headers: { cookie: "lv_admin_lang=ar" } });
    const data = await frameLoader({ request, params: {}, context: {} } as unknown as LoaderFunctionArgs);
    expect(data).toMatchObject({ locale: "ar", role: "OWNER", can: { refresh: true, prices: true } });
  });
});
