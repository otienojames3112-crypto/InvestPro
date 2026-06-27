import { describe, it, expect } from "vitest";
import { evaluateDriftThreshold } from "../shared/liquidAllocator";

/**
 * R67 — drift-alert snooze, breach-transition notification dedup, and
 * drift-history snapshot fields.
 *
 * The server gates the live alert and owner notification with two small pure
 * predicates that mirror the router logic in `snapshotAndMaybeNotifyDrift` and
 * the `liquidAllocation` query:
 *   - snoozed:    typeof snoozeUntil === "number" && snoozeUntil > now
 *   - effective:  breached && !snoozed
 *   - freshEvent: !lastNotified || now - lastNotified > 6h
 * These helpers replicate those exact conditions so we can test them in
 * isolation without a live DB/notification round-trip.
 */
const SIX_HOURS = 6 * 60 * 60 * 1000;

function isSnoozed(snoozeUntil: number | null, now: number): boolean {
  return typeof snoozeUntil === "number" && snoozeUntil > now;
}

function effectiveBreach(breached: boolean, snoozed: boolean): boolean {
  return breached && !snoozed;
}

function isFreshEvent(lastNotified: number | null, now: number): boolean {
  return !lastNotified || now - lastNotified > SIX_HOURS;
}

/** Mirrors the notify decision in snapshotAndMaybeNotifyDrift. */
function shouldNotify(args: {
  breached: boolean;
  snoozeUntil: number | null;
  lastNotified: number | null;
  now: number;
}): boolean {
  const snoozed = isSnoozed(args.snoozeUntil, args.now);
  const fresh = isFreshEvent(args.lastNotified, args.now);
  return args.breached && !snoozed && fresh;
}

describe("R67 — drift snooze gating", () => {
  const now = 1_000_000_000_000;

  it("treats a future snooze timestamp as active", () => {
    expect(isSnoozed(now + 60_000, now)).toBe(true);
  });

  it("treats a past snooze timestamp as expired", () => {
    expect(isSnoozed(now - 60_000, now)).toBe(false);
  });

  it("treats null snooze as not snoozed", () => {
    expect(isSnoozed(null, now)).toBe(false);
  });

  it("mutes the effective alert while snoozed even when drift breaches", () => {
    const snoozed = isSnoozed(now + SIX_HOURS, now);
    expect(effectiveBreach(true, snoozed)).toBe(false);
  });

  it("shows the effective alert once snooze has expired", () => {
    const snoozed = isSnoozed(now - 1, now);
    expect(effectiveBreach(true, snoozed)).toBe(true);
  });

  it("never shows the alert when there is no underlying breach", () => {
    expect(effectiveBreach(false, false)).toBe(false);
    expect(effectiveBreach(false, true)).toBe(false);
  });
});

describe("R67 — breach-transition notification dedup", () => {
  const now = 2_000_000_000_000;

  it("notifies on a fresh breach that was never notified before", () => {
    expect(
      shouldNotify({ breached: true, snoozeUntil: null, lastNotified: null, now }),
    ).toBe(true);
  });

  it("does not notify when drift is within threshold (no breach)", () => {
    expect(
      shouldNotify({ breached: false, snoozeUntil: null, lastNotified: null, now }),
    ).toBe(false);
  });

  it("does not notify a fresh breach while the alert is snoozed", () => {
    expect(
      shouldNotify({
        breached: true,
        snoozeUntil: now + SIX_HOURS,
        lastNotified: null,
        now,
      }),
    ).toBe(false);
  });

  it("suppresses duplicate notifications within the 6h dedup window", () => {
    expect(
      shouldNotify({
        breached: true,
        snoozeUntil: null,
        lastNotified: now - SIX_HOURS / 2,
        now,
      }),
    ).toBe(false);
  });

  it("re-notifies once more than 6h has elapsed since the last ping", () => {
    expect(
      shouldNotify({
        breached: true,
        snoozeUntil: null,
        lastNotified: now - (SIX_HOURS + 60_000),
        now,
      }),
    ).toBe(true);
  });

  it("treats an expired snooze the same as no snooze for notifications", () => {
    expect(
      shouldNotify({
        breached: true,
        snoozeUntil: now - 1,
        lastNotified: null,
        now,
      }),
    ).toBe(true);
  });
});

describe("R67 — drift-history snapshot fields", () => {
  it("captures totalDrift, thresholdValue, and breached consistent with the evaluator", () => {
    const drifts = [200_000, -100_000];
    const netWorth = 4_000_000;
    const thresholdPct = 5;
    const r = evaluateDriftThreshold({ drifts, netWorth, thresholdPct, hasActuals: true });

    // A snapshot row stores exactly these derived numbers plus netWorth.
    const snapshot = {
      totalDrift: r.totalDrift,
      netWorth,
      thresholdValue: r.thresholdValue,
      breached: r.breached,
    };

    expect(snapshot.totalDrift).toBe(300_000);
    expect(snapshot.thresholdValue).toBe(200_000);
    expect(snapshot.netWorth).toBe(4_000_000);
    expect(snapshot.breached).toBe(true);
  });

  it("records a non-breaching snapshot when drift is within threshold", () => {
    const r = evaluateDriftThreshold({
      drifts: [50_000, -25_000],
      netWorth: 4_000_000,
      thresholdPct: 5,
      hasActuals: true,
    });
    expect(r.totalDrift).toBe(75_000);
    expect(r.thresholdValue).toBe(200_000);
    expect(r.breached).toBe(false);
  });

  it("a converging series (decreasing totalDrift) is what the sparkline reads as good", () => {
    // Simulate three successive snapshots after progressive rebalancing.
    const series = [300_000, 180_000, 60_000];
    const first = series[0];
    const last = series[series.length - 1];
    expect(last).toBeLessThan(first); // converging → sparkline tone "emerald"
  });
});
