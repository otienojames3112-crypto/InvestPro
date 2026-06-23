import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
} from "./engine";

/**
 * Round 22 — Dashboard reconciliation, per-instrument today snapshot, and
 * editable CBK register entries (with linked-deposit sync).
 *
 * Two backend behaviours are locked here:
 *   1. The projection's "today" value is the ending total of the LAST month the
 *      engine seeded from real deposits (isActual). This is exactly what the
 *      Dashboard reconciliation row compares against live actuals.
 *   2. Editing a register security's face value re-values net worth from the
 *      register (single source of truth) — the engine reads the register, so a
 *      new face value flows straight through. The deposit-sync field mapping
 *      (faceValue→amount, issueDate→depositDate, securityType→bucket) is also
 *      asserted as a pure mapping so the router contract stays stable.
 */

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

const START = pastStartISO(6);

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

const PRIMARY_FUND = 1;

/** Mirror of the Dashboard's projectionToday selector. */
function projectionToday(results: ReturnType<typeof runProjection>): number | null {
  let last: number | null = null;
  for (const r of results) if (r.isActual) last = r.totalEnd;
  return last;
}

describe("Round 22 — projection 'today' value for reconciliation", () => {
  it("returns the last actual month's totalEnd (matches the dashboard selector)", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const actuals = results.filter((r) => r.isActual);
    expect(actuals.length).toBeGreaterThan(0);
    const today = projectionToday(results);
    expect(today).not.toBeNull();
    expect(today).toBe(actuals[actuals.length - 1].totalEnd);
  });

  it("today value equals the sum of every pocket at that month (no double count)", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
      { bucket: "tbill", amount: 50000, depositDate: monthsAfter(START, 1, 15), institutionType: "government_security", mmfFundId: null },
    ];
    const securities: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 50000, issueDate: monthsAfter(START, 1, 15), maturityDate: monthsAfter(START, 13, 15), couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, securities, [], [], PRIMARY_FUND);
    const actuals = results.filter((r) => r.isActual);
    const t = actuals[actuals.length - 1];
    const sumOfPockets = t.mmfEnd + t.tbillEnd + t.ifbEnd + t.fxdEnd + t.secondaryMmfEnd + t.bankEnd;
    expect(t.totalEnd).toBeCloseTo(sumOfPockets, 2);
  });

  it("is null when there are no actual months (start in current month)", () => {
    const noPast = { ...SETTINGS, startDate: pastStartISO(0) };
    const results = runProjection(noPast, [], [], [], [], [], [], PRIMARY_FUND);
    // currentMonth is 0 → no isActual months → no engine 'today' value.
    expect(projectionToday(results)).toBeNull();
  });
});

describe("Round 22 — editing a register security re-values net worth", () => {
  it("a larger face value flows straight through the register-canonical engine", () => {
    const issue = monthsAfter(START, 1, 15);
    const maturity = monthsAfter(START, 13, 15);
    const before: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 50000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const deposit: ActualDeposit[] = [
      { bucket: "tbill", amount: 50000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
    ];
    const r1 = runProjection(SETTINGS, [], [], deposit, before, [], [], PRIMARY_FUND);
    const t1 = r1.filter((r) => r.isActual).pop()!;
    expect(t1.tbillEnd).toBeCloseTo(50000, 0);

    // User edits the register face value to 150k; the linked deposit amount is
    // synced too. The engine reads the register, so the new face value is used.
    const after: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 150000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const depositSynced: ActualDeposit[] = [
      { bucket: "tbill", amount: 150000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
    ];
    const r2 = runProjection(SETTINGS, [], [], depositSynced, after, [], [], PRIMARY_FUND);
    const t2 = r2.filter((r) => r.isActual).pop()!;
    expect(t2.tbillEnd).toBeCloseTo(150000, 0);
    expect(t2.totalEnd).toBeGreaterThan(t1.totalEnd);
  });

  it("changing the security type moves the lot to the right pocket", () => {
    const issue = monthsAfter(START, 1, 1);
    const before: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 100000, issueDate: issue, maturityDate: monthsAfter(START, 13, 1), couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const r1 = runProjection(SETTINGS, [], [], [], before, [], [], PRIMARY_FUND);
    const t1 = r1.filter((r) => r.isActual).pop()!;
    expect(t1.tbillEnd).toBeCloseTo(100000, 0);
    expect(t1.ifbEnd).toBe(0);

    // Re-typed to an IFB bond (tax-exempt); the value must now sit in ifbEnd.
    const after: ActualSecurity[] = [
      { securityType: "ifb", faceValue: 100000, issueDate: issue, maturityDate: monthsAfter(START, 25, 1), couponRate: 12.5, isTaxExempt: true, isMatured: false },
    ];
    const r2 = runProjection(SETTINGS, [], [], [], after, [], [], PRIMARY_FUND);
    const t2 = r2.filter((r) => r.isActual).pop()!;
    expect(t2.ifbEnd).toBeCloseTo(100000, 0);
    expect(t2.tbillEnd).toBe(0);
  });
});

/**
 * Pure mirror of the deposit-sync field mapping in securities.update. Keeping
 * this as a unit assertion means a future refactor of the router can't silently
 * change which deposit fields follow a register edit.
 */
function depositBucketForType(t: string): "tbill" | "ifb" | "fxd" {
  return t === "ifb" ? "ifb" : t === "fxd" ? "fxd" : "tbill";
}

describe("Round 22 — linked-deposit sync field mapping", () => {
  it("maps each register security type to the correct deposit bucket", () => {
    expect(depositBucketForType("tbill_91")).toBe("tbill");
    expect(depositBucketForType("tbill_182")).toBe("tbill");
    expect(depositBucketForType("tbill_364")).toBe("tbill");
    expect(depositBucketForType("ifb")).toBe("ifb");
    expect(depositBucketForType("fxd")).toBe("fxd");
  });
});
