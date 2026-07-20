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
  // Stage 10b-2 note: the table grew from 7 to 14 explicit columns (Security,
  // Security type, Yield/rate, Coupon rate, Net yield after WHT, Tax
  // treatment, Tax-exempt, Tenor, Auction date, Value date, Maturity,
  // Minimum investment, Source & freshness, Action) — the Security/Tenor/
  // Maturity/Source/Action columns are unchanged, "Type" became the real
  // "Security type" figure instead of the generic asset-class label. This
  // test now asserts the CURRENT structure so it stays a real regression
  // guard rather than a stale pin. See server/cbkLiveWorkflowParity.test.ts
  // for the full column-parity proof.
  it("1. the table shows the established CBK fields as explicit columns", () => {
    expect(cbkPage).toContain('<TableHead><SortHead k="name">Security</SortHead></TableHead>');
    expect(cbkPage).toContain("<TableHead>Security type</TableHead>");
    expect(cbkPage).toContain('<SortHead k="yieldPct" numeric>Yield / rate</SortHead>');
    expect(cbkPage).toContain("<TableHead>Auction date</TableHead>");
    expect(cbkPage).toContain("<TableHead>Value date</TableHead>");
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
//
// Stage 10b-3 replaced the single generic MarketRow table (Equity/REIT/
// Offshore fund together) plus the separate Stage-9c SaccoTable/SaccoRow with
// FOUR per-subtype tabs, each rendering its own explicit-column table built
// from SubtypeTable/headersFor/SubtypeRow — all four now share the SAME
// architecture SACCO pioneered in Stage 9c (own contract, own columns, no
// generic price/yield/trailing-return/fee shape forced onto instruments it
// doesn't fit). isSaccoRow/detectMarketAssetSacco detection is unchanged.

const marketAssetsPage = read("client/src/pages/MarketAssetsReference.tsx");

describe("Stage 10b-3 · B — MarketAssetsReference.tsx: per-subtype tabbed tables", () => {
  it("7. SACCO rows are still detected via detectMarketAssetSacco (the SAME safe detection the gate/promotion layers use), scoped to assetClass 'alt' — unchanged from Stage 9c", () => {
    expect(marketAssetsPage).toContain('import { detectMarketAssetSacco } from "@shared/researchPipeline";');
    const idx = marketAssetsPage.indexOf("function isSaccoRow(");
    const block = marketAssetsPage.slice(idx, idx + 500);
    expect(block).toContain('if (r.assetClass !== "alt") return false;');
    expect(block).toContain("detectMarketAssetSacco({");
  });

  it("8. every subtype (including SACCO) is split into its OWN bucket via bySubtype — a shared SubtypeTable component renders each tab from its own filtered rows, never one generic table for all four", () => {
    expect(marketAssetsPage).toContain("sacco: marketRows.filter((r) => isSaccoRow(r) && matches(r)),");
    expect(marketAssetsPage).toContain('equity: marketRows.filter((r) => r.assetClass === "equity" && matches(r)),');
    expect(marketAssetsPage).toContain('reit: marketRows.filter((r) => r.assetClass === "reit" && matches(r)),');
    expect(marketAssetsPage).toContain('offshore_fund: marketRows.filter((r) => r.assetClass === "offshore_fund" && matches(r)),');
    // Four distinct tabs, each rendering the shared SubtypeTable against its own bucket.
    expect(marketAssetsPage).toContain('<SubtypeTable subtype="equity" rows={bySubtype.equity}');
    expect(marketAssetsPage).toContain('<SubtypeTable subtype="reit" rows={bySubtype.reit}');
    expect(marketAssetsPage).toContain('<SubtypeTable subtype="offshore_fund" rows={bySubtype.offshore_fund}');
    expect(marketAssetsPage).toContain('<SubtypeTable subtype="sacco" rows={bySubtype.sacco}');
  });

  it("9. the SACCO branch of SubtypeRow shows dividendRate/minimumShareCapital/minimumMonthlyDeposit/withdrawalTerms/regulatoryStatus, read via readField (readContractFieldValue against the SACCO contract)", () => {
    const idx = marketAssetsPage.indexOf("// sacco");
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

  it("headersFor's SACCO case uses the REAL contract labels via the label() closure (contract?.fields.find), not hand-typed strings", () => {
    const idx = marketAssetsPage.indexOf('case "sacco":', marketAssetsPage.indexOf("function headersFor("));
    const block = marketAssetsPage.slice(idx, marketAssetsPage.indexOf("function SubtypeRow("));
    expect(block).toContain('label("dividendRate"');
    expect(block).toContain('label("minimumShareCapital"');
    expect(block).toContain('label("minimumMonthlyDeposit"');
    expect(block).toContain('label("withdrawalTerms"');
    expect(block).toContain('label("regulatoryStatus"');
  });

  it("10. SACCO (and every subtype) source label/link/as-of use the SAME shared SourceCell/resolveCatalogueSource helper (8h)", () => {
    const idx = marketAssetsPage.indexOf("function SourceCell(");
    const block = marketAssetsPage.slice(idx, idx + 1200);
    expect(block).toContain("resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf");
    expect(block).toContain("catSource.label");
    expect(block).toContain("catSource.url");
    // Every subtype's row renders <SourceCell r={r} /> — including SACCO.
    const saccoIdx = marketAssetsPage.indexOf("// sacco");
    expect(marketAssetsPage.slice(saccoIdx)).toContain("<SourceCell r={r} />");
  });

  it("11. SACCO's assetType is never rendered as a user-facing field anywhere in the SACCO branch of SubtypeRow/headersFor", () => {
    const idx = marketAssetsPage.indexOf("// sacco");
    const block = marketAssetsPage.slice(idx, marketAssetsPage.length);
    expect(block).not.toMatch(/assetType/);
  });

  it("12. Equity, REIT and Offshore fund each get their OWN explicit-column table now (Stage 10b-3) — no longer one generic MarketRow shape forced onto all three", () => {
    // headersFor has a distinct case per subtype with subtype-specific columns.
    expect(marketAssetsPage).toContain('case "equity":');
    expect(marketAssetsPage).toContain('case "reit":');
    expect(marketAssetsPage).toContain('case "offshore_fund":');
    expect(marketAssetsPage).toContain('case "sacco":');
    // Equity gets ticker/dividend/price-change/sector/min-buy columns REIT and
    // offshore fund don't have — proving genuinely distinct column sets, not
    // one shared shape.
    expect(marketAssetsPage).toContain('label("ticker", "Ticker")');
    expect(marketAssetsPage).toContain('label("recentDividend", "Recent dividend")');
    expect(marketAssetsPage).toContain('label("occupancyRate", "Occupancy")');
    expect(marketAssetsPage).toContain('label("expenseRatioPct", "Fees / expense ratio")');
    // SubtypeRow's equity/reit/offshore_fund branches still read the SAME
    // underlying typed columns (lastPrice/yieldPct/trailingReturnPct/
    // expenseRatioPct) via fmtPrice/fmtPct — proving the promotion-side data
    // model itself is untouched, only the display split changed.
    const equityIdx = marketAssetsPage.indexOf('if (subtype === "equity")');
    const reitIdx = marketAssetsPage.indexOf('if (subtype === "reit")');
    // Search AFTER reitIdx — priceFieldFor (earlier in the file) also contains
    // 'if (subtype === "offshore_fund")', which would otherwise match first.
    const offshoreIdx = marketAssetsPage.indexOf('if (subtype === "offshore_fund")', reitIdx);
    const equityBlock = marketAssetsPage.slice(equityIdx, reitIdx);
    const reitBlock = marketAssetsPage.slice(reitIdx, offshoreIdx);
    const offshoreBlock = marketAssetsPage.slice(offshoreIdx, marketAssetsPage.indexOf("// sacco"));
    expect(equityBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(equityBlock).toContain("fmtPct(r.yieldPct)");
    expect(reitBlock).toContain("fmtPrice(r.lastPrice, r.currency)");
    expect(reitBlock).toContain("fmtPct(r.yieldPct)");
    expect(offshoreBlock).toContain("fmtPct(r.trailingReturnPct)");
    expect(offshoreBlock).toContain("fmtPct(r.expenseRatioPct)");
  });

  it("imports the Slice 9c / Stage 10b-3 helpers (readContractFieldValue, getCatalogueFieldContract, Tabs)", () => {
    expect(marketAssetsPage).toContain('from "@shared/catalogueFieldContracts"');
    expect(marketAssetsPage).toContain("readContractFieldValue");
    expect(marketAssetsPage).toContain('from "@/components/ui/tabs"');
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
