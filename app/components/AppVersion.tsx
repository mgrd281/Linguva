/**
 * The running version in one quiet line (Settings' end): when it went live,
 * in the store's time zone, and its commit; nothing when neither is known.
 */
import { useI18n } from "../i18n/react";

export function AppVersionLine({ version, now }: { version: { builtAt: string | null; commit: string | null }; now: string }) {
  const i18n = useI18n();
  const parts = [
    version.builtAt ? i18n.t("settings.version.updated", { when: i18n.at(version.builtAt, now) }) : null,
    version.commit ? i18n.t("settings.version.commit", { commit: version.commit }) : null,
  ].filter((part): part is string => part !== null);
  if (!parts.length) return null;
  return (
    <p id="settings-version" style={{ margin: 0 }}>
      <s-text color="subdued">{parts.join(" · ")}</s-text>
    </p>
  );
}
