/**
 * The translation editor, shared by every kind it edits (products, collections, pages, blog posts,
 * blogs, and the content types under /app/content). The route supplies the loader and action
 * (.server/translation/resource-editor). From the top:
 *
 * - the way back to the area list the item is opened from ("‹ Produkte"), the item's picture (or
 *   its area's icon), its name and how much is open in the language;
 * - the page's banners (leave without publishing, the AI permission, results and errors);
 * - one square tile per text with its state, each moving to its text;
 * - the toolbar: AI and the translation memory fill only the open texts (missing or outdated), the
 *   count in their buttons; "Translate everything again" asks first;
 * - every text in Review's order (name, description, Google texts, other texts, web address last),
 *   its state beside its name, its HTML shown rendered with "Edit HTML";
 * - the image descriptions and extra details, and one "Publish translations" (also the admin's save
 *   bar) for all of it: their typed and AI texts count as unpublished too.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Form, useBlocker, useFetcher, useLoaderData } from "react-router";
import type { loadEditorData, runEditorAction } from "../.server/translation/resource-editor";

import { showToast, useResultToast, useSaveBar } from "./app-bridge";
import { AttachedResourcesPanel } from "./AttachedResourcesPanel";
import { categoryName } from "./CategoryCard";
import { CountChip, HeadingRow, NoteBadges, StateBadge, TextTiles, textName, textStateLabel, type TextTile } from "./EditorParts";
import { HtmlPreview, previewHeight } from "./HtmlPreview";
import { IconSquare } from "./IconSquare";
import { Breadcrumbs } from "./LanguageLayout";
import { Actions, InlineNotice, StateLine } from "./SettingsParts";
import { StructuredEditor, StructuredView } from "./StructuredValue";
import { SeoCounter, SeoPreview } from "./SeoPanel";
import { Disclosure } from "./Disclosure";
import { Button } from "./Button";
import { isSeoKey } from "../lib/seo";
import { isDeepLOnly, orderTexts as engineOrderTexts, processorsText } from "../lib/engine-texts";
import { ENGINE_NAMES, isEngineId } from "../lib/engines";
import { parseOwnKeyCode } from "../lib/own-keys";
import { isStructuredValueType } from "../lib/structured-preview";
import { MAX_HANDLE_LENGTH, suggestHandle, validateHandle } from "../lib/handles";
import { editorArea, googlePreviewIndex, openForAi, orderTexts, pickDrafts, storefrontSegment, textCounts, textState } from "../lib/editor-view";
import { CATEGORIES, categoryPath, categoryOf, EXTRAS, languagePath } from "../lib/language-categories";
import type { IconName } from "../lib/icons";
import { upperFirst } from "../lib/name-lists";
import { useI18n } from "../i18n/react";
import type { I18n } from "../i18n/i18n";
import { hasMessage, jobErrorMessage, kindLabel, kindSingular } from "../i18n/labels";

type EditorLoader = () => ReturnType<typeof loadEditorData>;
type EditorAction = () => ReturnType<typeof runEditorAction>;
type EditorData = ReturnType<typeof useLoaderData<EditorLoader>>;

/** Text for an AI or memory error code (editor.aiError.*); an own key's quota or refusal names its engine. */
function aiErrorMessage(i18n: I18n, code: string, engine?: string | null) {
  const key = `editor.aiError.${code}`;
  if (!hasMessage(key)) return i18n.t("editor.aiError.generic");
  return i18n.t(key, engine && isEngineId(engine) ? { engine: ENGINE_NAMES[engine] } : {});
}

/** The own key's codes send the merchant to Settings › Your translation keys. */
const isOwnKeyError = (code: string) => code === "OWN_KEY_MISSING" || code === "OWN_KEY_QUOTA" || code === "OWN_KEY_AUTH";
/** What a plan doesn't include: the plans are one link away. */
const isPlanError = (code: string) => code === "PLAN_LANGUAGE" || code === "QUOTA_EXCEEDED";

/** Text for why an AI result was discarded (editor.rejection.*). */
function rejectionMessage(i18n: I18n, reason: string) {
  const key = `editor.rejection.${reason}`;
  return hasMessage(key) ? i18n.t(key) : i18n.t("editor.field.discarded");
}

/** Text for a field that wasn't saved: a known code in the language, else the server's message. */
function saveErrorMessage(i18n: I18n, outcome: { message?: string; code?: string }) {
  const key = `editor.handle.problem.${outcome.code ?? ""}`;
  if (outcome.code && hasMessage(key)) return i18n.t(key, { max: MAX_HANDLE_LENGTH });
  const saveKey = `editor.saveError.${outcome.code ?? ""}`;
  if (outcome.code && hasMessage(saveKey)) return i18n.t(saveKey, { detail: outcome.message ?? "" });
  return outcome.message ?? i18n.t("editor.field.notSaved");
}

const EDITOR_SAVE_BAR = "linguva-editor-save-bar";
/** More texts than this (or texts in pages): no tiles, the search (and paging) find a text. */
const MAX_TILES = 12;
/** The attached section's heading row (its tile jumps there). */
const ATTACHED_ID = "editor-attached";

/** A text's heading row: its tile moves focus to `<id>-heading`. */
const textId = (key: string) => `editor-text-${key}`;

/** Why an own-key shop can't translate with AI here: every saved key refused, else no key yet. */
function ownKeyHint(i18n: I18n, unavailable: string | null): string {
  const own = parseOwnKeyCode(unavailable);
  if (own?.kind === "AUTH") return i18n.t("editor.aiError.OWN_KEY_AUTH", { engine: ENGINE_NAMES[own.engine] });
  return i18n.t("editor.aiError.OWN_KEY_MISSING");
}

/** The area's icon (the area list's), for an item without a picture. */
function areaIcon(kind: string): IconName {
  const area = categoryOf(kind);
  if (!area) return "text-block";
  return area === "theme" || area === "notifications" ? EXTRAS[area].icon : CATEGORIES[area].icon;
}

