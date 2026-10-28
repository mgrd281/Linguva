/**
 * Server response time of the main pages (production build, simulated
 * Shopify answering instantly): what Linguva itself adds. Real timings in
 * the admin also include Shopify's API latency and are measured on a
 * development store (DEV_STORE_TEST_PLAN.md).
 */
import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

const PATHS = ["/app", "/app/products?lang=de", "/app/products/1?lang=de", "/app/review", "/app/jobs", "/app/content", "/app/plan", "/app/settings"];

test("main pages respond quickly", async ({ page }) => {
  const rows: string[] = [];
  for (const path of PATHS) {
    await openApp(page, "full", path); // warm-up (code loading, connections)
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      await openApp(page, "full", path);
      const nav = await page.evaluate(() => {
        const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        return { ttfb: entry!.responseStart - entry!.requestStart, html: entry!.responseEnd - entry!.requestStart };
      });
      samples.push(nav.html);
    }
    samples.sort((a, b) => a - b);
    const median = samples[1]!;
    rows.push(`${path.padEnd(28)} ${median.toFixed(0).padStart(5)} ms`);
    // Generous for shared CI runners; the measured values are printed below.
    expect(median, path).toBeLessThan(1_500);
  }
  console.info(`server response (median of 3, full HTML incl. token exchange check):\n${rows.join("\n")}`);
});
