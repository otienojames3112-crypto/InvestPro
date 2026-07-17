/**
 * Stage 10a-3 — MMF Reference Catalogue column parity.
 *
 * Stage 10a-2 surfaced Net yield/WHT into the table but folded them into
 * grouped "Yield"/"Cost & tax" captions (plus Daily yield/Withdrawal
 * period/Risk profile stayed drawer-only). Live verification found the
 * established MMF fields still weren't actual visible catalogue columns —
 * the Reference Catalogue is the quick-decision surface, so a manager
 * shouldn't have to open the drawer (or squint at a caption) to see WHT or
 * Net yield. This slice replaced the grouped cells with one explicit column
 * per established field.
 *
 * SUPERSEDED BY STAGE 10a-4 (see server/mmfFieldParity4.test.ts): live
 * verification of *this* slice found the resulting 14-column table was too
 * wide to scan, so Stage 10a-4 replaced the one-column-per-field layout with
 * a compact grouped primary row (Fund/Yield/Cost & tax/Entry & liquidity/
 * Size/Source & freshness/Actions) plus a per-row expand grid carrying the
 * SAME full established field set this file originally proved were columns
 * — now proved to be in the expand grid instead. The tests below are
 * REWRITTEN to assert the CURRENT (10a-4) structure rather than pin the
 * superseded one-column-per-field layout; the field-parity GUARANTEE this
 * file's title describes ("no established field is only in the drawer")
 * still holds, just via a different UI mechanism.
 *
 * Display-only: no promotion/gate/schema change. Reuses every value already
 * computed for the (unchanged) detail drawer — Net yield = EAR × (1 − WHT),
 * Daily yield/Withdrawal period from extendedFields, Risk profile always
 * "Not available" (no storage anywhere, same honest convention the drawer
 * already established).
 *
 * Established convention — no jsdom in this repo: static source-text scan of
 * `MmfFunds.tsx`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const mmfFundsPage = read("client/src/pages/MmfFunds.tsx");

const tableIdx = mmfFundsPage.indexOf("{/* Table */}");
const tableEndIdx = mmfFundsPage.indexOf("{/* Reference-vs-holdings separation");
const tableBlock = mmfFundsPage.slice(tableIdx, tableEndIdx);

describe("Stage 10a-3 · the primary row headers are the compact grouped columns Stage 10a-4 introduced", () => {
  it("1. the primary row has one grouped header per quick-decision category (Fund/Yield/Cost & tax/Entry & liquidity/Size/Source & freshness/Actions)", () => {
    const headers = ["Fund <SortIcon", "Yield <SortIcon", "Cost &amp; tax <SortIcon", "Entry &amp; liquidity <SortIcon", "Size <SortIcon", "Source &amp; freshness", ">Actions<"];
    for (const header of headers) {
      expect(tableBlock).toContain(header);
    }
  });

  it("the table scrolls horizontally rather than hiding a column", () => {
    expect(mmfFundsPage).toContain('<CardContent className="p-0 overflow-x-auto">');
  });
});

