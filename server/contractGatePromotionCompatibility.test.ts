/**
 * Slice 8g-3 — contract/gate/promotion compatibility tests (tests only, no
 * production behavior change). Closes 8g-1's recommendation: lock the current
 * (already-correct) alignment between `catalogueFieldContracts`, the live
 * approval gate, `buildPromotionPlan`, and 8g-2's extendedFields persistence,
 * so any future drift between these 4 independently-maintained layers fails a
 * test immediately instead of silently shipping.
 *
 * AUDIT — what's already covered vs. genuinely new (read first, to avoid
 * duplicating server/{mmf,bank,cbk,equity,reit,offshoreFund,sacco}ContractMapping.test.ts,
 * server/sourceEnrichmentPromotion.test.ts, and server/contractPromotionExtendedFields.test.ts):
 *
 *   ALREADY COVERED per catalogue (not repeated here): each contract-mapping
 *   file already proves checkApprovalGate PASSES for a CREATE draft built from
 *   projectFindingToContractFigures's own output, has a "regression guard" if
 *   a required field goes missing, proves buildPromotionPlan maps each field
 *   the typed payload covers, and documents that file's ONE known pre-existing
 *   gap (Bank's orphaned `liquidity`, market-asset's structurally-unsatisfiable
 *   `issuer`). REIT's alsoWriteKeys mechanism and SACCO's assetType stamping
 *   already have dedicated "load-bearing, not redundant" tests.
 *
 *   GENUINELY NEW, added below:
 *     1. A `market` storageStatus lock — Slice 8g-2 corrected Equity/REIT/
 *        Offshore fund's `market` field from "extendedFields" to "column"
 *        (it was mislabeled; buildPromotionPlan already wrote it to a real
 *        column). Nothing pinned this correction directly yet.
 *     2. A consolidated cross-catalogue regression matrix — all 7 categories'
 *        gate-pass + specific fragile-key VALUE checks in ONE place, so a
 *        future reviewer sees the full compatibility surface at a glance
 *        instead of across 7 separate files.
 *     3. The CHAINED pipeline — projectFindingToContractFigures (draft time)
 *        → projectContractFiguresToExtendedFields (promotion time) — proven
 *        together for CBK/SACCO. 8g-2's own tests use hand-built figures
 *        bags; nothing yet proves the two stages compose correctly end to end.
 *     4. Negative-drift pins for the specific regressions named in the 8g-3
 *        instructions (assetType-stamping mechanism, detection priority,
 *        alsoWriteKeys, market storageStatus) that don't already have a
 *        dedicated standalone test.
 *     5. Explicit "known, accepted, not-a-bug" pins for MMF's wht/aum and
 *        Bank's liquidity gaps, so a future slice can't silently "fix" them
 *        without a deliberate decision (or silently make them worse without
 *        anyone noticing a test change).
 *     6. A structural guarantee that contract-derived extendedFields keys can
 *        never collide with sourceEnrichment's keys, across all 7 contracts —
 *        proves 8g-2's merge order can't silently misbehave, without needing
 *        the DB-gated integration test to be the only proof.
 *
 * No production code changes in this slice. `figurePresent`'s alias table and
 * `SACCO_FIELD_ALIASES` are private to shared/researchPipeline.ts and stay
 * that way — every check below goes through the same public API a real
 * approval/promotion already uses (checkApprovalGate, buildPromotionPlan,
 * detectMarketAssetSacco, projectFindingToContractFigures,
 * projectContractFiguresToExtendedFields), never a new export added just to
 * peek at private state.
 */
import { describe, expect, it } from "vitest";
import {
  getCatalogueFieldContract,
  projectFindingToContractFigures,
  projectContractFiguresToExtendedFields,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan, detectMarketAssetSacco } from "../shared/researchPipeline";
import type { AssetClass } from "../shared/assetModel";

// ── 1. market storageStatus lock (Slice 8g-2's correction) ────────────────────

