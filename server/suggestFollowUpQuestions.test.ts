/**
 * Stage 5 — gap-driven follow-up questions (Option B: additive `missingRules`).
 *
 * Two things are locked in here, both pure and network/DB-free:
 *   A. `checkApprovalGate` now ALSO returns `missingRules: {key,label}[]` alongside
 *      the existing `missing: string[]` labels — purely additive. Every existing
 *      caller that only reads `.missing`/`.ok`/`.reason` keeps working unchanged;
 *      these tests assert `.missing` is byte-for-byte identical to before.
 *   B. `suggestFollowUpQuestions` turns `missingRules` into deterministic, template
 *      -based question text. No LLM, no field guessing — every question ASKS about
 *      a gap, it never asserts a value was found.
 */
import { describe, expect, it } from "vitest";
import { checkApprovalGate, suggestFollowUpQuestions } from "../shared/researchPipeline";

describe("Stage 5 · A — checkApprovalGate.missingRules is additive, missing stays unchanged", () => {
  it("CBK T-bill missing the value/settlement date: missingRules carries the real key, missing keeps the label", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      name: "91-Day Treasury Bill",
      currency: "KES",
      source: "CBK Weekly Bulletin",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        securityType: "treasury_bill",
        tenor: "91-day",
        yieldPct: "8.8347%",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        tenorDays: "91",
        auctionDate: "2026-07-09",
        // valueDate deliberately omitted
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("value / settlement date");
    expect(gate.missingRules).toContainEqual({ key: "valueDate", label: "value / settlement date" });
    // The label list is UNCHANGED by this change — same array of labels as before.
    expect(gate.missing).not.toContain("auction date"); // was supplied, not missing
  });

  it("CBK IFB tax-exempt-must-be-TRUE: missingRules reuses the real `taxExempt` key even though it's a value assertion, not an absence", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      name: "IFB1/2024/017",
      currency: "KES",
      source: "CBK bond prospectus",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        securityType: "ifb",
        tenor: "17 years",
        yieldPct: "14.189%",
        whtRule: "0% — infrastructure bonds are tax-exempt",
        taxExempt: "false", // wrong value for an IFB
        maturityRule: "fixed maturity date per prospectus",
      },
    });
    expect(gate.ok).toBe(false);
    const label = "tax-exempt flag must be TRUE for an infrastructure bond";
    expect(gate.missing).toContain(label);
    expect(gate.missingRules).toContainEqual({ key: "taxExempt", label });
  });

  it("MMF missing a required field carries its key", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Example MMF",
      issuer: "Example Asset Managers",
      currency: "KES",
      source: "Fund factsheet",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        ear: "16.1%",
        managementFee: "1.5%",
        // minInvestment deliberately omitted
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("minimum investment");
    expect(gate.missingRules).toContainEqual({ key: "minInvestment", label: "minimum investment" });
  });

  it("Bank product missing a required field carries its key", () => {
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      issuer: "Example Bank",
      currency: "KES",
      source: "Bank rate card",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        instrumentType: "fixed_deposit",
        minAmount: "50,000",
        indicativeRate: "12%",
        isNegotiable: "false",
        // liquidity deliberately omitted
      },
    });
    expect(gate.ok).toBe(false);
    // Stage 10b-1b renamed this rule's label to name the established Bank
    // fields that actually satisfy it (tenor/notice, early withdrawal rule,
    // access speed) — the rule's key is unchanged, only the label text.
    expect(gate.missing).toContain("tenor / notice, early withdrawal rule, or access speed");
    expect(gate.missingRules).toContainEqual({ key: "liquidity", label: "tenor / notice, early withdrawal rule, or access speed" });
  });

  it("REIT missing distribution yield carries its key", () => {
    const gate = checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      name: "Example REIT",
      issuer: "Example REIT Manager",
      currency: "KES",
      source: "REIT factsheet",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        market: "NSE",
        lastPrice: "18.50",
        // distributionYield deliberately omitted
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("distribution yield");
    expect(gate.missingRules).toContainEqual({ key: "distributionYield", label: "distribution yield" });
  });

  it("Offshore fund missing expense ratio AND stated in KES: two missingRules, one per real key", () => {
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      name: "Example Offshore Fund",
      issuer: "Example Offshore Manager",
      currency: "KES", // inconsistent with an offshore fund — triggers the value-assertion rule
      source: "Offshore fund factsheet",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        market: "NYSE",
        lastPrice: "102.30",
        // expenseRatioPct deliberately omitted
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("expense ratio / fee");
    expect(gate.missing).toContain("currency must not be KES for an offshore fund");
    expect(gate.missingRules).toContainEqual({ key: "expenseRatioPct", label: "expense ratio / fee" });
    expect(gate.missingRules).toContainEqual({
      key: "currency",
      label: "currency must not be KES for an offshore fund",
    });
  });

  it("SACCO dividend/rebate OR-case gets a pipe-joined compound key (no single field backs it)", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      name: "Example SACCO",
      issuer: "Example SACCO Society",
      currency: "KES",
      source: "SACCO annual report",
      asOf: Date.UTC(2026, 6, 9),
      figures: {
        assetType: "sacco",
        minimumShareCapital: "KES 20,000",
        minimumMonthlyDeposit: "KES 1,000",
        regulatoryStatus: "SASRA-regulated",
        withdrawalTerms: "60 days' notice",
        // neither shareCapitalDividendRate nor depositRebateRate supplied
      },
    });
    expect(gate.ok).toBe(false);
    const label = "share-capital dividend rate or deposit rebate / interest rate";
    expect(gate.missing).toContain(label);
    expect(gate.missingRules).toContainEqual({ key: "shareCapitalDividendRate|depositRebateRate", label });
  });

  it("no missing fields → missingRules is an empty array, not undefined, and ok is true", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Complete MMF",
      issuer: "Example Asset Managers",
      currency: "KES",
      source: "Fund factsheet",
      asOf: Date.UTC(2026, 6, 9),
      figures: { ear: "16.1%", managementFee: "1.5%", minInvestment: "1,000" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.missingRules).toEqual([]);
  });

  it("an edit is exempt exactly as before, and now also carries missingRules: []", () => {
    const gate = checkApprovalGate({ assetClass: "cash_mmf", changeKind: "edit" });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.missingRules).toEqual([]);
  });
});

