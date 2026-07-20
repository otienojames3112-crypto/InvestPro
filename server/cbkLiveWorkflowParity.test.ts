/**
 * Stage 10b-2 — CBK Securities end-to-end field parity.
 *
 * Applies the same product philosophy the Bank path went through (Stage
 * 10b-1/10b-1b) to CBK securities: established catalogue fields as explicit
 * table columns, a multi-field edit path before approval, clean labels (no
 * raw enum/camelCase), and closed extraction/gate gaps so a real CBK source
 * actually reaches the catalogue intact.
 *
 * Unlike Bank, CBK's contract (15 fields), display wiring (Ask AI, review
 * queue, approval modal), and promotion merge (Slice 8g-2) were ALREADY
 * built and well-tested (see cbkContractMapping.test.ts, cbkSaccoCatalogue
 * Display.test.ts, cbkStructuredRuleFill.test.ts, cbkSubtypeApprovalGate.
 * test.ts) — this stage's audit found FOUR remaining gaps, not a rebuild:
 *
 *   1. Gate-integrity bug (figurePresent sentinel masking) — shared/
 *      researchPipeline.ts's figurePresent() treated the "missing_from_source"
 *      sentinel (force-stamped onto every CBK finding's NEVER_INVENT_FIELDS
 *      keys) as a REAL present value, so a genuinely-incomplete FXD/IFB bond
 *      (missing issueNumber/couponRate/maturityDate) could silently pass the
 *      "hard, no escape" subtype gate. This was a documented, previously
 *      DEFERRED bug (see cbkStructuredRuleFill.test.ts's old "KNOWN DEFERRED
 *      bug" block) — fixed now by reusing isRealSourceValue(), the same
 *      absence-marker check the SACCO rules already relied on.
 *   2. T-bill extraction schema gap — CBK_TBILL_EXTRACTION_SCHEMA had no
 *      securityType/whtRule/taxExempt/maturityDate/minInvestment/
 *      applicationDeadline fields at all (bonds already had all of these via
 *      sharedAuctionFields + their own per-instrument fields) — a T-bill
 *      source stating them had nowhere to go, falling back entirely to
 *      applyCbkRuleFill's convention-based guess (which never sets a literal
 *      maturityDate for a T-bill, only the generic maturityRule text).
 *   3. Multi-field edit path — CBK pending updates had no Edit fields entry
 *      point (gated to mmf/bank only) despite the review queue/approval
 *      modal already showing CBK's full contract field block generically.
 *   4. Display gap — securityType (raw enum, e.g. "treasury_bill") and
 *      taxExempt (raw "true"/"false") rendered unformatted in the review
 *      queue, approval modal, and Ask AI finding card; the live catalogue
 *      table never showed 8 of the 15 established fields as explicit
 *      columns (coupon rate, net yield after WHT, tax treatment, tax-exempt
 *      flag, auction date, value date, minimum investment, security type —
 *      only visible in the drawer before this stage), and inferred its
 *      "Tax-exempt coupon" badge via a name/factNote REGEX the contract's
 *      own note flagged as fragile, instead of the real structured field.
 *
 * Five layers of test (established convention — no jsdom in this repo):
 *   A. Pure — the figurePresent sentinel fix, via checkApprovalGate directly.
 *   B. Pure — the T-bill live-QA scenario, extraction through promotion plan.
 *   C. Pure — a synthetic FXD bond scenario (the user's message was cut off
 *      before a bond fixture was supplied; synthesized here to the same
 *      standard, matching CBK_BOND_EXTRACTION_SCHEMA's shape).
 *   D. Static source-text scan — schema, gate, table, and display wiring.
 *   E. Full edit → approve → published-row path via the real tRPC caller —
 *      requires DATABASE_URL, `describe.skipIf`'d out otherwise.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogueFieldContract,
  projectFindingToContractFigures,
  projectFindingToContractDisplayRows,
  projectContractFiguresToExtendedFields,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan, cbkSecurityTypeLabel, cbkTaxExemptLabel } from "../shared/researchPipeline";
import { structuredInstrumentToDraft } from "./aiResearchService";
import type { SourceClass } from "../shared/instrumentProfile";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);
const cbkContract = getCatalogueFieldContract("cbk")!;

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ── A. figurePresent sentinel fix, via checkApprovalGate directly ─────────────

describe("Stage 10b-2 · A — the approval gate no longer treats missing_from_source as present", () => {
  const base = {
    assetClass: "gov_coupon" as const,
    changeKind: "create" as const,
    name: "FXD1/2026/010",
    source: "CBK",
    asOf: Date.UTC(2026, 6, 17),
  };

  it("a genuinely incomplete FXD bond (issueNumber/couponRate/maturityDate all the sentinel) is correctly blocked, not silently accepted", () => {
    const gate = checkApprovalGate({
      ...base,
      figures: {
        securityType: "fxd",
        tenor: "10y",
        yieldPct: "13.2",
        whtRule: "15% withholding tax on coupon",
        taxExempt: "false",
        maturityRule: "fixed maturity date per prospectus",
        // The exact sentinel structuredInstrumentToDraft's NEVER_INVENT_FIELDS
        // loop force-stamps onto every CBK finding when genuinely unextracted.
        issueNumber: "missing_from_source",
        couponRate: "missing_from_source",
        maturityDate: "missing_from_source",
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["coupon rate", "issue number", "maturity date"].sort());
  });

  it("control: the SAME bond with real values for those three fields passes cleanly", () => {
    const gate = checkApprovalGate({
      ...base,
      figures: {
        securityType: "fxd",
        tenor: "10y",
        yieldPct: "13.2",
        whtRule: "15% withholding tax on coupon",
        taxExempt: "false",
        maturityRule: "fixed maturity date per prospectus",
        issueNumber: "FXD1/2026/010",
        couponRate: "13.0",
        maturityDate: "2036-07-21",
      },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("a genuinely present real value is still recognised — the fix only excludes the sentinel/absence-marker vocabulary, not real data", () => {
    expect(
      checkApprovalGate({
        assetClass: "gov_discount",
        changeKind: "create",
        name: "91-Day Treasury Bill",
        source: "CBK",
        asOf: Date.UTC(2026, 6, 17),
        figures: {
          securityType: "treasury_bill",
          tenorDays: "91",
          tenor: "91-day",
          yieldPct: "10.5",
          whtRule: "15% withholding tax on the discount",
          taxExempt: "false",
          maturityRule: "value date + 91 days",
          auctionDate: "2026-07-17",
          valueDate: "2026-07-20",
        },
      }).ok,
    ).toBe(true);
  });
});

// ── B. The T-bill live-QA scenario, extraction through promotion plan ─────────

describe("Stage 10b-2 · B — synthetic CBK T-bill source, extraction through promotion plan", () => {
  const sourceText = `Test CBK T-Bill (Stage 10b-2 QA)

Security type: Treasury bill
Tenor: 91 days
Auction date: 17 July 2026
Application deadline: 16 July 2026
Value date: 20 July 2026
Weighted average rate of accepted bids: 10.50%
Minimum investment: KES 50,000
Tax treatment: 15% withholding tax on the discount
Tax-exempt: No
Maturity date: 19 October 2026
As of: 17 July 2026
Source: Manually entered for Stage 10b-2 QA testing — not a live CBK source.`;

  // Stands in for what the LLM would return against the now-fixed
  // CBK_TBILL_EXTRACTION_SCHEMA (securityType/whtRule/taxExempt/maturityDate/
  // minInvestment added), same convention cbkStructuredRuleFill.test.ts
  // already uses for calling structuredInstrumentToDraft directly.
  const raw = {
    instrumentName: "91-Day Treasury Bill",
    issueNumber: null,
    tenorDays: 91,
    securityType: "treasury_bill",
    yieldPct: "10.50%",
    prevAvgRate: null,
    amountOnOffer: null,
    amountReceived: null,
    amountAccepted: null,
    weightedAvgRate: "10.50%",
    whtRule: "15% withholding tax on the discount",
    taxExempt: "false",
    maturityDate: "2026-10-19",
    minInvestment: "KES 50,000",
    rawExcerpt: "Weighted average rate of accepted bids: 10.50%",
    warnings: [],
    confidence: 0.95,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
  };
  const sharedFields = { auctionDate: "2026-07-17", valueDate: "2026-07-20", applicationDeadline: "2026-07-16" };

  const draft = structuredInstrumentToDraft(raw, "cbk_tbill_auction_result" as SourceClass, sharedFields, sourceText);

  it("the draft carries securityType, whtRule, taxExempt, maturityDate, minInvestment, and applicationDeadline", () => {
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields.securityType).toBe("treasury_bill");
    expect(draft!.extractedFields.whtRule).toBe("15% withholding tax on the discount");
    expect(draft!.extractedFields.taxExempt).toBe("false");
    expect(draft!.extractedFields.maturityDate).toBe("2026-10-19");
    expect(draft!.extractedFields.minInvestment).toBe("KES 50,000");
    expect(draft!.extractedFields.applicationDeadline).toBe("2026-07-16");
  });

  it("sourceAsOf is bridged from the T-bill's auctionDate, unaffected by the new fields", () => {
    expect(draft!.sourceAsOf).toBe("2026-07-17");
  });

  const finding: ProjectableFinding = {
    instrumentName: draft!.instrumentName,
    issuer: draft!.issuer,
    sourceLabel: "Manually entered for Stage 10b-2 QA testing — not a live CBK source.",
    sourceUrl: null,
    sourceAsOf: Date.parse(draft!.sourceAsOf!),
    extractedFields: draft!.extractedFields,
  };
  const figures = projectFindingToContractFigures(cbkContract, finding);

  it("the contract projection carries every established field through", () => {
    expect(figures.securityType).toBe("treasury_bill");
    expect(figures.whtRule).toBe("15% withholding tax on the discount");
    expect(figures.taxExempt).toBe("false");
    expect(figures.maturityDate).toBe("2026-10-19");
    expect(figures.minInvestment).toBe("KES 50,000");
    expect(figures.applicationDeadline).toBe("2026-07-16");
    expect(figures.auctionDate).toBe("2026-07-17");
    expect(figures.valueDate).toBe("2026-07-20");
  });

  it("the approval gate passes cleanly — base rules AND the T-bill subtype rules", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.cbkSubtype).toBe("tbill");
  });

  it("buildPromotionPlan preserves the yield (10.5, not fabricated/dropped) AND the real maturityDate as the typed column value", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "gov_discount",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.yieldPct).toBeCloseTo(10.5);
    // maturityDate is a "column" contract field (buildPromotionPlan's typed
    // payload), not extendedFields-tier — the real source-stated date is now
    // preferred over applyCbkRuleFill's generic "value date + 91 days" text.
    expect(plan.payload.maturityDate).toBe("2026-10-19");
  });

  it("the extendedFields-tier projection preserves whtRule/taxExempt/minInvestment/applicationDeadline for promotion", () => {
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, figures);
    expect(extended.whtRule).toBe("15% withholding tax on the discount");
    expect(extended.taxExempt).toBe("false");
    expect(extended.minInvestment).toBe("KES 50,000");
    expect(extended.applicationDeadline).toBe("2026-07-16");
  });

  it("review queue / approval modal projection: no established field shows as Missing for this data", () => {
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    for (const key of ["securityType", "whtRule", "taxExempt", "maturityDate", "minInvestment", "applicationDeadline", "auctionDate", "valueDate"]) {
      expect(rows.find((r) => r.key === key)!.value).not.toBeNull();
    }
  });
});

// ── C. A synthetic FXD bond scenario (synthesized — see file header) ──────────

describe("Stage 10b-2 · C — synthetic CBK FXD bond source, extraction through promotion plan", () => {
  const raw = {
    instrumentName: "FXD2/2026/010",
    issueNumber: "FXD2/2026/010",
    securityType: "fxd",
    isin: null,
    tenorLabel: "10 years",
    tenorMonths: 120,
    couponRate: "13.00%",
    withholdingTaxRate: "15%",
    maturityDate: "2036-07-21",
    amountOnOffer: "50,000.00",
    cleanPrice: null,
    accruedInterestPer100: null,
    dirtyPrice: null,
    couponPaymentDates: null,
    cleanPriceTable: null,
    rawExcerpt: "FXD2/2026/010 — 13.00% coupon, 10-year tenor",
    warnings: [],
    confidence: 0.95,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
  };
  const sharedFields = {
    bidSubmissionDeadline: "2026-07-15",
    auctionDate: "2026-07-17",
    settlementDate: "2026-07-21",
    nonCompetitiveMin: "KES 50,000",
  };

  const draft = structuredInstrumentToDraft(raw, "cbk_bond_reopening" as SourceClass, sharedFields);

  it("the draft carries the bond's own figures plus the shared auction-level fields", () => {
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields.securityType).toBe("fxd");
    expect(draft!.extractedFields.issueNumber).toBe("FXD2/2026/010");
    expect(draft!.extractedFields.couponRate).toBe("13.00%");
    expect(draft!.extractedFields.maturityDate).toBe("2036-07-21");
    expect(draft!.extractedFields.bidSubmissionDeadline).toBe("2026-07-15");
    expect(draft!.extractedFields.nonCompetitiveMin).toBe("KES 50,000");
  });

  const finding: ProjectableFinding = {
    instrumentName: draft!.instrumentName,
    issuer: draft!.issuer,
    sourceLabel: "Manually entered for Stage 10b-2 QA testing — not a live CBK source.",
    sourceUrl: null,
    sourceAsOf: Date.UTC(2026, 6, 17),
    extractedFields: draft!.extractedFields,
  };
  const figures = projectFindingToContractFigures(cbkContract, finding);

  it("the contract projection carries issueNumber/couponRate/maturityDate/applicationDeadline/minInvestment through", () => {
    expect(figures.issueNumber).toBe("FXD2/2026/010");
    expect(figures.couponRate).toBe("13.00%");
    expect(figures.maturityDate).toBe("2036-07-21");
    expect(figures.applicationDeadline).toBe("2026-07-15");
    expect(figures.minInvestment).toBe("KES 50,000");
  });

  it("the approval gate passes cleanly — base rules AND the FXD subtype rules", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.cbkSubtype).toBe("fxd");
  });

  it("buildPromotionPlan + extendedFields projection both preserve the bond's figures", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "gov_coupon",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.maturityDate).toBe("2036-07-21");
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, figures);
    expect(extended.issueNumber).toBe("FXD2/2026/010");
    expect(extended.couponRate).toBe("13.00%");
  });
});

// ── D. Static source-text scan ─────────────────────────────────────────────────

const aiResearchSrc = read("server/aiResearchService.ts");
const researchPipelineSrc = read("shared/researchPipeline.ts");
const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");
const askAiPage = read("client/src/pages/AskAI.tsx");
const cbkPage = read("client/src/pages/CbkSecuritiesReference.tsx");

describe("Stage 10b-2 · D — CBK_TBILL_EXTRACTION_SCHEMA carries the previously-missing established fields", () => {
  const idx = aiResearchSrc.indexOf('const CBK_TBILL_EXTRACTION_SCHEMA = {');
  const nextIdx = aiResearchSrc.indexOf('/** MMF factsheet / benchmark extraction schema. */', idx);
  const block = aiResearchSrc.slice(idx, nextIdx);

  it("securityType, whtRule, taxExempt, maturityDate, and minInvestment are schema fields", () => {
    for (const field of ["securityType", "whtRule", "taxExempt", "maturityDate", "minInvestment"]) {
      expect(block).toContain(`${field}:`);
      expect(block).toContain(`"${field}"`);
    }
  });

  it("applicationDeadline is a top-level shared field, alongside auctionDate/valueDate", () => {
    expect(block).toContain("applicationDeadline:");
    expect(block).toContain('required: ["answer", "auctionDate", "valueDate", "applicationDeadline", "instruments"]');
  });

  it("runStructuredExtraction captures parsed.applicationDeadline into sharedFields", () => {
    expect(aiResearchSrc).toContain("if (parsed.applicationDeadline) sharedFields.applicationDeadline = parsed.applicationDeadline;");
  });
});

