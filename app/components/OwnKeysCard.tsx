/**
 * Settings › "Your translation keys" (the Own key plan): one row per
 * translation service (DeepL, Microsoft Azure, Google Cloud), each saved key
 * with its state in words, its last four characters and where it processes;
 * a form to add or replace a key, "Check again", and "Remove" behind a
 * dialog. Off the plan, saved keys can only be removed.
 *
 * Secrets: every key form posts (fetcher.Form defaults to GET, which would
 * put the key into the address, logs and the browser's history); the key
 * field never gets a value; the form is rebuilt after every result, so a
 * typed key leaves the page; results are codes and summaries, never a key.
 * No save bar: a key is submitted only by its own button.
 */
import { useRef, useState, type ReactNode } from "react";
import type { FetcherWithComponents } from "react-router";
import type { I18n, MessageKey } from "../i18n/i18n";
import { jobErrorMessage } from "../i18n/labels";
import { orderTexts } from "../lib/engine-texts";
import { ENGINE_IDS, ENGINE_NAMES, type EngineId } from "../lib/engines";
import type { IconName } from "../lib/icons";
import { engineList } from "../lib/name-lists";
import { DEEPL_PLAN_NAMES, ownKeyToken, usableOwnKey, type OwnKeyStatus, type OwnKeySummary } from "../lib/own-keys";
import { useResultToast } from "./app-bridge";
import { Actions, FactList, focusById, InlineNotice, More, SETTING_NAME, SettingCard, StateLine, useFreshResult, type SettingState } from "./SettingsParts";

/** The Settings loader's `ownKeys` (OwnKeysView): summaries only, never a key. */
export interface OwnKeysCardData {
  access: "plan" | "pending" | "off";
  plan: boolean;
  startsOn: string | null;
  keys: OwnKeySummary[];
  usage: { total: number; byEngine: Partial<Record<EngineId, number>> };
  deepl: { plan: "free" | "pro"; used: number; limit: number | null } | null;
}

/** What a key form's action answers (app.settings.tsx): codes and the key's state, never the key. */
export type KeyActionResult =
  | { ok: true; saved: "key"; engine: EngineId; replaced: boolean; status: OwnKeyStatus }
  | { ok: true; saved: "key-check"; engine: EngineId; status: OwnKeyStatus }
  | { ok: true; saved: "key-removed"; engine: EngineId }
  | { ok: false; error: string; engine?: EngineId; retryAfterSeconds?: number };

/** One fetcher per engine row (its add/replace, check and remove forms). */
export type KeyFetcher = FetcherWithComponents<unknown>;

/** The card's id: the glance tile, the Overview, the Plan page and the editor link to it. */
export const KEYS_CARD = "settings-keys";
/** A row's name, focused after a key's result (and the remove dialog's id). */
export const keyRowId = (engine: EngineId) => `${KEYS_CARD}-${engine}`;
export const keyRemoveModal = (engine: EngineId) => `settings-key-remove-${engine}`;

