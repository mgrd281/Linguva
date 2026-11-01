/**
 * Several translation engines behind one provider (docs/AI_ENGINES.md).
 *
 * - Order: DeepL → Microsoft Azure → Google Cloud (configured ones only;
 *   TRANSLATION_ENGINES picks and orders them, DeepL always first). Only
 *   built for two or more engines: a DeepL-only deployment gets today's
 *   DeepLProvider / DeepLKeyPool object, unchanged (providers/index.ts).
 * - Consent first: a request uses only the engines in `request.engines`
 *   (what the shop's AI consent covers). None → nothing is called.
 * - One request is translated completely by one engine; on failover the
 *   next engine gets the whole request again. Failover on quota, refused
 *   credentials, an outage (after the engine's own retries), a language the
 *   engine doesn't offer and a segment too large for it. Rate limits never
 *   switch engines: the queue waits and the same engine answers afterwards
 *   (deepl-pool.ts doesn't switch on them either).
 * - An engine that failed rests (module-global like the DeepL key pool,
 *   because getTranslationProvider() builds new objects per request).
 * - The caller's stop signal and deadline are checked before each engine
 *   and never passed into one: aborting an engine mid-request would lose
 *   what its earlier batches billed.
 */
import { logger } from "../lib/logger";
import type { EngineId } from "../../lib/engines";
import { TranslationProviderError, isRateLimit, type EngineCapabilities, type TranslationProvider, type TranslationRequest, type TranslationResult } from "./types";

export interface RoutedEngine {
  id: EngineId;
  /** DeepLProvider | DeepLKeyPool (key failover first, then engine failover) | AzureTranslatorProvider | GoogleTranslateProvider. Capabilities come from provider.capabilities. */
  provider: TranslationProvider;
}

export type EngineRestKind = "quota" | "auth" | "outage";
export interface EngineRest {
  kind: EngineRestKind;
  until: number;
}

export interface EnginePlan {
  /** Allowed engines that can translate into the locale, in the order they would be tried (rests ignored). */
  candidates: EngineId[];
  /** Configured engines outside `allowed` that could serve it (for "needs consent"). */
  blocked: EngineId[];
  /** Engines whose language list couldn't be read (candidates are tried in their place; blocked ones aren't known to serve it). */
  unknown: EngineId[];
  /** First candidate: the engine that normally serves the locale. */
  servedBy: EngineId | null;
  /** First candidate that isn't resting now: where the next request goes. */
  next: EngineId | null;
}

export const QUOTA_REST_MS = 60 * 60 * 1000;
export const AUTH_REST_MS = 6 * 60 * 60 * 1000;
/** Google's token endpoint refused the assertion: usually clock skew, so a shorter rest. */
export const TOKEN_GRANT_REST_MS = 60 * 60 * 1000;
/** Doubles per consecutive outage (a circuit breaker: one dead engine doesn't slow every request). */
export const OUTAGE_REST_MS = 2 * 60 * 1000;
export const MAX_OUTAGE_REST_MS = 15 * 60 * 1000;
/** The engine listed the pair but refused it: not tried again for that pair for a day. */
export const LANGUAGE_REFUSAL_MS = 24 * 60 * 60 * 1000;
/** A language list that couldn't be read isn't asked again for this long (as the Azure and Google adapters cache their failures). */
export const LIST_FAILURE_MS = 5 * 60 * 1000;
export const INTERACTIVE_DEADLINE_MS = 60_000;
export const JOB_DEADLINE_MS = 180_000;

// Shared by every router in the process, by engine id (never a key).
const rests = new Map<EngineId, EngineRest>();
const outages = new Map<EngineId, number>();
const refusals = new Map<string, number>();
const listFailures = new Map<EngineId, number>();
// Which rest is newer than an attempt: a counter, not the clock, so two events in the same
// millisecond still have an order. restSeq holds the counter value when the engine's rest was set.
let seq = 0;
const restSeq = new Map<EngineId, number>();

/** The engine's current rest in this process, if any. */
export function engineRest(id: EngineId, now = Date.now()): EngineRest | null {
  const rest = rests.get(id);
  return rest && rest.until > now ? rest : null;
}

/** Tests only. */
export function clearEngineRests(): void {
  rests.clear();
  outages.clear();
  refusals.clear();
  listFailures.clear();
  restSeq.clear();
}

const refusalKey = (id: EngineId, source: string, target: string) => `${id}\u0000${source.toLowerCase()}\u0000${target.toLowerCase()}`;

type Support = true | false | "unknown";

/** What the router throws itself: "router" as provider, so logs never blame an engine for it. */
function routerError(kind: TranslationProviderError["kind"], message: string, extra: { reason?: TranslationProviderError["reason"]; retryAfterMs?: number } = {}) {
  const error = new TranslationProviderError("router", kind, message, undefined, extra.retryAfterMs);
  if (extra.reason) error.reason = extra.reason;
  return error;
}


