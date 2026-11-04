/**
 * Settings' last line: when the running version went live (the build's
 * time, vite.config.ts) and Railway's commit, in the interface language
 * and the store's time zone; nothing it doesn't know.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { appVersion } from "../../app/.server/lib/app-version";
import { AppVersionLine } from "../../app/components/AppVersion";
import type { AppLocale } from "../../app/i18n/i18n";
import { I18nProvider } from "../../app/i18n/react";

const SHA = "183028ec43493c6c95a18bd2bb1b2ff03f06cabc";
const BUILT = "2026-11-03T11:41:00.000Z";
const NOW = "2026-11-03T15:00:00.000Z";

const line = (version: { builtAt: string | null; commit: string | null }, locale: AppLocale = "en") =>
  renderToStaticMarkup(createElement(I18nProvider, { locale, timeZone: "Europe/Berlin" } as ComponentProps<typeof I18nProvider>, createElement(AppVersionLine, { version, now: NOW })));

describe("appVersion", () => {
  it("takes the build's time and Railway's commit, its first 7 characters", () => {
    expect(appVersion({ RAILWAY_GIT_COMMIT_SHA: SHA }, BUILT)).toEqual({ builtAt: BUILT, commit: "183028e" });
    expect(appVersion({ RAILWAY_GIT_COMMIT_SHA: ` ${SHA.toUpperCase()} ` }, BUILT).commit).toBe("183028e");
  });

  it("says null for what it doesn't know, never a made-up value", () => {
    expect(appVersion({}, null)).toEqual({ builtAt: null, commit: null });
    expect(appVersion({ RAILWAY_GIT_COMMIT_SHA: "main" }, "yesterday")).toEqual({ builtAt: null, commit: null });
    expect(appVersion({ RAILWAY_GIT_COMMIT_SHA: "<script>" }, BUILT).commit).toBeNull();
    // The tests run without a build: no time.
    expect(appVersion({}).builtAt).toBeNull();
  });
});

describe("AppVersionLine", () => {
  it("says when the version went live in the store's zone, and its commit", () => {
    expect(line({ builtAt: BUILT, commit: "183028e" })).toContain(">Linguva last updated today at 12:41 PM · Version 183028e<");
    expect(line({ builtAt: BUILT, commit: "183028e" }, "de")).toContain(">Linguva zuletzt aktualisiert heute um 12:41 · Version 183028e<");
    expect(line({ builtAt: BUILT, commit: null }, "fr")).toContain(">Linguva mis à jour aujourd&#x27;hui à 12:41<");
    expect(line({ builtAt: null, commit: "183028e" }, "es")).toContain(">Versión 183028e<");
  });

  it("shows nothing without a time or a commit", () => {
    expect(line({ builtAt: null, commit: null })).toBe("");
  });
});
