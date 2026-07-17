/**
 * Stage 9b — approval-screen field-label parity cleanup, closing Stage 9a's
 * headline audit finding: `ResearchDesk.tsx`'s actual approval screen
 * (`fmtFigures`/`PendingDiffTable`) had its own tiny, independent 13-entry
 * label map — completely disconnected from `shared/catalogueFieldContracts.ts`
 * — so most extendedFields-tier figures (CBK's whtRule/taxExempt/auctionDate/
 * valueDate/issueNumber/couponRate, every one of SACCO's subtype-defining
 * figures) rendered with their raw camelCase key as the label, and SACCO's
 * internal `assetType` routing signal was shown to the manager as if it were
 * a real field.
 *
 * Fix: three new pure, display-only helpers in
 * shared/catalogueFieldContracts.ts —
 *   - `resolveContractCatalogueForUpdate` — resolves which catalogue/subtype
 *     contract applies to a pending update, mirroring the SAME resolution
 *     `reviewResearchUpdate` already uses at promotion time (Slice 8g-2), so
 *     the approval-screen display and the promotion-time persistence can't
 *     drift into two different answers for the same update.
 *   - `resolveApprovalFigureLabel` — looks up a raw key's contract label,
 *     checking the field's own canonical key first then its `aliases` (a raw
 *     AI-extraction-schema field name, as `PendingDiffTable`'s `changedFields`
 *     carries, is very likely an ALIAS, not the canonical key). Falls back to
 *     a caller-supplied fallback label (or the raw key) for anything the
 *     active contract doesn't recognize — never hides a field by itself.
 *   - `isInternalRoutingFigureKey` — flags keys that must never be shown as a
 *     real figure (currently just SACCO's `assetType` stamp).
 * All three are pure, read-only, and never called by `checkApprovalGate`,
 * `buildPromotionPlan`, or `reviewResearchUpdate` — display-only, wired only
 * into `ResearchDesk.tsx`'s `fmtFigures`/`PendingDiffTable`.
 *
 * DISCREPANCY FROM THE 9b INSTRUCTIONS (reported, not silently changed): the
 * instructions' example mapping said `whtRule` → "WHT rule" and `taxExempt` →
 * "Tax exempt". The REAL, existing contract labels (set during Slice 8d, with
 * their own documented reasoning — whtRule's note explicitly says the free-
 * text description IS "what a manager actually reads as 'tax treatment'") are
 * `whtRule` → "Tax treatment" and `taxExempt` → "Tax-exempt flag". This test
 * file asserts the REAL contract labels (per the instruction to "use
 * catalogueFieldContracts labels where safe" — the contract is the source of
 * truth, not the example text), not the instructions' paraphrase. SACCO's 5
 * example labels all matched the real contract exactly; `valueDate`'s real
 * label is "Value / settlement date" (fuller than "Value date", both
 * acceptable, tested as the real value).
 *
 * Two layers of test (established convention — no jsdom in this repo):
 *   A. `resolveApprovalFigureLabel`/`isInternalRoutingFigureKey`/
 *      `resolveContractCatalogueForUpdate` — pure, imported and called
 *      directly for real behavioural proof.
 *   B. `ResearchDesk.tsx`'s `fmtFigures`/`PendingDiffTable` wiring — static
 *      source-text scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveApprovalFigureLabel,
  isInternalRoutingFigureKey,
  resolveContractCatalogueForUpdate,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan } from "../shared/researchPipeline";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── A. Pure helper behaviour ────────────────────────────────────────────────

describe("Stage 9b · A — resolveApprovalFigureLabel (pure, no DB)", () => {
  describe("1. CBK labels", () => {
    const cases: [string, string][] = [
      ["whtRule", "Tax treatment"],
      ["taxExempt", "Tax-exempt flag"],
      ["auctionDate", "Auction date"],
      ["valueDate", "Value / settlement date"],
      ["issueNumber", "Issue number"],
      ["couponRate", "Coupon rate"],
    ];
    for (const [key, label] of cases) {
      it(`'${key}' resolves to the clean contract label '${label}', not the raw key`, () => {
        expect(resolveApprovalFigureLabel("cbk", undefined, key)).toBe(label);
      });
    }
  });

  describe("2. SACCO labels", () => {
    const cases: [string, string][] = [
      ["dividendRate", "Dividend rate / interest rate"],
      ["minimumShareCapital", "Minimum share capital"],
      ["minimumMonthlyDeposit", "Minimum contribution"],
      ["withdrawalTerms", "Lock-in or withdrawal rule"],
      ["regulatoryStatus", "Risk / protection note"],
    ];
    for (const [key, label] of cases) {
      it(`'${key}' resolves to the clean contract label '${label}', not the raw key`, () => {
        expect(resolveApprovalFigureLabel("market_asset", "sacco", key)).toBe(label);
      });
    }
  });

  it("3. SACCO's assetType is flagged as an internal routing key — must not be displayed", () => {
    expect(isInternalRoutingFigureKey("market_asset", "sacco", "assetType")).toBe(true);
  });

  it("3b. assetType is NOT flagged as internal for any other catalogue/subtype — the hide-check is scoped, not a blanket ban on the string 'assetType'", () => {
    expect(isInternalRoutingFigureKey("mmf", undefined, "assetType")).toBe(false);
    expect(isInternalRoutingFigureKey("bank", undefined, "assetType")).toBe(false);
    expect(isInternalRoutingFigureKey("cbk", undefined, "assetType")).toBe(false);
    expect(isInternalRoutingFigureKey("market_asset", "equity", "assetType")).toBe(false);
    expect(isInternalRoutingFigureKey("market_asset", "reit", "assetType")).toBe(false);
    expect(isInternalRoutingFigureKey("market_asset", "offshore_fund", "assetType")).toBe(false);
  });

  describe("4. MMF/Bank/Equity/REIT/Offshore fund labels remain readable — no regression", () => {
    it("MMF: ear/grossYield/managementFee/minInvestment resolve to their real contract labels", () => {
      expect(resolveApprovalFigureLabel("mmf", undefined, "ear")).toBe("EAR");
      expect(resolveApprovalFigureLabel("mmf", undefined, "grossYield")).toBe("Gross yield");
      expect(resolveApprovalFigureLabel("mmf", undefined, "managementFee")).toBe("Management fee");
      expect(resolveApprovalFigureLabel("mmf", undefined, "minInvestment")).toBe("Minimum investment");
    });

    it("Bank: indicativeRate/minAmount/isNegotiable/tenor resolve to their real contract labels", () => {
      expect(resolveApprovalFigureLabel("bank", undefined, "indicativeRate")).toBe("Interest rate");
      expect(resolveApprovalFigureLabel("bank", undefined, "minAmount")).toBe("Minimum deposit");
      expect(resolveApprovalFigureLabel("bank", undefined, "isNegotiable")).toBe("Negotiable");
      expect(resolveApprovalFigureLabel("bank", undefined, "tenor")).toBe("Tenor / lock-in period");
    });

    it("Equity: ticker/lastPrice/yieldPct resolve to their real contract labels", () => {
      expect(resolveApprovalFigureLabel("market_asset", "equity", "ticker")).toBe("Ticker / symbol");
      expect(resolveApprovalFigureLabel("market_asset", "equity", "lastPrice")).toBe("Current price");
      expect(resolveApprovalFigureLabel("market_asset", "equity", "yieldPct")).toBe("Dividend yield");
    });

    it("REIT: distributionYield/nav resolve to their real contract labels", () => {
      expect(resolveApprovalFigureLabel("market_asset", "reit", "distributionYield")).toBe("Distribution yield");
      expect(resolveApprovalFigureLabel("market_asset", "reit", "nav")).toBe("Net asset value / NAV");
    });

    it("Offshore fund: trailingReturnPct/expenseRatioPct/fxRiskNote resolve to their real contract labels", () => {
      expect(resolveApprovalFigureLabel("market_asset", "offshore_fund", "trailingReturnPct")).toBe(
        "Annualized return / performance",
      );
      expect(resolveApprovalFigureLabel("market_asset", "offshore_fund", "expenseRatioPct")).toBe("Fees");
      expect(resolveApprovalFigureLabel("market_asset", "offshore_fund", "fxRiskNote")).toBe("FX risk note");
    });
  });

  it("6. an unknown field (not in any contract) falls back to the caller-supplied fallback label", () => {
    expect(resolveApprovalFigureLabel("mmf", undefined, "someLegacyKey", "Some Legacy Key")).toBe("Some Legacy Key");
  });

  it("6b. an unknown field with NO fallback supplied falls back to the raw key itself — never disappears", () => {
    expect(resolveApprovalFigureLabel("mmf", undefined, "someLegacyKey")).toBe("someLegacyKey");
  });

  it("6c. when no catalogue is known at all (null), every key falls back safely — never throws", () => {
    expect(resolveApprovalFigureLabel(null, undefined, "whtRule", "WHT (fallback)")).toBe("WHT (fallback)");
    expect(resolveApprovalFigureLabel(null, undefined, "whtRule")).toBe("whtRule");
  });

  it("alias-tolerant: a raw AI-extraction-schema field name (an alias, not the canonical key) still resolves correctly — needed for PendingDiffTable's changedFields", () => {
    // whtRule's aliases include 'withholdingTaxRate' (the CBK bond extraction
    // schema's own field name for this concept).
    expect(resolveApprovalFigureLabel("cbk", undefined, "withholdingTaxRate")).toBe("Tax treatment");
    // dividendRate's aliases include 'shareCapitalDividendRate'.
    expect(resolveApprovalFigureLabel("market_asset", "sacco", "shareCapitalDividendRate")).toBe(
      "Dividend rate / interest rate",
    );
  });
});

describe("Stage 9b · A — resolveContractCatalogueForUpdate (pure, no DB)", () => {
  it("resolves MMF/Bank/CBK directly from assetClass", () => {
    expect(resolveContractCatalogueForUpdate({ assetClass: "cash_mmf" })).toEqual({ catalogue: "mmf" });
    expect(resolveContractCatalogueForUpdate({ assetClass: "bank_deposit" })).toEqual({ catalogue: "bank" });
    expect(resolveContractCatalogueForUpdate({ assetClass: "gov_discount" })).toEqual({ catalogue: "cbk" });
    expect(resolveContractCatalogueForUpdate({ assetClass: "gov_coupon" })).toEqual({ catalogue: "cbk" });
  });

  it("resolves Equity/REIT/Offshore fund directly from assetClass", () => {
    expect(resolveContractCatalogueForUpdate({ assetClass: "equity" })).toEqual({
      catalogue: "market_asset",
      subtype: "equity",
    });
    expect(resolveContractCatalogueForUpdate({ assetClass: "reit" })).toEqual({
      catalogue: "market_asset",
      subtype: "reit",
    });
    expect(resolveContractCatalogueForUpdate({ assetClass: "offshore_fund" })).toEqual({
      catalogue: "market_asset",
      subtype: "offshore_fund",
    });
  });

  it("resolves SACCO via detectMarketAssetSacco (assetClass 'alt' + figures.assetType) — the SAME detection reviewResearchUpdate uses", () => {
    expect(
      resolveContractCatalogueForUpdate({ assetClass: "alt", figures: { assetType: "sacco" } }),
    ).toEqual({ catalogue: "market_asset", subtype: "sacco" });
  });

  it("a plain 'alt' row with no SACCO signal resolves to market_asset with NO subtype", () => {
    expect(resolveContractCatalogueForUpdate({ assetClass: "alt", figures: {} })).toEqual({
      catalogue: "market_asset",
      subtype: undefined,
    });
  });
});

describe("Stage 9b · gate/promotion untouched (pure — checkApprovalGate/buildPromotionPlan are unmodified)", () => {
  it("checkApprovalGate's CBK result is unchanged by this slice", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      figures: {
        securityType: "treasury_bill",
        tenor: "91-day",
        yieldPct: "8.8",
        whtRule: "15%",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        // T-bill subtype detection (via name/securityType) also requires
        // these two, per CBK_SUBTYPE_FIELD_RULES.tbill.
        auctionDate: "2026-07-15",
        valueDate: "2026-07-17",
      },
      name: "91-Day Treasury Bill",
      source: "CBK auction results",
      asOf: Date.UTC(2026, 6, 1),
    });
    expect(gate.ok).toBe(true);
  });

  it("buildPromotionPlan's typed payload is unaffected by the new display helpers", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: "Test Fund",
      assetClass: "cash_mmf",
      figures: { ear: "16.5", grossYield: "17.0", managementFee: "2.0", minInvestment: "1000" },
      source: "Test",
    });
    expect(plan.target).toBe("mmf");
    if (plan.target === "mmf") expect(plan.payload.ear).toBeCloseTo(16.5, 5);
  });
});

// ── B. ResearchDesk.tsx wiring — static source scan ────────────────────────

const researchDesk = read("client/src/pages/ResearchDesk.tsx");

describe("Stage 9b · B — ResearchDesk.tsx wiring", () => {
  it("imports the three new Slice 9b display helpers", () => {
    expect(researchDesk).toContain("resolveContractCatalogueForUpdate");
    expect(researchDesk).toContain("resolveApprovalFigureLabel");
    expect(researchDesk).toContain("isInternalRoutingFigureKey");
    expect(researchDesk).toContain('from "@shared/catalogueFieldContracts"');
  });

  it("5. fmtFigures resolves the contract-aware label and filters internal routing keys, keeping the existing LABELS map as a fallback", () => {
    const fnIdx = researchDesk.indexOf("function fmtFigures(");
    const mapIdx = researchDesk.indexOf(".map(([k, v]) => ({", fnIdx);
    expect(mapIdx).toBeGreaterThan(fnIdx);
    const block = researchDesk.slice(fnIdx, mapIdx + 400);
    expect(block).toContain("resolveApprovalFigureLabel(contract?.catalogue, contract?.subtype, k, LABELS[k])");
    expect(block).toContain("isInternalRoutingFigureKey(contract?.catalogue, contract?.subtype, k)");
    // The pre-existing fallback map is still there, not deleted.
    expect(block).toContain('ear: "EAR %"');
  });

  it("5b. PendingDiffTable resolves the contract-aware label for each changed field and hides internal routing keys from the diff too", () => {
    const fnIdx = researchDesk.indexOf("function PendingDiffTable(");
    const mapIdx = researchDesk.indexOf("visibleChangedFields.map((field) => {", fnIdx);
    expect(mapIdx).toBeGreaterThan(fnIdx);
    const block = researchDesk.slice(fnIdx, mapIdx + 600);
    expect(block).toContain("isInternalRoutingFigureKey(contract?.catalogue, contract?.subtype, field)");
    expect(block).toContain(
      "resolveApprovalFigureLabel(contract?.catalogue, contract?.subtype, field, field)",
    );
  });

  it("PendingQueue resolves the contract once per update and passes it to both fmtFigures and PendingDiffTable", () => {
    expect(researchDesk).toContain(
      "const contract = resolveContractCatalogueForUpdate({",
    );
    expect(researchDesk).toContain("fmtFigures(u.figures as Record<string, unknown> | null, contract)");
    expect(researchDesk).toContain(
      '<PendingDiffTable figures={u.figures as Record<string, unknown> | null} contract={contract} />',
    );
  });

  it("the pre-existing underscore-prefix filter is unchanged (Round 98's own guardrail)", () => {
    expect(researchDesk).toContain('!k.startsWith("_")');
  });

  it("PendingDiffTable and PendingQueue's structural markers (component names, Field/Current/Proposed headers) are unchanged, matching Round 98's existing test expectations", () => {
    expect(researchDesk).toContain("function PendingDiffTable");
    expect(researchDesk).toContain("<PendingDiffTable");
    expect(researchDesk).toContain("Field");
    expect(researchDesk).toContain("Current");
    expect(researchDesk).toContain("Proposed");
  });
});