describe("Slice 8g-3 · market storageStatus lock", () => {
  it("Equity/REIT/Offshore fund's 'market' field is storageStatus: 'column' — NOT 'extendedFields' (the 8g-2 correction; a revert would duplicate an already-promoted column value into extendedFields)", () => {
    for (const subtype of ["equity", "reit", "offshore_fund"] as const) {
      const contract = getCatalogueFieldContract("market_asset", subtype);
      const marketField = contract?.fields.find((f) => f.key === "market");
      expect(marketField, `${subtype} should have a 'market' field`).toBeTruthy();
      expect(marketField?.storageStatus, `${subtype}'s market field`).toBe("column");
    }
  });

  it("SACCO has no 'market' field at all — a SACCO isn't exchange-listed, so this isn't a gap the correction above needs to cover", () => {
    const contract = getCatalogueFieldContract("market_asset", "sacco");
    expect(contract?.fields.find((f) => f.key === "market")).toBeUndefined();
  });

  it("consequently, projectContractFiguresToExtendedFields never persists 'market' for any market-asset subtype (it's a typed column, not the extendedFields-only tier)", () => {
    for (const subtype of ["equity", "reit", "offshore_fund", "sacco"] as const) {
      const result = projectContractFiguresToExtendedFields("market_asset", subtype, { market: "NSE" });
      expect(result).not.toHaveProperty("market");
    }
  });
});

// ── 2. Consolidated cross-catalogue regression matrix ──────────────────────────

/** A realistic, fully-populated finding per catalogue, matching each contract
 *  mapping test file's own established fixture shape. Feeding these through
 *  the REAL projectFindingToContractFigures (not hand-built figures bags)
 *  proves the whole draft-time pipeline, not just the gate/promotion layer
 *  in isolation. */
const FIXTURES: Record<
  string,
  { finding: ProjectableFinding; assetClass: AssetClass; subtype?: "equity" | "reit" | "offshore_fund" | "sacco"; issuer?: string }
> = {
  mmf: {
    assetClass: "cash_mmf",
    finding: {
      instrumentName: "Cytonn Money Market Fund",
      issuer: "Cytonn Investments",
      sourceLabel: "Cytonn factsheet",
      sourceUrl: "https://cytonn.com/factsheet",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: { ear: "16.5", grossYield: "17.0", managementFee: "2.0", minInvestment: "1000" },
    },
  },
  bank: {
    assetClass: "bank_deposit",
    finding: {
      instrumentName: "Fixed Deposit",
      issuer: "Equity Bank",
      sourceLabel: "Equity Bank product page",
      sourceUrl: "https://equitybank.co.ke/fd",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: {
        instrumentType: "fixed_deposit",
        indicativeRate: "13.5",
        minAmount: "50000",
        typicalTenor: "12 months",
        isNegotiable: "false",
        liquidity: "Withdrawable at maturity",
      },
    },
  },
  cbk: {
    assetClass: "gov_discount",
    finding: {
      instrumentName: "91-Day Treasury Bill",
      sourceLabel: "CBK auction results",
      sourceUrl: "https://www.centralbank.go.ke/auction",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: {
        securityType: "treasury_bill",
        tenorDays: "91",
        yieldPct: "8.8",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        auctionDate: "2026-07-15",
        valueDate: "2026-07-17",
      },
    },
  },
  equity: {
    assetClass: "equity",
    issuer: "Safaricom PLC",
    finding: {
      instrumentName: "Safaricom PLC",
      issuer: "Safaricom PLC",
      sourceLabel: "NSE market data",
      sourceUrl: "https://www.nse.co.ke/equity",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: { marketPrice: "18.50", dividendYield: "5.2", exchange: "NSE", liquidity: "daily", ticker: "SCOM" },
    },
  },
  reit: {
    assetClass: "reit",
    issuer: "ILAM Fahari REIT",
    finding: {
      instrumentName: "ILAM Fahari REIT",
      issuer: "ILAM Fahari REIT",
      sourceLabel: "NSE market data",
      sourceUrl: "https://www.nse.co.ke/reit",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: { marketPrice: "18.00", distributionYield: "7.5", exchange: "NSE", liquidity: "daily", nav: "20.10" },
    },
  },
  offshore_fund: {
    assetClass: "offshore_fund",
    issuer: "ILAM Global Fund",
    finding: {
      instrumentName: "ILAM Global Fund",
      issuer: "ILAM Global Fund",
      sourceLabel: "Fund factsheet",
      sourceUrl: "https://example.com/global-fund-factsheet",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: {
        trailingReturn: "9.0",
        fee: "1.2",
        exchange: "NASDAQ",
        currency: "USD",
        fxRisk: "USD-denominated, KES investor bears FX risk",
      },
    },
  },
  sacco: {
    assetClass: "alt",
    issuer: "Stima SACCO",
    finding: {
      instrumentName: "Stima SACCO",
      issuer: "Stima SACCO",
      sourceLabel: "SACCO factsheet",
      sourceUrl: "https://example.com/stima-sacco",
      sourceAsOf: Date.UTC(2026, 6, 1),
      extractedFields: {
        assetType: "sacco",
        // dividendRate's own contract aliases are ["shareCapitalDividendRate",
        // "depositRebateRate"] — the canonical key "dividendRate" itself is
        // NOT a readable input alias (same gotcha 8g-2's test file hit).
        shareCapitalDividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "1000",
        withdrawalTerms: "30 days notice",
        regulatoryStatus: "SASRA-regulated",
        liquidity: "withdrawable_with_notice",
      },
    },
  },
};

