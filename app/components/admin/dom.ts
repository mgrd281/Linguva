/**
 * Small browser helpers for the console's pages (client-only: they run in
 * event handlers and effects, never during the server render). Each takes
 * the elements it works on, so the unit tests hand it plain objects.
 */

type ClickLike = { preventDefault(): void; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
type Focusable = {
  focus(options?: FocusOptions): void;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  tabIndex: number;
};

/**
 * A click on an in-page link (#id: the skip link, an error summary's link
 * to its field): moves the focus to the target without a navigation. React
 * Router turns a fragment change into a navigation that drops the page's
 * action result (the errors being followed, a "saved" notice). A click that
 * opens a new tab or window, or a target that isn't there, is left to the
 * browser; without JavaScript the browser follows the fragment itself.
 */
export function jumpTo(event: ClickLike, id: string, { block = "center", doc = globalThis.document }: { block?: ScrollLogicalPosition; doc?: { getElementById(id: string): Focusable | null } } = {}): boolean {
  if ((event.button ?? 0) !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = doc?.getElementById(id);
  if (!target) return false;
  event.preventDefault();
  // A plain element (a card, a list) can take the focus only with a tabindex.
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block, inline: "nearest" });
  return true;
}

type FormLike = { elements: { namedItem(name: string): unknown } };

/**
 * Sets a GET form's fields to `values` (the filters the URL holds). The
 * fields are uncontrolled (the form works without JavaScript), and React
 * leaves a mounted field alone when its default changes, so after "Clear
 * filters", Back or Forward the fields would still show the old filters and
 * send them again. Only fields that differ are touched (the caret and the
 * focus stay where they are).
 */
export function applyFormValues(form: FormLike, values: Record<string, string | boolean>): void {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name) as { value?: string; checked?: boolean } | null;
    if (!field || typeof field !== "object") continue;
    if (typeof value === "boolean") {
      if (field.checked !== value) field.checked = value;
    } else if (field.value !== value) field.value = value;
  }
}

type Box = { left: number; right: number };
type Strip = {
  scrollWidth: number;
  clientWidth: number;
  getBoundingClientRect(): Box;
  querySelector(selector: string): { getBoundingClientRect(): Box } | null;
  scrollBy(options: ScrollToOptions): void;
};

/**
 * On a phone the navigation is one row that scrolls sideways: brings the
 * current page's tab into view (left or right to left alike: a relative
 * scroll), with `margin` to spare so a bit of the next tab shows there is
 * more. Nothing happens when the row fits or the tab is already in view.
 */
export function revealCurrent(strip: Strip | null, { selector = '[aria-current="page"]', margin = 40 }: { selector?: string; margin?: number } = {}): number {
  if (!strip || strip.scrollWidth <= strip.clientWidth) return 0;
  const item = strip.querySelector(selector);
  if (!item) return 0;
  const box = strip.getBoundingClientRect();
  const at = item.getBoundingClientRect();
  const delta = at.left < box.left + margin ? at.left - box.left - margin : at.right > box.right - margin ? at.right - box.right + margin : 0;
  if (delta !== 0) strip.scrollBy({ left: delta });
  return delta;
}
