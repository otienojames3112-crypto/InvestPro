/**
 * Stage 7d — wires Stage 7a's pure candidate/synonym matcher into the MMF
 * structured-extraction path (`structuredInstrumentToDraft`), the same established
 * pattern Stage 7b used for CBK. No LLM call is added anywhere — candidate detection
 * runs against source text already loaded in memory for the SAME extraction request.
 * A candidate is purely informational: persisted under the hidden `_candidatePhrases`
 * key, never written into a real figure, never consulted by the approval gate or
 * promotion path.
 *
 * Stage 7d also bridges the MMF extraction schema's `benchmarkDate` (the factsheet/
 * benchmark as-of date) into the draft's `sourceAsOf`, mirroring the existing CBK
 * auctionDate→sourceAsOf bridge. This is a narrow, deterministic mapping — never an
 * invented date — and only ever fills `sourceAsOf` for the mmf catalogue.
 */
import { describe, expect, it } from "vitest";
import { structuredInstrumentToDraft, missingRulesForFinding } from "./aiResearchService";
import type { CandidateMatch } from "../shared/candidatePhrases";

function mmfRaw(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    instrumentName: "Example Money Market Fund",
    fundManager: "Example Asset Managers",
    effectiveAnnualRate: null,
    grossYield: null,
    managementFee: null,
    minimumInvestment: null,
    aum: null,
    dayCountBasis: null,
    creditingFrequency: null,
    whtRate: null,
    withdrawalNoticePeriod: null,
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

describe("Stage 7d · benchmarkDate → sourceAsOf bridge", () => {
  it("a benchmarkDate populates sourceAsOf when present and no stronger sourceAsOf exists", () => {
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_benchmark", { benchmarkDate: "2026-07-10" });
    expect(draft!.sourceAsOf).toBe("2026-07-10");
  });

  it("no benchmarkDate leaves sourceAsOf null (never invented)", () => {
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_benchmark", {});
    expect(draft!.sourceAsOf).toBeNull();
  });

  it("a missing_from_source sentinel benchmarkDate is treated as absent, not carried into sourceAsOf", () => {
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", { benchmarkDate: "missing_from_source" });
    expect(draft!.sourceAsOf).toBeNull();
  });

  it("the bridge is scoped to mmf only — a CBK draft's sourceAsOf logic is completely unaffected", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "FXD1/2022/010", securityType: "fxd", warnings: [], confidence: 0.8, proposalType: "create", matchedCurrentRow: null, changedFields: [], currentValues: [] },
      "cbk_bond_reopening",
      { benchmarkDate: "2026-07-10" }, // irrelevant field for CBK, must be ignored
    );
    expect(draft!.sourceAsOf).toBeNull();
  });
});

describe("Stage 7d · MMF candidate-phrase detection", () => {
  it("'factsheet date' produces an asOf candidate when sourceAsOf is missing (no benchmarkDate)", () => {
    const sourceText = "Fund Fact Sheet — Factsheet Date: 10 July 2026. EAR: 11.2%.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "asOf");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("factsheet date");
  });

  it("'report date' produces an asOf candidate when sourceAsOf is missing", () => {
    const sourceText = "Report Date: 10-Jul-2026. Management fee: 2.0%.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_benchmark", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "asOf");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("report date");
  });

  it("'as at' produces an asOf candidate when sourceAsOf is missing", () => {
    const sourceText = "Rates as at 10 July 2026. Minimum investment KES 1,000.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_benchmark", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "asOf");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("as at");
  });

  it("a real benchmarkDate suppresses the redundant asOf candidate, even if 'factsheet date' text is also present", () => {
    const sourceText = "Factsheet Date: 10 July 2026. EAR: 11.2%.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", { benchmarkDate: "2026-07-10" }, sourceText);
    expect(draft!.sourceAsOf).toBe("2026-07-10");
    expect(candidatesOf(draft!).find((c) => c.key === "asOf")).toBeUndefined();
  });

  it("'effective annual rate' / 'net yield' produce an ear candidate when EAR is missing", () => {
    const sourceText = "Effective annual rate: 11.85%. Minimum investment KES 5,000.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "ear");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("effective annual rate");
    expect(c!.value).toBe("11.85%");
  });

  it("'gross yield' / 'daily yield' also produce an ear candidate (label is 'gross yield or EAR')", () => {
    const sourceText = "Gross yield: 12.40%. Management fee: 2.0%.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_benchmark", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "ear");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("gross yield");
    expect(c!.value).toBe("12.40%");
  });

  it("'annual management fee' produces a managementFee candidate when fee is missing", () => {
    const sourceText = "Annual management fee: 1.75%. EAR: 11.2%.";
    const draft = structuredInstrumentToDraft(mmfRaw({ effectiveAnnualRate: "11.2%" }), "mmf_factsheet", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "managementFee");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("annual management fee");
    expect(c!.value).toBe("1.75%");
  });

  it("'minimum initial investment' produces a minInvestment candidate when minimum is missing", () => {
    const sourceText = "Minimum initial investment: KES 1,000. EAR: 11.2%.";
    const draft = structuredInstrumentToDraft(mmfRaw({ effectiveAnnualRate: "11.2%" }), "mmf_factsheet", {}, sourceText);
    const c = candidatesOf(draft!).find((x) => x.key === "minInvestment");
    expect(c).toBeDefined();
    expect(c!.phrase.toLowerCase()).toBe("minimum initial investment");
    expect(c!.value).toBe("KES 1,000");
  });
});

