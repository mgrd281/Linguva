import { defineConfig } from "vitest/config";

/**
 * DeepL quality and cost measurement on the fictional demo catalog. Runs
 * only with a local DEEPL_API_KEY (never in CI, never with store data):
 *
 *   DEEPL_API_KEY=… pnpm test:deepl
 *
 * See tests/quality/deepl.quality.test.ts.
 */
export default defineConfig({
  test: {
    name: "quality",
    include: ["tests/quality/**/*.quality.test.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
  },
});
