import { describe, it, expect } from "vitest";
import {
  buildActualSavingClause,
  UNEXECUTED_SWEEP_NOTE,
  runProjection,
  getScheduledContribution,
  type EngineSettings,
  type ActualDeposit,
} from "./engine";
import { bankRowStatus, buildBankIncome, type BankIncomeInput } from "../shared/incomeBreakdown";

const BASE_SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 20000,
  stepUpAmount: 0,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
};

// ─── buildActualSavingClause (pure) ───────────────────────────────────────────
describe("R77 — buildActualSavingClause", () => {
  it("matched: actual ≈ planned reads plain past tense", () => {
    const r = buildActualSavingClause(20000, 20000);
    expect(r.divergence).toBe("matched");
    expect(r.text).toBe("Added KES 20,000 of savings to the MMF");
  });

  it("skipped: zero actual against a positive plan names the planned amount", () => {
    const r = buildActualSavingClause(0, 20000);
    expect(r.divergence).toBe("skipped");
    expect(r.text).toBe("No contribution recorded this month (KES 20,000 was planned)");
  });

  it("under-funded: states the shortfall vs the plan", () => {
    const r = buildActualSavingClause(12000, 20000);
    expect(r.divergence).toBe("under");
    expect(r.text).toBe("Added KES 12,000 to the MMF — KES 8,000 short of the KES 20,000 planned");
  });

  it("over-funded: states the excess vs the plan", () => {
    const r = buildActualSavingClause(60000, 20000);
    expect(r.divergence).toBe("over");
    expect(r.text).toBe("Added KES 60,000 to the MMF — KES 40,000 above the KES 20,000 planned");
  });

  it("nothing planned and nothing recorded → 'none', no text", () => {
    const r = buildActualSavingClause(0, 0);
    expect(r.divergence).toBe("none");
    expect(r.text).toBe("");
  });

  it("within rounding tolerance still counts as matched", () => {
    const r = buildActualSavingClause(20000.5, 20000);
    expect(r.divergence).toBe("matched");
  });
});

// ─── bankRowStatus (pure) ─────────────────────────────────────────────────────
describe("R77 — bankRowStatus", () => {
  const day = (s: string) => new Date(`${s}T12:00:00Z`).getTime();

  it("open-ended call/savings deposits are always accruing", () => {
    const r = bankRowStatus({ maturityDate: null, instrumentType: "call_deposit" }, day("2026-06-27"));
    expect(r.status).toBe("accruing");
    expect(r.label).toBe("Accruing");
  });

  it("a fixed deposit past its maturity reads matured (returned to cash)", () => {
    const r = bankRowStatus(
      { maturityDate: "2026-01-01", instrumentType: "fixed_deposit" },
      day("2026-06-27"),
    );
    expect(r.status).toBe("matured");
    expect(r.isPast).toBe(true);
    expect(r.label).toContain("Matured");
  });

  it("a fixed deposit maturing exactly today reads maturing today", () => {
    const r = bankRowStatus(
      { maturityDate: "2026-06-27", instrumentType: "fixed_deposit" },
      day("2026-06-27"),
    );
    expect(r.status).toBe("maturing");
  });

  it("a future fixed deposit is still accruing", () => {
    const r = bankRowStatus(
      { maturityDate: "2027-06-27", instrumentType: "fixed_deposit" },
      day("2026-06-27"),
    );
    expect(r.status).toBe("accruing");
  });
});

// ─── buildBankIncome now-threading + status ───────────────────────────────────
describe("R77 — buildBankIncome threads the simulated clock", () => {
  const day = (s: string) => new Date(`${s}T12:00:00Z`).getTime();
  const fd: BankIncomeInput = {
    id: 1,
    bankName: "NCBA",
    instrumentType: "fixed_deposit",
    principal: 100000,
    interestRate: 12,
    whtRate: 15,
    dayCountBasis: 365,
    maturityDate: "2026-03-01",
    isActive: true,
  };

  it("drops a fixed deposit that has matured in simulated time", () => {
    const after = buildBankIncome([fd], 30, day("2026-06-27"));
    expect(after.rows).toHaveLength(0);
  });

  it("keeps the deposit live (with an Accruing badge) before maturity", () => {
    const before = buildBankIncome([fd], 30, day("2026-01-15"));
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].statusLabel).toBe("Accruing");
  });
});

// ─── Integration: settled month with a skipped contribution ───────────────────
describe("R77 — settled-month actual-vs-planned narration", () => {
  // Plan starts 4 months before "now" so months 1–4 are settled (actuals).
  const start = new Date();
  start.setMonth(start.getMonth() - 4);
  const startDate = start.toISOString().split("T")[0];
  const nowOverride = Date.now();

  const settings: EngineSettings = {
    ...BASE_SETTINGS,
    startDate,
    nowOverride,
    horizonMonths: 120,
  };

  // Month 1 funded normally; month 2 SKIPPED (no deposit); month 3 funded.
  const isoForMonth = (m: number) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + (m - 1));
    d.setDate(15);
    return d.toISOString().split("T")[0];
  };
  const deposits: ActualDeposit[] = [
    { bucket: "mmf", amount: 20000, depositDate: isoForMonth(1), institutionType: "mmf_fund" },
    { bucket: "mmf", amount: 20000, depositDate: isoForMonth(3), institutionType: "mmf_fund" },
  ];

  const results = runProjection(settings, [], [], deposits);

  it("a settled month with NO contribution narrates the miss + planned amount and flags off-plan", () => {
    const m2 = results.find((r) => r.monthNumber === 2)!;
    expect(m2.isActual).toBe(true);
    expect(m2.mainAction).toContain("No contribution recorded this month");
    const planned = getScheduledContribution(2, settings);
    expect(m2.mainAction).toContain(Math.round(planned).toLocaleString());
    expect(m2.offPlan).toBe(true);
  });

  it("a settled month funded as planned is not flagged off-plan", () => {
    const m1 = results.find((r) => r.monthNumber === 1)!;
    expect(m1.isActual).toBe(true);
    expect(m1.offPlan).toBe(false);
    expect(m1.mainAction).toMatch(/Added KES/);
  });

  it("forward (projected) rows keep future-tense planning language and are never off-plan", () => {
    const forward = results.filter((r) => !r.isActual);
    expect(forward.length).toBeGreaterThan(0);
    expect(forward.every((r) => r.offPlan === false)).toBe(true);
    // At least one forward row still uses present/imperative wording.
    expect(forward.some((r) => /Add this month's saving|Move KES/.test(r.mainAction))).toBe(true);
  });

  it("settled rows never contain future-tense 'Move KES' / 'Add this month' wording", () => {
    const settled = results.filter((r) => r.isActual);
    expect(settled.every((r) => !/\bMove KES|Add this month's saving/.test(r.mainAction))).toBe(true);
  });

  it("exposes the unexecuted-sweep note constant for the blocked-sweep case", () => {
    // The note is composed into settled rows only when a projected sweep can't be
    // funded; assert the constant is wired and well-formed.
    expect(UNEXECUTED_SWEEP_NOTE).toContain("no sweep this month");
    expect(UNEXECUTED_SWEEP_NOTE).toContain("below the sweep threshold");
  });
});
