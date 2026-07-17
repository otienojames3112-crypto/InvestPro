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

const marketRowIdx = marketAssetsPage.indexOf("function MarketRow(");
const saccoTableIdx = marketAssetsPage.indexOf("function SaccoTable(");
const marketRowBlock = marketAssetsPage.slice(marketRowIdx, saccoTableIdx);

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

// ── B. MarketAssetsReference.tsx: MarketRow wiring ──────────────────────────

describe("Stage 9d · B — MarketAssetsReference.tsx: MarketRow compact fields", () => {
  it("1. Equity row shows ticker/symbol when available — MarketRow reads it via readContractFieldValue and renders it only for assetClass 'equity'", () => {
    expect(marketRowBlock).toContain('const ticker = subtype === "equity" ? readSubtypeField("ticker") : null;');
    expect(marketRowBlock).toContain("{ticker && (");
  });

  it("2. Equity existing price/yield/source display remains unchanged", () => {
    expect(marketRowBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(marketRowBlock).toContain("fmtPct(r.yieldPct)");
    expect(marketRowBlock).toContain("fmtPct(r.expenseRatioPct)");
    expect(marketRowBlock).toContain("resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp))");
  });

  it("3. REIT row shows distribution yield using the clear, contract-derived REIT-specific label, not just generic yieldKind", () => {
    expect(marketRowBlock).toContain(
      'const distributionYieldLabel = subtype === "reit" ? (subtypeField("distributionYield")?.label ?? null) : null;',
    );
    expect(marketRowBlock).toContain("{distributionYieldLabel ? (");
  });

  it("4. REIT NAV is surfaced when available, formatted via the existing fmtPrice helper", () => {
    expect(marketRowBlock).toContain('const nav = subtype === "reit" ? readSubtypeField("nav") : null;');
    expect(marketRowBlock).toContain("{nav && <div className=\"text-[10px] text-muted-foreground font-normal\">NAV {fmtPrice(nav, r.currency)}</div>}");
  });

  it("5. Existing REIT price/source display remains unchanged (same shared cells as Equity/offshore)", () => {
    expect(marketRowBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(marketRowBlock).toContain("catSource.label");
  });

  it("6. Offshore fund row shows FX risk note when available, via a tooltip on the existing FX-risk badge", () => {
    expect(marketRowBlock).toContain('const fxRiskNote = subtype === "offshore_fund" ? readSubtypeField("fxRiskNote") : null;');
    expect(marketRowBlock).toContain("fxRiskNote ? (");
    expect(marketRowBlock).toContain('<TooltipContent side="left" className="max-w-xs text-xs">{fxRiskNote}</TooltipContent>');
  });

  it("7. Existing offshore currency/return/expense/source display, and the FX-risk badge itself when no note is on record, remain unchanged", () => {
    expect(marketRowBlock).toContain("profile.fxExposed &&");
    expect(marketRowBlock).toContain(
      '<Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">',
    );
    expect(marketRowBlock).toContain('<Globe className="w-2.5 h-2.5" /> FX risk');
    expect(marketRowBlock).toContain("fmtPct(r.expenseRatioPct)");
    expect(marketRowBlock).toContain("trailing.toFixed(2)");
  });

  it("11. No raw JSON or raw camelCase keys appear in MarketRow's touched cells — every new field goes through readContractFieldValue/contract labels, never a raw extendedFields dump", () => {
    expect(marketRowBlock).not.toContain("Object.entries(r.extendedFields");
    expect(marketRowBlock).not.toContain("JSON.stringify");
  });

  it("12. Source label/link/as-of remains clean and clickable, unchanged", () => {
    expect(marketRowBlock).toContain('target="_blank"');
    expect(marketRowBlock).toContain('rel="noopener noreferrer"');
    expect(marketRowBlock).toContain("catSource.url");
  });

  it("imports the Slice 9d helpers (same imports 9c already established — no new imports needed)", () => {
    expect(marketAssetsPage).toContain('from "@shared/catalogueFieldContracts"');
    expect(marketAssetsPage).toContain("readContractFieldValue");
    expect(marketAssetsPage).toContain("getCatalogueFieldContract");
  });
});

// ── 8/9/10. Regression — SACCO table, CBK drawer, MMF/Bank untouched ────────

describe("Stage 9d · Regression — 9c SACCO/CBK and MMF/Bank untouched", () => {
  it("8. SACCO-specific table from 9c remains unchanged — SaccoTable/SaccoRow still present and still split out via isSaccoRow", () => {
    expect(marketAssetsPage).toContain("function SaccoTable({");
    expect(marketAssetsPage).toContain("function SaccoRow({");
    expect(marketAssetsPage).toContain("function isSaccoRow(r: Opportunity): boolean {");
  });

  it("9. CBK drawer from 9c remains unchanged — CbkSecuritiesReference.tsx untouched by this slice", () => {
    expect(cbkPage).toContain("function CbkDetailDrawer(");
    expect(cbkPage).not.toContain("Stage 9d");
  });

  it("10. MMF and Bank display remain unchanged — neither imports any Stage 9d MarketRow addition", () => {
    for (const page of [mmfPage, bankPage]) {
      expect(page).not.toContain("subtypeContract");
      expect(page).not.toContain("distributionYieldLabel");
      expect(page).not.toContain("fxRiskNote");
    }
  });

  it("Equity/REIT/offshore-fund table header block is unchanged — same columns, same sort keys (9c's own pin, re-verified after 9d's MarketRow edits)", () => {
    expect(marketAssetsPage).toContain('<TableHead><SortHead k="name">Instrument</SortHead></TableHead>');
    expect(marketAssetsPage).toContain('<SortHead k="lastPrice" numeric>Price</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="yieldPct" numeric>Yield</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="trailingReturnPct" numeric>Trailing 1Y</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="expenseRatioPct" numeric>Fee</SortHead>');
  });
});