describe("Stage 7d · guardrails", () => {
  it("an already-extracted EAR never generates a candidate, even if a synonym is also in the source", () => {
    const sourceText = "Effective annual rate: 11.85%.";
    const draft = structuredInstrumentToDraft(mmfRaw({ effectiveAnnualRate: "11.85%" }), "mmf_factsheet", {}, sourceText);
    expect(draft!.extractedFields.ear).toBe("11.85%");
    expect(candidatesOf(draft!).find((c) => c.key === "ear")).toBeUndefined();
  });

  it("a fund already carrying grossYield (normalised to yieldPct, an EAR alias) never gets an ear candidate", () => {
    const sourceText = "Gross yield: 12.40%.";
    const draft = structuredInstrumentToDraft(mmfRaw({ grossYield: "12.40%" }), "mmf_benchmark", {}, sourceText);
    expect(draft!.extractedFields.yieldPct).toBe("12.40%");
    expect(candidatesOf(draft!).find((c) => c.key === "ear")).toBeUndefined();
  });

  it("a candidate never overwrites or appears as a real figure — only under the hidden _candidatePhrases key", () => {
    const sourceText = "Annual management fee: 1.75%.";
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", {}, sourceText);
    expect(draft!.extractedFields.managementFee).toBeUndefined();
    expect(candidatesOf(draft!).some((c) => c.key === "managementFee")).toBe(true);
  });

  it("non-MMF catalogues are unaffected — a CBK source with a recognisable MMF synonym gets no MMF-style candidate", () => {
    const sourceText = "Effective annual rate: 11.85%. Management fee: 2%.";
    const draft = structuredInstrumentToDraft(
      { instrumentName: "FXD1/2022/010", securityType: "fxd", warnings: [], confidence: 0.8, proposalType: "create", matchedCurrentRow: null, changedFields: [], currentValues: [] },
      "cbk_bond_reopening",
      {},
      sourceText,
    );
    expect(candidatesOf(draft!).some((c) => c.key === "ear" || c.key === "managementFee")).toBe(false);
  });

  it("non-MMF catalogues (bank) are unaffected by this slice — no _candidatePhrases key from MMF synonyms leaking in", () => {
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
      mmfRaw({ effectiveAnnualRate: "11.2%", managementFee: "2%", minimumInvestment: "1000" }),
      "mmf_factsheet",
      { benchmarkDate: "2026-07-10" },
      sourceText,
    );
    expect(draft!.extractedFields._candidatePhrases).toBeUndefined();
  });

  it("omitting sourceText (existing callers) is fully backward compatible — no candidate key, no crash", () => {
    const draft = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", { benchmarkDate: "2026-07-10" });
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._candidatePhrases).toBeUndefined();
    expect(draft!.sourceAsOf).toBe("2026-07-10"); // the sourceAsOf bridge does not require sourceText
  });

  it("the approval gate's missingRules computation is completely unchanged by this slice (same inputs, same outputs as before Stage 7d)", () => {
    const figures = { ear: "11.2%", managementFee: "2%" };
    const gate = missingRulesForFinding("mmf", figures, {});
    expect(gate.some((r) => r.key === "ear")).toBe(false);
    expect(gate.some((r) => r.key === "minInvestment")).toBe(true); // still genuinely missing, unrelated to this slice
  });

  it("candidate detection running does not change the draft's own missingFields display list", () => {
    const withCandidates = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", {}, "Annual management fee: 1.75%.");
    const withoutCandidates = structuredInstrumentToDraft(mmfRaw(), "mmf_factsheet", {});
    expect(withCandidates!.missingFields.sort()).toEqual(withoutCandidates!.missingFields.sort());
  });
});
