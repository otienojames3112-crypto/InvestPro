/**
 * Market Assets empty-state — Equity/REIT tabs explain why "Add to holdings"
 * isn't visible when the catalogue has no approved rows of that subtype yet.
 *
 * Add to holdings is a row-level action tied to an approved Equity/REIT
 * reference row (Stage Holdings Sync 1). With zero approved rows there is no
 * row for the action to render on, so this locks in the empty-state copy that
 * explains that instead of leaving the tab looking silently broken — while
 * confirming no global "Add to holdings" button was introduced, the existing
 * row-level confirm-first behavior for populated tabs is unchanged, and none
 * of the retired surfaces (Plan Fit, Explain catalogue, Review a source with
 * AI, reset) return.
 *
 * Note: this test originally asserted Offshore fund also stayed on the older
 * Track holding fallback — that changed under Stage Holdings Sync 2, which
 * gave Offshore fund the same confirm-first Add to holdings flow (see
 * server/marketAssetOffshoreHoldingsSync2.test.ts). Only SACCO remains on
 * the fallback here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const marketPage = read("client/src/pages/MarketAssetsReference.tsx");
const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start);
  expect(end, `end marker not found after start: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("Market Assets empty-state — Add to holdings row-level explanation", () => {
  it("1. explains that Add to holdings appears only after an approved Equity row exists", () => {
    expect(marketPage).toContain(
      "No approved Equity records yet. Add to holdings appears after an approved Equity reference row exists. To propose new Equity facts, use Research Desk → Ask AI.",
    );
  });

  it("2. explains that Add to holdings appears only after an approved REIT row exists", () => {
    expect(marketPage).toContain(
      "No approved REIT records yet. Add to holdings appears after an approved REIT reference row exists. To propose new REIT facts, use Research Desk → Ask AI.",
    );
  });

  it("3. no global Add to holdings action appears when Market Assets has zero rows", () => {
    // The page header / search-and-scope toolbar (rendered regardless of row
    // count) must not carry an "Add to holdings" action of its own.
    const headerAndToolbar = sliceBetween(marketPage, "{/* Header */}", "{/* Archived rows");
    expect(headerAndToolbar).not.toContain("Add to holdings");
    // The empty-state branch renders only explanatory text, never the action button.
    const emptyBranch = sliceBetween(marketPage, "if (rows.length === 0) {", "overflow-x-auto");
    expect(emptyBranch).not.toContain("PlusCircle");
    expect(emptyBranch).not.toContain("<Button");
  });

  it("4. Equity rows still show Add to holdings when approved rows exist", () => {
    const equityRowBranch = sliceBetween(marketPage, 'if (subtype === "equity") {', 'if (subtype === "reit") {');
    expect(equityRowBranch).toContain("Add to holdings");
    expect(equityRowBranch).toContain("onClick={onTrack}");
  });

  it("5. REIT rows still show Add to holdings when approved rows exist", () => {
    const reitRowBranch = sliceBetween(marketPage, 'if (subtype === "reit") {', 'if (subtype === "offshore_fund") {');
    expect(reitRowBranch).toContain("Add to holdings");
    expect(reitRowBranch).toContain("onClick={onTrack}");
  });

  it("6. SACCO is not upgraded — its simple empty copy and Track holding action are unchanged", () => {
    expect(marketPage).toContain("No approved SACCO records yet.");
    // Its simple empty copy must not mention Add to holdings.
    expect(marketPage).not.toContain("No approved SACCO records yet. Add to holdings");
    // SACCO's row-level action stays "Track holding", not "Add to holdings".
    const saccoRowBranch = marketPage.slice(marketPage.indexOf("// sacco"));
    expect(saccoRowBranch).toContain('actionLabel="Track holding"');
    expect(saccoRowBranch).not.toContain("Add to holdings");
  });

  it("6b. Offshore fund's empty-state copy from this slice is still present (its row-level action was upgraded separately under Stage Holdings Sync 2)", () => {
    expect(marketPage).toContain("No approved Offshore fund records yet.");
    expect(marketPage).not.toContain("No approved Offshore fund records yet. Add to holdings");
  });

  it("7. no holding is created without confirmation", () => {
    expect(marketPage).toContain("const handleConfirm = () => {");
    expect(marketPage).toContain("commit.mutate({");
    expect(marketPage).toContain("onClick={handleConfirm}");
    // The row-level onTrack never calls the mutation directly — it only opens
    // the confirm-first dialog (equity/reit) or navigates to the deep-link
    // form (offshore/sacco); nothing commits on a bare row click.
    expect(marketPage).not.toMatch(/onTrack=\{[^}]*commit\.mutate/);
    expect(marketPage).toContain("onOpenHoldingsDialog(subtype, r, contract);");
  });

  it("8. Plan Fit does not return", () => {
    expect(marketPage).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
  });

  it("9. Explain catalogue does not return", () => {
    expect(marketPage).not.toContain("Explain catalogue");
    expect(marketPage).toContain("HOW_TO_READ_CATALOGUE_LABEL");
  });

  it("10. Review a source with AI does not return to catalogue headers", () => {
    expect(marketPage).not.toContain("Review a source with AI");
    expect(marketPage).not.toContain("CatalogueSourceReviewButton");
  });

  it("11. reset remains disabled/non-clickable", () => {
    const maintenance = sliceBetween(allApproved, "function ReferenceDataMaintenance()", "\nfunction MaintenanceAction(");
    expect(maintenance).toContain("Disabled until safe sandbox reset is implemented.");
    expect(maintenance).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(maintenance).not.toContain("resetToSeed.mutate");
  });
});
