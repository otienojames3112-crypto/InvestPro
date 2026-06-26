import { describe, it, expect } from "vitest";
import { currentSecurityValue, type CurrentValueSecurity } from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R51 — the Dashboard summary card adds a value-weighted average days-to-maturity
// (wAvgDays) and a value-weighted simple yield-to-maturity (wAvgYtmPct). Each lot's
// remaining days are weighted by its current (mark-to-model) value; YTM annualizes
// each lot's remaining gain (face − current) / current over its remaining life.
// This mirrors the Dashboard memo so the figures can't silently drift.
// ─────────────────────────────────────────────────────────────────────────────

const ISO = (d: Date) => d.toISOString().slice(0, 10);
const shift = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

type Lot = CurrentValueSecurity & { purchasePrice?: number | null };

const DAY = 1000 * 60 * 60 * 24;

// Framework-free mirror of the Dashboard weighted-maturity aggregation.
function weighted(rows: Lot[], today = new Date()) {
  const now = today.getTime();
  let dtmWeight = 0;
  let dtmWeighted = 0;
  let ytmWeighted = 0;
  for (const s of rows) {
    if (s.isMatured) continue;
    const face = Number(s.faceValue) || 0;
    if (face <= 0) continue;
    const current = currentSecurityValue(s, today);
    if (current <= 0) continue;
    const mt = new Date(String(s.maturityDate)).getTime();
    const days = Math.max(0, Math.round((mt - now) / DAY));
    dtmWeight += current;
    dtmWeighted += days * current;
    if (days > 0) {
      const periodReturn = (face - current) / current;
      ytmWeighted += periodReturn * (365 / days) * current;
    }
  }
  const wAvgDays = dtmWeight > 0 ? Math.round(dtmWeighted / dtmWeight) : 0;
  const wAvgYtmPct = dtmWeight > 0 ? (ytmWeighted / dtmWeight) * 100 : 0;
  return { wAvgDays, wAvgYtmPct };
}

describe("R51 — weighted maturity & YTM", () => {
  it("a single lot's weighted DTM equals its own remaining days", () => {
    const today = new Date();
    const rows: Lot[] = [
      {
        securityType: "tbill_364",
        faceValue: 100_000,
        purchasePrice: 90_000,
        issueDate: ISO(shift(-100)),
        maturityDate: ISO(shift(200)),
        isMatured: false,
      },
    ];
    const { wAvgDays, wAvgYtmPct } = weighted(rows, today);
    expect(wAvgDays).toBeGreaterThanOrEqual(199);
    expect(wAvgDays).toBeLessThanOrEqual(201);
    expect(wAvgYtmPct).toBeGreaterThan(0);
  });

  it("weighted DTM sits between the shortest and longest lot", () => {
    const today = new Date();
    const rows: Lot[] = [
      {
        securityType: "tbill_91",
        faceValue: 50_000,
        purchasePrice: 49_000,
        issueDate: ISO(shift(-61)),
        maturityDate: ISO(shift(30)),
        isMatured: false,
      },
      {
        securityType: "tbill_364",
        faceValue: 200_000,
        purchasePrice: 180_000,
        issueDate: ISO(shift(-64)),
        maturityDate: ISO(shift(300)),
        isMatured: false,
      },
    ];
    const { wAvgDays } = weighted(rows, today);
    expect(wAvgDays).toBeGreaterThan(30);
    expect(wAvgDays).toBeLessThan(300);
  });

  it("higher-value long lot pulls the weighted DTM toward it", () => {
    const today = new Date();
    const small: Lot = {
      securityType: "tbill_91",
      faceValue: 10_000,
      purchasePrice: 9_900,
      issueDate: ISO(shift(-61)),
      maturityDate: ISO(shift(30)),
      isMatured: false,
    };
    const bigLong: Lot = {
      securityType: "tbill_364",
      faceValue: 1_000_000,
      purchasePrice: 900_000,
      issueDate: ISO(shift(-64)),
      maturityDate: ISO(shift(300)),
      isMatured: false,
    };
    const { wAvgDays } = weighted([small, bigLong], today);
    // Dominated by the big long lot, so closer to 300 than to 30.
    expect(wAvgDays).toBeGreaterThan(250);
  });

  it("empty portfolio yields zero days and zero YTM", () => {
    const { wAvgDays, wAvgYtmPct } = weighted([]);
    expect(wAvgDays).toBe(0);
    expect(wAvgYtmPct).toBe(0);
  });
});