/**
 * Where "back" leads: the area list the item is opened from (Produkte auf Deutsch), else (the theme's
 * texts, notifications) its list under Content. `label`: the admin's breadcrumb, the parent page's title.
 */
function backTarget(data: EditorData, i18n: I18n, language: string) {
  const { t } = i18n;
  const locale = data.target.locale;
  const area = editorArea(data.kind.type);
  if (area) {
    const name = categoryName(i18n, area);
    return {
      href: categoryPath(locale, area),
      label: t("language.list.heading", { category: name, language }),
      trail: [
        { href: languagePath(locale), label: upperFirst(language) },
        { href: categoryPath(locale, area), label: name },
      ],
    };
  }
  const partKey = `content.part.${data.kind.type}.name`;
  const name = hasMessage(partKey) ? t(partKey) : kindLabel(i18n, data.kind.type);
  const href = `${data.kind.path}?lang=${encodeURIComponent(locale)}`;
  return {
    href,
    label: name,
    trail: [
      { href: `/app/content?lang=${encodeURIComponent(locale)}`, label: t("common.nav.content") },
      { href, label: name },
    ],
  };
}

/** One request at a time for AI: all open texts, the Google texts only, or every text again. */
type AiRun = "open" | "google" | "again";

/** A press of "Publish translations": which forms it sent, and their answers before it (to know when both are in). */
interface PublishRound {
  id: number;
  main: boolean;
  attached: boolean;
  mainBefore: unknown;
  attachedBefore: unknown;
}