describe("Stage 10b-2 · D — figurePresent sentinel fix is present in shared/researchPipeline.ts", () => {
  it("figurePresent reuses isRealSourceValue instead of a bare non-empty check", () => {
    const idx = researchPipelineSrc.indexOf("function figurePresent(");
    const block = researchPipelineSrc.slice(idx, researchPipelineSrc.indexOf("\n}\n", idx));
    expect(block).toContain("return isRealSourceValue(v);");
  });

  it("cbkSecurityTypeLabel and cbkTaxExemptLabel are exported and format cleanly", () => {
    expect(cbkSecurityTypeLabel("treasury_bill")).toBe("Treasury bill");
    expect(cbkSecurityTypeLabel("fxd")).toBe("Fixed coupon bond (FXD)");
    expect(cbkSecurityTypeLabel("ifb")).toBe("Infrastructure bond (IFB)");
    expect(cbkSecurityTypeLabel(null)).toBeNull();
    expect(cbkSecurityTypeLabel("some_unrecognised_type")).toBe("some unrecognised type");
    expect(cbkTaxExemptLabel("true")).toBe("Yes");
    expect(cbkTaxExemptLabel("false")).toBe("No");
    expect(cbkTaxExemptLabel(null)).toBeNull();
  });
});

describe("Stage 10b-2 · D — CBK Reference Catalogue table has explicit columns for every established field (C)", () => {
  it("every established CBK field has its own header", () => {
    const headers = [
      ">Security<",
      "Security type",
      "Yield / rate",
      "Coupon rate",
      "Net yield after WHT",
      "Tax treatment",
      "Tax-exempt",
      "Tenor",
      "Auction date",
      "Value date",
      "Maturity",
      "Minimum investment",
      "Source &amp; freshness",
      "Action",
    ];
    for (const header of headers) {
      expect(cbkPage).toContain(header);
    }
  });

  it("the table reuses the CBK contract for every extendedFields-tier column, not hand-typed labels", () => {
    expect(cbkPage).toContain('const CBK_CONTRACT = getCatalogueFieldContract("cbk");');
    expect(cbkPage).toContain('const cbkFieldByKey = (key: string) => CBK_CONTRACT?.fields.find((f) => f.key === key);');
    for (const key of ["securityType", "couponRate", "whtRule", "taxExempt", "auctionDate", "valueDate", "minInvestment"]) {
      expect(cbkPage).toContain(`cbkFieldByKey("${key}")`);
    }
  });

  it("Net yield after WHT is computed where safely possible, and shows a clean dash otherwise (D)", () => {
    expect(cbkPage).toContain("function netYieldAfterWht(");
    // IFB (tax-exempt) path: gross yield unchanged.
    expect(cbkPage).toContain('if ((taxExempt ?? "").trim().toLowerCase() === "true") return y;');
    // Parses the WHT % out of the free-text whtRule instead of assuming a fixed rate.
    expect(cbkPage).toContain('const m = (whtRule ?? "").match(/(\\d+(?:\\.\\d+)?)\\s*%/);');
    expect(cbkPage).toContain("if (!m) return null;");
  });

  it("the table replaces the fragile name/factNote tax-exempt REGEX with the real structured taxExempt figure", () => {
    expect(cbkPage).not.toContain('const isTaxExempt = /ifb|infrastructure/i.test(`${r.name} ${r.factNote ?? ""}`);');
    expect(cbkPage).toContain('const isTaxExempt = (taxExemptRaw ?? "").trim().toLowerCase() === "true";');
  });

  it("securityType/taxExempt display cleanly via the shared label helpers, never a raw enum/boolean string", () => {
    const idx = cbkPage.indexOf("function GovRow(");
    const block = cbkPage.slice(idx, cbkPage.indexOf("function DrawerFact("));
    expect(block).toContain("cbkSecurityTypeLabel(securityType)");
    expect(block).toContain("cbkTaxExemptLabel(taxExemptRaw)");
  });

  it("minimum investment tolerates a currency prefix/commas and formats as KES, mirroring the Bank/CBK numeric-parsing fix", () => {
    expect(cbkPage).toContain("function parseAmount(");
    expect(cbkPage).toContain("function kes(");
  });

  it("the page container is widened for the larger explicit-column table, with horizontal scroll fallback preserved", () => {
    expect(cbkPage).toContain('max-w-[1900px]');
    expect(cbkPage).toContain('<div className="overflow-x-auto">');
  });
});