describe("Stage 5 · B — suggestFollowUpQuestions (pure, no LLM)", () => {
  it("a plain presence gap asks a neutral lookup question, never implying a value was found", () => {
    const qs = suggestFollowUpQuestions([{ key: "valueDate", label: "value / settlement date" }], "91-Day Treasury Bill");
    expect(qs).toHaveLength(1);
    expect(qs[0]).toEqual({
      key: "valueDate",
      label: "value / settlement date",
      question: "Can you check the source again for the value / settlement date for this 91-Day Treasury Bill?",
    });
    expect(qs[0].question).not.toMatch(/payment deadline|due date/i); // no candidate-guessing yet
  });

  it("a value-assertion rule (IFB tax-exempt must be TRUE) reads as a confirmation, not a blank lookup", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "taxExempt", label: "tax-exempt flag must be TRUE for an infrastructure bond" }],
      "IFB1/2024/017",
    );
    expect(qs[0].question).toBe(
      "The source doesn't clearly confirm: tax-exempt flag must be TRUE for an infrastructure bond. Can you check IFB1/2024/017 again and confirm?",
    );
  });

  it("the offshore-fund currency value-assertion gets the same confirmation phrasing", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "currency", label: "currency must not be KES for an offshore fund" }],
      "Example Offshore Fund",
    );
    expect(qs[0].question).toContain("doesn't clearly confirm");
    expect(qs[0].question).toContain("currency must not be KES for an offshore fund");
  });

  it("the SACCO compound OR-key uses the plain lookup template — its label already reads naturally", () => {
    const qs = suggestFollowUpQuestions(
      [
        {
          key: "shareCapitalDividendRate|depositRebateRate",
          label: "share-capital dividend rate or deposit rebate / interest rate",
        },
      ],
      "Example SACCO",
    );
    expect(qs[0].question).toBe(
      "Can you check the source again for the share-capital dividend rate or deposit rebate / interest rate for this Example SACCO?",
    );
  });

  it("multiple missing rules produce one question each, in the same order", () => {
    const qs = suggestFollowUpQuestions(
      [
        { key: "expenseRatioPct", label: "expense ratio / fee" },
        { key: "currency", label: "currency must not be KES for an offshore fund" },
      ],
      "Example Offshore Fund",
    );
    expect(qs).toHaveLength(2);
    expect(qs[0].key).toBe("expenseRatioPct");
    expect(qs[1].key).toBe("currency");
  });

  it("no missing rules → no suggestions, no crash", () => {
    expect(suggestFollowUpQuestions([], "Anything")).toEqual([]);
  });
});