export function ResourceTranslationEditor() {
  const data = useLoaderData<EditorLoader>();
  const i18n = useI18n();
  const sourceName = i18n.language(data.sourceLocale, data.sourceName);
  const targetName = i18n.language(data.target.locale, data.target.name);
  const { t } = i18n;
  const kind = data.kind.type;
  const singular = kindSingular(i18n, kind);
  const aiFetcher = useFetcher<EditorAction>();
  const saveFetcher = useFetcher<EditorAction>();
  const consentFetcher = useFetcher<EditorAction>();
  const smartFetcher = useFetcher<EditorAction>();
  const memoryFetcher = useFetcher<EditorAction>();
  const restoreFetcher = useFetcher<EditorAction>();
  const removeFetcher = useFetcher<EditorAction>();
  const attachedAiFetcher = useFetcher<EditorAction>();
  const attachedSaveFetcher = useFetcher<EditorAction>();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const removed = removeFetcher.data?.kind === "removed" ? removeFetcher.data : null;
  const [filledFrom, setFilledFrom] = useState<"ai" | "memory">("ai");
  const [aiRun, setAiRun] = useState<AiRun>("open");
  const [askAgain, setAskAgain] = useState(false);
  // HTML texts show rendered; "Edit HTML" opens the code with a live preview.
  const [htmlOpen, setHtmlOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleHtml = (key: string) => {
    const opening = !htmlOpen.has(key);
    setHtmlOpen((v) => {
      const next = new Set(v);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    if (!opening) return;
    // Into the code it opened (the Polaris field may need a frame or two before it takes focus).
    let tries = 0;
    const focusCode = () => {
      const area = document.querySelector<HTMLElement>(`s-text-area[name="${CSS.escape(`value:${key}`)}"]`);
      area?.focus();
      if ((!area || !(document.activeElement === area || area.contains(document.activeElement))) && tries++ < 30) requestAnimationFrame(focusCode);
    };
    requestAnimationFrame(focusCode);
  };

  // The memory fills the texts that were open when it was asked, never a translation the merchant has.
  const [memoryKeys, setMemoryKeys] = useState<ReadonlySet<string>>(new Set());
  const memoryData = memoryFetcher.data?.kind === "ai" ? memoryFetcher.data : null;
  const memoryResult = useMemo(() => (memoryData ? pickDrafts(memoryData, memoryKeys) : null), [memoryData, memoryKeys]);
  // The latest of AI translation or memory suggestions fills the form.
  const aiResult = aiFetcher.data?.kind === "ai" ? aiFetcher.data : null;
  // "Discard" in the save bar drops the drafts shown and what was typed.
  const [discarded, setDiscarded] = useState<unknown>(null);
  const [resetCount, setResetCount] = useState(0);
  const filled = filledFrom === "memory" ? memoryResult : aiResult;
  const ai = filled && filled !== discarded ? filled : null;
  const restored = restoreFetcher.data?.kind === "restored" ? restoreFetcher.data.status : null;
  // Errors of the action that ran last (AI translation or memory suggestions).
  const lastData = filledFrom === "memory" ? memoryFetcher.data : aiFetcher.data;
  const actionError = lastData?.kind === "error" ? lastData : null;
  // A language only an engine the shop hasn't allowed serves: that engine, by name (only for that
  // code: an own key's quota or refusal names its engine too).
  const consentEngine =
    actionError && actionError.code === "ENGINE_CONSENT" && "engine" in actionError && typeof actionError.engine === "string" && isEngineId(actionError.engine) ? actionError.engine : null;
  const saved = saveFetcher.data?.kind === "saved" ? saveFetcher.data.outcomes : null;
  const saveStatus = new Map(saved?.map((o) => [o.key, o]) ?? []);
  const translating = aiFetcher.state !== "idle" || attachedAiFetcher.state !== "idle";
  const saving = saveFetcher.state !== "idle" || attachedSaveFetcher.state !== "idle";
  const ordered = orderTexts(data.fields);
  const seoFields = ordered.filter((f) => isSeoKey(f.key));
  const canAi = data.ai.available && data.ai.consent;

  // What the merchant has typed, for live SEO checks and the preview. It
  // belongs to the drafts it was typed over, so new drafts start fresh.
  const [typedState, setTyped] = useState<{ base: unknown; values: Record<string, string> }>({ base: null, values: {} });
  const typed = typedState.base === ai ? typedState.values : {};
  const fieldByKey = new Map(data.fields.map((f) => [f.key, f]));
  const currentValue = (key: string) => typed[key] ?? ai?.drafts[key] ?? fieldByKey.get(key)?.translation ?? "";
  // Right-to-left languages are typed right to left. URL handles stay left to
  // right; HTML follows its first letter (usually a tag, so left to right).
  const textDirection = (field: { key: string; type: string }): { dir?: "rtl" | "auto" } =>
    !data.target.rtl || field.key === "handle" ? {} : { dir: field.type === "HTML" ? "auto" : "rtl" };
  const onFormInput = (event: { target: EventTarget | null }) => {
    const el = event.target as (Element & { value?: string }) | null;
    const name = el?.getAttribute?.("name");
    if (name?.startsWith("value:") && typeof el?.value === "string") {
      const key = name.slice("value:".length);
      setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), [key]: el.value! } }));
    }
  };

  // The image descriptions and extra details: their drafts and typed texts, published with the rest.
  const attachedAiData = attachedAiFetcher.data?.kind === "attached-ai" ? attachedAiFetcher.data : null;
  const attachedAiError = attachedAiFetcher.data?.kind === "error" ? attachedAiFetcher.data : null;
  const [attachedDiscarded, setAttachedDiscarded] = useState<unknown>(null);
  const attachedAi = attachedAiData && attachedAiData !== attachedDiscarded ? attachedAiData : null;
  const attachedSaved = attachedSaveFetcher.data?.kind === "attached-saved" ? attachedSaveFetcher.data.outcomes : null;
  const [attachedTypedState, setAttachedTyped] = useState<{ base: unknown; values: Record<string, string> }>({ base: null, values: {} });
  const attachedTyped = attachedTypedState.base === attachedAi ? attachedTypedState.values : {};
  const attachedTexts = data.attached.items.flatMap((item) => item.fields.map((field) => ({ ...field, ref: `${item.id}:${field.key}` })));
  const attachedByRef = new Map(attachedTexts.map((f) => [f.ref, f]));
  const attachedValue = (ref: string) => attachedTyped[ref] ?? attachedAi?.drafts[ref] ?? attachedByRef.get(ref)?.translation ?? "";
  const setAttachedValue = (ref: string, value: string) =>
    setAttachedTyped((s) => ({ base: attachedAi, values: { ...(s.base === attachedAi ? s.values : {}), [ref]: value } }));

  // Typed text or drafts that differ from what is published would be lost
  // by leaving the page: ask first (in-app navigation and reloads).
  const mainChanged = [...new Set([...Object.keys(typed), ...Object.keys(ai?.drafts ?? {})])].some(
    (key) => currentValue(key) !== (fieldByKey.get(key)?.translation ?? ""),
  );
  const attachedChanged = [...new Set([...Object.keys(attachedTyped), ...Object.keys(attachedAi?.drafts ?? {})])].some(
    (ref) => attachedValue(ref) !== (attachedByRef.get(ref)?.translation ?? ""),
  );
  const unpublished = !saving && (mainChanged || attachedChanged);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unpublished && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    window.scrollTo({ top: 0 });
    // The Polaris button may not be ready to take focus in the first frame: retry briefly.
    let frame = 0;
    let tries = 0;
    const focusStay = () => {
      const stay = document.getElementById("editor-stay");
      stay?.focus();
      if (document.activeElement !== stay && tries++ < 30) frame = requestAnimationFrame(focusStay);
    };
    focusStay();
    return () => cancelAnimationFrame(frame);
  }, [blocker.state]);
  // The admin's save bar while there is something to publish (Publish / Discard).
  const saveFormRef = useRef<HTMLFormElement>(null);
  const attachedFormRef = useRef<HTMLFormElement>(null);
  useSaveBar(EDITOR_SAVE_BAR, unpublished);
  const discard = () => {
    setDiscarded(filled);
    setTyped({ base: null, values: {} });
    setAttachedDiscarded(attachedAiData);
    setAttachedTyped({ base: null, values: {} });
    setResetCount((n) => n + 1);
  };

  // One "Publish translations" for the page: the item's texts and, when changed, its image
  // descriptions and extra details (two requests); one toast once both are in.
  const [round, setRound] = useState<PublishRound | null>(null);
  const publish = () => {
    const attached = attachedChanged;
    const main = mainChanged || !attached;
    setRound((r) => ({ id: (r?.id ?? 0) + 1, main, attached, mainBefore: saveFetcher.data, attachedBefore: attachedSaveFetcher.data }));
    if (main) saveFormRef.current?.requestSubmit();
    if (attached) attachedFormRef.current?.requestSubmit();
  };
  const toastRound = useRef(0);
  useEffect(() => {
    if (!round || toastRound.current === round.id || saving) return;
    const mainIn = !round.main || saveFetcher.data !== round.mainBefore;
    const attachedIn = !round.attached || attachedSaveFetcher.data !== round.attachedBefore;
    if (!mainIn || !attachedIn) return;
    toastRound.current = round.id;
    // Success is confirmed with a toast; problems stay on the page, beside their texts.
    const outcomes = [
      ...(round.main && saveFetcher.data?.kind === "saved" ? saveFetcher.data.outcomes : []),
      ...(round.attached && attachedSaveFetcher.data?.kind === "attached-saved" ? attachedSaveFetcher.data.outcomes : []),
    ];
    if (outcomes.every((o) => o.status === "saved")) showToast(outcomes.length ? t("editor.saved.toast", { count: outcomes.length }) : t("editor.saved.nothingHeading"));
  });
  useEffect(() => {
    if (!unpublished) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unpublished]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ lang: data.target.locale, page: String(page) });
    if (data.paging?.query) params.set("q", data.paging.query);
    return `?${params.toString()}`;
  };
  // Own key plan: no Linguva allowance (limit null), so no "left" figure.
  const limit = data.ai.limit;
  const remaining = limit === null || data.ai.dailyLimit === null ? null : Math.max(0, Math.min(limit - data.ai.used, data.ai.dailyLimit - data.ai.usedToday));
  // Smart Auto-Translate (Business): left out of automatic translation, as just chosen or as stored.
  const smartResult = smartFetcher.data?.kind === "smart" ? smartFetcher.data : null;
  const smartError = smartFetcher.data?.kind === "error" ? smartFetcher.data : null;
  const smartExcluded = smartFetcher.formData ? smartFetcher.formData.get("intent") === "smart-exclude" : (smartResult?.excluded ?? data.smart?.excluded ?? false);
  useResultToast(smartResult, smartResult ? (smartResult.excluded ? t("editor.smart.excluded") : t("editor.smart.included")) : null);

  // What AI and the memory work on: the open texts (missing or outdated); translations stay.
  const openKeys = openForAi(data.fields).map((f) => f.key);
  const openGoogle = openKeys.filter(isSeoKey);
  const openAttached = openForAi(attachedTexts).length;
  const aiCount = openKeys.length + openAttached;
  const machineKeys = data.fields.filter((f) => f.machine).map((f) => f.key);
  const translate = (run: AiRun, keys: readonly string[], attachedToo: boolean) => {
    setFilledFrom("ai");
    setAiRun(run);
    if (keys.length) {
      const form = new FormData();
      form.set("intent", "ai-translate");
      for (const key of keys) form.append("key", key);
      aiFetcher.submit(form, { method: "post" });
    }
    if (attachedToo) attachedAiFetcher.submit({ intent: "ai-translate-attached" }, { method: "post" });
  };
  const fillFromMemory = () => {
    setMemoryKeys(new Set(openKeys));
    setFilledFrom("memory");
    memoryFetcher.submit({ intent: "memory-suggest" }, { method: "post" });
  };
  // "Translate everything again" asks first; the question takes focus, and Cancel gives it back.
  useEffect(() => {
    if (askAgain) document.getElementById("editor-again-confirm")?.focus();
  }, [askAgain]);
  const closeAgain = () => {
    setAskAgain(false);
    requestAnimationFrame(() => document.getElementById("editor-again")?.focus());
  };

  const language = targetName;
  const back = backTarget(data, i18n, language);
  const counts = textCounts([...data.fields, ...attachedTexts]);
  const lead = data.paging
    ? t("editor.header.paged", { language, count: data.paging.total })
    : counts.total === 0
      ? t("editor.header.language", { language })
      : counts.open
        ? t("editor.header.open", { language, open: counts.open, count: counts.total })
        : t("editor.header.done", { language, count: counts.total });
  const picture = data.attached.items.find((item) => item.kind === "IMAGE" && item.previewUrl)?.previewUrl ?? null;
  const stateOf = (field: (typeof data.fields)[number]) => {
    const draft = ai?.drafts[field.key];
    return textState({
      current: currentValue(field.key),
      translation: field.translation,
      outdated: field.outdated,
      draft: draft === undefined ? null : { from: ai?.provider === "memory" ? "memory" : "ai", value: draft },
      published: saveStatus.get(field.key)?.status === "saved",
    });
  };
  const attachedOpen = textCounts(attachedTexts).open;
  // No tiles for paged texts, or for the theme's and notifications' texts (named by their keys).
  const tiles: TextTile[] =
    data.paging || ordered.length > MAX_TILES || !editorArea(kind)
      ? []
      : [
          ...ordered.map((field) => {
            const state = stateOf(field);
            return { target: textId(field.key), name: textName(i18n, field.key, kind), state, word: textStateLabel(i18n, state, ai?.scores?.[field.key]) } satisfies TextTile;
          }),
          // The image descriptions and extra details: one tile for their section, with what is open there.
          ...(data.attached.available && data.attached.items.length
            ? [
                {
                  target: ATTACHED_ID,
                  name: t("editor.attached.tile"),
                  state: attachedOpen ? "open" : "done",
                  word: attachedOpen ? t("editor.tiles.open", { count: attachedOpen }) : t("common.translationStatus.translated"),
                } satisfies TextTile,
              ]
            : []),
        ];
  const previewAt = data.seoPreview ? googlePreviewIndex(ordered) : -1;
  const aiFilled = ai && ai.provider !== "memory" ? ai : null;
  const attachedFilled = attachedAi && Object.keys(attachedAi.drafts).length ? attachedAi : null;

  const charsLine =
    data.ai.ownKey && !data.ai.available ? null : data.ai.ownKey
      ? t("editor.ai.ownKey", { chars: data.ai.ownKey.chars })
      : data.ai.available
        ? limit === null || remaining === null
          ? null
          : remaining === Math.max(0, limit - data.ai.used)
            ? t("editor.toolbar.leftThisMonth", { remaining, limit })
            : t("editor.toolbar.leftToday", { remaining, monthRemaining: Math.max(0, limit - data.ai.used), limit })
        : t("editor.toolbar.notConfigured");

  const googleSection = data.seoPreview ? (
    <s-section key="editor-google" accessibilityLabel={t("editor.seo.heading")}>
      <s-stack direction="block" gap="base">
        <HeadingRow id="editor-google" title={t("editor.seo.heading")} icon="search" />
        <s-paragraph>{t("editor.seo.intro", { title: data.title, language: targetName })}</s-paragraph>
        <SeoPreview
          value={currentValue}
          source={(k) => fieldByKey.get(k)?.source ?? ""}
          hasField={(k) => fieldByKey.has(k)}
          shopDomain={data.shopDomain}
          locale={data.target.locale}
          pathSegment={storefrontSegment(kind, data.kind.plural)}
        />
        {seoFields.length === 0 ? <s-paragraph>{t("editor.seo.noFields", { singular })}</s-paragraph> : null}
      </s-stack>
    </s-section>
  ) : null;

  return (
    <s-page heading={data.title}>
      <s-link slot="breadcrumb-actions" href={back.href}>
        {back.label}
      </s-link>

      <s-query-container>
        <s-stack direction="block" gap="small-200">
          <Breadcrumbs i18n={i18n} trail={back.trail} current={data.title} touch />
          <div className="lv-ed-header">
            {picture ? (
              <span className="lv-ed-picture">
                {/* The name is written beside it. */}
                <img src={`${picture}${picture.includes("?") ? "&" : "?"}width=96`} alt="" />
              </span>
            ) : (
              <IconSquare icon={areaIcon(kind)} size={48} />
            )}
            <div className="lv-ed-header__text">
              <h1 className="lv-h1 lv-ed-header__name">{data.title}</h1>
              <s-text color="subdued">{lead}</s-text>
            </div>
          </div>
        </s-stack>
      </s-query-container>

      {blocker.state === "blocked" ? (
        <s-banner tone="warning" heading={t("editor.leave.heading")}>
          <s-paragraph>{t("editor.leave.body")}</s-paragraph>
          <s-stack direction="inline" gap="base">
            <Button id="editor-stay" variant="primary" onClick={() => blocker.reset()}>
              {t("editor.leave.stay")}
            </Button>
            <Button tone="critical" onClick={() => blocker.proceed()}>
              {t("editor.leave.leave")}
            </Button>
          </s-stack>
        </s-banner>
      ) : null}

      {data.ai.available && !data.ai.consent ? (
        <s-banner tone="info" heading={t("editor.consent.heading")}>
          <s-paragraph>
            {/* Own key plan: the merchant's own keys, under its own contract with the services. */}
            {data.ai.ownKey
              ? t("editor.consent.body.ownKey", { singular, processors: processorsText(i18n, data.ai.consentTokens) })
              : isDeepLOnly(data.ai.consentTokens)
                ? t("editor.consent.body", { singular })
                : t("editor.consent.body.multi", { singular, processors: processorsText(i18n, data.ai.consentTokens) })}
            {/* Several services: their order and the failover, as in Settings (the same consent version). */}
            {data.ai.consentTokens.length > 1 ? ` ${t("editor.consent.order", engineOrderTexts(i18n, data.ai.consentTokens))}` : null}
          </s-paragraph>
          {/* The page showed an older list of services: nothing was stored, the list above is the current one. */}
          {consentFetcher.data?.kind === "error" && consentFetcher.data.code === "CONSENT_CHANGED" ? (
            <s-paragraph>{t("editor.aiError.CONSENT_CHANGED")}</s-paragraph>
          ) : null}
          <consentFetcher.Form method="post">
            <input type="hidden" name="intent" value="grant-consent" />
            <input type="hidden" name="consentTokens" value={data.ai.consentTokens.join(",")} />
            <Button type="submit" icon="shield-check-mark" {...(consentFetcher.state !== "idle" ? { loading: true } : {})}>
              {t("editor.consent.allow")}
            </Button>
          </consentFetcher.Form>
        </s-banner>
      ) : null}

      {removed ? (
        <s-banner
          tone={removed.status === "removed" ? "success" : "warning"}
          heading={removed.status === "removed" ? t("editor.removed.heading") : t("editor.removed.failedHeading")}
        >
          <s-paragraph>
            {removed.status === "removed" ? t("editor.removed.body") : t("editor.reloadAndRetry")}
          </s-paragraph>
        </s-banner>
      ) : null}

      {restored ? (
        <s-banner
          tone={restored === "restored" ? "success" : "warning"}
          heading={restored === "restored" ? t("editor.restored.heading") : t("editor.restored.failedHeading")}
        >
          <s-paragraph>
            {restored === "restored"
              ? t("editor.restored.body")
              : restored === "source_changed"
                ? t("editor.restored.sourceChanged")
                : t("editor.reloadAndRetry")}
          </s-paragraph>
        </s-banner>
      ) : null}

      {actionError ? (
        <s-banner
          tone={actionError.code.startsWith("RATE_LIMITED") ? "warning" : "critical"}
          heading={filledFrom === "memory" ? t("editor.aiError.memoryHeading") : t("editor.aiError.heading")}
        >
          <s-paragraph>
            {consentEngine
              ? t("editor.aiError.ENGINE_CONSENT.named", { engine: ENGINE_NAMES[consentEngine] })
              : aiErrorMessage(i18n, actionError.code, "engine" in actionError && typeof actionError.engine === "string" ? actionError.engine : null)}
            {"retryAfterSeconds" in actionError && actionError.retryAfterSeconds
              ? ` ${t("editor.aiError.retryAfter", { seconds: Number(actionError.retryAfterSeconds) })}`
              : ""}
            {actionError.code === "ENGINE_CONSENT" ? (
              <>
                {" "}
                <s-link href="/app/settings?section=ai">{t("common.nav.settings")}</s-link>
              </>
            ) : isOwnKeyError(actionError.code) ? (
              <>
                {" "}
                <s-link href="/app/settings?section=keys">{t("common.nav.settings")}</s-link>
              </>
            ) : isPlanError(actionError.code) ? (
              <>
                {" "}
                <s-link href="/app/plan">{t("common.action.seePlans")}</s-link>
              </>
            ) : null}
          </s-paragraph>
        </s-banner>
      ) : null}

      {saved && !saved.every((o) => o.status === "saved") ? (
        <s-banner tone="warning" heading={t("editor.saved.partialHeading")}>
          <s-paragraph>{t("editor.saved.partialBody")}</s-paragraph>
        </s-banner>
      ) : null}

      {data.caution === "legal" ? (
        <s-banner tone="warning" heading={t("editor.caution.legalHeading")}>
          <s-paragraph>{t("editor.caution.legalBody")}</s-paragraph>
        </s-banner>
      ) : null}
      {data.caution === "liquid" ? (
        <s-banner tone="warning" heading={t("editor.caution.liquidHeading")}>
          <s-paragraph>{t("editor.caution.liquidBody")}</s-paragraph>
        </s-banner>
      ) : null}

      {data.target.rtl ? (
        <s-banner tone="info" heading={t("editor.rtl.heading")}>
          <s-paragraph>{t("editor.rtl.body")}</s-paragraph>
        </s-banner>
      ) : null}

      {tiles.length > 1 ? <TextTiles label={t("editor.tiles.label")} tiles={tiles} /> : null}

      <s-section heading={`${sourceName} → ${targetName}`}>
        <s-stack direction="block" gap="base">
          {aiCount > 0 ? (
            <Actions wide={780}>
              <Button
                variant="primary"
                icon="wand"
                inlineSize="fill"
                accessibilityLabel={t("editor.toolbar.countLabel", { action: t("editor.toolbar.translateAi"), count: aiCount })}
                disabled={!canAi || (translating && aiRun !== "open")}
                {...(translating && aiRun === "open" ? { loading: true } : {})}
                onClick={() => translate("open", openKeys, openAttached > 0)}
              >
                {t("editor.toolbar.translateAi")}
                <CountChip count={aiCount} />
              </Button>
              {openGoogle.length && openGoogle.length < aiCount ? (
                <Button
                  icon="search"
                  inlineSize="fill"
                  accessibilityLabel={t("editor.toolbar.countLabel", { action: t("editor.toolbar.translateSeo"), count: openGoogle.length })}
                  disabled={!canAi || (translating && aiRun !== "google")}
                  {...(translating && aiRun === "google" ? { loading: true } : {})}
                  onClick={() => translate("google", openGoogle, false)}
                >
                  {t("editor.toolbar.translateSeo")}
                  <CountChip count={openGoogle.length} />
                </Button>
              ) : null}
              {openKeys.length ? (
                <Button
                  icon="database"
                  inlineSize="fill"
                  accessibilityLabel={t("editor.toolbar.countLabel", { action: t("editor.toolbar.fillMemory"), count: openKeys.length })}
                  {...(memoryFetcher.state !== "idle" ? { loading: true } : {})}
                  onClick={fillFromMemory}
                >
                  {t("editor.toolbar.fillMemory")}
                  <CountChip count={openKeys.length} />
                </Button>
              ) : null}
            </Actions>
          ) : null}
          <s-text color="subdued">{aiCount ? t("editor.toolbar.open", { count: aiCount }) : t("editor.toolbar.allDone")}</s-text>
          {aiCount === 0 && machineKeys.length && !askAgain ? (
            <s-stack direction="inline">
              <Button
                id="editor-again"
                variant="tertiary"
                icon="wand"
                disabled={!canAi}
                {...(translating && aiRun === "again" ? { loading: true } : {})}
                onClick={() => setAskAgain(true)}
              >
                {t("editor.toolbar.again")}
              </Button>
            </s-stack>
          ) : null}
          {askAgain ? (
            <InlineNotice
              icon="wand"
              heading={t("editor.again.heading")}
              actions={
                <>
                  <Button
                    id="editor-again-confirm"
                    variant="primary"
                    onClick={() => {
                      setAskAgain(false);
                      translate("again", machineKeys, false);
                    }}
                  >
                    {t("editor.again.confirm")}
                  </Button>
                  <Button onClick={closeAgain}>{t("common.action.cancel")}</Button>
                </>
              }
            >
              {t("editor.again.body", { count: machineKeys.length })}
            </InlineNotice>
          ) : null}
          {data.ai.ownKey && !data.ai.available ? (
            // Own key plan without a usable key: what is missing, and where to add it.
            <StateLine icon="key">
              {ownKeyHint(i18n, data.ai.ownKey.unavailable)} <s-link href="/app/settings?section=keys">{t("common.nav.settings")}</s-link>
            </StateLine>
          ) : charsLine ? (
            <StateLine icon="gauge">{charsLine}</StateLine>
          ) : null}
          {data.smart ? (
            <s-checkbox
              label={t("editor.smart.exclude")}
              details={t("editor.smart.excludeDetails")}
              {...(smartExcluded ? { checked: true } : {})}
              {...(smartFetcher.state !== "idle" ? { disabled: true } : {})}
              // React 18 sends no onChange for a web component; its input event comes through.
              onInput={(e) => smartFetcher.submit({ intent: e.currentTarget.checked ? "smart-exclude" : "smart-include" }, { method: "post" })}
            />
          ) : null}
          {smartError ? (
            <s-banner tone="critical">
              <s-paragraph>{jobErrorMessage(i18n, smartError.code) ?? t("editor.aiError.generic")}</s-paragraph>
            </s-banner>
          ) : null}
          {ai?.provider === "memory" ? (
            <s-paragraph>{Object.keys(ai.drafts).length ? t("editor.fill.memory") : t("editor.fill.memoryNone")}</s-paragraph>
          ) : aiFilled || attachedFilled ? (
            <s-paragraph>{aiFilled?.memoryHits ? t("editor.fill.aiWithMemory", { count: aiFilled.memoryHits }) : t("editor.fill.ai")}</s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {data.paging ? (
        <s-section heading={t("editor.paging.texts", { count: data.paging.total })}>
          <s-stack direction="block" gap="small">
            <Form method="get">
              <input type="hidden" name="lang" value={data.target.locale} />
              <s-stack direction="inline" gap="small" alignItems="end">
                <s-search-field name="q" label={t("editor.paging.findLabel")} placeholder={t("editor.paging.findPlaceholder")} value={data.paging.query} />
                <Button type="submit">{t("common.action.search")}</Button>
              </s-stack>
            </Form>
            <s-text color="subdued">
              {data.paging.matching === 0
                ? t("editor.paging.noMatch")
                : t(data.paging.query ? "editor.paging.showingMatching" : "editor.paging.showing", {
                    from: (data.paging.page - 1) * data.paging.pageSize + 1,
                    to: Math.min(data.paging.page * data.paging.pageSize, data.paging.matching),
                    total: data.paging.matching,
                  })}
            </s-text>
            <s-stack direction="inline" gap="small">
              {data.paging.page > 1 ? (
                <Button icon="chevron-left" href={pageHref(data.paging.page - 1)}>
                  {t("common.action.previous")}
                </Button>
              ) : null}
              {data.paging.page < data.paging.pages ? (
                <Button icon="chevron-right" href={pageHref(data.paging.page + 1)}>
                  {t("common.action.next")}
                </Button>
              ) : null}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <ui-save-bar id={EDITOR_SAVE_BAR}>
        <button variant="primary" onClick={publish} {...(saving ? { loading: "" } : {})}>
          {t("editor.publish")}
        </button>
        <button onClick={discard}>{t("editor.discard")}</button>
      </ui-save-bar>

      <saveFetcher.Form ref={saveFormRef} method="post" onInput={onFormInput} onChange={onFormInput}>
        <input type="hidden" name="intent" value="save" />
        {ai ? <input type="hidden" name="provider" value={ai.provider} /> : null}
        {/* Each draft's own engine (the server reads it before the form-wide one). */}
        {ai ? Object.keys(ai.drafts).map((key) => <input key={key} type="hidden" name={`provider:${key}`} value={ai.provider} />) : null}
        {ordered.map((field, index) => (
          <Fragment key={field.key}>
            {index === previewAt ? googleSection : null}
            {renderField(field)}
          </Fragment>
        ))}
        {previewAt === ordered.length ? googleSection : null}
      </saveFetcher.Form>

      <AttachedResourcesPanel
        id={ATTACHED_ID}
        data={data}
        errorMessage={(code, engine) => aiErrorMessage(i18n, code, engine)}
        ai={attachedAi}
        // The same stop for both requests (the plan, a rate limit) is said once, at the top.
        aiError={attachedAiError && !(actionError && actionError.code === attachedAiError.code) ? attachedAiError : null}
        saved={attachedSaved}
        save={attachedSaveFetcher}
        formRef={attachedFormRef}
        resetCount={resetCount}
        value={attachedValue}
        onValue={setAttachedValue}
      />

      <s-stack direction="inline" gap="base">
        <Button variant="primary" onClick={publish} {...(saving ? { loading: true } : {})}>
          {t("editor.publish")}
        </Button>
      </s-stack>
    </s-page>
  );

  function renderField(field: (typeof data.fields)[number]) {
    const draft = ai?.drafts[field.key];
    const value = draft ?? field.translation;
    const status = saveStatus.get(field.key);
    const rejected = ai?.rejected[field.key];
    const warnings = ai?.warnings[field.key];
    const html = field.sourcePreview !== null;
    const editingHtml = html && htmlOpen.has(field.key);
    const multiline = field.type === "HTML" || field.type === "MULTI_LINE_TEXT_FIELD" || field.source.length > 120;
    // Rich text, lists and links (e.g. metaobject fields): shown readably, never as JSON.
    const structured = isStructuredValueType(field.type);
    const label = textName(i18n, field.key, kind);
    const error =
      status?.status === "conflict"
        ? "reason" in status && status.reason === "TRANSLATION_CHANGED"
          ? t("editor.field.translationChanged")
          : t("editor.field.conflict")
        : status?.status === "error"
          ? saveErrorMessage(i18n, status)
          : rejected
            ? rejectionMessage(i18n, rejected)
            : undefined;
    const removable = Boolean(field.translation) && !(removed?.status === "removed" && removed.key === field.key);
    // One height for an original and its rendered translation side by side.
    const frameHeight = html ? Math.max(previewHeight(field.sourcePreview ?? ""), previewHeight(currentValue(field.key))) : 0;
    const originalTitle = t("editor.field.originalFrame", { field: label, language: sourceName });
    const previewTitle = t("editor.field.previewFrame", { field: label, language: targetName });
    const remove = removable ? (
      confirmRemove === field.key ? (
        <Button
          variant="tertiary"
          tone="critical"
          icon="delete"
          onClick={() => {
            setConfirmRemove(null);
            removeFetcher.submit({ intent: "remove", key: field.key }, { method: "post" });
          }}
        >
          {t("editor.remove.confirm")}
        </Button>
      ) : (
        <Button
          variant="tertiary"
          icon="delete"
          tooltip={t("editor.remove.button")}
          accessibilityLabel={t("editor.remove.label", { field: label })}
          onClick={() => setConfirmRemove(field.key)}
        />
      )
    ) : null;

    return (
      <s-section key={field.key} accessibilityLabel={label}>
        <input type="hidden" name={`digest:${field.key}`} value={field.digest} />
        <input type="hidden" name={`current:${field.key}`} value={field.currentDigest} />
        {draft !== undefined ? <input type="hidden" name={`origin:${field.key}`} value="AI" /> : null}
        <s-stack direction="block" gap="base">
          {/* The text's name and its state first, where the eye lands; its one action at the end of the row. */}
          <HeadingRow id={textId(field.key)} title={label} end={remove}>
            <StateBadge i18n={i18n} state={stateOf(field)} score={ai?.scores?.[field.key]} />
            <NoteBadges i18n={i18n} warnings={warnings} machine={field.machine} />
          </HeadingRow>
          <s-query-container>
            <s-grid gridTemplateColumns="@container (inline-size > 640px) 1fr 1fr, 1fr" gap="base">
              <s-stack direction="block" gap="small">
                <s-text color="subdued">{t("editor.field.original", { language: sourceName })}</s-text>
                {structured ? (
                  <StructuredView type={field.type} value={field.source} title={originalTitle} lang={data.sourceLocale} tone="subdued" />
                ) : html && !editingHtml ? (
                  <HtmlPreview html={field.sourcePreview ?? ""} title={originalTitle} lang={data.sourceLocale} tone="subdued" textBox height={frameHeight} />
                ) : html ? (
                  // While its translation's HTML is edited, the original's HTML beside it.
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <pre className="lv-ed-code" lang={data.sourceLocale}>
                      {field.source}
                    </pre>
                  </s-box>
                ) : (
                  <s-box padding="base" background="subdued" borderRadius="base">
                    <s-paragraph>{field.source}</s-paragraph>
                  </s-box>
                )}
              </s-stack>
              <s-stack direction="block" gap="small">
                {structured ? (
                  <StructuredEditor
                    key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                    type={field.type}
                    source={field.source}
                    value={value}
                    name={`value:${field.key}`}
                    language={targetName}
                    title={previewTitle}
                    locale={data.target.locale}
                    rtl={data.target.rtl}
                    {...(error ? { error } : {})}
                    onValue={(next) => setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), [field.key]: next } }))}
                  />
                ) : html && !editingHtml ? (
                  <>
                    <s-text color="subdued">{targetName}</s-text>
                    {/* The text goes with the form as it is shown (typed, drafted or published). */}
                    <input type="hidden" name={`value:${field.key}`} value={currentValue(field.key)} />
                    <HtmlPreview html={currentValue(field.key)} title={previewTitle} lang={data.target.locale} dir={data.target.rtl ? "rtl" : "auto"} textBox height={frameHeight} />
                    {error ? <s-text tone="critical">{error}</s-text> : null}
                  </>
                ) : (
                  <div lang={data.target.locale} {...textDirection(field)}>
                    {multiline ? (
                      <s-text-area
                        key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                        name={`value:${field.key}`}
                        label={targetName}
                        value={html ? currentValue(field.key) : value}
                        rows={html ? 8 : 3}
                        {...(error ? { error } : {})}
                        {...(html ? { details: t("editor.field.htmlDetails") } : {})}
                      />
                    ) : (
                      <s-text-field
                        key={`${field.key}:${draft ?? "base"}:${resetCount}`}
                        name={`value:${field.key}`}
                        label={targetName}
                        value={field.key === "handle" ? currentValue("handle") : value}
                        {...(error ? { error } : {})}
                        {...(field.key === "handle" ? { details: t("editor.field.handleDetails") } : {})}
                      />
                    )}
                  </div>
                )}
                {editingHtml ? (
                  // What the merchant types, rendered live (sandboxed, nothing in it can run).
                  <HtmlPreview html={currentValue(field.key)} title={previewTitle} lang={data.target.locale} dir={data.target.rtl ? "rtl" : "auto"} textBox />
                ) : null}
                {html ? (
                  <s-stack direction="inline">
                    <Button variant="tertiary" icon="code" onClick={() => toggleHtml(field.key)}>
                      {editingHtml ? t("editor.field.hideHtml") : t("editor.field.editHtml")}
                    </Button>
                  </s-stack>
                ) : null}
                {field.key === "handle" ? (
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline">
                      <Button
                        variant="tertiary"
                        icon="lightbulb"
                        onClick={() => {
                          const title = currentValue("title") || fieldByKey.get("title")?.source || "";
                          const suggestion = suggestHandle(title, data.target.locale);
                          if (suggestion) setTyped((t) => ({ base: ai, values: { ...(t.base === ai ? t.values : {}), handle: suggestion } }));
                        }}
                      >
                        {t("editor.handle.suggest")}
                      </Button>
                    </s-stack>
                    {currentValue("handle") && validateHandle(currentValue("handle")) ? (
                      <s-text tone="critical">{t(`editor.handle.problem.${validateHandle(currentValue("handle"))!}`, { max: MAX_HANDLE_LENGTH })}</s-text>
                    ) : null}
                    {field.translation && currentValue("handle") !== field.translation ? (
                      <s-checkbox name="confirm-handle" label={t("editor.handle.confirm", { handle: field.translation, language: targetName })} />
                    ) : null}
                  </s-stack>
                ) : null}
                {isSeoKey(field.key) ? <SeoCounter fieldKey={field.key} value={currentValue(field.key)} source={field.source} /> : null}
                {field.outdated && draft === undefined && field.translation ? (
                  <s-checkbox name={`confirm:${field.key}`} label={t("editor.field.stillCorrect")} />
                ) : null}
              </s-stack>
            </s-grid>
          </s-query-container>
          {field.history.length ? (
            <Disclosure summary={t("editor.history.summary", { count: field.history.length })}>
              {field.history.map((h) => (
                <s-box key={h.id} padding="small" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small-300">
                    <s-text color="subdued">
                      {i18n.dateTime(h.createdAt)}
                      {" · "}
                      {h.removed
                        ? t("editor.history.removed")
                        : h.origin === "EXTERNAL"
                          ? t("editor.history.origin.external")
                          : h.origin === "AI"
                            ? h.approved
                              ? t("editor.history.origin.aiApproved")
                              : t("editor.history.origin.ai")
                            : t("editor.history.origin.manual")}
                    </s-text>
                    {h.removed ? null : <s-paragraph>{h.value.length > 300 ? `${h.value.slice(0, 300)}…` : h.value}</s-paragraph>}
                    {h.restorable ? (
                      <s-stack direction="inline">
                        <Button variant="tertiary" icon="clock-revert" onClick={() => restoreFetcher.submit({ intent: "restore", revisionId: h.id }, { method: "post" })}>
                          {t("editor.history.restore")}
                        </Button>
                      </s-stack>
                    ) : null}
                  </s-stack>
                </s-box>
              ))}
            </Disclosure>
          ) : null}
        </s-stack>
      </s-section>
    );
  }
}
