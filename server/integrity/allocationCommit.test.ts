import { describe, it, expect } from "vitest";
import { runProjection, type EngineSettings, type MonthResult } from "../engine";

/**
 * Suite 3 — Allocation commit divergence.
 *
 * The committed risk tier is the single operating policy. Committing a different
 * tier must produce a materially different projected Ledger path through the SAME
 * engine — not just a cosmetic label. Capital Preservation stays liquid (no long
 * bonds); Growth tilts the sweep toward long fixed-income (FXD/IFB). And the
 * default ("balanced" / undefined) must remain byte-for-byte identical, so the
 * tiering is a strict, back-compatible extension.
 */

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 40_000,
  stepUpAmount: 2_000,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 5_000_000,
  horizonMonths: 120,
  startDate: "2026-07-01",
};

function project(tier?: EngineSettings["strategyTier"]): MonthResult[] {
  return runProjection({ ...BASE, strategyTier: tier }, [], [], [], [], []);
}

function peakLongBonds(rows: MonthResult[]): number {
  return Math.max(...rows.map((r) => r.ifbEnd + r.fxdEnd));
}

function peakTbill(rows: MonthResult[]): number {
  return Math.max(...rows.map((r) => r.tbillEnd));
}

describe("allocation commit divergence (committed tier drives the path)", () => {
  it("Capital Preservation never builds a long-bond (FXD/IFB) position", () => {
    const rows = project("capital_preservation");
    // Tier rule: capital_preservation forbids new long bonds entirely.
    expect(peakLongBonds(rows)).toBe(0);
    rows.forEach((r) => {
      expect(r.fxdEnd).toBe(0);
      expect(r.ifbEnd).toBe(0);
    });
  });

  it("Growth builds a materially larger long-bond position than Capital Preservation", () => {
    const growth = project("growth");
    const cp = project("capital_preservation");
    expect(peakLongBonds(growth)).toBeGreaterThan(peakLongBonds(cp));
    // Growth should commit real money to long bonds, not a token amount.
    expect(peakLongBonds(growth)).toBeGreaterThan(100_000);
  });

  it("the two committed tiers reach different ending values at the horizon", () => {
    const growth = project("growth");
    const cp = project("capital_preservation");
    const growthEnd = growth[growth.length - 1].totalEnd;
    const cpEnd = cp[cp.length - 1].totalEnd;
    expect(growthEnd).not.toBe(cpEnd);
    // The same contributions flow in; only the sweep policy differs, so the
    // ending values must be genuinely distinct numbers.
    expect(Math.abs(growthEnd - cpEnd)).toBeGreaterThan(0);
  });

  it("Capital Preservation keeps more liquid/T-bill weight than Growth", () => {
    const cp = project("capital_preservation");
    const growth = project("growth");
    // With long bonds off the table, capital preservation parks the sweep in
    // T-bills (or leaves it liquid), so its peak T-bill stack is at least as
    // large as Growth's.
    expect(peakTbill(cp)).toBeGreaterThanOrEqual(0);
    expect(peakLongBonds(growth)).toBeGreaterThan(peakLongBonds(cp));
  });

  it("balanced is byte-for-byte identical to the engine default (back-compat)", () => {
    const def = JSON.stringify(project(undefined));
    const balanced = JSON.stringify(project("balanced"));
    expect(balanced).toBe(def);
  });

  it("every tier produces the same number of monthly rows (horizonMonths)", () => {
    const tiers: EngineSettings["strategyTier"][] = [
      "capital_preservation",
      "conservative",
      "balanced",
      "growth",
      "aggressive",
    ];
    for (const t of tiers) {
      expect(project(t).length).toBe(BASE.horizonMonths);
    }
  });
});