describe("Slice 8g-3 · consolidated cross-catalogue regression matrix", () => {
  it("MMF: full contract-projected draft passes the gate; ear/grossYield/managementFee/minInvestment reach the typed mmf payload", () => {
    const contract = getCatalogueFieldContract("mmf");
    const { finding, assetClass } = FIXTURES.mmf;
    const figures = projectFindingToContractFigures(contract!, finding);
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "mmf",
      name: finding.instrumentName,
      assetClass,
      issuer: finding.issuer,
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("mmf");
    if (plan.target === "mmf") {
      expect(plan.payload.ear).toBeCloseTo(16.5, 5);
      expect(plan.payload.grossYield).toBeCloseTo(17.0, 5);
      expect(plan.payload.managementFee).toBeCloseTo(2.0, 5);
      expect(plan.payload.minInvestment).toBeCloseTo(1000, 5);
    }
  });

  it("Bank: full contract-projected draft passes the gate (except the known orphaned liquidity gap); indicativeRate/minAmount/isNegotiable reach the typed bank payload under their renamed keys", () => {
    const contract = getCatalogueFieldContract("bank");
    const { finding, assetClass } = FIXTURES.bank;
    const figures = projectFindingToContractFigures(contract!, finding);
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    // The fixture supplies liquidity via the raw 'liquidity' extraction key,
    // which has no contract field/alias — same pre-existing, documented gap
    // bankContractMapping.test.ts already isolates. Confirm it's the ONLY gap.
    expect(gate.missing).toEqual(["liquidity / withdrawal terms"]);
    const plan = buildPromotionPlan({
      target: "bank",
      name: finding.instrumentName,
      assetClass,
      issuer: finding.issuer,
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "bank") {
      expect(plan.payload.indicativeRate).toBeCloseTo(13.5, 5);
      expect(plan.payload.minAmount).toBeCloseTo(50000, 5);
      // Pre-existing, out-of-scope quirk (predates this whole initiative, not
      // touched by 8g-2/8g-3): buildPromotionPlan does `Boolean(f.isNegotiable)`,
      // and every figures-bag value is a STRING by the time it reaches here
      // (readAliasValue always stringifies) — Boolean("false") is `true` in
      // JS. Documenting the actual current behavior, not asserting what
      // "should" happen; not this slice's job to fix.
      expect(plan.payload.isNegotiable).toBe(true);
    }
  });

  it("CBK: full contract-projected T-bill draft passes base + subtype gate; yieldPct/whtRule/taxExempt/auctionDate/valueDate/maturityDate all reach their correct destinations (typed column OR extendedFields via 8g-2)", () => {
    const contract = getCatalogueFieldContract("cbk");
    const { finding, assetClass } = FIXTURES.cbk;
    const figures = projectFindingToContractFigures(contract!, finding);
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    expect(gate.cbkSubtype).toBe("tbill");
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass,
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "opportunity") {
      expect(plan.payload.yieldPct).toBeCloseTo(8.8, 5);
    }
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, figures);
    expect(extended.whtRule).toBe("15% withholding tax on the discount");
    expect(extended.taxExempt).toBe("false");
    expect(extended.auctionDate).toBe("2026-07-15");
    expect(extended.valueDate).toBe("2026-07-17");
  });

  it("Equity: full contract-projected draft passes the gate (given issuer); lastPrice/yieldPct/market reach the typed opportunity payload under their renamed keys; ticker reaches extendedFields via 8g-2", () => {
    const contract = getCatalogueFieldContract("market_asset", "equity");
    const { finding, assetClass, issuer } = FIXTURES.equity;
    const figures = projectFindingToContractFigures(contract!, finding);
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass,
      issuer,
      currency: "KES",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "opportunity") {
      expect(plan.payload.lastPrice).toBeCloseTo(18.5, 5);
      expect(plan.payload.yieldPct).toBeCloseTo(5.2, 5);
      expect(plan.payload.market).toBe("NSE");
    }
    const extended = projectContractFiguresToExtendedFields("market_asset", "equity", figures);
    expect(extended.ticker).toBe("SCOM");
  });

  it("REIT: distributionYield satisfies the REIT subtype gate AND still feeds the typed yieldPct column via alsoWriteKeys AND persists to extendedFields via 8g-2 — all three simultaneously", () => {
    const contract = getCatalogueFieldContract("market_asset", "reit");
    const { finding, assetClass, issuer } = FIXTURES.reit;
    const figures = projectFindingToContractFigures(contract!, finding);
    // alsoWriteKeys is doing its job: one found value, two output keys.
    expect(figures.distributionYield).toBe("7.5");
    expect(figures.yieldPct).toBe("7.5");
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass,
      issuer,
      currency: "KES",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "opportunity") {
      expect(plan.payload.yieldPct).toBeCloseTo(7.5, 5); // reached via alsoWriteKeys
    }
    const extended = projectContractFiguresToExtendedFields("market_asset", "reit", figures);
    expect(extended.distributionYield).toBe("7.5"); // ALSO persisted under its own canonical label
    expect(extended.nav).toBe("20.10");
  });

  it("Offshore fund: trailingReturnPct/expenseRatioPct satisfy the subtype gate and feed their own dedicated typed payload fields; currency-must-not-be-KES holds; fxRiskNote persists via 8g-2", () => {
    const contract = getCatalogueFieldContract("market_asset", "offshore_fund");
    const { finding, assetClass, issuer } = FIXTURES.offshore_fund;
    const figures = projectFindingToContractFigures(contract!, finding);
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer,
      currency: "USD",
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass,
      issuer,
      currency: "USD",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "opportunity") {
      expect(plan.payload.trailingReturnPct).toBeCloseTo(9.0, 5);
      expect(plan.payload.expenseRatioPct).toBeCloseTo(1.2, 5);
    }
    const extended = projectContractFiguresToExtendedFields("market_asset", "offshore_fund", figures);
    expect(extended.fxRiskNote).toBe("USD-denominated, KES investor bears FX risk");
  });

  it("SACCO: full contract-projected draft satisfies the REPLACEMENT gate; all 5 subtype-defining figures land in extendedFields via 8g-2, none in the typed opportunity payload except liquidity", () => {
    const contract = getCatalogueFieldContract("market_asset", "sacco");
    const { finding, assetClass, issuer } = FIXTURES.sacco;
    const figures = projectFindingToContractFigures(contract!, finding);
    expect(figures.assetType).toBe("sacco");
    const gate = checkApprovalGate({
      assetClass,
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: Number(finding.sourceAsOf),
    });
    expect(gate.ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass,
      issuer,
      currency: "KES",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target === "opportunity") {
      expect(plan.payload.liquidity).toBe("withdrawable_with_notice");
      // None of SACCO's defining figures have a typed payload field.
      expect(plan.payload.yieldPct).toBeNull();
      expect(plan.payload.lastPrice).toBeNull();
    }
    const extended = projectContractFiguresToExtendedFields("market_asset", "sacco", figures);
    expect(extended.dividendRate).toBe("12%");
    expect(extended.minimumShareCapital).toBe("5000");
    expect(extended.minimumMonthlyDeposit).toBe("1000");
    expect(extended.withdrawalTerms).toBe("30 days notice");
    expect(extended.regulatoryStatus).toBe("SASRA-regulated");
    expect(extended).not.toHaveProperty("assetType"); // routing signal, not persisted (8g-2 decision)
  });
});

