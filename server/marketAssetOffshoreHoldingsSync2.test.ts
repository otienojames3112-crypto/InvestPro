/**
 * Stage Holdings Sync 2 — Offshore fund gets the same confirm-first,
 * row-level Add to holdings flow Equity/REIT already have (Stage Holdings
 * Sync 1). SACCO is explicitly NOT upgraded in this slice and keeps the
 * older Track holding deep-link.
 *
 * Contract locked in here:
 *   - Offshore fund rows show "Add to holdings" (not "Track holding") and it
 *     opens the SAME MarketAssetHoldingDialog used by Equity/REIT, reusing
 *     the snapshot-capable modeling.commit path — no schema/backend change.
 *   - The dialog separates approved reference facts (fund name, manager,
 *     currency, fund type, trailing return explicitly labeled as reference
 *     performance, minimum investment, fees/expense ratio, withdrawal
 *     period, FX risk note, risk note, source/as-of) from user-entered
 *     holding details (units, purchase price in fund currency, FX rate to
 *     KES, purchase date, notes).
 *   - Because offshore_fund is `priceDriven` AND `fxExposed` in
 *     shared/assetModel.ts, the existing assetGuardIssues already requires a
 *     positive units + unitPrice + non-KES currency + positive fxRateToKes
 *     for every priceDriven/fxExposed commit — the same guard Equity/REIT
 *     already satisfy. The KES amount is derived ONLY from units × price ×
 *     FX (shared/modeling.ts deriveAmountKes), never from trailing return,
 *     fees, yield, or NAV.
 *   - Nothing writes on row click; the mutation only fires from the
 *     dialog's own Confirm button.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const marketPage = read("client/src/pages/MarketAssetsReference.tsx");
const modeling = read("shared/modeling.ts");
const assetModel = read("shared/assetModel.ts");
const routers = read("server/routers.ts");

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const offshoreRowBranch = sliceBetween(marketPage, 'if (subtype === "offshore_fund") {', "// sacco");
const offshoreFactsBranch = sliceBetween(
  marketPage,
  '<ReferenceFact label="Fund name"',
  "Source and provenance",
);

describe("Stage Holdings Sync 2 — Offshore fund confirm-first Add to holdings", () => {
  it("1. Offshore fund rows show Add to holdings, not Track holding", () => {
    expect(offshoreRowBranch).toContain('actionLabel="Add to holdings"');
    expect(offshoreRowBranch).not.toContain('actionLabel="Track holding"');
  });

  it("2. Offshore Add to holdings opens the confirm-first dialog (same component as Equity/REIT)", () => {
    expect(marketPage).toContain('subtype === "equity" || subtype === "reit" || subtype === "offshore_fund"');
    expect(marketPage).toContain("onOpenHoldingsDialog(subtype, r, contract);");
    expect(marketPage).toContain('"Add offshore fund to holdings"');
  });

  it("3. no holding is created until the user confirms", () => {
    expect(marketPage).toContain("const handleConfirm = () => {");
    expect(marketPage).toContain("commit.mutate({");
    expect(marketPage).toContain("onClick={handleConfirm}");
    expect(marketPage).not.toMatch(/onTrack=\{[^}]*commit\.mutate/);
  });

  it("4. Offshore dialog separates approved reference facts from user holding details", () => {
    expect(offshoreFactsBranch).toContain('label="Fund name"');
    expect(offshoreFactsBranch).toContain('label="Manager / provider"');
    expect(offshoreFactsBranch).toContain('label="Currency"');
    expect(offshoreFactsBranch).toContain('label="Fund type"');
    expect(offshoreFactsBranch).toContain("Trailing return (reference performance, not owned value)");
    expect(offshoreFactsBranch).toContain('label="Minimum investment"');
    expect(offshoreFactsBranch).toContain('label="Fees / expense ratio"');
    expect(offshoreFactsBranch).toContain('label="Withdrawal period"');
    expect(offshoreFactsBranch).toContain('label="FX risk note"');
    expect(offshoreFactsBranch).toContain('label="Risk note"');
    expect(marketPage).toContain('<p className="text-sm font-medium">Your holding details</p>');
  });

  it("5. Offshore dialog shows source/as-of when available", () => {
    expect(offshoreFactsBranch).toContain('label="Source as-of date"');
    expect(marketPage).toContain('<p className="text-sm font-medium">Source and provenance</p>');
    expect(marketPage).toContain('<ReferenceFact label="Source" value={sourceMeta?.label ?? snapshotSource ?? "Not recorded"} />');
    expect(marketPage).toContain('<ReferenceFact label="As-of" value={formatAsOf(sourceMeta?.asOf ?? row.dataAsOf)} />');
  });

  it("6. Offshore user-owned fields include units, purchase price, FX rate to KES, and purchase date", () => {
    expect(marketPage).toContain("const [fxRateToKes, setFxRateToKes] = useState");
    expect(marketPage).toContain("const isOffshore = target?.subtype === \"offshore_fund\";");
    expect(marketPage).toContain("<Label>FX rate to KES</Label>");
    expect(marketPage).toContain('Enter a valid FX rate to KES.');
    expect(marketPage).toContain("<Label>Purchase date</Label>");
    expect(marketPage).toContain('{target?.subtype === "equity" ? "Shares held" : "Units held"}');
  });

  it("7. currentValue is never seeded from trailing return, fees, yield, NAV, or any percentage field", () => {
    // The commit payload only ever carries user-entered units/price/currency/FX —
    // never row.trailingReturnPct or row.expenseRatioPct.
    const handleConfirmBody = sliceBetween(marketPage, "const handleConfirm = () => {", "<Dialog open={open}");
    expect(handleConfirmBody).not.toContain("trailingReturnPct");
    expect(handleConfirmBody).not.toContain("expenseRatioPct");
    expect(handleConfirmBody).not.toContain("yieldPct");
    expect(handleConfirmBody).toContain("units: unitsNum");
    expect(handleConfirmBody).toContain("unitPrice: priceNum");
    expect(handleConfirmBody).toContain("fxRateToKes: fxRateNum ?? undefined");
    // deriveAmountKes (shared/modeling.ts) — the single place currentValue is
    // computed — only reads units/unitPrice/fxRateToKes/amountKes, never a
    // percentage/yield/return field.
    const deriveAmountKesBody = sliceBetween(modeling, "export function deriveAmountKes(", "export function deriveUnits(");
    expect(deriveAmountKesBody).not.toMatch(/trailingReturn|expenseRatio|yieldPct|incomeRatePct/);
  });

  it("8. reference identity, source, and as-of are preserved through the existing snapshot path (no backend change)", () => {
    expect(marketPage).toContain("opportunityId: row.id");
    expect(marketPage).toContain("dataSource: snapshotSource");
    expect(marketPage).toContain("dataAsOf: snapshotAsOf");
    expect(marketPage).toContain('catalogRef: row.ref');
    expect(routers).toContain('referenceCatalogueType: "market_asset"');
    expect(routers).toContain("opportunityId: z.number().int().positive().optional()");
  });

  it("9. Equity and REIT flows remain unchanged", () => {
    expect(marketPage).toContain('"Add equity to holdings"');
    expect(marketPage).toContain('"Add REIT to holdings"');
    const equityRowBranch = sliceBetween(marketPage, 'if (subtype === "equity") {', 'if (subtype === "reit") {');
    expect(equityRowBranch).toContain("Add to holdings");
    const reitRowBranch = sliceBetween(marketPage, 'if (subtype === "reit") {', 'if (subtype === "offshore_fund") {');
    expect(reitRowBranch).toContain("Add to holdings");
    // Equity's own reference-facts branch is untouched.
    expect(marketPage).toContain('<ReferenceFact label="Company" value={row.name} />');
    expect(marketPage).toContain('<ReferenceFact label="Ticker" value={readField("ticker") ?? "—"} />');
    expect(marketPage).toContain('<ReferenceFact label="REIT" value={row.name} />');
  });

  it("10. SACCO remains unchanged and is not implemented in this slice", () => {
    const saccoBranch = marketPage.slice(marketPage.indexOf("// sacco"));
    expect(saccoBranch).toContain('actionLabel="Track holding"');
    expect(saccoBranch).not.toContain("Add to holdings");
    expect(saccoBranch).not.toContain("onOpenHoldingsDialog");
  });

  it("11. Empty-state copy from 51302ce remains intact", () => {
    expect(marketPage).toContain(
      "No approved Equity records yet. Add to holdings appears after an approved Equity reference row exists. To propose new Equity facts, use Research Desk → Ask AI.",
    );
    expect(marketPage).toContain(
      "No approved REIT records yet. Add to holdings appears after an approved REIT reference row exists. To propose new REIT facts, use Research Desk → Ask AI.",
    );
    expect(marketPage).toContain("No approved Offshore fund records yet.");
    expect(marketPage).toContain("No approved SACCO records yet.");
  });

  it("12. Plan Fit does not return", () => {
    expect(marketPage).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
  });

  it("13. Explain catalogue does not return", () => {
    expect(marketPage).not.toContain("Explain catalogue");
    expect(marketPage).toContain("HOW_TO_READ_CATALOGUE_LABEL");
  });

  it("14. Review a source with AI does not return to catalogue headers", () => {
    expect(marketPage).not.toContain("Review a source with AI");
    expect(marketPage).not.toContain("CatalogueSourceReviewButton");
  });

  it("15. reset remains disabled/non-clickable", () => {
    const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");
    const maintenance = sliceBetween(allApproved, "function ReferenceDataMaintenance()", "\nfunction MaintenanceAction(");
    expect(maintenance).toContain("Disabled until safe sandbox reset is implemented.");
    expect(maintenance).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(maintenance).not.toContain("resetToSeed.mutate");
  });

  it("offshore_fund is priceDriven AND fxExposed, so the existing guard already requires units/price/currency/FX (no schema change needed)", () => {
    const offshoreProfile = sliceBetween(assetModel, "offshore_fund: {", "alt: {");
    expect(offshoreProfile).toContain("priceDriven: true");
    expect(offshoreProfile).toContain("fxExposed: true");
  });

  it("copy guardrails: no best/buy/sell/recommend/profit/choose-this/opportunity/Plan Fit wording added", () => {
    expect(offshoreFactsBranch.toLowerCase()).not.toMatch(/\bbest\b|\bbuy\b|\bsell\b|\brecommend/);
    expect(offshoreFactsBranch.toLowerCase()).not.toContain("profit");
    expect(offshoreFactsBranch.toLowerCase()).not.toContain("choose this");
  });
});