export class EngineRouter implements TranslationProvider {
  /** The first engine of the order: every existing provider.id use (memory-only results, fallbacks) stays a real engine id, never a composite. */
  readonly id: EngineId;
  /** "deepl+azure+google": logs and the worker heartbeat only, never stored. */
  readonly label: string;
  readonly engines: readonly EngineId[];
  private readonly members: readonly RoutedEngine[];
  private readonly now: () => number;

  constructor(engines: readonly RoutedEngine[], options: { now?: () => number } = {}) {
    if (engines.length < 2) throw new Error("A router needs at least two engines");
    const ids = engines.map((e) => e.id);
    if (new Set(ids).size !== ids.length) throw new Error("Each engine can be routed once");
    if (ids.includes("deepl") && ids[0] !== "deepl") throw new Error("DeepL, when used, is the first engine");
    this.members = engines;
    this.engines = ids;
    this.id = ids[0]!;
    this.label = ids.join("+");
    this.now = options.now ?? Date.now;
  }

  capabilitiesOf(id: EngineId): EngineCapabilities {
    return this.members.find((m) => m.id === id)?.provider.capabilities ?? { formality: true, context: true };
  }

  /** Allowed members in routing order. */
  private allowed(engines: readonly string[] | undefined): RoutedEngine[] {
    const set = new Set(engines ?? []);
    return this.members.filter((m) => set.has(m.id));
  }

  /**
   * One engine's language list, or null when it can't be read. A failed read isn't repeated
   * for LIST_FAILURE_MS: a hanging host (DeepL's list isn't cached on failure) would otherwise
   * hold every job item and plan for its whole timeout.
   */
  private async listOf(member: RoutedEngine, locales: readonly string[]): Promise<Map<string, boolean> | null> {
    if (!member.provider.targetSupport) return new Map(locales.map((l) => [l, true]));
    if ((listFailures.get(member.id) ?? 0) > this.now()) return null;
    try {
      const list = await member.provider.targetSupport(locales);
      listFailures.delete(member.id);
      return list;
    } catch {
      listFailures.set(member.id, this.now() + LIST_FAILURE_MS);
      return null;
    }
  }

  /** One engine's support for one locale; a list that can't be read is "unknown". */
  private async supportOf(member: RoutedEngine, locale: string): Promise<Support> {
    const list = await this.listOf(member, [locale]);
    return list === null ? "unknown" : list.get(locale) === true;
  }

  private setRest(id: EngineId, rest: EngineRest): void {
    rests.set(id, rest);
    restSeq.set(id, ++seq);
  }

  /** `startedAt`: when the failed attempt began, so failures of requests that were already running count as one outage. */
  private rest(id: EngineId, error: TranslationProviderError, startedAt: number): void {
    const at = this.now();
    if (error.kind === "quota") {
      this.setRest(id, { kind: "quota", until: at + QUOTA_REST_MS });
    } else if (error.kind === "auth") {
      this.setRest(id, { kind: "auth", until: at + (error.reason === "TOKEN_GRANT" ? TOKEN_GRANT_REST_MS : AUTH_REST_MS) });
    } else {
      const current = rests.get(id);
      if (current?.kind === "outage" && current.until > startedAt) {
        // The same outage, seen by a request that was already running (several items in flight, or
        // a pass-3 probe while resting): it may lengthen the rest, but it isn't another consecutive outage.
        const backoff = Math.min(OUTAGE_REST_MS * 2 ** ((outages.get(id) ?? 1) - 1), MAX_OUTAGE_REST_MS);
        rests.set(id, { kind: "outage", until: Math.max(current.until, at + Math.max(error.retryAfterMs ?? 0, backoff)) });
        return;
      }
      // A new outage: the previous rest had ended before this attempt started.
      const count = (outages.get(id) ?? 0) + 1;
      outages.set(id, count);
      const backoff = Math.min(OUTAGE_REST_MS * 2 ** (count - 1), MAX_OUTAGE_REST_MS);
      this.setRest(id, { kind: "outage", until: at + Math.max(error.retryAfterMs ?? 0, backoff) });
    }
  }

  async translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    // 1. Consent, fail closed: no engine the shop didn't accept, and none at all without a list.
    const allowed = this.allowed(request.engines);
    if (allowed.length === 0) throw routerError("invalid", "no consented engine", { reason: "CONFIGURATION" });
    // 2. One allowed engine (a DeepL-only consent): exactly that engine's call, as if no router existed.
    if (allowed.length === 1) return allowed[0]!.provider.translate(request);

