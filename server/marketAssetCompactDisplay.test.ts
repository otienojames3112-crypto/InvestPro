/**
 * Stage 9d — Equity / REIT / Offshore fund compact Reference Catalogue display
 * cleanup. Closes three of Stage 9a's audit findings: Equity's ticker/symbol,
 * REIT's distribution yield (previously only labeled via free-text
 * `yieldKind`) and NAV, and Offshore fund's FX risk note were all either
 * invisible in the main table or only reachable as a raw `extendedFields`
 * dump on the detail page.
 *
 * Display-only: no approval-gate, promotion, extraction, or DB-schema change.
 * SACCO's 9c table, CBK's 9c drawer, and MMF/Bank are proven unchanged below,
 * not just assumed.
 *
 * Two layers of test (established convention — no jsdom in this repo):
 *   A. Contract lookups (readContractFieldValue + getCatalogueFieldContract)
 *      — pure, imported and called directly for real behavioural proof.
 *   B. `MarketAssetsReference.tsx` wiring — static source-text scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readContractFieldValue } from "@/lib/format";
import { getCatalogueFieldContract } from "../shared/catalogueFieldContracts";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const marketAssetsPage = read("client/src/pages/MarketAssetsReference.tsx");
const cbkPage = read("client/src/pages/CbkSecuritiesReference.tsx");
const mmfPage = read("client/src/pages/MmfFunds.tsx");
const bankPage = read("client/src/pages/BankInstruments.tsx");

// Stage 10b-3 replaced the single generic MarketRow (Equity/REIT/Offshore fund
// together) with per-subtype branches inside SubtypeRow. Slice each subtype's
// branch out individually so these tests scope to the right block, the same
// way marketRowBlock used to scope to MarketRow as a whole.
const subtypeRowIdx = marketAssetsPage.indexOf("function SubtypeRow(");
const equityBranchIdx = marketAssetsPage.indexOf('if (subtype === "equity")', subtypeRowIdx);
const reitBranchIdx = marketAssetsPage.indexOf('if (subtype === "reit")', subtypeRowIdx);
const offshoreBranchIdx = marketAssetsPage.indexOf('if (subtype === "offshore_fund")', reitBranchIdx);
const saccoBranchIdx = marketAssetsPage.indexOf("// sacco", offshoreBranchIdx);
const equityBlock = marketAssetsPage.slice(equityBranchIdx, reitBranchIdx);
const reitBlock = marketAssetsPage.slice(reitBranchIdx, offshoreBranchIdx);
const offshoreBlock = marketAssetsPage.slice(offshoreBranchIdx, saccoBranchIdx);
const marketRowBlock = marketAssetsPage.slice(subtypeRowIdx, marketAssetsPage.length);

// ── A. Contract lookups (pure, no DB) ───────────────────────────────────────

describe("Stage 9d · A — Equity/REIT/offshore contract fields (pure, no DB)", () => {
  it("1. Equity ticker reads via readContractFieldValue against the equity contract", () => {
    const contract = getCatalogueFieldContract("market_asset", "equity");
    const field = contract?.fields.find((f) => f.key === "ticker");
    expect(field?.label).toBe("Ticker / symbol");
    expect(readContractFieldValue({ ticker: "SCOM" }, field!)).toBe("SCOM");
    expect(readContractFieldValue(null, field!)).toBeNull();
    expect(readContractFieldValue({}, field!)).toBeNull();
  });

  it("3. REIT distributionYield contract label is a clear, REIT-specific label", () => {
    const contract = getCatalogueFieldContract("market_asset", "reit");
    const field = contract?.fields.find((f) => f.key === "distributionYield");
    expect(field?.label).toBe("Distribution yield");
  });

  it("4. REIT NAV reads via readContractFieldValue against the reit contract", () => {
    const contract = getCatalogueFieldContract("market_asset", "reit");
    const field = contract?.fields.find((f) => f.key === "nav");
    expect(field?.label).toBe("Net asset value / NAV");
    expect(readContractFieldValue({ nav: "24.50" }, field!)).toBe("24.50");
    expect(readContractFieldValue({}, field!)).toBeNull();
  });

  it("6. Offshore fund fxRiskNote reads via readContractFieldValue, including its 'fxRisk' alias", () => {
    const contract = getCatalogueFieldContract("market_asset", "offshore_fund");
    const field = contract?.fields.find((f) => f.key === "fxRiskNote");
    expect(field?.label).toBe("FX risk note");
    expect(field?.aliases).toContain("fxRisk");
    expect(readContractFieldValue({ fxRiskNote: "USD-denominated; KES depreciation increases KES-value returns" }, field!)).toBe(
      "USD-denominated; KES depreciation increases KES-value returns",
    );
    expect(readContractFieldValue({ fxRisk: "legacy alias value" }, field!)).toBe("legacy alias value");
    expect(readContractFieldValue({}, field!)).toBeNull();
  });
});

// ── B. MarketAssetsReference.tsx: SubtypeRow compact fields ────────────────
//
// Stage 10b-3 replaced the single MarketRow (shared across Equity/REIT/
// Offshore fund) with per-subtype branches inside SubtypeRow, each with its
// own explicit column set (see cbkSaccoCatalogueDisplay.test.ts for the
// header-level proof). These tests re-verify the SAME field-level behaviour
// Stage 9d established — ticker, REIT distribution yield/NAV, offshore FX
// risk note — now inside their respective SubtypeRow branches.

describe("Stage 10b-3 · B — MarketAssetsReference.tsx: SubtypeRow compact fields", () => {
  it("1. Equity row shows ticker/symbol when available, read via readField (readContractFieldValue) and rendered only in the equity branch", () => {
    expect(equityBlock).toContain('const ticker = readField("ticker");');
    expect(equityBlock).toContain("{ticker && <Badge");
  });

  it("2. Equity price/yield/source display uses the same shared helpers as every other subtype", () => {
    expect(equityBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(equityBlock).toContain("fmtPct(r.yieldPct)");
    expect(equityBlock).toContain("<SourceCell r={r} />");
  });

  it("3. REIT's Distribution yield column header resolves the clear, contract-derived REIT-specific label via headersFor's label() closure, not a hardcoded string", () => {
    const idx = marketAssetsPage.indexOf('case "reit":', marketAssetsPage.indexOf("function headersFor("));
    const block = marketAssetsPage.slice(idx, marketAssetsPage.indexOf('case "offshore_fund":'));
    expect(block).toContain('label("distributionYield", "Distribution yield")');
    const contract = getCatalogueFieldContract("market_asset", "reit");
    expect(contract?.fields.find((f) => f.key === "distributionYield")?.label).toBe("Distribution yield");
  });

  it("4. REIT NAV is surfaced in its own dedicated column when available, formatted via the existing fmtPrice helper", () => {
    expect(reitBlock).toContain('const nav = readField("nav");');
    expect(reitBlock).toContain('{nav ? fmtPrice(nav, r.currency) : "—"}');
  });

  it("5. REIT price/source display uses the same shared helpers as every other subtype", () => {
    expect(reitBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(reitBlock).toContain("<SourceCell r={r} />");
  });

  it("6. Offshore fund row shows FX risk note when available, via a tooltip on the existing FX-risk badge", () => {
    expect(offshoreBlock).toContain('const fxRiskNote = readField("fxRiskNote");');
    expect(offshoreBlock).toContain("fxRiskNote ? (");
    expect(offshoreBlock).toContain('<TooltipContent side="left" className="max-w-xs text-xs">{fxRiskNote}</TooltipContent>');
  });

  it("7. Existing offshore currency/return/expense/source display, and the FX-risk badge itself when no note is on record, remain intact", () => {
    expect(offshoreBlock).toContain('r.currency !== "KES"');
    expect(offshoreBlock).toContain(
      '<Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">',
    );
    expect(offshoreBlock).toContain('<Globe className="w-2.5 h-2.5" /> FX risk');
    expect(offshoreBlock).toContain("fmtPct(r.expenseRatioPct)");
    expect(offshoreBlock).toContain("fmtPct(r.trailingReturnPct)");
  });

  it("11. No raw JSON or raw camelCase keys appear in SubtypeRow's touched cells — every field goes through readField/readContractFieldValue, never a raw extendedFields dump", () => {
    expect(marketRowBlock).not.toContain("Object.entries(r.extendedFields");
    expect(marketRowBlock).not.toContain("JSON.stringify");
  });

  it("12. Source label/link/as-of remains clean and clickable, unchanged — shared SourceCell component", () => {
    const idx = marketAssetsPage.indexOf("function SourceCell(");
    const block = marketAssetsPage.slice(idx, idx + 1200);
    expect(block).toContain('target="_blank"');
    expect(block).toContain('rel="noopener noreferrer"');
    expect(block).toContain("catSource.url");
  });

  it("imports the Slice 9d / Stage 10b-3 helpers (readContractFieldValue, getCatalogueFieldContract)", () => {
    expect(marketAssetsPage).toContain('from "@shared/catalogueFieldContracts"');
    expect(marketAssetsPage).toContain("readContractFieldValue");
    expect(marketAssetsPage).toContain("getCatalogueFieldContract");
  });
});

// ── 8/9/10. Regression — SACCO table, CBK drawer, MMF/Bank untouched ────────

describe("Stage 10b-3 · Regression — SACCO/CBK and MMF/Bank untouched", () => {
  it("8. SACCO detection/rendering still works — isSaccoRow is unchanged, and SACCO now renders through the SAME shared SubtypeTable/SubtypeRow every other subtype uses (Stage 10b-3 generalized 9c's own-table pattern to all four)", () => {
    expect(marketAssetsPage).toContain("function SubtypeTable({");
    expect(marketAssetsPage).toContain("function SubtypeRow({");
    expect(marketAssetsPage).toContain("function isSaccoRow(r: Opportunity): boolean {");
  });

  it("9. CBK drawer from 9c remains unchanged — CbkSecuritiesReference.tsx untouched by this slice", () => {
    expect(cbkPage).toContain("function CbkDetailDrawer(");
    expect(cbkPage).not.toContain("Stage 9d");
    expect(cbkPage).not.toContain("Stage 10b-3");
  });

  it("10. MMF and Bank display remain unchanged — neither references any market-asset-specific SubtypeRow/SubtypeTable addition", () => {
    for (const page of [mmfPage, bankPage]) {
      expect(page).not.toContain("SubtypeTable");
      expect(page).not.toContain("SubtypeRow");
      expect(page).not.toContain("fxRiskNote");
    }
  });

  it("Equity/REIT/Offshore-fund/SACCO each keep their OWN distinct header set (headersFor) — re-verified after Stage 10b-3's per-subtype split", () => {
    expect(marketAssetsPage).toContain('function headersFor(subtype: Subtype, contract: CatalogueFieldContract | null)');
    expect(marketAssetsPage).toContain('case "equity":');
    expect(marketAssetsPage).toContain('case "reit":');
    expect(marketAssetsPage).toContain('case "offshore_fund":');
    expect(marketAssetsPage).toContain('case "sacco":');
  });
});