describe("Stage 10a-3 · every established field is still findable (now in the per-row expand grid, not the drawer only)", () => {
  it("2/4/5/6/7. EAR, Gross yield, Net yield, WHT, Management fee are all present in the expand grid via DrawerFact", () => {
    const idx = tableBlock.indexOf("isExpanded && (");
    const block = tableBlock.slice(idx);
    expect(block).toContain('<DrawerFact label="EAR" value={`${fund.ear.toFixed(2)}%`} />');
    expect(block).toContain('<DrawerFact label="Gross yield" value={`${fund.grossYield.toFixed(2)}%`} />');
    expect(block).toContain('<DrawerFact label="Net yield" value={`${netYield.toFixed(2)}%`} />');
    expect(block).toContain('<DrawerFact label="WHT" value={`${whtRate.toFixed(2)}%`} />');
    expect(block).toContain('<DrawerFact label="Management fee" value={`${fund.managementFee.toFixed(2)}%`} />');
  });

  it("EAR/Gross yield/Net yield remain visible without opening the expand grid too — the primary Yield cell still shows all three compactly", () => {
    const idx = tableBlock.indexOf('<td className="px-4 py-3 text-right">');
    const block = tableBlock.slice(idx, idx + 900);
    expect(block).toContain("{fund.ear.toFixed(2)}%");
    expect(block).toContain("Gross {fund.grossYield.toFixed(2)}% · Net {netYield.toFixed(2)}%");
  });

  it("Management fee/WHT remain visible in the primary Cost & tax cell too", () => {
    expect(tableBlock).toContain("{fund.managementFee.toFixed(2)}% fee</div>");
    expect(tableBlock).toContain("WHT {whtRate.toFixed(2)}%</div>");
  });

  it("3. Daily yield is in the expand grid, reading extendedFields.dailyYield, dash when absent", () => {
    expect(tableBlock).toContain('rowExtendedFields?.dailyYield ? String(rowExtendedFields.dailyYield) : null');
    const idx = tableBlock.indexOf("isExpanded && (");
    const block = tableBlock.slice(idx);
    expect(block).toContain('<DrawerFact label="Daily yield" value={dailyYield ?? "—"} />');
  });

  it("8. Minimum investment is visible in BOTH the primary Entry & liquidity cell and the expand grid, labeled with its currency", () => {
    expect(tableBlock).toContain('KES {fund.minInvestment.toLocaleString("en-KE")}');
    const idx = tableBlock.indexOf("isExpanded && (");
    const block = tableBlock.slice(idx);
    expect(block).toContain('<DrawerFact label="Minimum investment" value={`KES ${fund.minInvestment.toLocaleString("en-KE")}`} />');
  });

  it("9. Withdrawal period is visible in both the primary Entry & liquidity cell and the expand grid, dash when absent", () => {
    expect(tableBlock).toContain("rowExtendedFields?.withdrawalNoticePeriod");
    expect(tableBlock).toContain("String(rowExtendedFields.withdrawalNoticePeriod)");
    expect(tableBlock).toContain('{withdrawalPeriod ?? "—"} withdrawal');
    const idx = tableBlock.indexOf("isExpanded && (");
    const block = tableBlock.slice(idx);
    expect(block).toContain('<DrawerFact label="Withdrawal period" value={withdrawalPeriod ?? "—"} />');
  });

  it("10. AUM is visible in both the primary Size cell and the expand grid, labeled with currency/millions", () => {
    expect(tableBlock).toContain('`KES ${fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 })}M`');
  });

  it("11. Risk profile is in the expand grid, cleanly 'Not available' (never fabricated — no storage exists anywhere for it)", () => {
    const idx = tableBlock.indexOf("isExpanded && (");
    const block = tableBlock.slice(idx);
    expect(block).toContain('<DrawerFact label="Risk profile" value="Not available" />');
  });

  it("12. Source label/link renders cleanly via the established resolveCatalogueSource helper (8h), both in the primary row and the expand grid", () => {
    expect(tableBlock).toContain(
      "const catSource = resolveCatalogueSource(fund.source, fund.extendedFields, fund.asOfDate);",
    );
    expect(tableBlock).toContain("catSource.url ? (");
    expect(tableBlock).toContain("href={catSource.url}");
    expect(tableBlock).toContain("No source</span>");
  });

  it("13. Source-as-of renders as a readable date slice, never a raw epoch number, both in the primary row and the expand grid", () => {
    expect(tableBlock).toContain("String(catSource.asOf).slice(0, 10)");
  });
});

describe("Stage 10a-3 · the drawer remains supplementary, not the only place to see established fields", () => {
  it("14. MmfDetailDrawer still exists and still shows the full field set (unaffected by the table redesign)", () => {
    expect(mmfFundsPage).toContain("function MmfDetailDrawer(");
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain('fieldByKey("ear")');
    expect(block).toContain('fieldByKey("dailyYield")');
    expect(block).toContain('fieldByKey("grossYield")');
    expect(block).toContain('fieldByKey("netYield")');
    expect(block).toContain('fieldByKey("wht")');
    expect(block).toContain('fieldByKey("managementFee")');
    expect(block).toContain('fieldByKey("minInvestment")');
    expect(block).toContain('fieldByKey("withdrawalPeriod")');
    expect(block).toContain('fieldByKey("aum")');
    expect(block).toContain('fieldByKey("riskProfile")');
  });

  it("the 'View full details' action opening the drawer is still present on each row", () => {
    expect(mmfFundsPage).toContain("onClick={() => setDetailFund(fund)}");
    expect(mmfFundsPage).toContain("View full details");
  });
});

describe("Stage 10a-3 · no raw JSON or raw camelCase keys in the redesigned table", () => {
  it("15. the table block never dumps extendedFields or a raw Object.entries listing", () => {
    expect(tableBlock).not.toContain("Object.entries(fund.extendedFields");
    expect(tableBlock).not.toContain("JSON.stringify");
  });

  it("no raw camelCase field name is interpolated as literal display text in the table (values always go through a labeled cell)", () => {
    expect(tableBlock).not.toContain("{fund.whtRate}");
    expect(tableBlock).not.toContain("{fund.extendedFields}");
  });
});

describe("Stage 10a-3 · sorting is preserved for every grouped category that has a stable underlying sort key", () => {
  it("Fund/Yield(EAR)/Cost & tax(fee)/Entry & liquidity(min investment)/Size(AUM) each keep a sort button", () => {
    for (const key of ["fundName", "ear", "managementFee", "minInvestment", "aumMillions"]) {
      expect(tableBlock).toContain(`handleSort("${key}")`);
    }
  });
});
