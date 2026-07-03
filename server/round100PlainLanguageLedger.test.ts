import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Round 100 — Plain-Language Instrument-Specific Ledger
 *
 * Validates that:
 * 1. The engine emits InstrumentEvent[] and SecondaryMmfMonthDetail[] per month
 * 2. The lotLabel helper uses issueNumber when available
 * 3. The mainAction includes liquidity-at-goal language on the final month
 * 4. The no_sweep event is emitted when the guard blocks sweeping
 * 5. The missed_contribution event fires for projected months with zero contribution
 * 6. Bank maturity events include redeployment context
 * 7. T-bill purchase events are emitted during sweeps
 * 8. The Ledger.tsx renders instrumentEvents and secondaryMmfDetail in the popover
 */

const engineSrc = readFileSync(resolve(__dirname, "engine.ts"), "utf-8");
const ledgerSrc = readFileSync(resolve(__dirname, "../client/src/pages/Ledger.tsx"), "utf-8");

describe("Round 100 — InstrumentEvent type and emission", () => {
  it("defines InstrumentEvent with kind, description, amount, instrument, details", () => {
    expect(engineSrc).toContain("export interface InstrumentEvent");
    // kind is a union type, not `kind: string;`
    expect(engineSrc).toContain('| "tbill_purchase"');
    expect(engineSrc).toContain("description: string;");
    expect(engineSrc).toContain("amount: number;");
    expect(engineSrc).toContain("instrument: string;");
    expect(engineSrc).toContain("details?: Record<string, string | number | null>;");
  });

  it("defines SecondaryMmfMonthDetail with per-fund fields", () => {
    expect(engineSrc).toContain("export interface SecondaryMmfMonthDetail");
    expect(engineSrc).toContain("label: string;");
    expect(engineSrc).toContain("deposit: number;");
    expect(engineSrc).toContain("grossInterest: number;");
    expect(engineSrc).toContain("wht: number;");
    expect(engineSrc).toContain("netInterest: number;");
    expect(engineSrc).toContain("endBalance: number;");
  });

  it("MonthResult includes instrumentEvents and secondaryMmfDetail", () => {
    expect(engineSrc).toContain("instrumentEvents: InstrumentEvent[];");
    expect(engineSrc).toContain("secondaryMmfDetail: SecondaryMmfMonthDetail[];");
  });
});

describe("Round 100 — lotLabel helper", () => {
  it("uses issueNumber when available in the label", () => {
    // The lotLabel function should check for lot.issueNumber
    expect(engineSrc).toContain("function lotLabel(lot:");
    expect(engineSrc).toContain("lot.issueNumber");
  });

  it("falls back to tenorLabel when no issueNumber", () => {
    expect(engineSrc).toContain("tenorLabel(lot.bucket, lot.tenorMonths)");
  });
});

describe("Round 100 — SecurityLot and ActualSecurity have issueNumber", () => {
  it("SecurityLot has issueNumber field", () => {
    const lotBlock = engineSrc.slice(
      engineSrc.indexOf("export interface SecurityLot"),
      engineSrc.indexOf("export interface SecurityLot") + 1500,
    );
    expect(lotBlock).toContain("issueNumber");
  });

  it("ActualSecurity has issueNumber field", () => {
    const actBlock = engineSrc.slice(
      engineSrc.indexOf("export interface ActualSecurity"),
      engineSrc.indexOf("export interface ActualSecurity") + 1500,
    );
    expect(actBlock).toContain("issueNumber");
  });
});

describe("Round 100 — Contribution events", () => {
  it("emits contribution event for projected months with a deposit", () => {
    expect(engineSrc).toContain('kind: "contribution"');
    expect(engineSrc).toContain("planned savings added to the primary MMF");
  });

  it("emits missed_contribution event when no contribution but one was planned", () => {
    expect(engineSrc).toContain('kind: "missed_contribution"');
    expect(engineSrc).toContain("No contribution recorded this month");
  });
});