describe("Stage 10b-2 · D — CBK drawer gains Net yield after WHT and a clean security-type label", () => {
  it("the drawer shows Net yield after WHT alongside Tax treatment / Tax-exempt", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx);
    expect(block).toContain('fieldByKey("netYieldAfterWht")?.label ?? "Net yield after WHT"');
  });

  it("the drawer's securityType fact is formatted via cbkSecurityTypeLabel, not the raw value", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx, idx + 4000);
    expect(block).toContain("value={cbkSecurityTypeLabel(securityType) ?? \"—\"}");
  });
});

describe("Stage 10b-2 · D — ResearchDesk.tsx: multi-field edit path extended to CBK", () => {
  it("EditCatalogueFieldsDialog now supports mmf, bank, AND cbk, with cbk's own (name-less) envelope routing", () => {
    const idx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const nextIdx = researchDeskPage.indexOf("/* ── Pending update review queue");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain('const isSupported = catalogue === "mmf" || catalogue === "bank" || catalogue === "cbk";');
    expect(block).toContain("cbk: {");
  });

  it("the Edit fields entry points (pending card + approval modal) are both gated to include cbk", () => {
    expect(researchDeskPage).toContain('(data?.catalogue === "mmf" || data?.catalogue === "bank" || data?.catalogue === "cbk")');
    expect(researchDeskPage).toContain('(contract.catalogue === "mmf" || contract.catalogue === "bank" || contract.catalogue === "cbk")');
  });

  it("CBK's securityType/taxExempt display cleanly (not raw) in the review-queue card, approval modal, and Ask AI finding card", () => {
    expect(researchDeskPage).toContain('contract?.catalogue === "cbk" && k === "securityType"');
    expect(researchDeskPage).toContain('contract?.catalogue === "cbk" && k === "taxExempt"');
    expect(researchDeskPage).toContain('data?.catalogue === "cbk" && row.key === "securityType"');
    expect(researchDeskPage).toContain('contract.catalogue === "cbk" && row.key === "securityType"');
    const idx = askAiPage.indexOf("CBK catalogue fields");
    const nextIdx = askAiPage.indexOf("Slice 8e-1", idx);
    const block = askAiPage.slice(idx, nextIdx);
    expect(block).toContain('row.key === "securityType"');
    expect(block).toContain('row.key === "taxExempt"');
  });

  it("the review-queue card and the approval modal already resolve the full CBK contract field block generically — verified, not newly added", () => {
    const idx = researchDeskPage.indexOf("const contract = resolveContractCatalogueForUpdate({");
    const block = researchDeskPage.slice(idx, idx + 1200);
    expect(block).toContain("getCatalogueFieldContract(contract.catalogue)");
  });
});

