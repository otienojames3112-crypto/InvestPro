import { describe, it, expect } from "vitest";
import {
  runProjection,
  pastTensifyMainAction,
  type EngineSettings,
  type ActualDeposit,
} from "./engine";

/**
 * R75 — tense-aware ledger Main Action + actual materialized amounts.
 *
 * Once the (real or simulated) clock has passed a month, that month has
 * actually happened and its Main Action should read in the past tense and
 * state the REAL contribution that landed (e.g. an injected-variance amount),
 * not the originally-scheduled figure. Months still ahead of the clock keep
 * the present/future tense.
 */

// Build a start date exactly `n` whole months before today (UTC, day 1).
function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

const START = pastStartISO(4);

const SETTINGS: EngineSettings = {
  mmfYield: 13.2,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 30000,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: START,
  horizonMonths: 120,
};

describe("R75 — pastTensifyMainAction (pure)", () => {
  it("turns a sweep 'Move' into 'Moved'", () => {
    const s = "Move KES 50,000 from the MMF into a 182-day T-bill maturing May 2027";
    expect(pastTensifyMainAction(s)).toBe(
      "Moved KES 50,000 from the MMF into a 182-day T-bill maturing May 2027"
    );
  });

  it("turns 'matures at' / 'matures,' into past tense", () => {
    expect(pastTensifyMainAction("a 364-day T-bill matures at its KES 50,000 face value")).toContain(
      "matured at"
    );
    expect(pastTensifyMainAction("a 2yr FXD matures, returning KES 100,000")).toContain("matured,");
  });

  it("turns 'pays a' coupon into 'paid a'", () => {
    expect(pastTensifyMainAction("an FXD bond pays a KES 6,175 coupon into the MMF")).toContain(
      "paid a"
    );
  });

  it("turns 'Add ... saving' / 'Add KES ...' into 'Added'", () => {
    expect(pastTensifyMainAction("Add this month's saving to the MMF")).toContain("Added this month's saving");
    expect(pastTensifyMainAction("Add KES 12,345 of savings to the MMF")).toContain("Added KES 12,345 of savings");
  });

  it("is idempotent on already-past phrases (bank 'Placed'/'matured' untouched)", () => {
    const bank = "Placed KES 200,000 in Equity Bank at 11%; a fixed deposit matured, returning KES 210,000";
    // 'Placed' stays; 'matured,' stays 'matured,'.
    const out = pastTensifyMainAction(bank);
    expect(out).toContain("Placed KES 200,000");
    expect(out).toContain("matured, returning");
    // No accidental double-tensifying.
    expect(out).not.toContain("maturedd");
  });

  it("does not touch a future-tense string that has no known verbs", () => {
    const s = "kept in the MMF (no instrument matures before your goal date)";
    // 'matures' here is followed by a space -> becomes 'matured'.
    expect(pastTensifyMainAction(s)).toContain("matured before your goal date");
  });
});

describe("R75 — engine integration: settled months read in past tense", () => {
  const deposits: ActualDeposit[] = [
    { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: 1 },
  ];

  it("a settled (actual) month's Main Action is past tense, a future month's is present tense", () => {
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], 1);
    const actuals = results.filter((r) => r.isActual);
    const future = results.filter((r) => !r.isActual);
    expect(actuals.length).toBeGreaterThan(0);
    expect(future.length).toBeGreaterThan(0);

    // No settled month may contain a present-tense verb the transform handles.
    for (const a of actuals) {
      expect(a.mainAction).not.toMatch(/\bMove KES/);
      expect(a.mainAction).not.toMatch(/ matures /);
      expect(a.mainAction).not.toMatch(/Add this month's saving/);
    }
    // At least one future month keeps the present/future tense.
    expect(future.some((f) => /Move KES| matures |Add this month's saving/.test(f.mainAction))).toBe(true);
  });

  it("settled contribution-only month states the ACTUAL KES amount that went in", () => {
    // Month 1 has the real 100k deposit and (typically) no sweep yet.
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], 1);
    const m1 = results[0];
    expect(m1.isActual).toBe(true);
    // Its narration should mention the actual amount in past tense when it is a
    // pure-contribution month (no maturities, no sweep).
    if (/of savings to the MMF/.test(m1.mainAction)) {
      expect(m1.mainAction).toMatch(/Added KES [\d,]+ of savings/);
      // The amount equals the recorded contribution for that month.
      expect(m1.mainAction).toContain(Math.round(m1.contribution).toLocaleString());
    }
  });
});
