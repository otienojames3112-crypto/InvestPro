import { useEffect, useState } from "react";

/**
 * Shared "maturing soon" window (in days). Persisted to localStorage and kept in
 * sync across the app — the Securities page selector and the sidebar count badge
 * both read/write the same value so they never disagree.
 *
 * Allowed values (days): 30 / 60 / 90 / 180 / 365 (1yr) / 730 (2yr) / ALL.
 * The wider windows let long-dated government paper (FXD / IFB bonds with
 * multi-year tenors) surface in the lookahead, not just short T-bills.
 * "All" is encoded as a large sentinel so any future maturity is included.
 * Defaults to 30.
 */
export const MATURING_WINDOW_ALL = 36500; // ~100 years — effectively "all upcoming"
export type MaturingWindow = 30 | 60 | 90 | 180 | 365 | 730 | typeof MATURING_WINDOW_ALL;

/** Ordered options with human-friendly labels for the selector UI. */
export const MATURING_WINDOW_OPTIONS: { value: MaturingWindow; label: string }[] = [
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
  { value: 180, label: "180d" },
  { value: 365, label: "1yr" },
  { value: 730, label: "2yr" },
  { value: MATURING_WINDOW_ALL, label: "All" },
];

const STORAGE_KEY = "kes5m.maturingWindowDays";
const ALLOWED: MaturingWindow[] = MATURING_WINDOW_OPTIONS.map((o) => o.value);
const EVENT = "kes5m:maturing-window-change";

function readStored(): MaturingWindow {
  if (typeof window === "undefined") return 30;
  const raw = Number(window.localStorage.getItem(STORAGE_KEY));
  return (ALLOWED as number[]).includes(raw) ? (raw as MaturingWindow) : 30;
}

export function useMaturingWindow(): [MaturingWindow, (next: MaturingWindow) => void] {
  const [windowDays, setWindowDays] = useState<MaturingWindow>(readStored);

  useEffect(() => {
    // Keep multiple hook instances (page + sidebar) in sync within the same tab
    // (storage events only fire across tabs, so we use a custom event too).
    const sync = () => setWindowDays(readStored());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = (next: MaturingWindow) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(EVENT));
    }
    setWindowDays(next);
  };

  return [windowDays, update];
}

/** Whole days from now until the given date (negative = already overdue). */
export function daysUntilDate(dateStr: string | Date): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Friendly label for a window value (e.g. "1yr", "All"). */
export function maturingWindowLabel(value: number): string {
  return MATURING_WINDOW_OPTIONS.find((o) => o.value === value)?.label ?? `${value}d`;
}