// ── E. Full edit → approve → published-row path (requires DATABASE_URL) ────────

describe.skipIf(!hasDb)("Stage 10b-2 · E — the T-bill QA scenario round-trips through the real DB (requires DATABASE_URL)", () => {
  const TEST_REF = `zz-stage10b2-cbk-tbill-${Date.now()}`;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, TEST_REF));
  });

  it("a pending CBK T-bill update carrying the full QA scenario — including a post-draft rate edit via updatePendingFields — approves cleanly and publishes every field correctly", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    const pendingId = await enqueueResearchUpdate({
      targetRef: TEST_REF,
      changeKind: "create",
      name: "Test 91-Day Treasury Bill (Stage 10b-2 QA)",
      assetClass: "gov_discount",
      currency: "KES",
      figures: {
        securityType: "treasury_bill",
        tenor: "91",
        yieldPct: "10.00",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityDate: "2026-10-19",
        minInvestment: "KES 50,000",
        applicationDeadline: "2026-07-16",
        auctionDate: "2026-07-17",
        valueDate: "2026-07-20",
      },
      source: "Manually entered for Stage 10b-2 QA testing — not a live CBK source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));

    // The multi-field edit path (updatePendingFields) — now available for CBK.
    const edited = await caller.researchPipeline.updatePendingFields({
      id: pendingId as number,
      figures: { yieldPct: "10.50" },
    });
    expect((edited.update.figures as Record<string, unknown>).yieldPct).toBe("10.50");

    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const { getDb } = await import("./db");
    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [published] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.ref, TEST_REF)).limit(1);
    expect(published).toBeTruthy();
    expect(Number(published.yieldPct)).toBeCloseTo(10.5);
    const ext = published.extendedFields as Record<string, unknown> | null;
    expect(ext?.securityType).toBe("treasury_bill");
    expect(ext?.whtRule).toBe("15% withholding tax on the discount");
    expect(ext?.taxExempt).toBe("false");
    expect(ext?.maturityDate).toBe("2026-10-19");
    expect(ext?.minInvestment).toBe("KES 50,000");
  });
});
