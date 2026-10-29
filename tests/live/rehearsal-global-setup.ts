/**
 * One-time setup of the rehearsal: the live tests' own setup (gate,
 * target language) against the rehearsal store.
 */
import type { TestProject } from "vitest/node";
import liveSetup from "./global-setup";
import { installRehearsalFetch, rehearsalEnv, rehearsalShape, rehearsalStore } from "./rehearsal";

export default async function setup(project: TestProject) {
  // The live setup reads its settings from this process's environment.
  Object.assign(process.env, rehearsalEnv());
  const restore = installRehearsalFetch(rehearsalStore(rehearsalShape()));
  try {
    await liveSetup(project);
  } finally {
    restore();
  }
}
