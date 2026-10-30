/** settleAll: Promise.all that answers only once every promise has settled. */
import { describe, expect, it } from "vitest";
import { settleAll } from "../../app/.server/lib/settle";

describe("settleAll", () => {
  it("returns every value in order", async () => {
    await expect(settleAll([Promise.resolve(1), "two", Promise.resolve({ three: 3 })])).resolves.toEqual([1, "two", { three: 3 }]);
  });

  it("rejects with the first rejection, but only after the slower reads have finished", async () => {
    let slowDone = false;
    const slow = new Promise<string>((resolve) => setTimeout(() => {
      slowDone = true;
      resolve("slow");
    }, 30));
    const failure = new Error("billing failed");
    await expect(settleAll([Promise.reject(failure), slow, Promise.reject(new Error("later"))])).rejects.toBe(failure);
    expect(slowDone).toBe(true);
  });
});