const STATE_TEXT: Record<OwnKeyStatus, MessageKey> = {
  OK: "settings.keys.state.OK",
  QUOTA: "settings.keys.state.QUOTA",
  REFUSED: "settings.keys.state.REFUSED",
  UNREADABLE: "settings.keys.state.UNREADABLE",
  RECHECK: "settings.keys.state.RECHECK",
};
const STATE_LOOK: Record<OwnKeyStatus, { icon: IconName; tone?: "critical" | "caution" }> = {
  OK: { icon: "check-circle" },
  QUOTA: { icon: "alert-triangle", tone: "caution" },
  REFUSED: { icon: "alert-circle", tone: "critical" },
  UNREADABLE: { icon: "alert-circle", tone: "critical" },
  RECHECK: { icon: "refresh", tone: "caution" },
};
const HELP: Record<EngineId, MessageKey> = {
  deepl: "settings.keys.help.deepl",
  azure: "settings.keys.help.azure",
  google: "settings.keys.help.google",
};
/** Where Microsoft and Google show usage and costs (their keys have no usage API). */
const ELSEWHERE: Partial<Record<EngineId, MessageKey>> = {
  azure: "settings.keys.usage.elsewhere.azure",
  google: "settings.keys.usage.elsewhere.google",
};
const LOCATION: Record<"eu" | "global", MessageKey> = { eu: "settings.keys.location.eu", global: "settings.keys.location.global" };
const FIELD_LOCATION: Record<"eu" | "global", MessageKey> = { eu: "settings.keys.field.location.eu", global: "settings.keys.field.location.global" };
const ERROR_TEXT: Record<string, MessageKey> = {
  PLAN_OWN_KEY: "settings.keys.error.PLAN_OWN_KEY",
  ENGINE_UNKNOWN: "settings.keys.error.ENGINE_UNKNOWN",
  KEY_FORMAT: "settings.keys.error.KEY_FORMAT",
  REGION_FORMAT: "settings.keys.error.REGION_FORMAT",
  KEY_REFUSED: "settings.keys.error.KEY_REFUSED",
  KEY_UNREADABLE: "settings.keys.error.KEY_UNREADABLE",
  KEY_CHANGED: "settings.keys.error.KEY_CHANGED",
  SHOP_INACTIVE: "settings.keys.error.SHOP_INACTIVE",
  KEY_UNREACHABLE: "settings.keys.error.KEY_UNREACHABLE",
  KEY_MOCK_ONLY: "settings.keys.error.KEY_MOCK_ONLY",
  RATE_LIMITED: "settings.keys.error.RATE_LIMITED",
  NO_KEY: "settings.keys.error.NO_KEY",
};

/** A fetcher's data as a key action's result (anything else: null). */
export function keyResult(data: unknown): KeyActionResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.ok === true && (d.saved === "key" || d.saved === "key-check" || d.saved === "key-removed")) return d as KeyActionResult;
  if (d.ok === false && typeof d.error === "string") return d as KeyActionResult;
  return null;
}

/** "DeepL and Google Cloud bill you …": the saved keys' services, or all three before any is saved. */
export function ownKeyCostNote(i18n: I18n, keys: readonly Pick<OwnKeySummary, "engine">[]): string {
  const engines = keys.length ? ENGINE_IDS.filter((e) => keys.some((k) => k.engine === e)) : ENGINE_IDS;
  return i18n.t("settings.keys.costNote", { engines: engineList(i18n, engines.map((e) => ENGINE_NAMES[e])) });
}

/** A key's state in words: its icon and its sentence ("Refused by DeepL"). */
export function keyStateText(i18n: I18n, key: Pick<OwnKeySummary, "engine" | "status">): string {
  return i18n.t(STATE_TEXT[key.status], { engine: ENGINE_NAMES[key.engine] });
}

/** A key form's error in words, with its engine and the seconds to wait. */
export function keyErrorText(i18n: I18n, result: { error: string; engine?: EngineId; retryAfterSeconds?: number }, engine: EngineId): string {
  const key = ERROR_TEXT[result.error];
  if (!key) return i18n.t("editor.aiError.generic");
  return i18n.t(key, { engine: ENGINE_NAMES[result.engine ?? engine], seconds: result.retryAfterSeconds ?? 60 });
}

/** The toast after a key action. */
function keyToast(i18n: I18n, result: KeyActionResult | null): string | null {
  if (!result?.ok) return null;
  const engine = ENGINE_NAMES[result.engine];
  if (result.saved === "key") return i18n.t(result.status === "QUOTA" ? "settings.keys.toast.savedQuota" : "settings.keys.toast.saved", { engine });
  if (result.saved === "key-check") return i18n.t("settings.keys.toast.checked", { engine });
  return i18n.t("settings.keys.toast.removed", { engine });
}

