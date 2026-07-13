/**
 * Stage 7b — wires Stage 7a's pure candidate/synonym matcher into the CBK
 * structured-extraction path only (`structuredInstrumentToDraft`). No LLM call is
 * added anywhere — candidate detection runs against source text already loaded in
 * memory for the SAME extraction request. A candidate is purely informational: it
 * is persisted as a hidden `_candidatePhrases` key (same pattern as
 * `_proposalType`/`_extendedFields`), never written into a real figure, never
 * consulted by the approval gate or promotion path.
 *
 * The scan list fed to findCandidatePhrases() is the UNION of (a) the real
 * approval-gate missingRules (unchanged, still computed by checkApprovalGate) and
 * (b) any field the schema marked missing_from_source (NEVER_INVENT_FIELDS) that
 * ISN'T a gate rule at all — e.g. cleanPrice has no CatalogueFieldRule, so it can
 * never appear in missingRules, but it's exactly the kind of field a source states
 * under a different label ("Price per Kshs 100"). Building this wider list does
 * NOT change missingRules or checkApprovalGate themselves — verified below.
 */
import { describe, expect, it } from "vitest";
import { structuredInstrumentToDraft, missingRulesForFinding } from "./aiResearchService";
import type { CandidateMatch } from "../shared/candidatePhrases";

function tbillRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    instrumentName: "91-Day Treasury Bill",
    issueNumber: "2689/091",
    tenorDays: 91,
    yieldPct: "8.8347%",
    prevAvgRate: null,
    amountOnOffer: "4,000.00",
    amountReceived: null,
    amountAccepted: null,
    weightedAvgRate: "8.8347%",
    rawExcerpt: "A. RESULTS OF 91, 182 & 364 DAYS TREASURY BILLS",
    warnings: [],
    confidence: 0.9,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
    ...overrides,
  };
}

function bondRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    instrumentName: "FXD1/2022/010",
    issueNumber: "FXD1/2022/010",
    securityType: "fxd",
    isin: null,
    tenorLabel: "10 years",
    tenorMonths: 120,
    couponRate: "13.5%",
    withholdingTaxRate: null,
    maturityDate: null,
    amountOnOffer: "15,000,000,000",
    cleanPrice: null,
    accruedInterestPer100: null,
    dirtyPrice: null,
    couponPaymentDates: null,
    cleanPriceTable: null,
    rawExcerpt: null,
    warnings: [],
    confidence: 0.85,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
    ...overrides,
  };
}

function candidatesOf(draft: NonNullable<ReturnType<typeof structuredInstrumentToDraft>>): CandidateMatch[] {
  const raw = draft.extractedFields._candidatePhrases;
  return raw ? (JSON.parse(raw) as CandidateMatch[]) : [];
}

describe("Stage 7b · CBK candidate-phrase wiring — the four requested examples", () => {
  it("'Due Date' produces a maturityDate candidate when maturity is missing", () => {
    const sourceText = "FXD1/2022/010 — Coupon 13.5%. Due Date: 15-Jan-2032. Amount on offer KES 15,000,000,000.";
    const draft = structuredInstrumentToDraft(bondRaw(), "cbk_bond_reopening", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "maturityDate");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("due date");
    expect(c!.value).toBe("15-Jan-2032");
  });

  it("'payment deadline' produces a valueDate candidate for a T-bill missing its value/settlement date", () => {
    const sourceText = "Settlement details — payment deadline: 14-Jul-2026. Value KES 4,000,000,000.";
    const draft = structuredInstrumentToDraft(tbillRaw(), "cbk_tbill_auction_result", {}, sourceText);
    // valueDate is a CBK_SUBTYPE_FIELD_RULES.tbill gate key and not extracted here (no
    // valueDate in tbillRaw), so it's genuinely gate-missing — real gateMissing path.
    const c = candidatesOf(draft!).find((x) => x.key === "valueDate");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("payment deadline");
    expect(c!.value).toBe("14-Jul-2026");
  });

  it("'weighted average interest rate of accepted bids' produces a yieldPct candidate when yield is missing", () => {
    const sourceText = "A. RESULTS OF 91 DAYS TREASURY BILLS\nWeighted average interest rate of accepted bids: 8.8347%";
    const draft = structuredInstrumentToDraft(
      tbillRaw({ yieldPct: null, weightedAvgRate: null }),
      "cbk_tbill_auction_result",
      { auctionDate: "2026-07-09" },
      sourceText,
    );
    const c = candidatesOf(draft!).find((x) => x.key === "yieldPct");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("weighted average interest rate of accepted bids");
    expect(c!.value).toBe("8.8347%");
  });

  it("'Price per Kshs 100' produces a cleanPrice candidate, even though cleanPrice has no gate rule at all", () => {
    const sourceText = "FXD1/2022/010 pricing — Price per Kshs 100: 98.75. Accrued interest per 100: 1.20.";
    const draft = structuredInstrumentToDraft(bondRaw(), "cbk_bond_reopening", {}, sourceText);
    // Confirm cleanPrice is genuinely NOT a gate rule (so this only works via the
    // NEVER_INVENT_FIELDS-sentinel scan, not the gate path).
    const gate = missingRulesForFinding("cbk", { securityType: "fxd" }, { assetClass: "gov_coupon" });
    expect(gate.some((r) => r.key === "cleanPrice")).toBe(false);

    const c = candidatesOf(draft!).find((x) => x.key === "cleanPrice");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("price per kshs 100");
    expect(c!.value).toBe("98.75");
  });
});