    // 3. Engines that haven't refused this pair recently. Support is asked lazily, in order, so a
    // DeepL success never reads Google's list.
    const at = this.now();
    const eligible = allowed.filter((m) => (refusals.get(refusalKey(m.id, request.sourceLocale, request.targetLocale)) ?? 0) <= at);
    if (eligible.length === 0) throw routerError("invalid", "no engine for the target language", { reason: "UNSUPPORTED_LANGUAGE" });
    const supports = new Map<EngineId, Promise<Support>>();
    const support = (m: RoutedEngine) => {
      let known = supports.get(m.id);
      if (!known) supports.set(m.id, (known = this.supportOf(m, request.targetLocale)));
      return known;
    };
    // Rests as they were when the request came in (the passes below add new ones).
    const restAtStart = new Map(eligible.map((m) => [m.id, engineRest(m.id, at)]));

    const failures: Array<{ id: EngineId; error: TranslationProviderError }> = [];
    const billed: Record<string, number> = {};
    const tried = new Set<EngineId>();
    let stopped = false;

    const fail = (error: TranslationProviderError): never => {
      const sum = Object.values(billed).reduce((n, c) => n + c, 0);
      if (sum > 0) error.billedCharacters = sum;
      if (Object.keys(billed).length) error.billedByEngine = { ...billed };
      throw error;
    };

    /** One engine: its result, or null after recording why it failed (and resting it). */
    const attempt = async (member: RoutedEngine, known: Support): Promise<TranslationResult | null> => {
      tried.add(member.id);
      const previous = failures.at(-1);
      if (previous) logger.info({ from: previous.id, to: member.id, kind: previous.error.kind, status: previous.error.status }, "translation engine switched");
      const startedAt = this.now();
      const seqAtStart = seq;
      try {
        // The request object unchanged and no signal: DeepL gets exactly today's request.
        const result = await member.provider.translate(request);
        // It answered: whatever it rested for (an outage, or a quota or auth limit that pass 2 found
        // lifted) is over, with its outage count. Unless another request rested it while this call
        // was running: that rest is newer than this answer.
        if ((restSeq.get(member.id) ?? 0) <= seqAtStart) {
          outages.delete(member.id);
          rests.delete(member.id);
          restSeq.delete(member.id);
        }
        const lost = Object.fromEntries(Object.entries(billed).filter(([, c]) => c > 0));
        return { ...result, provider: member.id, ...(Object.keys(lost).length ? { lostByEngine: lost } : {}) };
      } catch (error) {
        if (!(error instanceof TranslationProviderError)) throw error;
        if (error.billedCharacters) billed[member.id] = (billed[member.id] ?? 0) + error.billedCharacters;
        // A rate limit: wait, don't switch (the queue's rate-limited path), and no rest.
        if (isRateLimit(error)) fail(error);
        if (error.kind === "quota" || error.kind === "auth" || error.kind === "retryable") {
          this.rest(member.id, error, startedAt);
        } else if (error.reason === "REQUEST_TOO_LARGE") {
          // Another engine's limit is higher (DeepL's 128 KiB): next, no rest.
        } else if (error.reason === "UNSUPPORTED_LANGUAGE") {
          // The list said yes, the engine said no: not this pair again for a while. A guessed
          // code (list unreadable) proves nothing about the engine.
          if (known === true) refusals.set(refusalKey(member.id, request.sourceLocale, request.targetLocale), this.now() + LANGUAGE_REFUSAL_MS);
        } else if (known === true) {
          // Invalid input doesn't switch engines.
          fail(error);
        }
        // (A plain invalid with an unreadable list: Google v2's unstructured invalid language.)
        failures.push({ id: member.id, error });
        return null;
      }
    };

    const run = async (members: readonly RoutedEngine[]): Promise<TranslationResult | null> => {
      for (const member of members) {
        if (stopped) return null;
        const known = await support(member);
        if (known === false) continue;
        // The caller's stop or deadline: no further engine.
        if (signal?.aborted) {
          stopped = true;
          return null;
        }
        const result = await attempt(member, known);
        if (result) return result;
      }
      return null;
    };

    const restKind = (m: RoutedEngine) => restAtStart.get(m.id)?.kind;
    // Pass 1: engines not resting. Pass 2: resting for quota or auth (a limit may have been
    // lifted, like deepl-pool.ts). Pass 3, only when nothing was tried at all: resting for an
    // outage, so a language with a single engine still reaches it on every request, as today.
    const result =
      (await run(eligible.filter((m) => !restKind(m)))) ??
      (await run(eligible.filter((m) => restKind(m) === "quota" || restKind(m) === "auth"))) ??
      (tried.size === 0 ? await run(eligible.filter((m) => restKind(m) === "outage")) : null);
    if (result) return result;

