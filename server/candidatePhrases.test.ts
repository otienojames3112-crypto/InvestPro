/**
 * Stage 7a — pure candidate/synonym-phrase matching. No LLM, no DB, no network.
 * Every test operates on a literal in-memory source-text string.
 */
import { describe, expect, it } from "vitest";
import { findCandidatePhrases } from "../shared/candidatePhrases";

describe("Stage 7a · CBK synonyms", () => {
  it("recognises 'Due Date' as a maturityDate candidate", () => {
    const text = "Bond terms: Coupon 13.5%. Due Date: 15-Jan-2032. Issue Number: FXD1/2022/010.";
    const [c] = findCandidatePhrases(text, [{ key: "maturityDate", label: "maturity date" }], "cbk");
    expect(c).toBeDefined();
    expect(c.phrase.toLowerCase()).toBe("due date");
    expect(c.value).toBe("15-Jan-2032");
  });

  it("recognises 'payment deadline' as a valueDate candidate", () => {
    const text = "Settlement details — payment deadline: 14-Jul-2026. Value KES 4,000,000,000.";
    const [c] = findCandidatePhrases(text, [{ key: "valueDate", label: "value / settlement date" }], "cbk");
    expect(c).toBeDefined();
    expect(c.phrase.toLowerCase()).toBe("payment deadline");
    expect(c.value).toBe("14-Jul-2026");
  });

  it("recognises 'weighted average rate of accepted bids' as a yieldPct candidate", () => {
    const text = "A. RESULTS OF 91 DAYS TREASURY BILLS\nWeighted average rate of accepted bids: 8.8347%";
    const [c] = findCandidatePhrases(text, [{ key: "yieldPct", label: "rate / coupon / previous average rate" }], "cbk");
    expect(c).toBeDefined();
    expect(c.phrase.toLowerCase()).toBe("weighted average rate of accepted bids");
    expect(c.value).toBe("8.8347%");
  });

  it("prefers the longer, more specific phrase over a shorter prefix (term to maturity, not term)", () => {
    const text = "Term to maturity: 10 years";
    const [c] = findCandidatePhrases(text, [{ key: "tenor", label: "tenor" }], "cbk");
    expect(c.phrase.toLowerCase()).toBe("term to maturity");
    expect(c.value).toBe("10 years");
  });
});

describe("Stage 7a · MMF synonyms", () => {
  it("recognises 'factsheet date' as an asOf candidate", () => {
    const text = "Fund Fact Sheet — Factsheet Date: 30-Jun-2026. EAR 16.10%.";
    const [c] = findCandidatePhrases(text, [{ key: "asOf", label: "as-of date" }], "mmf");
    expect(c).toBeDefined();
    expect(c.phrase.toLowerCase()).toBe("factsheet date");
    expect(c.value).toBe("30-Jun-2026");
  });

  it("recognises 'effective annual rate' as an ear candidate", () => {
    const text = "Effective Annual Rate: 16.10% (net of fees).";
    const [c] = findCandidatePhrases(text, [{ key: "ear", label: "gross yield or EAR" }], "mmf");
    expect(c.phrase.toLowerCase()).toBe("effective annual rate");
    expect(c.value).toContain("16.10%");
  });
});

describe("Stage 7a · Bank synonyms", () => {
  it("recognises 'nominal rate' as an indicativeRate candidate and 'notice period' as typicalTenor", () => {
    const text = "Nominal rate: 12% p.a. Notice period: 30 days.";
    const cs = findCandidatePhrases(
      text,
      [
        { key: "indicativeRate", label: "indicative rate" },
        { key: "typicalTenor", label: "tenor / notice period" },
      ],
      "bank",
    );
    expect(cs).toHaveLength(2);
    expect(cs[0].phrase.toLowerCase()).toBe("nominal rate");
    expect(cs[1].phrase.toLowerCase()).toBe("notice period");
  });
});

