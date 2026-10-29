/**
 * Native admin feedback through App Bridge: toasts after an action and the
 * contextual save bar. Outside the admin (tests without App Bridge, server
 * rendering) these do nothing.
 */
import { useEffect, useRef } from "react";

export function showToast(message: string, options: { isError?: boolean } = {}) {
  if (typeof window === "undefined") return;
  window.shopify?.toast?.show(message, options.isError ? { isError: true } : undefined);
}

/** Shows `message` once for each new result (a fetcher's data object); null shows nothing. */
export function useResultToast(result: unknown, message: string | null, options: { isError?: boolean } = {}) {
  const shown = useRef<unknown>(null);
  useEffect(() => {
    if (!result || result === shown.current) return;
    shown.current = result;
    if (message) showToast(message, options);
  }, [result, message, options]);
}

/** Shows the admin's save bar with this id while `visible` is true. */
export function useSaveBar(id: string, visible: boolean) {
  useEffect(() => {
    const saveBar = typeof window === "undefined" ? undefined : window.shopify?.saveBar;
    if (!saveBar) return;
    void (visible ? saveBar.show(id) : saveBar.hide(id));
  }, [id, visible]);
  useEffect(() => () => void (typeof window === "undefined" ? undefined : window.shopify?.saveBar?.hide(id)), [id]);
}
