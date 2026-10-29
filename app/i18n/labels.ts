/**
 * Names of Shopify content types, fields, quality checks and job states in
 * the interface language. Unknown codes fall back to the English helpers in
 * app/lib (which also humanise unknown keys).
 */
import { fieldLabel } from "../lib/field-labels";
import { issueLabel } from "../lib/issue-labels";
import { ITEM_ERROR_MESSAGES, JOB_ERROR_MESSAGES, JOB_STATUS_LABELS } from "../lib/job-display";
import { coverageTypeLabel, isContentType, kindMeta, RESOURCE_KINDS, type TranslatableKind } from "../lib/resource-kinds";
import type { I18n } from "./i18n";
import { MESSAGES, type MessageKey } from "./messages";

export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(MESSAGES.en, key);
}

function known(i18n: I18n, key: string, fallback: string): string {
  return hasMessage(key) ? i18n.t(key) : fallback;
}

function isKind(kind: string): kind is TranslatableKind {
  return isContentType(kind) || Object.prototype.hasOwnProperty.call(RESOURCE_KINDS, kind);
}

/** "Products" / "Produkte". */
export function kindLabel(i18n: I18n, kind: string): string {
  return known(i18n, `common.kind.${kind}.label`, isKind(kind) ? kindMeta(kind).label : coverageTypeLabel(kind));
}

/** "product" / "Produkt" (German nouns keep their capital letter). */
export function kindSingular(i18n: I18n, kind: TranslatableKind): string {
  return known(i18n, `common.kind.${kind}.singular`, kindMeta(kind).singular);
}

/** "products"; for images and custom fields of an owner type (a smart check's jobs) their own words. */
export function kindPlural(i18n: I18n, kind: string): string {
  return known(i18n, `common.kind.${kind}.plural`, isKind(kind) ? kindMeta(kind).plural : kindLabel(i18n, kind).toLowerCase());
}

export function groupLabel(i18n: I18n, group: string): string {
  return known(i18n, `common.group.${group}`, group);
}

export function fieldName(i18n: I18n, key: string): string {
  return known(i18n, `common.field.${key}`, fieldLabel(key));
}

export function issueName(i18n: I18n, code: string): string {
  return known(i18n, `common.issue.${code}`, issueLabel(code));
}

export function jobStatus(i18n: I18n, status: string) {
  const tone = JOB_STATUS_LABELS[status]?.tone ?? "neutral";
  return { label: known(i18n, `common.jobStatus.${status}`, JOB_STATUS_LABELS[status]?.label ?? status), tone };
}

export function jobErrorMessage(i18n: I18n, code: string): string | null {
  if (!code) return null;
  return hasMessage(`common.jobError.${code}`) ? i18n.t(`common.jobError.${code}` as MessageKey) : (JOB_ERROR_MESSAGES[code] ?? null);
}

export function itemErrorMessage(i18n: I18n, code: string): string | null {
  if (!code) return null;
  return hasMessage(`common.itemError.${code}`) ? i18n.t(`common.itemError.${code}` as MessageKey) : (ITEM_ERROR_MESSAGES[code] ?? null);
}

/** Why an item of a job ended as it did ("Already up to date", an error, …). */
export function itemOutcome(i18n: I18n, status: string, code: string | null): string {
  if (code && hasMessage(`jobs.outcome.${code}`)) return i18n.t(`jobs.outcome.${code}` as MessageKey);
  if (code) return itemErrorMessage(i18n, code) ?? jobErrorMessage(i18n, code) ?? code;
  if (hasMessage(`jobs.outcome.${status}`)) return i18n.t(`jobs.outcome.${status}` as MessageKey);
  return jobStatus(i18n, status).label;
}