describe("Stage 7a · Market asset (REIT / offshore / SACCO) synonyms", () => {
  it("REIT: recognises 'distribution yield'", () => {
    const text = "Fahari I-REIT — Distribution yield: 9.2% p.a.";
    const [c] = findCandidatePhrases(text, [{ key: "distributionYield", label: "distribution yield" }], "market_asset");
    expect(c.phrase.toLowerCase()).toBe("distribution yield");
    expect(c.value).toContain("9.2%");
  });

  it("offshore: recognises 'total expense ratio' for expenseRatioPct", () => {
    const text = "Offshore Fund X — Total Expense Ratio: 1.75%. Fund currency USD.";
    const [c] = findCandidatePhrases(text, [{ key: "expenseRatioPct", label: "expense ratio / fee" }], "market_asset");
    expect(c.phrase.toLowerCase()).toBe("total expense ratio");
    expect(c.value).toContain("1.75%");
  });

  it("SACCO: recognises 'SASRA status' for regulatoryStatus", () => {
    const text = "Example SACCO — SASRA status: Deposit-taking, licensed.";
    const [c] = findCandidatePhrases(text, [{ key: "regulatoryStatus", label: "SASRA / regulatory status" }], "market_asset");
    expect(c.phrase.toLowerCase()).toBe("sasra status");
  });

  it("SACCO: the compound dividend/rebate OR-key matches via either side's synonyms", () => {
    const text = "Example SACCO — Rebate rate: 8.0% on deposits.";
    const [c] = findCandidatePhrases(
      text,
      [{ key: "shareCapitalDividendRate|depositRebateRate", label: "share-capital dividend rate or deposit rebate / interest rate" }],
      "market_asset",
    );
    expect(c).toBeDefined();
    expect(c.key).toBe("shareCapitalDividendRate|depositRebateRate");
    expect(c.phrase.toLowerCase()).toBe("rebate rate");
    expect(c.value).toContain("8.0%");
  });
});

describe("Stage 7a · guardrails — never hallucinates, never false-positives", () => {
  it("a field with NO registered synonym list never produces a candidate", () => {
    const text = "This document mentions absolutely everything, including securityType and whtRule details.";
    const cs = findCandidatePhrases(text, [{ key: "securityType", label: "security type" }], "cbk");
    expect(cs).toEqual([]);
  });

  it("a registered synonym that simply isn't in the text produces no candidate (silence, not a false positive)", () => {
    const text = "This bulletin only states the issue number and the coupon rate. Nothing else is printed.";
    const cs = findCandidatePhrases(text, [{ key: "maturityDate", label: "maturity date" }], "cbk");
    expect(cs).toEqual([]);
  });

  it("never returns a fabricated value — a phrase with nothing usable nearby returns value: null, not an invented string", () => {
    const text = "Due Date\n\n(see table below for details)";
    const cs = findCandidatePhrases(text, [{ key: "maturityDate", label: "maturity date" }], "cbk");
    expect(cs).toHaveLength(1);
    expect(cs[0].phrase.toLowerCase()).toBe("due date");
    expect(cs[0].value).toBeNull();
  });

  it("empty source text produces no candidates and does not throw", () => {
    expect(findCandidatePhrases("", [{ key: "maturityDate", label: "maturity date" }], "cbk")).toEqual([]);
    expect(findCandidatePhrases("   ", [{ key: "maturityDate", label: "maturity date" }], "cbk")).toEqual([]);
  });

  it("empty missingRules produces no candidates and does not throw", () => {
    expect(findCandidatePhrases("Due Date: 2032-01-15", [], "cbk")).toEqual([]);
  });

  it("this module never mutates or reads anything beyond its own inputs — no drafting/gate/approval symbols appear", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../shared/candidatePhrases.ts"), "utf8");
    expect(src).not.toMatch(/checkApprovalGate|draftFromFinding|extractedFields\[|invokeLLM|fetch\(/);
  });
});
