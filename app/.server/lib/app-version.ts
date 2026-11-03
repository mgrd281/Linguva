/**
 * Which version of Linguva is running, for Settings' last line ("Linguva
 * zuletzt aktualisiert heute um 12:41 · Version 183028e"): when the running
 * build was made (vite.config.ts defines it; Railway builds the image on
 * every deploy, so it is when the update went live) and the commit Railway
 * deployed (RAILWAY_GIT_COMMIT_SHA, as the worker's heartbeat names it).
 * Either is null where it isn't known: in the tests, or a build outside
 * Railway without the variable.
 */
declare const __LINGUVA_BUILT_AT__: string | undefined;

const BUILT_AT: string | null = typeof __LINGUVA_BUILT_AT__ === "string" ? __LINGUVA_BUILT_AT__ : null;

export interface AppVersion {
  /** When the running build was made (ISO). */
  builtAt: string | null;
  /** The deployed commit, its first 7 characters. */
  commit: string | null;
}

export function appVersion(env: Readonly<Record<string, string | undefined>> = process.env, builtAt: string | null = BUILT_AT): AppVersion {
  const sha = env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? "";
  return {
    builtAt: builtAt && !Number.isNaN(Date.parse(builtAt)) ? new Date(builtAt).toISOString() : null,
    commit: /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null,
  };
}