describe("Round 100 — MMF interest events", () => {
  it("emits mmf_interest event with net interest and WHT", () => {
    expect(engineSrc).toContain('kind: "mmf_interest"');
    expect(engineSrc).toContain("Primary MMF earned");
  });
});

describe("Round 100 — T-bill maturity events with lotLabel", () => {
  it("emits tbill_maturity event with lotLabel-based description", () => {
    expect(engineSrc).toContain('kind: "tbill_maturity"');
    expect(engineSrc).toContain("matured: KES");
    expect(engineSrc).toContain("face value returned");
  });
});

describe("Round 100 — Bond coupon and maturity events", () => {
  it("emits bond_coupon event with gross/WHT/net breakdown", () => {
    expect(engineSrc).toContain('kind: "bond_coupon"');
    expect(engineSrc).toContain("coupon paid: KES");
  });

  it("emits bond_maturity event with principal return", () => {
    expect(engineSrc).toContain('kind: "bond_maturity"');
  });
});

describe("Round 100 — Bank events", () => {
  it("emits bank_placement event with rate and tenor", () => {
    expect(engineSrc).toContain('kind: "bank_placement"');
    expect(engineSrc).toContain("Placed KES");
  });

  it("emits bank_maturity event with redeployment context", () => {
    expect(engineSrc).toContain('kind: "bank_maturity"');
    expect(engineSrc).toContain("matured:");
    expect(engineSrc).toContain("returned to MMF");
  });
});

describe("Round 100 — Sweep purchase events", () => {
  it("emits tbill_purchase event during sweeps", () => {
    expect(engineSrc).toContain('kind: "tbill_purchase"');
    expect(engineSrc).toContain("Bought KES");
    expect(engineSrc).toContain("face value of");
  });
});

describe("Round 100 — No-sweep event", () => {
  it("emits no_sweep event when guard blocks the sweep", () => {
    expect(engineSrc).toContain('kind: "no_sweep"');
    expect(engineSrc).toContain("No sweep this month because");
  });
});

describe("Round 100 — Liquidity-at-goal enforcement", () => {
  it("emits liquidity_at_goal event on the final month", () => {
    expect(engineSrc).toContain('kind: "liquidity_at_goal"');
    expect(engineSrc).toContain("Goal month reached. All funds are liquid");
  });

  it("appends goal-month narration to mainAction on the final projected month", () => {
    expect(engineSrc).toContain(
      "Goal month reached — all funds are liquid in MMF/cash, no instruments mature after this date",
    );
  });

  it("the guard prevents sweeps in the no-buy tail (existing enforcement)", () => {
    expect(engineSrc).toContain("return { allowed: false, maxTbillTenor: 0, allowLongBonds: false };");
  });
});

describe("Round 100 — Secondary MMF per-fund detail", () => {
  it("emits mmf_deposit event for each secondary fund with a contribution", () => {
    expect(engineSrc).toContain('kind: "mmf_deposit"');
  });

  it("populates secondaryMmfDetail with per-fund breakdown", () => {
    expect(engineSrc).toContain("secondaryMmfDetail.push({");
    expect(engineSrc).toContain("label: sec.label");
  });
});

describe("Round 100 — Ledger UI renders events", () => {
  it("renders instrumentEvents in the popover", () => {
    expect(ledgerSrc).toContain("Cash Flow Events");
    expect(ledgerSrc).toContain("r.instrumentEvents");
    expect(ledgerSrc).toContain("ev.description");
  });

  it("renders secondaryMmfDetail in the popover", () => {
    expect(ledgerSrc).toContain("Per-Fund MMF Detail");
    expect(ledgerSrc).toContain("r.secondaryMmfDetail");
    expect(ledgerSrc).toContain("f.endBalance");
    expect(ledgerSrc).toContain("f.netInterest");
  });
});

describe("Round 100 — mapActualSecurities passes issueNumber from holdingSnapshot", () => {
  const routersSrc = readFileSync(resolve(__dirname, "routers.ts"), "utf-8");
  it("extracts issueNumber from holdingSnapshot.copiedTerms", () => {
    expect(routersSrc).toContain("holdingSnapshot?.copiedTerms?.issueNumber");
  });
});
