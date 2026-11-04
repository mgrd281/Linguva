/** Moving the focus to a Polaris control, which may not take it in its first frame. */

/** Focuses a Polaris control once it can take focus (it may not in the first frame). */
export function focusSoon(find: () => HTMLElement | null) {
  let tries = 0;
  const attempt = () => {
    const el = find();
    el?.focus();
    // A Polaris host stands for its inner control: the document's active element is the host.
    const done = el !== null && (document.activeElement === el || el.contains(document.activeElement));
    if (!done && tries++ < 30) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