/** The card's state badge: the keys work, one needs attention, or none yet. */
export function keysState(i18n: I18n, keys: readonly OwnKeySummary[]): SettingState {
  const problem = keys.find((k) => k.status !== "OK");
  if (problem) return { label: keyStateText(i18n, problem), icon: STATE_LOOK[problem.status].icon, tone: problem.status === "QUOTA" || problem.status === "RECHECK" ? "warning" : "critical" };
  const usable = keys.filter(usableOwnKey);
  if (usable.length) return { label: engineList(i18n, usable.map((k) => ENGINE_NAMES[k.engine])), icon: "check-circle", tone: "success" };
  return { label: i18n.t("settings.changes.badge.noKey"), icon: "alert-triangle", tone: "warning" };
}

export interface OwnKeysCardProps {
  data: OwnKeysCardData;
  i18n: I18n;
  fetchers: Record<EngineId, KeyFetcher>;
  /** DeepL's "Check and save" is the page's one primary button (on the plan, no usable key, languages added). */
  primary: boolean;
}

export function OwnKeysCard({ data, i18n, fetchers, primary }: OwnKeysCardProps) {
  const { t } = i18n;
  const manage = data.access !== "off";
  // Off the plan only the saved keys (to remove them); otherwise every service, saved or to add.
  const engines = manage ? ENGINE_IDS : ENGINE_IDS.filter((e) => data.keys.some((k) => k.engine === e));
  const usable = data.keys.filter(usableOwnKey);
  const usageEngines = ENGINE_IDS.filter((e) => (data.usage.byEngine[e] ?? 0) > 0);
  let notice: ReactNode = null;
  if (data.access === "pending") {
    // Keys can be prepared now; they are used from the switch.
    notice = (
      <s-banner tone="info">
        <s-paragraph>{data.startsOn ? t("settings.keys.pending", { date: i18n.date(data.startsOn, "long") }) : t("settings.keys.pendingNoDate")}</s-paragraph>
      </s-banner>
    );
  } else if (data.access === "off") {
    // Another plan: the keys stay unused (only Remove), and texts go to Linguva's services now.
    notice = (
      <s-banner tone="info" heading={t("settings.keys.offPlan.heading")}>
        <s-paragraph>{t("settings.keys.offPlan.body")}</s-paragraph>
        <s-paragraph>{t("settings.keys.offPlan.texts")}</s-paragraph>
      </s-banner>
    );
  }
  return (
    <SettingCard
      id={KEYS_CARD}
      icon="connect"
      heading={t("settings.keys.heading")}
      state={manage ? keysState(i18n, data.keys) : null}
      lead={data.access === "plan" ? t("settings.keys.lead") : undefined}
    >
      {notice}
      {/* The services bill every character: their own cost limit is the only one. */}
      {manage ? <StateLine icon="cash-dollar" tone="caution">{ownKeyCostNote(i18n, data.keys)}</StateLine> : null}
      {data.access === "plan" && data.keys.length === 0 ? <StateLine icon="info">{t("settings.keys.none")}</StateLine> : null}
      <ul aria-label={t("settings.keys.heading")} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        {engines.map((engine) => (
          <KeyRow
            key={engine}
            i18n={i18n}
            engine={engine}
            saved={data.keys.find((k) => k.engine === engine) ?? null}
            manage={manage}
            fetcher={fetchers[engine]}
            primary={primary && engine === "deepl"}
            openAdd={engine === "deepl" && data.keys.length === 0}
          />
        ))}
      </ul>
      {manage ? (
        <s-stack direction="block" gap="small-200">
          {usable.length >= 2 ? <s-text color="subdued">{t("settings.keys.order", orderTexts(i18n, usable.map(ownKeyToken)))}</s-text> : null}
          <s-text color="subdued">{data.usage.total > 0 ? t("settings.keys.usage", { chars: data.usage.total }) : t("settings.keys.usage.none")}</s-text>
          {usageEngines.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {usageEngines.map((engine) => (
                <li key={engine}>
                  <s-text color="subdued">{t("plan.usage.ownKey.engine", { engine: ENGINE_NAMES[engine], chars: data.usage.byEngine[engine] ?? 0 })}</s-text>
                </li>
              ))}
            </ul>
          ) : null}
          {data.deepl ? (
            <s-text color="subdued">
              {data.deepl.limit !== null
                ? t("settings.keys.deeplUsage", { used: data.deepl.used, limit: data.deepl.limit })
                : t("settings.keys.deeplUsage.unlimited", { used: data.deepl.used })}
            </s-text>
          ) : null}
        </s-stack>
      ) : null}
    </SettingCard>
  );
}

