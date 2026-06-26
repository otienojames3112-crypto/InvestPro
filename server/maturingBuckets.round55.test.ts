import { describe, it, expect } from "vitest";

/**
 * R55.1 — the CBK Securities Register groups maturing-soon lots into horizon
 * buckets (Within 90 days / 90 days–1 year / 1–2 years / Beyond 2 years) when a
 * wide window is selected and there are enough lots spread across horizons.
 *
 * These tests pin the pure bucketing rule (mirrored from Securities.tsx) so the
 * grouping logic stays stable independent of the React layer.
 */

type Lot = { id: number; days: number };

// Mirror of the bucket boundaries used in the page.
const BUCKETS: { label: string; max: number }[] = [
  { label: "Within 90 days", max: 90 },
  { label: "90 days – 1 year", max: 365 },
  { label: "1 – 2 years", max: 730 },
  { label: "Beyond 2 years", max: Infinity },
];

function bucketLabel(days: number): string {
  return BUCKETS.find((b) => days <= b.max)!.label;
}

function groupByHorizon(lots: Lot[]): { label: string; lots: Lot[] }[] {
  return BUCKETS.map((b) => ({
    label: b.label,
    lots: lots.filter((l) => bucketLabel(l.days) === b.label),
  })).filter((g) => g.lots.length > 0);
}

// Mirror of the `useBuckets` gate in the page.
function shouldBucket(windowDays: number, lots: Lot[]): boolean {
  const groups = groupByHorizon(lots);
  return windowDays >= 365 && lots.length >= 4 && groups.length > 1;
}

describe("R55.1 maturing-soon horizon bucketing", () => {
  it("assigns each lot to the correct horizon bucket", () => {
    expect(bucketLabel(0)).toBe("Within 90 days"); // due/overdue
    expect(bucketLabel(45)).toBe("Within 90 days");
    expect(bucketLabel(90)).toBe("Within 90 days");
    expect(bucketLabel(91)).toBe("90 days – 1 year");
    expect(bucketLabel(365)).toBe("90 days – 1 year");
    expect(bucketLabel(366)).toBe("1 – 2 years");
    expect(bucketLabel(730)).toBe("1 – 2 years");
    expect(bucketLabel(900)).toBe("Beyond 2 years");
  });

  it("drops empty buckets and keeps order soonest-first", () => {
    const groups = groupByHorizon([
      { id: 1, days: 10 },
      { id: 2, days: 500 },
    ]);
    // The 90d–1yr bucket is empty and must be omitted; order stays soonest-first.
    expect(groups.map((g) => g.label)).toEqual([
      "Within 90 days",
      "1 – 2 years",
    ]);
  });

  it("buckets only for wide windows with enough spread", () => {
    const spread: Lot[] = [
      { id: 1, days: 20 },
      { id: 2, days: 200 },
      { id: 3, days: 500 },
      { id: 4, days: 900 },
    ];
    // Wide window + 4 lots across 4 horizons -> bucket.
    expect(shouldBucket(730, spread)).toBe(true);
    expect(shouldBucket(36500, spread)).toBe(true);

    // Narrow window -> never bucket, even with many lots.
    expect(shouldBucket(90, spread)).toBe(false);

    // Too few lots -> flat list.
    expect(shouldBucket(730, spread.slice(0, 3))).toBe(false);

    // All in one bucket -> flat list even with a wide window.
    const allShort: Lot[] = [
      { id: 1, days: 5 },
      { id: 2, days: 30 },
      { id: 3, days: 60 },
      { id: 4, days: 80 },
    ];
    expect(shouldBucket(730, allShort)).toBe(false);
  });
});
