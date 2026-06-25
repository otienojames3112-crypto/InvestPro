import { describe, it, expect } from "vitest";
import { buildBankIncome, type BankIncomeInput } from "../shared/incomeBreakdown";

// ─────────────────────────────────────────────────────────────────────────────
// R41.5 — Bank Instruments must offer the same 7/30/90/180/365-day "Accrual
// Inputs" interest breakdown the MMF tab has, including a per-bank subtotal.
// These tests lock the engine the UI consumes (buildBankIncome) and the
// per-bank grouping the page renders.
// ─────────────────────────────────────────────────────────────────────────────

const HOLDINGS: BankIncomeInput[] = [
  { id: 1, bankName: "KCB", instrumentType: "fixed_deposit", principal: 1_000_000, interestRate: 12, whtRate: 15 },
  { id: 2, bankName: "KCB", instrumentType: "call_deposit", principal: 500_000, interestRate: 9, whtRate: 15 },
  { id: 3, bankName: "Equity", instrumentType: "fixed_deposit", principal: 2_000_000, interestRate: 13, whtRate: 15 },
];

describe("R41.5 — bank interest scales with the projection horizon", () => {
  it("90-day gross is ~3x the 30-day gross (pro-rata)", () => {
    const d30 = buildBankIncome(HOLDINGS, 30);
    const d90 = buildBankIncome(HOLDINGS, 90);
    expect(d90.grossHorizon).toBeCloseTo(d30.grossHorizon * 3, 4);
    expect(d90.netHorizon).toBeCloseTo(d30.netHorizon * 3, 4);
  });

  it("7-day horizon equals annual gross × 7/365", () => {
    const d7 = buildBankIncome(HOLDINGS, 7);
    const expectedAnnual =
      1_000_000 * 0.12 + 500_000 * 0.09 + 2_000_000 * 0.13;
    expect(d7.grossHorizon).toBeCloseTo((expectedAnnual * 7) / 365, 2);
  });

  it("365-day horizon equals the annual gross", () => {
    const d365 = buildBankIncome(HOLDINGS, 365);
    expect(d365.grossHorizon).toBeCloseTo(d365.grossAnnual, 2);
  });

  it("net = gross − WHT for every horizon", () => {
    for (const days of [7, 30, 90, 180, 365]) {
      const s = buildBankIncome(HOLDINGS, days);
      expect(s.netHorizon).toBeCloseTo(s.grossHorizon - s.whtHorizon, 4);
    }
  });
});

describe("R41.5 — per-bank subtotal grouping (mirrors the page table)", () => {
  // Replicate the grouping logic used in IncomeBreakdownSection.
  function groupByBank(rows: { label: string; grossHorizon: number; whtHorizon: number; netHorizon: number }[]) {
    const map = new Map<string, { name: string; gross: number; wht: number; net: number; count: number }>();
    for (const r of rows) {
      const g = map.get(r.label) ?? { name: r.label, gross: 0, wht: 0, net: 0, count: 0 };
      g.gross += r.grossHorizon;
      g.wht += r.whtHorizon;
      g.net += r.netHorizon;
      g.count += 1;
      map.set(r.label, g);
    }
    return Array.from(map.values());
  }

  it("groups KCB's two instruments into one row and sums their interest", () => {
    const summary = buildBankIncome(HOLDINGS, 90);
    const groups = groupByBank(summary.rows);
    const kcb = groups.find((g) => g.name === "KCB");
    expect(kcb).toBeDefined();
    expect(kcb!.count).toBe(2);

    const kcbRows = summary.rows.filter((r) => r.label === "KCB");
    const expectedGross = kcbRows.reduce((s, r) => s + r.grossHorizon, 0);
    expect(kcb!.gross).toBeCloseTo(expectedGross, 4);
  });

  it("per-bank subtotals sum to the overall horizon total", () => {
    const summary = buildBankIncome(HOLDINGS, 90);
    const groups = groupByBank(summary.rows);
    const groupedNet = groups.reduce((s, g) => s + g.net, 0);
    expect(groupedNet).toBeCloseTo(summary.netHorizon, 4);
  });

  it("produces a row per distinct bank (KCB + Equity = 2 groups)", () => {
    const groups = groupByBank(buildBankIncome(HOLDINGS, 30).rows);
    expect(groups.length).toBe(2);
  });
});