interface KeyRowProps {
  i18n: I18n;
  engine: EngineId;
  saved: OwnKeySummary | null;
  /** On the plan or with a pending change to it: add, replace and check (off the plan: remove only). */
  manage: boolean;
  fetcher: KeyFetcher;
  primary: boolean;
  /** The add form starts open (DeepL, while the store has no key). */
  openAdd: boolean;
}

function KeyRow({ i18n, engine, saved, manage, fetcher, primary, openAdd }: KeyRowProps) {
  const { t } = i18n;
  const name = ENGINE_NAMES[engine];
  // Rebuilt after every result: a typed key never stays on the page.
  const [formKey, setFormKey] = useState(0);
  const removeForm = useRef<HTMLFormElement>(null);
  const result = keyResult(fetcher.data);
  useResultToast(fetcher.data, keyToast(i18n, result));
  useFreshResult(fetcher, (data) => {
    setFormKey((k) => k + 1);
    if (keyResult(data)?.ok) focusById(keyRowId(engine));
  });
  const busy = fetcher.state !== "idle";
  const intent = fetcher.formData?.get("intent");
  const error = result && !result.ok ? (
    <InlineNotice icon="alert-circle" heading={name}>
      {keyErrorText(i18n, result, engine)}
    </InlineNotice>
  ) : null;
  const form = (
    <KeyForm key={formKey} i18n={i18n} engine={engine} saved={saved} fetcher={fetcher} primary={primary} loading={busy && intent === "save-key"} />
  );
  const heading = (
    <span id={keyRowId(engine)} tabIndex={-1} style={{ ...SETTING_NAME, outline: "none" }}>
      {name}
    </span>
  );
  if (!saved) {
    return (
      <li>
        <s-box border="base" borderRadius="large-100" padding="base">
          <s-stack direction="block" gap="small-200">
            {heading}
            <More summary={t("settings.keys.add", { engine: name })} open={openAdd}>
              {form}
            </More>
            {error}
          </s-stack>
        </s-box>
      </li>
    );
  }
  const look = STATE_LOOK[saved.status];
  const facts: Array<{ icon: IconName; text: ReactNode; key: string }> = [{ key: "hint", icon: "key", text: t("settings.keys.hint", { hint: saved.hint }) }];
  if (saved.deeplPlan) facts.push({ key: "plan", icon: "receipt", text: DEEPL_PLAN_NAMES[saved.deeplPlan] });
  if (engine === "azure") {
    facts.push({
      key: "where",
      icon: "globe",
      text: saved.region ? `${t("settings.keys.regionValue", { region: saved.region })} · ${t(LOCATION[saved.dataLocation])}` : t(LOCATION[saved.dataLocation]),
    });
  }
  if (engine === "google") facts.push({ key: "where", icon: "globe", text: t(LOCATION.global) });
  facts.push({ key: "checked", icon: "calendar-check", text: t("settings.keys.checked", { date: i18n.date(saved.verifiedAt, "long") }) });
  const problem = saved.lastErrorCode ? jobErrorMessage(i18n, saved.lastErrorCode) : null;
  if (problem && saved.lastErrorAt) {
    facts.push({ key: "error", icon: "alert-circle", text: `${problem} ${t("settings.keys.lastError", { engine: name, date: i18n.date(saved.lastErrorAt, "long") })}` });
  }
  const modal = keyRemoveModal(engine);
  return (
    <li>
      <s-box border="base" borderRadius="large-100" padding="base">
        <s-stack direction="block" gap="small-200">
          {heading}
          <StateLine icon={look.icon} {...(look.tone ? { tone: look.tone } : {})}>
            {keyStateText(i18n, saved)}
          </StateLine>
          <FactList label={name} facts={facts} />
          <Actions wide={320}>
            {manage ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="check-key" />
                <input type="hidden" name="engine" value={engine} />
                <s-button type="submit" {...(busy && intent === "check-key" ? { loading: true } : {})}>
                  {t("settings.keys.checkAgain")}
                </s-button>
              </fetcher.Form>
            ) : null}
            <s-button tone="critical" commandFor={modal} command="--show" {...(busy && intent === "remove-key" ? { loading: true } : {})}>
              {t("settings.keys.remove")}
            </s-button>
          </Actions>
          {manage ? <More summary={t("settings.keys.replace")}>{form}</More> : null}
          {error}
          {/* Posted from the dialog's button: a form of its own, so removing posts too. */}
          <fetcher.Form method="post" ref={removeForm}>
            <input type="hidden" name="intent" value="remove-key" />
            <input type="hidden" name="engine" value={engine} />
          </fetcher.Form>
          <s-modal id={modal} heading={t("settings.keys.remove.heading", { engine: name })} accessibilityLabel={t("settings.keys.remove.heading", { engine: name })}>
            <s-paragraph>{t("settings.keys.remove.body", { engine: name })}</s-paragraph>
            <s-button slot="primary-action" variant="primary" tone="critical" commandFor={modal} command="--hide" onClick={() => removeForm.current?.requestSubmit()}>
              {t("settings.keys.remove.confirm")}
            </s-button>
            <s-button slot="secondary-actions" commandFor={modal} command="--hide">
              {t("common.action.cancel")}
            </s-button>
          </s-modal>
        </s-stack>
      </s-box>
    </li>
  );
}

