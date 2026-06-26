import { describe, it, expect } from "vitest";
import { formatRelativeTime, isReconcileStale, RECONCILE_STALE_DAYS } from "../client/src/lib/format";

const DAY = 24 * 60 * 60 * 1000;

describe("R66 — formatRelativeTime", () => {
  it("returns empty string for nullish input", () => {
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime(undefined)).toBe("");
  });

  it("returns 'just now' for very recent timestamps", () => {
    expect(formatRelativeTime(Date.now() - 5_000)).toBe("just now");
  });

  it("formats minutes, hours, days, months", () => {
    expect(formatRelativeTime(Date.now() - 5 * 60_000)).toBe("5 mins ago");
    expect(formatRelativeTime(Date.now() - 3 * 60 * 60_000)).toBe("3 hours ago");
    expect(formatRelativeTime(Date.now() - 4 * DAY)).toBe("4 days ago");
    expect(formatRelativeTime(Date.now() - 60 * DAY)).toBe("2 months ago");
  });

  it("uses singular units correctly", () => {
    expect(formatRelativeTime(Date.now() - 1 * 60_000)).toBe("1 min ago");
    expect(formatRelativeTime(Date.now() - 1 * 60 * 60_000)).toBe("1 hour ago");
    expect(formatRelativeTime(Date.now() - 1 * DAY)).toBe("1 day ago");
  });
});

describe("R66 — isReconcileStale", () => {
  it("is false for fresh and nullish timestamps", () => {
    expect(isReconcileStale(Date.now())).toBe(false);
    expect(isReconcileStale(null)).toBe(false);
    expect(isReconcileStale(undefined)).toBe(false);
  });

  it("is true once older than the staleness threshold", () => {
    expect(isReconcileStale(Date.now() - (RECONCILE_STALE_DAYS + 1) * DAY)).toBe(true);
  });

  it("is false right at the boundary (not strictly older)", () => {
    expect(isReconcileStale(Date.now() - (RECONCILE_STALE_DAYS - 1) * DAY)).toBe(false);
  });
});