describe("Stage 7b · guardrails", () => {
  it("an already-extracted (present) field never generates a candidate, even if its synonym text is also in the source", () => {
    const sourceText = "Due Date: 15-Jan-2032. Term to maturity: 10 years. Price per Kshs 100: 98.75.";
    const draft = structuredInstrumentToDraft(
      bondRaw({ maturityDate: "2032-01-15" }), // model DID extract this
      "cbk_bond_reopening",
      {},
      sourceText,
    );
    expect(draft!.extractedFields.maturityDate).toBe("2032-01-15"); // real value preserved verbatim
    expect(candidatesOf(draft!).find((c) => c.key === "maturityDate")).toBeUndefined();
  });

  it("a genuinely-present valueDate never gets a candidate, even with 'payment deadline' text in the source — the direct-key check (not the gate's alias tolerance) correctly sees it as filled", () => {
    const sourceText = "Settlement details — payment deadline: 14-Jul-2026.";
    const draft = structuredInstrumentToDraft(
      tbillRaw({ valueDate: "2026-07-14" }), // model DID extract this under its real key
      "cbk_tbill_auction_result",
      {},
      sourceText,
    );
    expect(draft!.extractedFields.valueDate).toBe("2026-07-14");
    expect(candidatesOf(draft!).find((c) => c.key === "valueDate")).toBeUndefined();
  });

  it("a candidate never overwrites or appears as a real figure — only under the hidden _candidatePhrases key", () => {
    const sourceText = "Price per Kshs 100: 98.75.";
    const draft = structuredInstrumentToDraft(bondRaw(), "cbk_bond_reopening", {}, sourceText);
    // The real figure stays the MISSING_FROM_SOURCE sentinel — never silently filled.
    expect(draft!.extractedFields.cleanPrice).toBe("missing_from_source");
    expect(candidatesOf(draft!).some((c) => c.key === "cleanPrice")).toBe(true);
  });

  it("non-CBK catalogues are NOT wired in this slice — a bank source with a recognisable synonym gets no candidate key", () => {
    const sourceText = "Nominal rate: 12% p.a. Notice period: 30 days.";
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "Example Bank Fixed Deposit",
        bankName: "Example Bank",
        instrumentType: "fixed_deposit",
        indicativeRate: null,
        rateType: null,
        minAmount: "50000",
        tenor: null,
        noticePeriod: null,
        payoutFrequency: null,
        earlyWithdrawalPenalty: null,
        isNegotiable: "false",
        whtRate: null,
        rawExcerpt: null,
        warnings: [],
        confidence: 0.8,
        proposalType: "create",
        matchedCurrentRow: null,
        changedFields: [],
        currentValues: [],
      },
      "bank_rate_card",
      {},
      sourceText,
    );
    expect(draft!.extractedFields._candidatePhrases).toBeUndefined();
  });

  it("no candidates found → the hidden key is simply absent, not an empty-array key", () => {
    const sourceText = "This document states nothing recognisable at all.";
    const draft = structuredInstrumentToDraft(
      tbillRaw({ yieldPct: null, weightedAvgRate: null }),
      "cbk_tbill_auction_result",
      {},
      sourceText,
    );
    expect(draft!.extractedFields._candidatePhrases).toBeUndefined();
  });

  it("omitting sourceText (existing callers) is fully backward compatible — no candidate key, no crash", () => {
    const draft = structuredInstrumentToDraft(tbillRaw(), "cbk_tbill_auction_result", { auctionDate: "2026-07-09" });
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._candidatePhrases).toBeUndefined();
    expect(draft!.extractedFields.securityType).toBe("treasury_bill");
  });

  it("the approval gate's missingRules computation is completely unchanged by this slice (same inputs, same outputs as before Stage 7b)", () => {
    const figures = { securityType: "fxd", couponRate: "13.5%" };
    const gate = missingRulesForFinding("cbk", figures, { assetClass: "gov_coupon" });
    // cleanPrice must NEVER appear here — proving the gate itself was not widened,
    // only the separate, wider scan list used purely for candidate detection.
    expect(gate.some((r) => r.key === "cleanPrice")).toBe(false);
    expect(gate.some((r) => r.key === "tenor")).toBe(true); // still genuinely missing, unrelated to this slice
  });

  it("the sentinel-masked figure value itself (missing_from_source) is unaffected by candidate detection running", () => {
    const withCandidates = structuredInstrumentToDraft(bondRaw(), "cbk_bond_reopening", {}, "Due Date: 15-Jan-2032.");
    const withoutCandidates = structuredInstrumentToDraft(bondRaw(), "cbk_bond_reopening", {});
    expect(withCandidates!.extractedFields.maturityDate).toBe(withoutCandidates!.extractedFields.maturityDate);
    expect(withCandidates!.missingFields).toEqual(withoutCandidates!.missingFields);
  });
});
