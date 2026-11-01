/**
 * The Own key plan's errors: a merchant key's used-up quota or refusal as the
 * job stop that names its engine (OWN_KEY_QUOTA_<E>, OWN_KEY_AUTH_<E>), the
 * keys a failed request found used up or refused (for noteOwnKeyResult), and
 * the "try again" of a key that can't be used here for now. Codes and engine
 * ids only: never a key, hint or fingerprint (docs/SECURITY_MODEL.md).
 */
import { isEngineId } from "../../lib/engines";
import { ownKeyStopCode } from "../../lib/own-keys";
import { JobStopError } from "../jobs/errors";
import { TranslationProviderError, type OwnKeyFailure } from "../providers/types";

/** A merchant key's quota or refusal as the job stop that names it; anything else unchanged. */
export function toOwnKeyError(error: unknown, planned: string): unknown {
  if (!(error instanceof TranslationProviderError) || (error.kind !== "quota" && error.kind !== "auth")) return error;
  const engine = isEngineId(error.provider) ? error.provider : isEngineId(planned) ? planned : "deepl";
  return new JobStopError(ownKeyStopCode(error.kind, engine), error.scope);
}

/**
 * Every key the failed request found used up or refused: the router's ownKeyFailures list
 * (engine-router.ts) when present, else the error itself when it is a quota/auth
 * TranslationProviderError of an engine, else [].
 */
export function ownKeyFailure(error: unknown): OwnKeyFailure[] {
  if (!(error instanceof TranslationProviderError)) return [];
  if (error.ownKeyFailures?.length) return error.ownKeyFailures.map((f) => ({ ...f }));
  if ((error.kind === "quota" || error.kind === "auth") && isEngineId(error.provider)) return [{ engine: error.provider, kind: error.kind }];
  return [];
}

/**
 * The merchant's key can't be used here for now: its envelope names a key id this process doesn't
 * have, or it was replaced or removed while the request ran. Never the key's fault and never a
 * stop: the editor says "try again" (PROVIDER_UNAVAILABLE).
 */
export class OwnKeyUnavailableError extends Error {
  constructor(readonly reason: "unknown-key-id" | "changed") {
    super(`Own key unavailable: ${reason}`);
    this.name = "OwnKeyUnavailableError";
  }
}