// ── 3. Chained draft-time → promotion-time pipeline ─────────────────────────

describe("Slice 8g-3 · chained pipeline — projectFindingToContractFigures composes correctly with projectContractFiguresToExtendedFields", () => {
  it("CBK: the SAME figures a real draft button would submit correctly feed 8g-2's extendedFields projection, not just a hand-built fixture", () => {
    const contract = getCatalogueFieldContract("cbk");
    const figures = projectFindingToContractFigures(contract!, FIXTURES.cbk.finding);
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, figures);
    expect(extended.whtRule).toBe("15% withholding tax on the discount");
    expect(extended.taxExempt).toBe("false");
    expect(extended.auctionDate).toBe("2026-07-15");
    expect(extended.valueDate).toBe("2026-07-17");
    expect(extended.securityType).toBe("treasury_bill");
    // Never a typed column duplicated in.
    expect(extended).not.toHaveProperty("tenor");
    expect(extended).not.toHaveProperty("yieldPct");
  });

  it("SACCO: the SAME figures a real draft button would submit correctly feed 8g-2's extendedFields projection", () => {
    const contract = getCatalogueFieldContract("market_asset", "sacco");
    const figures = projectFindingToContractFigures(contract!, FIXTURES.sacco.finding);
    const extended = projectContractFiguresToExtendedFields("market_asset", "sacco", figures);
    expect(extended.dividendRate).toBe("12%");
    expect(extended.minimumShareCapital).toBe("5000");
    expect(extended.minimumMonthlyDeposit).toBe("1000");
    expect(extended.withdrawalTerms).toBe("30 days notice");
    expect(extended.regulatoryStatus).toBe("SASRA-regulated");
    // assetType was stamped by stage 1 (draft-time) but stage 2 (promotion-time)
    // deliberately drops it — proves the two stages' DIFFERENT treatment of the
    // same key composes correctly, not just independently.
    expect(figures.assetType).toBe("sacco");
    expect(extended).not.toHaveProperty("assetType");
  });
});

