/**
 * The translation provider of one shop (docs/AI_ENGINES.md). Every shop but
 * one on the Own key plan gets exactly what it got before: the operator's
 * provider (getTranslationProvider()) and the consent tokens of the engines in
 * the environment, without any database read. A shop on the Own key plan gets
 * only its own keys: an EngineRouter over SealedProvider members built per call
 * from its decrypted rows, never an operator engine, never an environment key.
 *
 * - `shopTranslationFacts` (never decrypts): what pages show (availability,
 *   consent tokens, the keys' summaries).
 * - `openShopTranslation` (decrypts): only where texts are sent or an
 *   engine's language list is read (the AI actions, the worker item, the
 *   Settings and Languages loaders). Its result is never returned from a
 *   loader or action, and nothing here is cached: decrypted keys live only in
 *   the sealed providers of one call or job item.
 * - A merchant key is a SecretValue until the SealedProvider builds its
 *   adapter, which it keeps in an ES private field: JSON, util.inspect and
 *   pino never see a key at any depth (docs/SECURITY_MODEL.md).
 */
import type { PrismaClient } from "@prisma/client";
import type { ConsentToken, EngineId } from "../../lib/engines";
import { ownKeyStopCode, ownKeyToken, usableOwnKey, type OwnKeySummary } from "../../lib/own-keys";
import { usesOwnKeys, type Entitlements } from "../../lib/plans";
import type { BillingStatus } from "../billing/subscription";
import { ownKeyMode, type OwnKeyMode } from "../credentials/formats";
import { ownKeyAccess } from "../credentials/service";
import { azureEndpointFor, listEngineKeys, loadEngineKeys, type OwnCredential } from "../credentials/store";
import { engineConsentTokens, getConfig, type AppConfig } from "../lib/config";
import { prisma as defaultClient } from "../lib/db";
import type { SecretValue } from "../lib/secret";
import type { ConsentPayer } from "../settings/ai-consent";
import { consentedEngines, getShopSettings, type ConsentState } from "../settings/shop-settings";
import { AzureTranslatorProvider } from "./azure";
import { DeepLProvider } from "./deepl";
import { EngineRouter, type RoutedEngine } from "./engine-router";
import { GoogleTranslateProvider } from "./google";
import { getTranslationProvider } from "./index";
import { MockTranslationProvider } from "./mock";
import type { EngineCapabilities, TranslationProvider, TranslationRequest, TranslationResult } from "./types";

export interface OperatorTranslation {
  payer: "linguva";
  provider: TranslationProvider | null;
  available: boolean;
  /** Consent tokens of the services texts go to: engineConsentTokens(getConfig()), today's default. */
  configured: ConsentToken[];
  unavailable: "AI_NOT_CONFIGURED" | null;
  keys: null;
}

export interface OwnKeyTranslation {
  payer: "merchant";
  /** Always an EngineRouter over SealedProvider members (ownKeys option), or null without one. Never an operator engine. */
  provider: EngineRouter | null;
  available: boolean;
  /** Tokens of the usable keys, in routing order (ownKeyToken). */
  configured: ConsentToken[];
  /**
   * Why there's no provider: OWN_KEY_AUTH_<E> when a saved key is refused and none is usable
   * (the first such engine), OWN_KEY_UNAVAILABLE when a usable key was skipped only because of a
   * key id this process doesn't have (transient, never a stop), else OWN_KEY_MISSING.
   */
  unavailable: string | null;
  keys: OwnKeySummary[];
  /** The credentials the provider was built from (for noteOwnKeyResult's keyVersion guard). Server-only. */
  used: OwnCredential[];
}

export type ShopTranslation = OperatorTranslation | OwnKeyTranslation;
/** Without decrypting: what pages show. */
export type ShopTranslationFacts = Omit<OperatorTranslation, "provider"> | Omit<OwnKeyTranslation, "provider" | "used">;

type BillingLike = { entitlements: Entitlements } | null | undefined;

