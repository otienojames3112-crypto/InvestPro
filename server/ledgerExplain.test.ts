import { describe, it, expect } from "vitest";
import { explainLedgerRow, type LedgerExplainRow } from "@shared/ledgerExplain";

function row(over: Partial<LedgerExplainRow> = {}): LedgerExplainRow {
  return {
    monthNumber: over.monthNumber ?? 7,
    mainAction: over.mainAction ?? "Move KES 50,000 from the MMF into a 182-day T-bill maturing May 2027",
    contribution: over.contribution ?? 0,
    cbkCashIn: over.cbkCashIn ?? 0,
    bankCashIn: over.bankCashIn ?? 0,
    mmfToDhow: over.mmfToDhow ?? 0,
    mmfInterestNet: over.mmfInterestNet ?? 0,
    mmfEnd: over.mmfEnd ?? 120000,
    totalEnd: over.totalEnd ?? 250000,
    isActual: over.isActual ?? false,
    offPlan: over.offPlan ?? false,
    phase: over.phase ?? "growth",
  };
}

describe("explainLedgerRow — headline mirrors the engine verbatim", () => {
  it("uses mainAction as the headline so the panel can never drift from the cell", () => {
    const ma = "Add this month's saving to the MMF; nothing swept into securities this month";
    const e = explainLedgerRow(row({ mainAction: ma }));
    expect(e.headline).toBe(ma);
  });
});

describe("explainLedgerRow — only emits legs the row actually carries", () => {
  it("shows a saving leg only when there is a contribution", () => {
    const e = explainLedgerRow(row({ contribution: 20000 }));
    const save = e.lines.find((l) => l.key === "save");
    expect(save).toBeTruthy();
    expect(save!.sign).toBe("in");
    expect(save!.detail).toContain("KES 20,000");
  });

  it("omits a saving leg when contribution is zero", () => {
    const e = explainLedgerRow(row({ contribution: 0, mmfToDhow: 50000 }));
    expect(e.lines.find((l) => l.key === "save")).toBeUndefined();
  });

  it("shows CBK-in, bank-in and swept-out legs with correct signs", () => {
    const e = explainLedgerRow(row({ cbkCashIn: 50000, bankCashIn: 100000, mmfToDhow: 40000 }));
    expect(e.lines.find((l) => l.key === "cbk_in")!.sign).toBe("in");
    expect(e.lines.find((l) => l.key === "bank_in")!.sign).toBe("in");
    expect(e.lines.find((l) => l.key === "swept_out")!.sign).toBe("out");
  });

  it("renders a quiet-month line when nothing flowed", () => {
    const e = explainLedgerRow(row({}));
    expect(e.lines).toHaveLength(1);
    expect(e.lines[0].key).toBe("quiet");
  });
});

describe("explainLedgerRow — tense follows the settled/projected basis", () => {
  it("reads in the past tense for a settled month", () => {
    const e = explainLedgerRow(row({ isActual: true, contribution: 20000 }));
    expect(e.lede).toContain("settled");
    expect(e.lines.find((l) => l.key === "save")!.detail).toMatch(/You added/);
    expect(e.closing).toMatch(/stood at/);
  });

  it("reads in the present/future for a projected month", () => {
    const e = explainLedgerRow(row({ isActual: false, contribution: 20000 }));
    expect(e.lede).toContain("projected");
    expect(e.lines.find((l) => l.key === "save")!.detail).toMatch(/is added/);
    expect(e.closing).toMatch(/projected at/);
  });
});

describe("explainLedgerRow — figures come only from row fields", () => {
  it("never shows a KES amount that is not on the row", () => {
    const e = explainLedgerRow(
      row({ contribution: 20000, cbkCashIn: 50000, mmfToDhow: 40000, mmfEnd: 130000, totalEnd: 260000 }),
    );
    const text = [e.closing, ...e.lines.map((l) => l.detail)].join(" ");
    const amounts = (text.match(/KES ([\d,]+)/g) ?? []).map((s) => s.replace(/KES |,/g, ""));
    const allowed = new Set(["20000", "20,000", "50000", "50,000", "40000", "40,000", "130000", "130,000", "260000", "260,000"].map((s) => s.replace(/,/g, "")));
    for (const a of amounts) expect(allowed.has(a)).toBe(true);
  });

  it("carries the offPlan flag straight through", () => {
    expect(explainLedgerRow(row({ isActual: true, offPlan: true })).offPlan).toBe(true);
    expect(explainLedgerRow(row({ isActual: true, offPlan: false })).offPlan).toBe(false);
  });
});

describe("explainLedgerRow — non-advisory", () => {
  it("never uses advisory language", () => {
    const e = explainLedgerRow(
      row({ isActual: true, contribution: 20000, cbkCashIn: 50000, mmfToDhow: 40000, mmfInterestNet: 900 }),
    );
    const banned = /\b(should|recommend|advise|best|optimal|you ought|we suggest)\b/i;
    const all = [e.lede, e.closing, ...e.lines.map((l) => l.detail)].join(" ");
    expect(all).not.toMatch(banned);
  });
});
