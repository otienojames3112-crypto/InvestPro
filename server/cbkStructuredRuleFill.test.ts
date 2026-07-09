/**
 * Stage 4 follow-up — the structured CBK extraction path (`structuredInstrumentToDraft`,
 * used for a first-turn AI-search / pasted-URL / pasted-text / uploaded-PDF-or-screenshot
 * CBK source classified as a T-bill auction or bond prospectus) never ran the existing
 * deterministic CBK rule-fill (`applyCbkRuleFill`) that the OTHER extraction path
 * (`normaliseFinding`, used for follow-ups / unclassified sources) already applies. That
 * gap made a genuinely source-grounded CBK T-bill finding still fail the approval gate on
 * `security type` / `tenor` / `tax-exempt flag`, and separately, the auction date was
 * never threaded into the finding's `sourceAsOf`, failing the gate's `as-of date` check
 * too — even though a real CBK T-bill auction RESULT bulletin states the auction date.
 *
 * This locks in the fix: `structuredInstrumentToDraft` now (a) applies the SAME
 * `applyCbkRuleFill` helper, write-only-if-empty so it never overwrites a model-provided
 * value, and (b) narrowly, for the cbk_tbill_auction / cbk_tbill_auction_result source
 * classes only, carries `sharedFields.auctionDate` into `sourceAsOf`.
 *
 * These are PURE tests against the real exported functions — no DB, no network, no LLM
 * call (mirrors the CBK T-bill / bond extraction SCHEMAS' shapes directly, since that is
 * exactly what a real invokeLLM() response is parsed into before reaching this function).
 */
import { describe, expect, it } from "vitest";
import { structuredInstrumentToDraft, missingFieldsForFinding } from "./aiResearchService";

/** Simulates the SAME gate recompute `runResearchQuestion`'s provenance-fallback step
 *  performs once a source label is stamped on (aiResearchService.ts's `stamped` map) —
 *  this is what the manager actually sees as "still missing" on the finding card. */
function gateMissingFor(draft: NonNullable<ReturnType<typeof structuredInstrumentToDraft>>) {
  return missingFieldsForFinding("cbk", draft.extractedFields, {
    name: draft.instrumentName,
    issuer: draft.issuer,
    currency: draft.currency,
    source: "AI search: Central Bank of Kenya — some bulletin",
    asOf: draft.sourceAsOf && Number.isFinite(Date.parse(draft.sourceAsOf)) ? Date.parse(draft.sourceAsOf) : null,
    assetClass: draft.assetClass,
  });
}

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

describe("Stage 4 follow-up · structuredInstrumentToDraft applies CBK rule-fill", () => {
  it("91-day T-bill auction result: security type / tenor / tax-exempt flag / as-of date are no longer missing", () => {
    const draft = structuredInstrumentToDraft(tbillRaw(), "cbk_tbill_auction_result", {
      auctionDate: "2026-07-09",
      valueDate: "2026-07-14",
    });
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields.securityType).toBe("treasury_bill");
    expect(draft!.extractedFields.tenor).toBe("91-day");
    expect(draft!.extractedFields.taxExempt).toBe("false");
    expect(draft!.extractedFields.whtRule).toBe("15% withholding tax on the discount");
    expect(draft!.extractedFields.maturityRule).toBe("value date + 91 days");
    expect(draft!.sourceAsOf).toBe("2026-07-09");

    const missing = gateMissingFor(draft!);
    expect(missing).not.toContain("security type");
    expect(missing).not.toContain("tenor");
    expect(missing).not.toContain("tax-exempt flag");
    expect(missing).not.toContain("as-of date");
    expect(missing).toEqual([]);
  });

  it("does not conflate settlement/value date with as-of: valueDate stays a separate figure", () => {
    const draft = structuredInstrumentToDraft(tbillRaw(), "cbk_tbill_auction_result", {
      auctionDate: "2026-07-09",
      valueDate: "2026-07-14",
    });
    expect(draft!.sourceAsOf).toBe("2026-07-09");
    expect(draft!.extractedFields.valueDate).toBe("2026-07-14");
    expect(draft!.sourceAsOf).not.toBe(draft!.extractedFields.valueDate);
  });

  it("182-day and 364-day tenors rule-fill correctly", () => {
    const d182 = structuredInstrumentToDraft(
      tbillRaw({ instrumentName: "182-Day Treasury Bill", tenorDays: 182 }),
      "cbk_tbill_auction_result",
      { auctionDate: "2026-07-09" },
    );
    expect(d182!.extractedFields.securityType).toBe("treasury_bill");
    expect(d182!.extractedFields.tenor).toBe("182-day");
    expect(d182!.extractedFields.taxExempt).toBe("false");
    expect(gateMissingFor(d182!)).toEqual([]);

    const d364 = structuredInstrumentToDraft(
      tbillRaw({ instrumentName: "364-Day Treasury Bill", tenorDays: 364 }),
      "cbk_tbill_auction_result",
      { auctionDate: "2026-07-09" },
    );
    expect(d364!.extractedFields.securityType).toBe("treasury_bill");
    expect(d364!.extractedFields.tenor).toBe("364-day");
    expect(d364!.extractedFields.taxExempt).toBe("false");
    expect(gateMissingFor(d364!)).toEqual([]);
  });

  it("cbk_tbill_auction (auction NOTICE, not yet a result) gets the same rule-fill", () => {
    const draft = structuredInstrumentToDraft(tbillRaw(), "cbk_tbill_auction", { auctionDate: "2026-07-09" });
    expect(draft!.extractedFields.securityType).toBe("treasury_bill");
    expect(draft!.sourceAsOf).toBe("2026-07-09");
  });

  it("auctionDate is NOT carried into sourceAsOf for a non-T-bill CBK source class (bond prospectus)", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "FXD1/2022/010",
        issueNumber: "FXD1/2022/010",
        securityType: "fxd",
        isin: null,
        tenorLabel: "10 years",
        tenorMonths: 120,
        couponRate: "13.5%",
        withholdingTaxRate: "15%",
        maturityDate: "2032-06-01",
        amountOnOffer: "15,000.00",
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
      },
      "cbk_bond_reopening",
      { auctionDate: "2026-07-09" },
    );
    // sharedAuctionFields.auctionDate exists for bonds too, but this fix is scoped
    // narrowly to the T-bill auction classes only (per the approved fix scope) — a
    // bond's as-of semantics were not part of the reported symptom and are left alone.
    expect(draft!.sourceAsOf).toBeNull();
  });
});

