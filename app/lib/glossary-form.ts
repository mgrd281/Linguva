/**
 * The glossary's form and list (app/routes/app.glossary.tsx): the three
 * rules as tiles with their icon and words, the server's problems placed on
 * the field they are about (with words for that field instead of the
 * schema's "translation: …"), and the list's search. Pure; tested in
 * tests/unit/glossary-form.test.ts.
 */
import type { Tint } from "../components/IconSquare";
import type { MessageKey, MessageRef } from "../i18n/i18n";
import type { IconName } from "./icons";

export const GLOSSARY_RULES = ["DO_NOT_TRANSLATE", "PREFERRED", "FORBIDDEN"] as const;
export type GlossaryRule = (typeof GLOSSARY_RULES)[number];

export function isGlossaryRule(value: string): value is GlossaryRule {
  return (GLOSSARY_RULES as readonly string[]).includes(value);
}

/**
 * Each rule's tile: its icon (a pin keeps a word as it is, replace swaps it, a stop sign forbids it), the
 * colour of its square, what it means, and what its term field asks for.
 */
export const RULE_LOOK: Record<GlossaryRule, { icon: IconName; tint: Tint; help: MessageKey; term: MessageKey }> = {
  DO_NOT_TRANSLATE: { icon: "pin", tint: "slate", help: "glossary.ruleHelp.DO_NOT_TRANSLATE", term: "glossary.termDetails.DO_NOT_TRANSLATE" },
  PREFERRED: { icon: "replace", tint: "blue", help: "glossary.ruleHelp.PREFERRED", term: "glossary.termDetails.PREFERRED" },
  FORBIDDEN: { icon: "alert-octagon", tint: "rose", help: "glossary.ruleHelp.FORBIDDEN", term: "glossary.termDetails.FORBIDDEN" },
};

/** The fields of the form a problem can be shown on. */
export type FormField = "term" | "translation" | "targetLocale" | "market";

const FIELDS: readonly string[] = ["term", "translation", "targetLocale", "market"];

/** A problem in words for the field it is shown on, or null when it belongs above the form. */
function onField(ref: MessageRef, field: FormField): MessageRef | null {
  switch (ref.key) {
    case "glossary.issue.requiredForPreferred":
      if (field === "translation") return { key: "glossary.form.translationRequired" };
      if (field === "targetLocale") return { key: "glossary.form.languageRequired" };
      return null;
    case "glossary.issue.market":
      return field === "market" ? { key: "glossary.form.marketInvalid" } : null;
    case "glossary.issue.tooShort":
      return field === "term" ? { key: "glossary.form.termRequired" } : null;
    case "glossary.issue.tooLong":
      return field === "term" || field === "translation" ? { key: "glossary.form.tooLong", vars: { max: ref.vars?.max ?? 200 } } : null;
    default:
      return null;
  }
}

/** The add form's problems: one per field it is about (the first), the rest for the banner. */
export function formProblems(messages: readonly MessageRef[]): { fields: Partial<Record<FormField, MessageRef>>; rest: MessageRef[] } {
  const fields: Partial<Record<FormField, MessageRef>> = {};
  const rest: MessageRef[] = [];
  for (const ref of messages) {
    const name = ref.vars?.field;
    const field = typeof name === "string" && FIELDS.includes(name) ? (name as FormField) : null;
    const message = field ? onField(ref, field) : null;
    if (field && message) {
      if (!fields[field]) fields[field] = message;
    } else rest.push(ref);
  }
  return { fields, rest };
}

/** The list's search: the term or its translation contains the words, ignoring case ("merino" finds "Merino"). */
export function matchesQuery(term: { term: string; translation: string | null }, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return term.term.toLocaleLowerCase().includes(q) || (term.translation ?? "").toLocaleLowerCase().includes(q);
}

/** Rows the list draws at most (a glossary can hold 5,000 terms): the search finds the others. */
export const MAX_SHOWN_TERMS = 200;
/** From this many terms on, the list has a search. */
export const SEARCH_FROM = 8;
