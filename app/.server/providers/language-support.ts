/**
 * Which target languages AI translation covers, for the Languages page and
 * the editor: read from the configured provider (DeepL's own list), never
 * assumed. "unknown" when the provider couldn't be asked; "none" without a
 * provider.
 */
import { logger } from "../lib/logger";
import type { TranslationProvider } from "./types";

export type AiSupport = "supported" | "unsupported" | "unknown" | "none";

export async function aiLanguageSupport(provider: TranslationProvider | null, locales: readonly string[]): Promise<Record<string, AiSupport>> {
  if (!provider) return Object.fromEntries(locales.map((l) => [l, "none" as const]));
  if (!provider.targetSupport) return Object.fromEntries(locales.map((l) => [l, "supported" as const]));
  try {
    const support = await provider.targetSupport(locales);
    return Object.fromEntries(locales.map((l) => [l, support.get(l) ? ("supported" as const) : ("unsupported" as const)]));
  } catch (error) {
    logger.warn({ provider: provider.id, err: (error as Error).name }, "couldn't read the provider's languages");
    return Object.fromEntries(locales.map((l) => [l, "unknown" as const]));
  }
}