    // 6. Total failure: one error, with every engine's partial bill attached.
    const recorded = [...failures];
    for (const member of eligible) {
      if (tried.has(member.id)) continue;
      const rest = restAtStart.get(member.id);
      if (stopped) {
        // Not asked because of the stop or deadline: only down, so an early stop never becomes a
        // quota or auth job stop for engines that weren't asked.
        if ((await supports.get(member.id)) !== false) recorded.push({ id: member.id, error: routerError("retryable", "engine resting") });
      } else if (rest?.kind === "outage" && (await support(member)) !== false) {
        // Skipped while resting for an outage: retry when its rest ends.
        recorded.push({ id: member.id, error: routerError("retryable", "engine resting", { retryAfterMs: Math.max(0, rest.until - at) }) });
      }
    }
    if (recorded.length === 0) throw routerError("invalid", "no engine for the target language", { reason: "UNSUPPORTED_LANGUAGE" });
    const order = new Map(this.engines.map((id, i) => [id, i]));
    // Precedence: retryable (incl. synthetic) > too large for an engine that serves the language >
    // quota > auth > the rest; ties go to the earliest in order. A segment too large for an engine
    // that wasn't resting fails only this item: that engine still translates the rest of the
    // language, so no quota or auth job stop. Too large from an engine tried while resting for
    // quota or auth (the size check runs before any call) proves nothing about its limit.
    const rank = (r: { id: EngineId; error: TranslationProviderError }) =>
      r.error.kind === "retryable"
        ? 0
        : r.error.reason === "REQUEST_TOO_LARGE" && !restAtStart.get(r.id)
          ? 1
          : r.error.kind === "quota"
            ? 2
            : r.error.kind === "auth"
              ? 3
              : 4;
    recorded.sort((a, b) => rank(a) - rank(b) || order.get(a.id)! - order.get(b.id)!);
    const first = recorded[0]!;
    const timed = recorded.filter((r) => r.error.kind === "retryable" && r.error.retryAfterMs !== undefined).sort((a, b) => a.error.retryAfterMs! - b.error.retryAfterMs!)[0];
    const chosen = first.error.kind === "retryable" && timed ? timed.error : first.error;
    if (chosen.kind === "quota" || chosen.kind === "auth") {
      // Used up or refused for this language only, while a consented engine still works (it
      // serves other languages): the job for this language stops, the shop's automatic and smart
      // translation don't pause. Every consented engine resting for quota or auth: shop-wide, as before.
      const end = this.now();
      const working = allowed.some((m) => {
        const kind = engineRest(m.id, end)?.kind;
        return kind !== "quota" && kind !== "auth";
      });
      if (working) chosen.scope = "language";
    }
    return fail(chosen);
  }

  /** Union over every engine; throws only if no engine's list could be read. */
  async targetSupport(locales: readonly string[]): Promise<Map<string, boolean>> {
    const union = new Map(locales.map((l) => [l, false]));
    let read = 0;
    let last: unknown;
    for (const member of this.members) {
      if (!member.provider.targetSupport) {
        read++;
        for (const l of locales) union.set(l, true);
        continue;
      }
      try {
        const support = await member.provider.targetSupport(locales);
        read++;
        for (const l of locales) if (support.get(l)) union.set(l, true);
      } catch (error) {
        last = error;
      }
    }
    if (read === 0) throw last;
    return union;
  }

  /**
   * Per locale: which allowed engines would translate it, in order, and which configured ones
   * need consent. With `sourceLocale`, `next` also skips an engine that refused that pair
   * recently, as translate() does (job items and plans name the engine that will answer).
   */
  async plan(locales: readonly string[], allowed: readonly string[], sourceLocale?: string): Promise<Map<string, EnginePlan>> {
    const allowedSet = new Set(allowed);
    const at = this.now();
    const lists = new Map<EngineId, Map<string, boolean> | null>();
    for (const member of this.members) lists.set(member.id, await this.listOf(member, locales));
    const refused = (id: EngineId, locale: string) => sourceLocale !== undefined && (refusals.get(refusalKey(id, sourceLocale, locale)) ?? 0) > at;
    const plans = new Map<string, EnginePlan>();
    for (const locale of locales) {
      const candidates: EngineId[] = [];
      const blocked: EngineId[] = [];
      const unknown: EngineId[] = [];
      for (const id of this.engines) {
        const list = lists.get(id);
        const support: Support = list === null || list === undefined ? "unknown" : list.get(locale) === true;
        if (support === false) continue;
        if (support === "unknown") unknown.push(id);
        if (!allowedSet.has(id)) {
          blocked.push(id);
          continue;
        }
        candidates.push(id);
      }
      plans.set(locale, {
        candidates,
        blocked,
        unknown,
        servedBy: candidates[0] ?? null,
        next: candidates.find((id) => !engineRest(id, at) && !refused(id, locale)) ?? candidates[0] ?? null,
      });
    }
    return plans;
  }
}

export function isEngineRouter(provider: TranslationProvider | null | undefined): provider is EngineRouter {
  return provider instanceof EngineRouter;
}