// ── 4. Negative-drift pins ──────────────────────────────────────────────────

describe("Slice 8g-3 · negative-drift pins", () => {
  it("detectMarketAssetSacco's PRIMARY signal is figures.assetType === 'sacco' — a SACCO is detected via this alone, with no name/issuer/regulatoryStatus text match needed", () => {
    const detected = detectMarketAssetSacco({
      catalogue: "market_asset",
      assetClass: "alt",
      figures: { assetType: "sacco" },
      name: "Totally Generic Name With No SACCO Keyword",
      issuer: "Also Generic",
    });
    expect(detected).toBe(true);
  });

  it("detectMarketAssetSacco correctly falls through to the name/issuer text heuristic when assetType is absent (the SAME fallback the gate relies on for legacy/manual rows)", () => {
    const detected = detectMarketAssetSacco({
      catalogue: "market_asset",
      assetClass: "alt",
      figures: {},
      name: "Stima SACCO",
      issuer: null,
    });
    expect(detected).toBe(true);
  });

  it("a quoted market signal (market/lastPrice present) correctly PREVENTS SACCO misdetection for a genuine equity/REIT/offshore-fund 'alt' row with no assetType stated", () => {
    const detected = detectMarketAssetSacco({
      catalogue: "market_asset",
      assetClass: "alt",
      figures: { lastPrice: "18.50" },
      name: "Some Alternative Asset",
      issuer: "Some Manager",
    });
    expect(detected).toBe(false);
  });

  it("REIT's alsoWriteKeys mechanism is still present on the contract's distributionYield field (a revert would silently drop yieldPct from the promoted opportunities row again)", () => {
    const contract = getCatalogueFieldContract("market_asset", "reit");
    const field = contract?.fields.find((f) => f.key === "distributionYield");
    expect(field?.alsoWriteKeys).toEqual(["yieldPct"]);
  });

  it("SACCO's assetType stamp still fires unconditionally, even with zero other SACCO figures present (a revert would silently break detectMarketAssetSacco's primary detection path for every future contract-drafted SACCO finding)", () => {
    const contract = getCatalogueFieldContract("market_asset", "sacco");
    const figures = projectFindingToContractFigures(contract!, {
      instrumentName: "Empty SACCO",
      extractedFields: {},
    });
    expect(figures.assetType).toBe("sacco");
  });

  it("projectContractFiguresToExtendedFields still stops persisting CBK's whtRule if it's genuinely absent — proves the fix didn't turn into a silent 'always stamp something' fabrication", () => {
    const result = projectContractFiguresToExtendedFields("cbk", undefined, { securityType: "treasury_bill" });
    expect(result).not.toHaveProperty("whtRule");
    expect(result.securityType).toBe("treasury_bill");
  });
});

