/**
 * Stage 10a-3 — MMF Reference Catalogue column parity.
 *
 * Stage 10a-2 surfaced Net yield/WHT into the table but folded them into
 * grouped "Yield"/"Cost & tax" captions (plus Daily yield/Withdrawal
 * period/Risk profile stayed drawer-only). Live verification found the
 * established MMF fields still weren't actual visible catalogue columns —
 * the Reference Catalogue is the quick-decision surface, so a manager
 * shouldn't have to open the drawer (or squint at a caption) to see WHT or
 * Net yield. This slice replaces the grouped cells with one explicit column
 * per established field: EAR, Daily yield, Gross yield, Net yield, WHT,
 * Management fee, Minimum investment, Withdrawal period, AUM, Risk profile,
 * Source & freshness — Fund name/manager stay stacked in one "Fund" column
 * (explicitly permitted: "may be stacked... if necessary, but the manager
 * must still be visible") and Source/as-of stay combined in one "Source &
 * freshness" column (explicitly permitted: "can share a compact column only
 * if both are clearly visible"). The table now scrolls horizontally
 * (CardContent already had `overflow-x-auto`) rather than hiding any field.
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

describe("Stage 10a-3 · the established MMF fields are explicit table headers", () => {
  it("1. every established MMF field has its own <th> header in the table (not folded into a grouped caption)", () => {
    const headers = [
      "Fund <SortIcon",
      "EAR <SortIcon",
      "Daily yield<",
      "Gross yield <SortIcon",
      "Net yield<",
      "WHT<",
      "Management fee <SortIcon",
      "Minimum investment <SortIcon",
      "Withdrawal period<",
      "AUM <SortIcon",
      "Risk profile<",
      "Source &amp; freshness",
    ];
    for (const header of headers) {
      expect(tableBlock).toContain(header);
    }
  });

  it("no more grouped 'Yield (EAR/Gross/Net)' or 'Cost & tax (Fee/WHT)' captions remain", () => {
    expect(tableBlock).not.toContain("Yield (EAR/Gross/Net)");
    expect(tableBlock).not.toContain("Cost &amp; tax (Fee/WHT)");
  });

  it("the table scrolls horizontally rather than hiding a column", () => {
    expect(mmfFundsPage).toContain('<CardContent className="p-0 overflow-x-auto">');
  });
});

describe("Stage 10a-3 · each established field renders as its own cell", () => {
  it("2. EAR is its own cell, no longer prefixed inline with 'EAR ' inside a shared Yield cell", () => {
    expect(tableBlock).toContain("{fund.ear.toFixed(2)}%");
    expect(tableBlock).not.toContain("EAR {fund.ear.toFixed(2)}%");
  });

  it("3. Daily yield is its own cell, reading extendedFields.dailyYield, dash when absent", () => {
    expect(tableBlock).toContain('rowExtendedFields?.dailyYield ? String(rowExtendedFields.dailyYield) : null');
    expect(tableBlock).toContain('{dailyYield ?? "—"}');
  });

  it("4. Gross yield is its own cell, no longer inside the 'Gross X% · Net Y%' caption", () => {
    expect(tableBlock).toContain("{fund.grossYield.toFixed(2)}%</td>");
    expect(tableBlock).not.toContain("Gross {fund.grossYield.toFixed(2)}%");
  });

  it("5. Net yield is its own cell, computed the same way as the (unchanged) drawer", () => {
    expect(tableBlock).toContain("const netYield = fund.ear * (1 - whtRate / 100);");
    expect(tableBlock).toContain("{netYield.toFixed(2)}%</td>");
  });

  it("6. WHT is its own cell, no longer inside a 'Fee X% / WHT Y%' caption", () => {
    expect(tableBlock).toContain("{whtRate.toFixed(2)}%</td>");
    expect(tableBlock).not.toContain("WHT {whtRate.toFixed(2)}%");
  });

  it("7. Management fee is its own cell", () => {
    expect(tableBlock).toContain("{fund.managementFee.toFixed(2)}%</td>");
  });

  it("8. Minimum investment is its own cell, labeled with its currency", () => {
    expect(tableBlock).toContain('KES {fund.minInvestment.toLocaleString("en-KE")}');
  });

  it("9. Withdrawal period is its own cell, reading extendedFields.withdrawalNoticePeriod, dash when absent", () => {
    expect(tableBlock).toContain("rowExtendedFields?.withdrawalNoticePeriod");
    expect(tableBlock).toContain("String(rowExtendedFields.withdrawalNoticePeriod)");
    expect(tableBlock).toContain('{withdrawalPeriod ?? "—"}');
  });

  it("10. AUM is its own cell, labeled with currency/millions", () => {
    expect(tableBlock).toContain('`KES ${fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 })}M`');
  });

  it("11. Risk profile is its own cell, cleanly 'Not available' (never fabricated — no storage exists anywhere for it)", () => {
    expect(tableBlock).toContain('<td className="px-4 py-3 text-left text-muted-foreground">Not available</td>');
  });

  it("12. Source label/link renders cleanly via the established resolveCatalogueSource helper (8h)", () => {
    expect(tableBlock).toContain(
      "const catSource = resolveCatalogueSource(fund.source, fund.extendedFields, fund.asOfDate);",
    );
    expect(tableBlock).toContain("catSource.url ? (");
    expect(tableBlock).toContain("href={catSource.url}");
    expect(tableBlock).toContain("No source</span>");
  });

  it("13. Source-as-of renders as a readable date slice, never a raw epoch number", () => {
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

describe("Stage 10a-3 · sorting is preserved for every field that already had a stable sort key", () => {
  it("EAR/Gross yield/Management fee/Minimum investment/AUM keep their own sort buttons (Fund's own sort key is unchanged too)", () => {
    for (const key of ["fundName", "ear", "grossYield", "managementFee", "minInvestment", "aumMillions"]) {
      expect(tableBlock).toContain(`handleSort("${key}")`);
    }
  });
});