/** Add or replace: the key (never with a value), Azure's region and data location, and its own button. */
function KeyForm({
  i18n,
  engine,
  saved,
  fetcher,
  primary,
  loading,
}: {
  i18n: I18n;
  engine: EngineId;
  saved: OwnKeySummary | null;
  fetcher: KeyFetcher;
  primary: boolean;
  loading: boolean;
}) {
  const { t } = i18n;
  const name = ENGINE_NAMES[engine];
  const location = saved?.dataLocation ?? "eu";
  const elsewhere = ELSEWHERE[engine];
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="save-key" />
      <input type="hidden" name="engine" value={engine} />
      <s-stack direction="block" gap="base">
        <s-password-field name="apiKey" label={t("settings.keys.field.key", { engine: name })} details={t(HELP[engine])} autocomplete="off" required />
        {engine === "azure" ? (
          <>
            <s-choice-list name="location" label={t("settings.keys.field.location")}>
              {(["eu", "global"] as const).map((value) => (
                <s-choice key={value} value={value} defaultSelected={value === location}>
                  {t(FIELD_LOCATION[value])}
                </s-choice>
              ))}
            </s-choice-list>
            <s-text-field name="region" label={t("settings.keys.field.region")} details={t("settings.keys.field.region.help")} autocomplete="off" />
          </>
        ) : null}
        {engine === "google" ? <StateLine icon="globe">{t("settings.keys.google.global")}</StateLine> : null}
        {elsewhere ? <s-text color="subdued">{t(elsewhere)}</s-text> : null}
        <s-stack direction="inline">
          <s-button type="submit" variant={primary ? "primary" : "secondary"} {...(loading ? { loading: true } : {})}>
            {t("settings.keys.save")}
          </s-button>
        </s-stack>
      </s-stack>
    </fetcher.Form>
  );
}