export interface OwnKeyOptions {
  /** The shop's settings when the caller has them (the consent the router is built with). */
  settings?: ConsentState;
  client?: PrismaClient;
  config?: AppConfig;
  /** Tests only: "live" members with a fake fetch (never through env). Default: ownKeyMode(config). */
  mode?: OwnKeyMode;
  fetch?: typeof fetch;
}

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/**
 * A merchant key's adapter behind a TranslationProvider that holds it in an ES private field: its
 * only public fields are `id` and (when the adapter declares them) `capabilities`, and JSON or
 * util.inspect print "[own-key provider <engine>]". The key is revealed only while the adapter is
 * built, inside the constructor.
 */
export class SealedProvider implements TranslationProvider {
  readonly #adapter: TranslationProvider;
  readonly id: EngineId;
  declare readonly capabilities?: EngineCapabilities;
  declare readonly targetSupport?: (locales: readonly string[]) => Promise<Map<string, boolean>>;

  constructor(engine: EngineId, apiKey: SecretValue, build: (key: string) => TranslationProvider) {
    this.id = engine;
    const adapter = build(apiKey.reveal());
    this.#adapter = adapter;
    if (adapter.capabilities) this.capabilities = adapter.capabilities;
    // Only when the adapter reads a language list (the router reads "absent" as every locale).
    if (adapter.targetSupport) {
      Object.defineProperty(this, "targetSupport", { value: (locales: readonly string[]) => adapter.targetSupport!(locales), enumerable: false });
    }
  }

  translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult> {
    return this.#adapter.translate(request, signal);
  }

  toJSON(): string {
    return `[own-key provider ${this.id}]`;
  }

  toString(): string {
    return `[own-key provider ${this.id}]`;
  }

  [INSPECT](): string {
    return `[own-key provider ${this.id}]`;
  }
}

/** The operator's branch: exactly getTranslationProvider() and the environment's consent tokens. */
export function operatorTranslation(provider: TranslationProvider | null, config: AppConfig = getConfig()): OperatorTranslation {
  return { payer: "linguva", provider, available: provider !== null, configured: engineConsentTokens(config), unavailable: provider ? null : "AI_NOT_CONFIGURED", keys: null };
}

/** Mock mode (development, tests, staging): an offline member under the engine's id; "-quota" / "-refused" test keys fail every call. */
function mockMember(engine: EngineId, key: string): TranslationProvider {
  if (key.includes("-quota")) return new MockTranslationProvider({ id: engine, failNext: { count: Infinity, kind: "quota" } });
  if (key.includes("-refused")) return new MockTranslationProvider({ id: engine, failNext: { count: Infinity, kind: "auth" } });
  return new MockTranslationProvider({ id: engine });
}

/** Pure: the router members for decrypted keys, in their order (DeepL, Azure, Google). */
export function ownKeyEngines(keys: readonly OwnCredential[], config: AppConfig, options: { mode?: OwnKeyMode; fetch?: typeof fetch } = {}): RoutedEngine[] {
  const mode = options.mode ?? ownKeyMode(config);
  // `fetch` only when a test passes one.
  const extra = options.fetch ? { fetch: options.fetch } : {};
  return keys.map((credential) => ({
    id: credential.engine,
    stateKey: credential.stateKey,
    provider: new SealedProvider(credential.engine, credential.apiKey, (key) => {
      if (mode === "mock") return mockMember(credential.engine, key);
      // DeepL: the key itself picks the host (":fx" → api-free); never the operator's base URL.
      if (credential.engine === "deepl") return new DeepLProvider({ apiKey: key, ...extra });
      if (credential.engine === "azure") {
        return new AzureTranslatorProvider({
          key,
          ...(credential.region ? { region: credential.region } : {}),
          endpoint: credential.endpoint ?? azureEndpointFor(credential.dataLocation),
          ...extra,
        });
      }
      return new GoogleTranslateProvider({ auth: { kind: "apiKey", apiKey: key }, cacheScope: credential.stateKey, ...extra });
    }),
  }));
}

/** Why an own-key shop has no provider (without a transient key: what a page can know). */
function unavailableOf(keys: readonly OwnKeySummary[], transient: boolean): string {
  if (transient) return "OWN_KEY_UNAVAILABLE";
  const refused = keys.find((k) => k.status === "REFUSED");
  return refused ? ownKeyStopCode("auth", refused.engine) : "OWN_KEY_MISSING";
}

