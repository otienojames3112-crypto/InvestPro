import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_APPROVED_CATALOGUE_FIELD_GUIDE,
  BANK_CATALOGUE_FIELD_GUIDE,
  CBK_CATALOGUE_FIELD_GUIDE,
  HOW_TO_READ_CATALOGUE_LABEL,
  MARKET_ASSETS_CATALOGUE_FIELD_GUIDE,
  MMF_CATALOGUE_FIELD_GUIDE,
} from "../client/src/lib/catalogueReadGuides";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const frontend = {
  allApproved: read("client/src/pages/AllApprovedInstruments.tsx"),
  mmf: read("client/src/pages/MmfFunds.tsx"),
  bank: read("client/src/pages/BankInstruments.tsx"),
  cbk: read("client/src/pages/CbkSecuritiesReference.tsx"),
  market: read("client/src/pages/MarketAssetsReference.tsx"),
  guides: read("client/src/lib/catalogueReadGuides.ts"),
};

const explainService = read("server/aiExplainService.ts");
const routers = read("server/routers.ts");
const sourceReview = read("client/src/components/CatalogueSourceReview.tsx");
const allApprovedMaintenance = frontend.allApproved.slice(
  frontend.allApproved.indexOf("function ReferenceDataMaintenance()"),
  frontend.allApproved.indexOf("\nfunction MaintenanceAction(", frontend.allApproved.indexOf("function ReferenceDataMaintenance()")),
);

describe("Stage 10b-5g - How to read this catalogue", () => {
  it("renames the visible catalogue explanation action everywhere it exists", () => {
    expect(HOW_TO_READ_CATALOGUE_LABEL).toBe("How to read this catalogue");
    for (const src of Object.values(frontend)) {
      expect(src).not.toContain("Explain catalogue");
    }
    for (const page of [frontend.allApproved, frontend.mmf, frontend.bank, frontend.cbk, frontend.market]) {
      expect(page).toContain("HOW_TO_READ_CATALOGUE_LABEL");
      expect(page).toContain("AiExplainDialog");
      expect(page).toContain("trpc.aiExplain.referenceCatalogue.useQuery");
    }
  });

  it("keeps the action secondary to source review and manual manager actions", () => {
    for (const page of [frontend.mmf, frontend.bank, frontend.cbk, frontend.market]) {
      expect(page.indexOf("<CatalogueSourceReviewButton")).toBeGreaterThan(-1);
      expect(page.indexOf("{HOW_TO_READ_CATALOGUE_LABEL}")).toBeGreaterThan(page.indexOf("<CatalogueSourceReviewButton"));
    }
    expect(frontend.mmf.indexOf("{HOW_TO_READ_CATALOGUE_LABEL}")).toBeGreaterThan(frontend.mmf.indexOf("Add / correct fund"));
    expect(frontend.bank.indexOf("{HOW_TO_READ_CATALOGUE_LABEL}")).toBeGreaterThan(frontend.bank.indexOf("Add / correct product"));
  });

  it("passes category-specific read guides into the existing read-only AI explanation query", () => {
    for (const [page, guideName] of [
      [frontend.allApproved, "ALL_APPROVED_CATALOGUE_FIELD_GUIDE"],
      [frontend.mmf, "MMF_CATALOGUE_FIELD_GUIDE"],
      [frontend.bank, "BANK_CATALOGUE_FIELD_GUIDE"],
      [frontend.cbk, "CBK_CATALOGUE_FIELD_GUIDE"],
      [frontend.market, "MARKET_ASSETS_CATALOGUE_FIELD_GUIDE"],
    ] as const) {
      expect(page).toContain("catalogueReadGuide(");
      expect(page).toContain(guideName);
      expect(page).toContain("catalogueSummary: catFacts");
    }
  });

  it("covers the MMF field concepts and reference-only boundary", () => {
    for (const term of ["Fund name", "EAR", "Daily yield", "Gross yield", "net yield", "WHT", "management fee", "Minimum investment", "Withdrawal period", "AUM", "Source", "as-of date", "Holdings"]) {
      expect(MMF_CATALOGUE_FIELD_GUIDE).toContain(term);
    }
  });

  it("covers the bank-product field concepts and reference-only boundary", () => {
    for (const term of ["Bank", "product name", "Product type", "Indicative rate", "Tenor", "notice period", "Minimum deposit", "WHT", "fees", "charges", "early withdrawal rule", "access speed", "Holdings"]) {
      expect(BANK_CATALOGUE_FIELD_GUIDE).toContain(term);
    }
  });

  it("covers the CBK field concepts and reference-only boundary", () => {
    for (const term of ["Security type", "Tenor", "auction date", "value date", "maturity date", "issue number", "Yield", "Coupon", "Tax treatment", "WHT", "Minimum investment", "Holdings -> Government"]) {
      expect(CBK_CATALOGUE_FIELD_GUIDE).toContain(term);
    }
  });

  it("covers Market Asset subtype field concepts", () => {
    for (const term of ["Equity", "price", "ticker", "dividend yield", "recent dividend", "sector", "liquidity", "REIT", "unit price", "distribution yield", "NAV", "occupancy", "Offshore fund", "currency", "trailing return", "fees", "withdrawal period", "FX risk", "SACCO", "share capital", "monthly contribution", "membership", "risk or protection"]) {
      expect(MARKET_ASSETS_CATALOGUE_FIELD_GUIDE).toContain(term);
    }
  });

  it("covers the All Approved master-index concepts", () => {
    for (const term of ["master index", "Catalogue family", "Subtype", "Headline fact", "Source", "as-of date", "Status", "freshness", "Open record", "full field set", "does not rank"]) {
      expect(ALL_APPROVED_CATALOGUE_FIELD_GUIDE).toContain(term);
    }
  });

  it("strengthens the AI prompt as a catalogue-reading guide, not a selection prompt", () => {
    expect(explainService).toContain("Role: Catalogue reading guide");
    expect(explainService).toContain("Use the category-specific field guide in the facts");
    expect(explainService).toContain("compare incompatible catalogue families");
    expect(explainService).toContain("mention retired scoring surfaces");
    expect(explainService).not.toContain("Plan Fit");
    expect(routers).toContain("How to read this catalogue");
    expect(routers).toContain("How to read the reference catalogue entries");
  });

  it("does not reintroduce Plan Fit or positive advice wording into the read guides", () => {
    const guides = [
      MMF_CATALOGUE_FIELD_GUIDE,
      BANK_CATALOGUE_FIELD_GUIDE,
      CBK_CATALOGUE_FIELD_GUIDE,
      MARKET_ASSETS_CATALOGUE_FIELD_GUIDE,
      ALL_APPROVED_CATALOGUE_FIELD_GUIDE,
      frontend.guides,
    ].join("\n");
    expect(guides).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
    expect(guides).not.toMatch(/\bbest\b|\brecommended\b|\bprofit\b|choose this/i);
  });

  it("keeps Review source with AI unchanged", () => {
    expect(sourceReview).toContain("export function CatalogueSourceReviewButton");
    expect(sourceReview).toContain("COPY[catalogue].button");
    expect(sourceReview).toContain("Nothing here changes a catalogue");
    expect(sourceReview).toContain("FindingCard");
  });

  it("keeps reset disabled and non-clickable", () => {
    expect(allApprovedMaintenance).toContain("Reset catalogues to seed");
    expect(allApprovedMaintenance).toContain("Unavailable");
    expect(allApprovedMaintenance).toContain("Disabled until safe sandbox reset is implemented.");
    expect(allApprovedMaintenance).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(allApprovedMaintenance).not.toContain("resetToSeed.mutate");
  });
});