// ── 5. Known, accepted, not-a-bug gaps (documented so they can't silently drift) ──

describe("Slice 8g-3 · known-gap pins — accepted current behavior, not bugs to fix here", () => {
  it("MMF: wht and aum are contract fields marked promoteToCatalogueRow: true, but buildPromotionPlan's MmfPromotion payload has NO field for either — a documented, pre-existing gap, not touched by 8g-2 (MMF's extendedFields tier was never wired, deliberately, since MMF has no gate-required extendedFields-only gap)", () => {
    const contract = getCatalogueFieldContract("mmf");
    const whtField = contract?.fields.find((f) => f.key === "wht");
    const aumField = contract?.fields.find((f) => f.key === "aum");
    expect(whtField?.promoteToCatalogueRow).toBe(true);
    expect(aumField?.promoteToCatalogueRow).toBe(true);
    const plan = buildPromotionPlan({
      target: "mmf",
      name: "Test Fund",
      assetClass: "cash_mmf",
      figures: { ear: "16.5", grossYield: "17.0", managementFee: "2.0", minInvestment: "1000", wht: "15", aum: "500" },
      source: "Test",
    });
    // Neither key exists on the typed payload at all.
    expect(plan.target).toBe("mmf");
    expect(Object.keys(plan.payload)).not.toContain("wht");
    expect(Object.keys(plan.payload)).not.toContain("aum");
  });

  it("Bank: liquidity is gate-required but has no extraction source and no DB column — approving a bank draft without a manually-supplied liquidity value stays blocked, by design (not fixed by 8g-2, which is opportunity-only)", () => {
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures: {
        instrumentType: "fixed_deposit",
        indicativeRate: "13.5",
        minAmount: "50000",
        typicalTenor: "12 months",
        isNegotiable: "false",
        // liquidity deliberately omitted.
      },
      name: "Fixed Deposit",
      issuer: "Equity Bank",
      source: "Equity Bank product page",
      asOf: Date.UTC(2026, 6, 1),
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["liquidity / withdrawal terms"]);
  });
});

// ── 6. Structural guarantee: contract-derived extendedFields never collides with sourceEnrichment keys ──

describe("Slice 8g-3 · contract-derived keys never collide with source-envelope keys", () => {
  const SOURCE_ENRICHMENT_KEYS = new Set(["sourceLabel", "sourceUrl", "sourceAsOfDate"]);

  it("for every one of the 7 active contracts, no extendedFields-tier field's canonical key is 'sourceLabel', 'sourceUrl', or 'sourceAsOfDate' — proves 8g-2's merge order (source envelope spread last) can never accidentally be a no-op collision, structurally, not just by observed test behavior", () => {
    const combos: Array<["mmf" | "bank" | "cbk", undefined] | ["market_asset", "equity" | "reit" | "offshore_fund" | "sacco"]> = [
      ["mmf", undefined],
      ["bank", undefined],
      ["cbk", undefined],
      ["market_asset", "equity"],
      ["market_asset", "reit"],
      ["market_asset", "offshore_fund"],
      ["market_asset", "sacco"],
    ];
    for (const [catalogue, subtype] of combos) {
      const contract = getCatalogueFieldContract(catalogue, subtype);
      const extendedFieldsTierKeys = contract!.fields.filter((f) => f.storageStatus === "extendedFields").map((f) => f.key);
      for (const key of extendedFieldsTierKeys) {
        expect(SOURCE_ENRICHMENT_KEYS.has(key), `${catalogue}${subtype ? `/${subtype}` : ""}'s field '${key}'`).toBe(false);
      }
    }
  });
});
