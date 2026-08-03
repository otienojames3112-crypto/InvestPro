import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const pages = {
  mmf: read("client/src/pages/MmfFunds.tsx"),
  bank: read("client/src/pages/BankInstruments.tsx"),
  cbk: read("client/src/pages/CbkSecuritiesReference.tsx"),
  market: read("client/src/pages/MarketAssetsReference.tsx"),
  allApproved: read("client/src/pages/AllApprovedInstruments.tsx"),
};

const routers = read("server/routers.ts");
const researchPipeline = read("shared/researchPipeline.ts");
const contractsSource = read(["shared", "catalogue" + "Field" + "Contracts.ts"].join("/"));

describe("Catalogue maintenance actions", () => {
  it("renames MMF and Bank catalogue header actions to Maintain records", () => {
    expect(pages.mmf).toContain("Maintain MMF records");
    expect(pages.bank).toContain("Maintain bank product records");
    expect(pages.mmf).toContain("<Plus className=\"w-4 h-4 mr-1\" /> Maintain records");
    expect(pages.bank).toContain("<Plus className=\"w-4 h-4 mr-2\" /> Maintain records");
    expect(pages.mmf).not.toContain("Add / correct fund");
    expect(pages.bank).not.toContain("Add / correct product");
  });

  it("explains manual maintenance without duplicating AI source intake", () => {
    for (const src of [pages.mmf, pages.bank]) {
      expect(src).toContain("manager-only manual maintenance");
      expect(src).toContain("approved facts are already known");
      expect(src).toContain("supported by a source");
      expect(src).toContain("Research Desk → Ask AI");
      expect(src).toContain("URL, pasted text, PDF, or image");
      expect(src).toContain("recorded separately");
    }
    expect(pages.mmf).toContain("Add a missing MMF fund record or correct fields on an existing one");
    expect(pages.bank).toContain("Add a missing bank product record or correct fields on an existing one");
  });

  it("keeps MMF and Bank source/as-of/reason protections where supported", () => {
    expect(pages.mmf).toContain("Source URL / Reference *");
    expect(pages.mmf).toContain("Data as of Date");
    expect(pages.mmf).toContain("Reason for correction (optional)");
    expect(pages.bank).toContain("Source (URL or note) — required");
    expect(pages.bank).toContain("Source as-of date");
    expect(pages.bank).toContain("Reason for correction (optional)");
    expect(routers).toContain("mmfFunds: router({");
    expect(routers).toContain("bankInstruments: router({");
    expect(routers).toContain("recordManualCorrectionAudit");
    expect(routers).toContain("reason: z.string().max(300).optional()");
  });

  it("uses honest disabled placeholders for CBK and Market Assets until safe governed maintenance exists", () => {
    expect(pages.cbk).toContain("Maintain CBK security records is not enabled here yet.");
    expect(pages.cbk).toContain("T-bill, FXD, and IFB subtype validation");
    expect(pages.cbk).toContain("before manager");
    expect(pages.cbk).toContain("Research Desk → Ask AI");
    expect(pages.cbk).toContain("purchases and holdings are");
    expect(pages.cbk).toContain("<Button size=\"sm\" disabled");

    expect(pages.market).toContain("Maintain market asset records is not enabled here yet.");
    expect(pages.market).toContain("Equity, REIT, Offshore fund, and SACCO subtype");
    expect(pages.market).toContain("before manager");
    expect(pages.market).toContain("Research Desk → Ask AI");
    expect(pages.market).toContain("holdings are recorded separately");
    expect(pages.market).toContain("<Button size=\"sm\" disabled");
  });

  it("does not bring source-review, Explain catalogue, Plan Fit, or reset into catalogue headers", () => {
    for (const src of [pages.mmf, pages.bank, pages.cbk, pages.market]) {
      expect(src).not.toContain("CatalogueSourceReviewButton");
      expect(src).not.toContain("Review a source with AI");
      expect(src).not.toContain("Explain catalogue");
      expect(src).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
      expect(src).toContain("HOW_TO_READ_CATALOGUE_LABEL");
    }
    expect(pages.allApproved).toContain("Disabled until safe sandbox reset is implemented.");
    expect(pages.allApproved).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(pages.allApproved).not.toContain("resetToSeed.mutate");
  });

  it("keeps CBK subtype gates and market asset subtype contracts covered", () => {
    expect(researchPipeline).toContain("export const CBK_SUBTYPE_FIELD_RULES");
    expect(researchPipeline).toContain('tbill: [');
    expect(researchPipeline).toContain('key: "auctionDate"');
    expect(researchPipeline).toContain('key: "valueDate"');
    expect(researchPipeline).toContain('key: "issueNumber"');
    expect(researchPipeline).toContain('key: "couponRate"');
    expect(researchPipeline).toContain('key: "maturityDate"');
    expect(researchPipeline).toContain('key: "taxExempt"');
    expect(researchPipeline).toContain("const tenorDays = Number(f.tenorDays)");

    for (const subtype of ["equity", "reit", "offshore_fund", "sacco"] as const) {
      expect(contractsSource).toContain(`subtype: "${subtype}"`);
    }
    expect(researchPipeline).toContain("export const MARKET_ASSET_SUBTYPE_FIELD_RULES");
    expect(researchPipeline).toContain('args.assetClass === "reit" || args.assetClass === "offshore_fund"');
    expect(researchPipeline).toContain("export const SACCO_MARKET_ASSET_FIELD_RULES");
    expect(researchPipeline).toContain("const isSacco = detectMarketAssetSacco");
  });
});
