/**
 * What Settings says about translating changes: which mode is chosen
 * (nothing, shortly after saving, on a schedule) and whether it really
 * runs. A state may read "On" only when the work actually happens: the
 * plan, the installation, the permission, a pause and the languages are
 * all checked, in that order.
 */
import type { SmartStatus } from "./smart-auto";

/** The three ways changes are translated; at most one is on (the server keeps it that way). */
export type ChangesMode = "manual" | "basic" | "smart";

export function changesMode(input: { basicEnabled: boolean; smartEnabled: boolean }): ChangesMode {
  if (input.smartEnabled) return "smart";
  return input.basicEnabled ? "basic" : "manual";
}

/** Automatic translation shortly after saving, as it really is. */
export type BasicState = "off" | "on" | "plan" | "unavailable" | "consent" | "paused" | "noLanguage";

export function basicState(input: {
  enabled: boolean;
  /** The plan includes translating whole areas (bulk), which this needs. */
  planIncludes: boolean;
  /** AI translation and background jobs are set up. */
  available: boolean;
  consent: boolean;
  paused: boolean;
  /** Chosen languages the plan includes. */
  activeLanguages: number;
}): BasicState {
  if (!input.enabled) return "off";
  if (!input.planIncludes) return "plan";
  if (!input.available) return "unavailable";
  if (!input.consent) return "consent";
  if (input.paused) return "paused";
  if (input.activeLanguages === 0) return "noLanguage";
  return "on";
}

/** The smart schedule as Settings shows it: stopped by the plan reads as paused, with the plan named. */
export type SmartState = "off" | "on" | "paused" | "waiting" | "plan";

export function smartState(input: { status: SmartStatus; entitled: boolean }): SmartState {
  if (input.status.state === "off") return "off";
  if (!input.entitled) return "plan";
  return input.status.state;
}

/**
 * Publishing as it really happens: automatic only while the plan includes
 * it (the job processor checks the same), otherwise everything waits in
 * Review.
 */
export function effectivePublishMode(input: { mode: string; inPlan: boolean }): "DRAFT" | "AUTO_PUBLISH" {
  return input.mode === "AUTO_PUBLISH" && input.inPlan ? "AUTO_PUBLISH" : "DRAFT";
}
