import { useEffect, useState } from "react";

/**
 * Shared "maturing soon" window (in days). Persisted to localStorage and kept in
 * sync across the app — the Securities page selector and the sidebar count badge
 * both read/write the same value so they never disagree.
 *
 * Allowed values: 30 / 60 / 90 days. Defaults to 30.
 */
export type MaturingWindow = 30 | 60 | 90;

const STORAGE_KEY = "kes5m.maturingWindowDays";
const ALLOWED: MaturingWindow[] = [30, 60, 90];
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
