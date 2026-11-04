/**
 * Search as you type, the same wherever a search narrows a list (Review, an area's list, Jobs, Memory,
 * Coverage by item, the editor's "Find a text"): the search runs after a pause in typing (SEARCH_DELAY_MS),
 * from SEARCH_FROM characters on (one character would match nearly everything; an emptied field shows all
 * again), and at once on Enter. It sends its GET form, so the filters the form keeps (hidden inputs, the
 * form's other fields) stay; the page is drawn afresh for the results and the field keeps the focus, the
 * caret at the end, so typing goes on where it was. No "Search" button: without scripts, Enter sends the
 * form.
 *
 * `SearchForm` is the form with the field (and the kept filters as its children); `SearchField` alone goes
 * into a form of the page's own (Jobs' and Memory's, whose other fields apply at once).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Form, useLocation, useSubmit } from "react-router";
import { focusSoon } from "./focus";

/** Typing pauses this long before the search runs. */
export const SEARCH_DELAY_MS = 350;
/** The fewest characters a search runs with while typing (an empty field runs too: it shows everything). */
export const SEARCH_FROM = 2;

/**
 * The field that was being typed in when its search last ran (its page and name): drawn afresh for the
 * results, it takes the focus back. Cleared once the results are shown, so no later page takes it.
 */
let refocus: string | null = null;

export interface SearchFieldProps {
  /** The form field's name (default "q"). */
  name?: string;
  label: string;
  /** The label for screen readers only (default; the placeholder says what to type), or shown above the field. */
  labelHidden?: boolean;
  placeholder?: string;
  /** The search the page shows. */
  value: string;
}

export function SearchField({ name = "q", label, labelHidden = true, placeholder, value }: SearchFieldProps) {
  const submit = useSubmit();
  const location = useLocation();
  const field = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = `${location.pathname}#${name}`;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Drawn afresh for the results of a search typed here: the focus back, the caret at the end.
  useEffect(() => {
    if (refocus !== key) return;
    refocus = null;
    focusSoon(() => field.current);
    requestAnimationFrame(() => {
      const input = field.current?.shadowRoot?.querySelector("input");
      if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [key]);
  // The results are shown (the field stayed, and with it the focus): nothing left to give back.
  useEffect(() => {
    refocus = null;
  }, [location.key]);
  // Enter sends the form at once (the field's own submit): typed here, the results give the focus back.
  useEffect(() => {
    const owner = field.current?.closest("form");
    if (!owner) return;
    const typedHere = () => {
      if (owner.contains(document.activeElement)) refocus = key;
    };
    owner.addEventListener("submit", typedHere);
    return () => owner.removeEventListener("submit", typedHere);
  }, [key]);

  const onInput = (event: Event) => {
    const text = (event.currentTarget as HTMLInputElement).value.trim();
    if (timer.current) clearTimeout(timer.current);
    if (text.length > 0 && text.length < SEARCH_FROM) return;
    timer.current = setTimeout(() => {
      const owner = field.current?.closest("form");
      if (!owner) return;
      if (owner.contains(document.activeElement)) refocus = key;
      void submit(owner, { replace: true });
    }, SEARCH_DELAY_MS);
  };
  return (
    <s-search-field
      ref={field}
      name={name}
      label={label}
      {...(labelHidden ? { labelAccessibilityVisibility: "exclusive" as const } : {})}
      placeholder={placeholder}
      value={value}
      onInput={onInput}
    />
  );
}

/** The search's own GET form (a search landmark) with the filters it keeps as `children` (hidden inputs). */
export function SearchForm({
  action,
  accessibilityLabel,
  children,
  ...field
}: SearchFieldProps & {
  /** Where the form goes (default: the page itself). */
  action?: string;
  /** The landmark's name, where the page has more than one search. */
  accessibilityLabel?: string;
  children?: ReactNode;
}) {
  return (
    <Form method="get" action={action} role="search" aria-label={accessibilityLabel}>
      {children}
      <SearchField {...field} />
    </Form>
  );
}
