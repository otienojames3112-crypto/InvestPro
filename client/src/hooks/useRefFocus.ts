import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";

/**
 * Deep-link row focus (Round 85, item 6).
 *
 * A catalogue page can be linked to with `?ref=<targetRef>` (e.g. from Recently
 * Approved's "Open published row" or an approval toast). This hook reads that ref
 * from the URL and gives a page three things:
 *
 *   - `focusRef`: the requested ref (or null), so a page can prefill its search box.
 *   - `isFocused(candidate)`: whether a given row's ref/name matches the requested
 *     one (case-insensitive, trimmed). A catalogue keys rows differently (fund name,
 *     bank name, opportunity ref), so a page may pass any identifier it holds.
 *   - `registerRow(candidate)`: a ref callback to attach to the row element. When the
 *     matching row mounts, it is scrolled into view and briefly highlighted with a
 *     ring. Honors `prefers-reduced-motion` (skips the smooth scroll, keeps the ring).
 *
 * The highlight is applied via direct DOM class toggling (no per-row React state) so
 * it works uniformly across table rows and cards, and auto-clears after ~2.6s.
 */

const HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-primary",
  "ring-offset-2",
  "ring-offset-background",
  "rounded-md",
  "transition-shadow",
];

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function useRefFocus() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRef = searchParams.get("ref");
  const focusKey = norm(focusRef);

  // Only act on the first mount for a given ref value, so re-renders don't re-scroll.
  const handledRef = useRef<string | null>(null);
  const [activeRef, setActiveRef] = useState<string | null>(focusRef);

  useEffect(() => {
    setActiveRef(focusRef);
    handledRef.current = null;
  }, [focusRef]);

  const isFocused = useCallback(
    (...candidates: (string | null | undefined)[]) => {
      if (!focusKey) return false;
      return candidates.some((c) => norm(c) === focusKey);
    },
    [focusKey],
  );

  const registerRow = useCallback(
    (...candidates: (string | null | undefined)[]) =>
      (el: HTMLElement | null) => {
        if (!el || !focusKey) return;
        const matches = candidates.some((c) => norm(c) === focusKey);
        if (!matches) return;
        if (handledRef.current === focusKey) return;
        handledRef.current = focusKey;

        const reduce =
          typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        // Defer to next frame so layout is settled before scrolling.
        requestAnimationFrame(() => {
          try {
            el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
          } catch {
            el.scrollIntoView();
          }
          el.classList.add(...HIGHLIGHT_CLASSES);
          window.setTimeout(() => {
            el.classList.remove(...HIGHLIGHT_CLASSES);
          }, 2600);
        });
      },
    [focusKey],
  );

  /**
   * Round 86 — cross-catalogue leak guard.
   *
   * A page calls this once its rows have loaded, passing every candidate identifier
   * present on this catalogue (fund/bank names, opportunity refs, etc.). If a `?ref=`
   * was supplied but matches NOTHING here, the ref clearly belongs to a different
   * catalogue (a stale deep link that survived a tab switch): we clear the URL's
   * `?ref=` and invoke `onClear` so the page can also reset any search box it prefilled
   * from the ref. When the ref does match, nothing happens (the highlight still runs).
   */
  const clearIfMissing = useCallback(
    (candidates: (string | null | undefined)[], onClear?: () => void) => {
      if (!focusKey) return;
      const anyMatch = candidates.some((c) => norm(c) === focusKey);
      if (anyMatch) return;
      setActiveRef(null);
      onClear?.();
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (next.has("ref")) next.delete("ref");
        return next;
      }, { replace: true });
    },
    [focusKey, setSearchParams],
  );

  return useMemo(
    () => ({ focusRef, focusKey, activeRef, isFocused, registerRow, clearIfMissing }),
    [focusRef, focusKey, activeRef, isFocused, registerRow, clearIfMissing],
  );
}

/** The shape returned by {@link useRefFocus}, for passing down to row subcomponents. */
export type RefFocus = ReturnType<typeof useRefFocus>;