/** The Own key plan's provider for a shop: its usable keys, decrypted, behind one router. Never an operator engine. */
export async function ownKeyTranslation(shopId: string, options: OwnKeyOptions = {}): Promise<OwnKeyTranslation> {
  const config = options.config ?? getConfig();
  const client = options.client ?? defaultClient;
  // One transaction: the summaries and the credentials describe the same rows.
  const { summaries: keys, credentials, transient } = await loadEngineKeys(shopId, client);
  const configured = credentials.map(ownKeyToken);
  const settings = options.settings ?? (await getShopSettings(shopId, client));
  // Token-accurate: a member the stored own-key consent doesn't cover is never used, whatever a request lists.
  const consented = consentedEngines(settings, configured, "merchant");
  const members = ownKeyEngines(credentials, config, options);
  const provider = members.length ? new EngineRouter(members, { ownKeys: { consented } }) : null;
  return {
    payer: "merchant",
    provider,
    available: provider !== null,
    configured,
    unavailable: provider ? null : unavailableOf(keys, transient.length > 0),
    keys,
    used: credentials,
  };
}

/** Decrypts (own-key shops). Only for the AI action branches, the worker item and loaders that need language lists. */
export async function openShopTranslation(shopId: string, billing: BillingLike, options: OwnKeyOptions = {}): Promise<ShopTranslation> {
  if (!usesOwnKeys(billing?.entitlements)) return operatorTranslation(getTranslationProvider(), options.config);
  return ownKeyTranslation(shopId, options);
}

/** Facts only: one listEngineKeys read for own-key shops, none otherwise. Never decrypts. */
export async function shopTranslationFacts(
  shopId: string,
  billing: BillingLike,
  options: { client?: PrismaClient; config?: AppConfig } = {},
): Promise<ShopTranslationFacts> {
  if (!usesOwnKeys(billing?.entitlements)) {
    const { payer, available, configured, unavailable, keys } = operatorTranslation(getTranslationProvider(), options.config);
    return { payer, available, configured, unavailable, keys };
  }
  const keys = await listEngineKeys(shopId, options.client ?? defaultClient);
  const usable = keys.filter(usableOwnKey);
  return {
    payer: "merchant",
    available: usable.length > 0,
    configured: usable.map(ownKeyToken),
    // A page can't know about a process's keyring: the action that opens the provider reports that.
    unavailable: usable.length ? null : unavailableOf(keys, false),
    keys,
  };
}

/** The services a consent is about and who they are used under (no decryption). */
export async function consentForShop(
  shopId: string,
  billing: BillingLike,
  client: PrismaClient = defaultClient,
): Promise<{ configured: ConsentToken[]; payer: ConsentPayer }> {
  if (!usesOwnKeys(billing?.entitlements)) return { configured: engineConsentTokens(getConfig()), payer: "linguva" };
  const keys = await listEngineKeys(shopId, client);
  return { configured: keys.filter(usableOwnKey).map(ownKeyToken), payer: "merchant" };
}

export interface OverviewOwnKeys {
  access: "plan" | "pending";
  keys: OwnKeySummary[];
  /** Pending only: when Shopify switches to Own key (ISO), or null when unknown. */
  startsOn: string | null;
}

/** The Overview's own-key state: on the plan (its keys), a pending change to it (keys saved so far, from when), else null. */
export async function ownKeysForOverview(
  shopId: string,
  facts: ShopTranslationFacts,
  billing: Pick<BillingStatus, "state" | "entitlements" | "subscription">,
  client: PrismaClient = defaultClient,
): Promise<OverviewOwnKeys | null> {
  const access = ownKeyAccess(billing);
  if (access === "plan") return { access, keys: facts.keys ?? [], startsOn: null };
  if (access === "pending") return { access, keys: await listEngineKeys(shopId, client), startsOn: billing.subscription?.currentPeriodEnd?.toISOString() ?? null };
  return null;
}