describe("Stage 4 follow-up · CBK rule-fill never overwrites a model-provided value", () => {
  it("an IFB (infrastructure bond) with securityType already extracted keeps its OWN securityType, and gets the IFB-specific tax-exempt/WHT/maturity fill", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "IFB1/2024/017",
        issueNumber: "IFB1/2024/017",
        securityType: "ifb",
        isin: "KE1000012345",
        tenorLabel: "17 years",
        tenorMonths: 204,
        couponRate: "14.189%",
        withholdingTaxRate: null,
        maturityDate: "2041-01-01",
        amountOnOffer: "20,000.00",
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
      },
      "cbk_bond_prospectus",
      { auctionDate: "2026-07-09" },
    );
    // The model's own securityType is preserved verbatim — rule-fill is write-only-if-empty.
    expect(draft!.extractedFields.securityType).toBe("ifb");
    // The IFB branch still fires (via the securityType blob signal) to back-fill the
    // conventional fields the model's schema never asked it for.
    expect(draft!.extractedFields.taxExempt).toBe("true");
    expect(draft!.extractedFields.whtRule).toBe("0% — infrastructure bonds are tax-exempt");
    expect(draft!.extractedFields.maturityRule).toBe("fixed maturity date per prospectus");
  });

  it("an FXD bond keeps its own securityType and gets the FXD-specific (taxable) fill, distinct from an IFB", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "FXD1/2022/010",
        issueNumber: "FXD1/2022/010",
        securityType: "fxd",
        isin: null,
        tenorLabel: "10 years",
        tenorMonths: 120,
        couponRate: "13.5%",
        withholdingTaxRate: null,
        maturityDate: "2032-06-01",
        amountOnOffer: "15,000.00",
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
      },
      "cbk_bond_reopening",
      {},
    );
    expect(draft!.extractedFields.securityType).toBe("fxd");
    expect(draft!.extractedFields.taxExempt).toBe("false");
    expect(draft!.extractedFields.whtRule).toBe("15% withholding tax on coupon (10% for bonds of 10+ years)");
  });
});

describe("Stage 4 follow-up · KNOWN DEFERRED bug — sentinel-masking is NOT fixed by this change", () => {
  it("when rule-fill cannot determine a tenor/type at all, whtRule/maturityRule are STILL wrongly reported as present (NEVER_INVENT_FIELDS sentinel leaking through the gate's alias check) — this is a pre-existing, separately-tracked issue, left untouched here", () => {
    // No tenor digits, no t-bill/ifb/fxd/bond keyword anywhere in name/securityType —
    // applyCbkRuleFill's blob-detection cannot classify this, so it fills nothing.
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "CBK Note XYZ",
        issueNumber: "XYZ",
        securityType: null,
        isin: null,
        tenorLabel: null,
        tenorMonths: null,
        couponRate: null,
        withholdingTaxRate: null,
        maturityDate: null,
        amountOnOffer: "1,000.00",
        cleanPrice: null,
        accruedInterestPer100: null,
        dirtyPrice: null,
        couponPaymentDates: null,
        cleanPriceTable: null,
        rawExcerpt: null,
        warnings: [],
        confidence: 0.5,
        proposalType: "create",
        matchedCurrentRow: null,
        changedFields: [],
        currentValues: [],
      },
      "cbk_bond_reopening",
      {},
    );
    // Genuinely never extracted, never rule-filled — correctly flagged.
    expect(draft!.extractedFields.securityType).toBeUndefined();
    const missing = gateMissingFor(draft!);
    expect(missing).toContain("security type");
    // KNOWN BUG, unchanged by this commit: NEVER_INVENT_FIELDS stamps withholdingTaxRate
    // and maturityDate with the "missing_from_source" SENTINEL, normaliseExtractionFields
    // copies it onto the whtRule/maturityRule ALIASES (whtRate / maturityDate), and the
    // gate's alias check treats any non-empty string — including the sentinel — as
    // "present". So whtRule/maturityRule are silently accepted here even though nothing
    // was ever really extracted. Documented as a deferred follow-up, not fixed in this
    // commit — this test pins the CURRENT (buggy) behaviour so a future fix changes it
    // deliberately rather than by accident.
    expect(missing).not.toContain("WHT rule");
    expect(missing).not.toContain("maturity rule");
  });
});
