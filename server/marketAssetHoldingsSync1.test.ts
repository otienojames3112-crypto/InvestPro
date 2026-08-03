import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const marketPage = read("client/src/pages/MarketAssetsReference.tsx");
const routers = read("server/routers.ts");
const modeling = read("shared/modeling.ts");
const otherAssets = read("client/src/pages/OtherAssets.tsx");
const maintenance = read("server/researchCatalogueMaintenanceActions.test.ts");
const planFit = read("server/round94PlanFitWording.test.ts");
const resetSafety = read("server/catalogueResetSafetyLock5c.test.ts");

describe("Stage Holdings Sync 1 · Market Assets Equity/REIT holdings flow", () => {
  it("shows Add to holdings for Equity and REIT and keeps Offshore/SACCO on Track holding for now", () => {
    expect(marketPage).toContain("Add equity to holdings");
    expect(marketPage).toContain("Add REIT to holdings");
    expect(marketPage).toContain("Add to holdings");
    expect(marketPage).toContain("Track holding");
    expect(marketPage).toContain("Equity, REIT and Offshore fund rows now use a confirm-first Add to holdings dialog.");
    expect(marketPage).toContain("SACCO rows keep the existing Track holding deep-link for now.");
  });

  it("uses a confirm-first dialog with approved facts separated from user-owned fields", () => {
    expect(marketPage).toContain("Approved reference facts");
    expect(marketPage).toContain("Your holding details");
    expect(marketPage).toContain("Holdings are recorded separately.");
    expect(marketPage).toContain("Nothing is saved until you confirm.");
    expect(marketPage).toContain("Later catalogue changes will not automatically");
    expect(marketPage).toContain("rewrite this holding.");
  });

  it("captures Equity user inputs manually instead of seeding a lossy currentValue", () => {
    expect(marketPage).toContain("Shares held");
    expect(marketPage).toContain("Purchase price per share");
    expect(marketPage).toContain("Purchase date");
    expect(marketPage).toContain("Broker, fees, account nickname, or other ownership notes");
    expect(marketPage).toContain("Current value is not seeded from yield, return, dividend, distribution, or NAV figures");
  });

  it("captures REIT user inputs manually instead of collapsing to generic real-estate wording", () => {
    expect(marketPage).toContain("Units held");
    expect(marketPage).toContain("Purchase price per unit");
    expect(marketPage).toContain("Add REIT to holdings");
    expect(marketPage).toContain("REIT type");
    expect(marketPage).toContain("Distribution yield");
  });

  it("writes through the existing snapshot-capable market-asset path without schema changes", () => {
    expect(routers).toContain('holdingSourceContext: z.string().max(120).nullable().optional()');
    expect(routers).toContain('userNotes: z.string().max(1000).nullable().optional()');
    expect(routers).toContain('referenceCatalogueType: "market_asset"');
    expect(routers).toContain("input.userNotes?.trim()");
    expect(marketPage).toContain('holdingSourceContext: "Market Assets Reference"');
    expect(modeling).toContain('holdingSourceContext?: string | null;');
    expect(modeling).toContain('"Modeled from Explore"');
    expect(modeling).toContain('Added from ${sourceContext}');
  });

  it("preserves catalogue identity and provenance instead of creating a holding on click", () => {
    expect(marketPage).toContain("This holding will preserve the reference row identity, source, and as-of date");
    expect(marketPage).toContain("snapshot terms at purchase.");
    expect(marketPage).toContain("opportunityId: row.id");
    expect(marketPage).toContain("dataSource: snapshotSource");
    expect(marketPage).toContain("dataAsOf: snapshotAsOf");
  });

  it("leaves the generic Other Assets deep-link flow in place only as the older fallback", () => {
    expect(otherAssets).toContain("?track=1&name=");
    expect(otherAssets).toContain("Nothing is written until the user confirms in the dialog");
  });

  it("does not reintroduce Review a source with AI, Explain catalogue, Plan Fit, or reset", () => {
    expect(marketPage).not.toContain("Review a source with AI");
    expect(marketPage).not.toContain("Explain catalogue");
    expect(marketPage).toContain("HOW_TO_READ_CATALOGUE_LABEL");
    expect(maintenance).toContain("does not bring source-review, Explain catalogue, Plan Fit, or reset into catalogue headers");
    expect(planFit).toContain("removes the retired Plan Fit surface");
    expect(resetSafety).toContain("backend catalogue reset safety lock");
  });
});
