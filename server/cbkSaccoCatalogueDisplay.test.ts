/**
 * Stage 9c — CBK detail drawer + SACCO-specific Reference Catalogue table.
 * Closes two of Stage 9a's audit findings: CBK's extendedFields-tier figures
 * (tax treatment, tax-exempt flag, issue number, coupon rate, auction/value
 * dates — the ones Slice 8g-2 made persist) had nowhere to be seen cleanly
 * after approval; SACCO rows were forced into the generic Market Assets
 * price/yield/trailing-return/fee columns, meaningless for a SACCO's
 * dividend-rate/share-capital model.
 *
 * Display-only: no approval-gate, promotion, extraction, or DB-schema change.
 * `CbkSecuritiesReference.tsx`'s existing table/GovRow and
 * `MarketAssetsReference.tsx`'s existing MarketRow are both proven unchanged
 * below, not just assumed.
 *
 * Two layers of test (established convention — no jsdom in this repo):
 *   A. `readContractFieldValue` (client/src/lib/format.ts) — pure, imported
 *      and called directly for real behavioural proof.
 *   B. `CbkSecuritiesReference.tsx`/`MarketAssetsReference.tsx` wiring —
 *      static source-text scan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readContractFieldValue } from "@/lib/format";
import { getCatalogueFieldContract } from "../shared/catalogueFieldContracts";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── A. readContractFieldValue (pure, no DB) ────────────────────────────────

describe("Stage 9c · A — readContractFieldValue (pure, no DB)", () => {
  it("reads via the canonical key first", () => {
    expect(readContractFieldValue({ whtRule: "15% withholding tax" }, { key: "whtRule", aliases: ["withholdingTaxRate"] })).toBe(
      "15% withholding tax",
    );
  });

  it("falls back to an alias when the canonical key is absent", () => {
    expect(
      readContractFieldValue({ withholdingTaxRate: "15%" }, { key: "whtRule", aliases: ["withholdingTaxRate", "whtRate"] }),
    ).toBe("15%");
  });

  it("treats the missing_from_source sentinel as absent", () => {
    expect(readContractFieldValue({ whtRule: "missing_from_source" }, { key: "whtRule", aliases: [] })).toBeNull();
  });

  it("returns null for null/undefined extendedFields — never throws", () => {
    expect(readContractFieldValue(null, { key: "whtRule", aliases: [] })).toBeNull();
    expect(readContractFieldValue(undefined, { key: "whtRule", aliases: [] })).toBeNull();
  });

  it("returns null when neither the key nor any alias is present — never fabricates a value", () => {
    expect(readContractFieldValue({ someOtherKey: "x" }, { key: "whtRule", aliases: ["withholdingTaxRate"] })).toBeNull();
  });
});

// ── B. CbkSecuritiesReference.tsx wiring — static source scan ─────────────

const cbkPage = read("client/src/pages/CbkSecuritiesReference.tsx");

describe("Stage 9c · B — CbkSecuritiesReference.tsx: detail drawer", () => {
  it("1. the existing baseline table columns are unchanged (Security, Type, Yield/coupon, Tenor, Maturity, Source & freshness, Action)", () => {
    expect(cbkPage).toContain('<TableHead><SortHead k="name">Security</SortHead></TableHead>');
    expect(cbkPage).toContain("Type");
    expect(cbkPage).toContain('<SortHead k="yieldPct" numeric>Yield / coupon</SortHead>');
    expect(cbkPage).toContain('<SortHead k="tenorYears" numeric>Tenor</SortHead>');
    expect(cbkPage).toContain('<SortHead k="maturityDate" numeric>Maturity</SortHead>');
    expect(cbkPage).toContain("Source &amp; freshness");
    expect(cbkPage).toContain("Action");
  });

  it("2. a CBK row can open a detail drawer — GovRow gets an onViewDetails callback that opens a Sheet", () => {
    expect(cbkPage).toContain("onViewDetails: () => void;");
    expect(cbkPage).toContain("onViewDetails={() => setDrawerRow(r)}");
    expect(cbkPage).toContain("<CbkDetailDrawer row={drawerRow}");
    expect(cbkPage).toContain('<Sheet open={row !== null} onOpenChange={onOpenChange}>');
  });

  it("3. the drawer shows clean contract labels for whtRule/taxExempt/auctionDate/valueDate/issueNumber/couponRate/minInvestment — never their raw camelCase key", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx);
    for (const key of ["whtRule", "taxExempt", "auctionDate", "valueDate", "issueNumber", "couponRate", "minInvestment"]) {
      expect(block).toContain(`fieldByKey("${key}")`);
    }
    // Confirm these actually resolve to the REAL contract labels (not a guess).
    const contract = getCatalogueFieldContract("cbk");
    const labelFor = (key: string) => contract?.fields.find((f) => f.key === key)?.label;
    expect(labelFor("whtRule")).toBe("Tax treatment");
    expect(labelFor("taxExempt")).toBe("Tax-exempt flag");
    expect(labelFor("auctionDate")).toBe("Auction date");
    expect(labelFor("valueDate")).toBe("Value / settlement date");
    expect(labelFor("issueNumber")).toBe("Issue number");
    expect(labelFor("couponRate")).toBe("Coupon rate");
    expect(labelFor("minInvestment")).toBe("Minimum investment");
  });

  it("4. the drawer reads extendedFields-tier values via readContractFieldValue, not a raw Object.entries dump", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx, idx + 2500);
    expect(block).toContain("readContractFieldValue(extendedFields, fieldByKey(");
    // No raw dump of extendedFields anywhere in the drawer.
    expect(block).not.toContain("Object.entries(row.extendedFields");
    expect(block).not.toContain("Object.entries(extendedFields");
  });

  it("5. the drawer shows source label/link/as-of via the established resolveCatalogueSource helper (8h), not a new ad hoc mechanism", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx);
    expect(block).toContain("resolveCatalogueSource(row.dataSource, row.extendedFields, row.dataAsOf");
    expect(block).toContain("catSource.url");
    expect(block).toContain("catSource.label");
  });

  it("6. the drawer never renders a raw camelCase field name as literal JSX text (no {\"whtRule\"} or {\"taxExempt\"} interpolations, no raw extendedFields[key] dumps)", () => {
    const idx = cbkPage.indexOf("function CbkDetailDrawer(");
    const block = cbkPage.slice(idx, cbkPage.indexOf("\n}\n", idx) + 3);
    expect(block).not.toMatch(/\{k\}/); // no raw-key interpolation pattern
    expect(block).not.toContain("extendedFields[k]");
  });

  it("imports the Slice 9c helpers and Sheet UI", () => {
    expect(cbkPage).toContain('from "@shared/catalogueFieldContracts"');
    expect(cbkPage).toContain("readContractFieldValue");
    expect(cbkPage).toContain('from "@/components/ui/sheet"');
  });
});

// ── B. MarketAssetsReference.tsx wiring — static source scan ──────────────

const marketAssetsPage = read("client/src/pages/MarketAssetsReference.tsx");

describe("Stage 9c · B — MarketAssetsReference.tsx: SACCO-specific table", () => {
  it("7. SACCO rows are detected via detectMarketAssetSacco (the SAME safe detection the gate/promotion layers use), scoped to assetClass 'alt'", () => {
    expect(marketAssetsPage).toContain('import { detectMarketAssetSacco } from "@shared/researchPipeline";');
    const idx = marketAssetsPage.indexOf("function isSaccoRow(");
    const block = marketAssetsPage.slice(idx, idx + 500);
    expect(block).toContain('if (r.assetClass !== "alt") return false;');
    expect(block).toContain("detectMarketAssetSacco({");
  });

  it("8. SACCO rows are split OUT of the generic table — nonSaccoFiltered explicitly excludes them, MarketRow (with its price/yield/trailing-return/fee cells) is never rendered for a SACCO row", () => {
    expect(marketAssetsPage).toContain("const saccoFiltered = useMemo(() => filtered.filter(isSaccoRow), [filtered]);");
    expect(marketAssetsPage).toContain(
      "const nonSaccoFiltered = useMemo(() => filtered.filter((r) => !isSaccoRow(r)), [filtered]);",
    );
    expect(marketAssetsPage).toContain("{nonSaccoFiltered.map((r) => (");
    expect(marketAssetsPage).not.toContain("{filtered.map((r) => (\n                            <MarketRow");
  });

  it("9. SaccoRow shows dividendRate/minimumShareCapital/minimumMonthlyDeposit/withdrawalTerms/regulatoryStatus, read via readContractFieldValue against the SACCO contract", () => {
    const idx = marketAssetsPage.indexOf("function SaccoRow(");
    const block = marketAssetsPage.slice(idx, marketAssetsPage.length);
    for (const key of ["dividendRate", "minimumShareCapital", "minimumMonthlyDeposit", "withdrawalTerms", "regulatoryStatus"]) {
      expect(block).toContain(`readField("${key}")`);
    }
    expect(block).toContain("r.liquidity");
    // Confirm these resolve to the REAL contract labels used as column headers.
    const contract = getCatalogueFieldContract("market_asset", "sacco");
    const labelFor = (key: string) => contract?.fields.find((f) => f.key === key)?.label;
    expect(labelFor("dividendRate")).toBe("Dividend rate / interest rate");
    expect(labelFor("minimumShareCapital")).toBe("Minimum share capital");
    expect(labelFor("minimumMonthlyDeposit")).toBe("Minimum contribution");
    expect(labelFor("withdrawalTerms")).toBe("Lock-in or withdrawal rule");
    expect(labelFor("regulatoryStatus")).toBe("Risk / protection note");
  });

  it("SaccoTable's column headers use the REAL contract labels via fieldByKey, not hand-typed strings", () => {
    const idx = marketAssetsPage.indexOf("function SaccoTable(");
    const block = marketAssetsPage.slice(idx, marketAssetsPage.indexOf("function SaccoRow("));
    expect(block).toContain('fieldByKey("dividendRate")?.label');
    expect(block).toContain('fieldByKey("minimumShareCapital")?.label');
    expect(block).toContain('fieldByKey("minimumMonthlyDeposit")?.label');
    expect(block).toContain('fieldByKey("withdrawalTerms")?.label');
    expect(block).toContain('fieldByKey("regulatoryStatus")?.label');
  });

  it("10. SACCO source label/link/as-of use the SAME resolveCatalogueSource helper as the generic table (8h)", () => {
    const idx = marketAssetsPage.indexOf("function SaccoRow(");
    const block = marketAssetsPage.slice(idx);
    expect(block).toContain("resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf");
    expect(block).toContain("catSource.label");
    expect(block).toContain("catSource.url");
  });

  it("11. SACCO's assetType is never rendered as a user-facing field anywhere in SaccoTable/SaccoRow", () => {
    const idx = marketAssetsPage.indexOf("function SaccoTable(");
    const block = marketAssetsPage.slice(idx);
    expect(block).not.toMatch(/assetType/);
  });

  it("12. Equity/REIT/offshore-fund table (MarketRow, the header block) is unchanged — same columns, same sort keys, same component", () => {
    expect(marketAssetsPage).toContain('<TableHead><SortHead k="name">Instrument</SortHead></TableHead>');
    expect(marketAssetsPage).toContain('<SortHead k="lastPrice" numeric>Price</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="yieldPct" numeric>Yield</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="trailingReturnPct" numeric>Trailing 1Y</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="expenseRatioPct" numeric>Fee</SortHead>');
    expect(marketAssetsPage).toContain("function MarketRow({");
    // MarketRow's own body (unchanged from 8h-2) still reads fmtPrice/fmtPct on
    // the SAME typed columns — proving the component itself wasn't touched.
    const idx = marketAssetsPage.indexOf("function MarketRow(");
    const block = marketAssetsPage.slice(idx, marketAssetsPage.indexOf("function SaccoTable("));
    expect(block).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(block).toContain("fmtPct(r.yieldPct)");
    expect(block).toContain("fmtPct(r.expenseRatioPct)");
  });

  it("imports the Slice 9c helpers", () => {
    expect(marketAssetsPage).toContain('from "@shared/catalogueFieldContracts"');
    expect(marketAssetsPage).toContain("readContractFieldValue");
  });
});

// ── 13. MMF and Bank pages never import CBK/SACCO-SPECIFIC components ──────

describe("Stage 9c · MMF/Bank untouched", () => {
  // Stage 10b-1 note: `readContractFieldValue` was originally grouped into
  // this exclusion list only because neither MMF nor Bank needed it YET at
  // Slice 9c — it's a generic, catalogue-agnostic helper (client/src/lib/
  // format.ts), not a CBK/SACCO-specific one, unlike the other three
  // (isSaccoRow, CbkDetailDrawer, SaccoTable, which genuinely ARE CBK/SACCO-
  // only components/functions). Bank now legitimately uses it (Stage 10b-1,
  // same as CBK/SACCO already did) for Product name/Early withdrawal rule —
  // see server/bankFieldParity.test.ts. The real invariant this test
  // protects — MMF/Bank never importing a CBK/SACCO-SPECIFIC identifier —
  // still holds and is still checked below.
  it("13. MmfFunds.tsx and BankInstruments.tsx do not import any CBK/SACCO-SPECIFIC component (isSaccoRow, CbkDetailDrawer, SaccoTable)", () => {
    const mmf = read("client/src/pages/MmfFunds.tsx");
    const bank = read("client/src/pages/BankInstruments.tsx");
    for (const src of [mmf, bank]) {
      expect(src).not.toContain("isSaccoRow");
      expect(src).not.toContain("CbkDetailDrawer");
      expect(src).not.toContain("SaccoTable");
    }
  });

  it("MmfFunds.tsx still does not use readContractFieldValue (it reads extendedFields directly) — Bank's new Stage 10b-1 usage is the only change", () => {
    const mmf = read("client/src/pages/MmfFunds.tsx");
    expect(mmf).not.toContain("readContractFieldValue");
  });
});
