import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");
const researchArea = read("client/src/pages/ResearchArea.tsx");
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");

function maintenancePanel(): string {
  const start = allApproved.indexOf("function ReferenceDataMaintenance()");
  const end = allApproved.indexOf("\nfunction MaintenanceAction(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return allApproved.slice(start, end);
}

describe("Stage 10b-5e · Research and Reference Catalogue shell", () => {
  it("keeps Research Desk and Reference Catalogues wired with calm governance copy", () => {
    expect(researchArea).toContain('id: "research-desk"');
    expect(researchArea).toContain('id: "reference-catalogues"');
    expect(researchArea).toContain(
      "Research approved market reference data and manage proposed catalogue updates.",
    );
    expect(researchArea).toContain("AI findings remain drafts until approved.");
    expect(researchArea).toContain(
      "Approved reference data does not change holdings or portfolio calculations by itself.",
    );
  });

  it("keeps all five Reference Catalogue tabs in the approved order", () => {
    const tabArray = catalogueTabs.slice(catalogueTabs.indexOf("export const CATALOGUE_TABS"));
    const ids = [...tabArray.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual([
      "all-approved",
      "mmf-market",
      "bank-catalogue",
      "cbk-securities",
      "market-assets",
    ]);
  });
});

describe("Stage 10b-5e · All Approved master index", () => {
  it("describes the index by family, headline fact, source, as-of date, and status", () => {
    expect(allApproved).toContain("Master index of every approved catalogue row");
    expect(allApproved).toContain("Catalogue family");
    expect(allApproved).toContain("Headline fact");
    expect(allApproved).toContain("Source / as-of");
    expect(allApproved).toContain("Open record");
  });

  it("removes incompatible cross-family min/max filtering", () => {
    expect(allApproved).not.toContain("Min headline figure");
    expect(allApproved).not.toContain("Max headline figure");
    expect(allApproved).not.toContain("minFigure");
    expect(allApproved).not.toContain("maxFigure");
  });

  it("keeps the useful compact filters and manager archive toggle", () => {
    for (const copy of [
      "Search",
      "Catalogue",
      "Currency",
      "Include archived rows",
      "Reset filters",
    ]) {
      expect(allApproved).toContain(copy);
    }
  });

  it("uses one concise governance note without an Information only control", () => {
    expect(allApproved).toContain('role="note"');
    expect(allApproved).toContain("AI findings remain drafts until approved.");
    expect(allApproved).toContain("holdings are");
    expect(allApproved).not.toContain("Information only");
    expect(allApproved).not.toContain("For information only");
  });

  it("shows a professional empty state", () => {
    expect(allApproved).toContain("No approved instruments yet.");
    expect(allApproved).toContain(
      "Approved catalogue rows will appear here after findings are reviewed and approved.",
    );
  });

  it("does not restore visible Plan Fit code", () => {
    expect(`${allApproved}\n${researchArea}\n${catalogueTabs}`).not.toMatch(
      /Plan Fit|planFit|showPlanFit|PlanFit/,
    );
  });
});

describe("Stage 10b-5e · maintenance remains safely lower priority", () => {
  const maintenance = maintenancePanel();

  it("keeps reset unavailable and non-clickable", () => {
    expect(maintenance).toContain("Reset catalogues to seed");
    expect(maintenance).toContain("Unavailable");
    expect(maintenance).toContain("Disabled until safe sandbox reset is implemented.");
    expect(maintenance).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(maintenance).not.toContain("resetToSeed.mutate");
  });

  it("keeps the three existing manager maintenance actions", () => {
    for (const label of [
      "Archive all reference rows",
      "Clear pending queue",
      "Clear approval log",
    ]) {
      expect(maintenance).toContain(label);
    }
  });
});
