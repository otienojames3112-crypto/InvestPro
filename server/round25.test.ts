import { describe, it, expect } from "vitest";

/**
 * Round 25 — laddering presets, configurable maturing-soon window, rollover link.
 *
 * These features are UI/router-level, so the deterministic logic is locked here:
 *   1. The one-tap laddering preset math the split dialog uses to set the MMF
 *      portion from a ratio (25/75, 50/50, 75/25), rounded to the nearest 1,000,
 *      with the re-buy side as the remainder.
 *   2. The configurable maturing-soon window selection (30/60/90 days), shared by
 *      the Securities page and the sidebar badge, including already-overdue lots.
 *   3. The rollover-link invariant: a recycled (rolledIntoId set) matured lot is
 *      no longer offered for re-rolling, and the trail points at the replacement.
 */

// ── 1. Laddering preset math (mirror of the split dialog) ──────────────────────
function presetMmf(total: number, ratio: number): number {
  return Math.min(Math.round((total * ratio) / 1000) * 1000, total);
}
function rebuyRemainder(total: number, mmf: number): number {
  return Math.max(Math.round((total - mmf) * 100) / 100, 0);
}

describe("Round 25 — laddering preset allocation", () => {
  it("25/75 sets a quarter to MMF, three-quarters to re-buy", () => {
    const total = 200000;
    const mmf = presetMmf(total, 0.25);
    expect(mmf).toBe(50000);
    expect(rebuyRemainder(total, mmf)).toBe(150000);
  });
  it("50/50 splits evenly", () => {
    const total = 200000;
    const mmf = presetMmf(total, 0.5);
    expect(mmf).toBe(100000);
    expect(rebuyRemainder(total, mmf)).toBe(100000);
  });
  it("75/25 sets three-quarters to MMF", () => {
    const total = 200000;
    const mmf = presetMmf(total, 0.75);
    expect(mmf).toBe(150000);
    expect(rebuyRemainder(total, mmf)).toBe(50000);
  });
  it("rounds odd totals to the nearest 1,000 and never exceeds the total", () => {
    const total = 333333;
    const mmf = presetMmf(total, 0.5);
    expect(mmf % 1000).toBe(0);
    expect(mmf).toBeLessThanOrEqual(total);
    expect(rebuyRemainder(total, mmf)).toBeGreaterThan(0);
  });
});

// ── 2. Configurable maturing-soon window (mirror of useMaturingWindow) ─────────
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
function inWindow(maturityISO: string, windowDays: 30 | 60 | 90): boolean {
  return daysUntil(maturityISO) <= windowDays;
}
function isoInDays(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}

describe("Round 25 — configurable maturing-soon window", () => {
  it("a 45-day lot is hidden at 30d but shown at 60d and 90d", () => {
    const lot = isoInDays(45);
    expect(inWindow(lot, 30)).toBe(false);
    expect(inWindow(lot, 60)).toBe(true);
    expect(inWindow(lot, 90)).toBe(true);
  });
  it("a 75-day lot is hidden at 30d/60d but shown at 90d", () => {
    const lot = isoInDays(75);
    expect(inWindow(lot, 30)).toBe(false);
    expect(inWindow(lot, 60)).toBe(false);
    expect(inWindow(lot, 90)).toBe(true);
  });
  it("an overdue lot is always shown regardless of window", () => {
    const lot = isoInDays(-10);
    expect(inWindow(lot, 30)).toBe(true);
    expect(inWindow(lot, 60)).toBe(true);
    expect(inWindow(lot, 90)).toBe(true);
  });
});

// ── 3. Rollover-link invariant (mirror of the register UI gating) ──────────────
type Lot = { id: number; isMatured: boolean; rolledIntoId: number | null };

/** Matured lots eligible for the "Roll over" action are those not yet recycled. */
function rollableMatured(lots: Lot[]): Lot[] {
  return lots.filter((l) => l.isMatured && l.rolledIntoId == null);
}

describe("Round 25 — rollover link gating", () => {
  const lots: Lot[] = [
    { id: 1, isMatured: true, rolledIntoId: 7 }, // already recycled
    { id: 2, isMatured: true, rolledIntoId: null }, // still rollable
    { id: 7, isMatured: false, rolledIntoId: null }, // the replacement
  ];
  it("hides the Roll over action once a lot has been recycled", () => {
    const ids = rollableMatured(lots).map((l) => l.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(1);
  });
  it("points the matured lot at its replacement for the audit trail", () => {
    const recycled = lots.find((l) => l.id === 1)!;
    expect(recycled.rolledIntoId).toBe(7);
    expect(lots.some((l) => l.id === recycled.rolledIntoId)).toBe(true);
  });
});
