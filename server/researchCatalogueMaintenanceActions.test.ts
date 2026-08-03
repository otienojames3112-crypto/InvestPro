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
  it("keeps MMF and Bank catalogue header actions named Maintain records", () => {
    expect(pages.mmf).toContain("Maintain MMF records");
    expect(pages.bank).toContain("Maintain bank product records");
    expect(pages.mmf).toContain("<Plus className=\"w-4 h-4 mr-1\" /> Maintain records");
    expect(pages.bank).toContain("<Plus className=\"w-4 h-4 mr-2\" /> Maintain records");
    expect(pages.mmf).not.toContain("Add / correct fund");
    expect(pages.bank).not.toContain("Add / correct product");
  });

  it("opens MMF and Bank maintenance to a choice screen before blank manual entry", () => {
    expect(pages.mmf).toContain("type MmfMaintenanceMode = \"add\" | \"correct\"");
    expect(pages.mmf).toContain("const [maintainOpen, setMaintainOpen] = useState(false)");
    expect(pages.mmf).toContain("setMaintainOpen(true)");
    expect(pages.mmf).toContain("Add a missing MMF record");
    expect(pages.mmf).toContain("Create a new approved MMF reference record from source-supported facts.");
    expect(pages.mmf).toContain("Correct an existing MMF record");
    expect(pages.mmf).toContain("Choose an existing fund, review the current values, and save a source-supported correction.");
    expect(pages.mmf).not.toContain("onClick={() => setAddOpen(true)} size=\"sm\"");

    expect(pages.bank).toContain("type BankMaintenanceMode = \"add\" | \"correct\"");
    expect(pages.bank).toContain("const [maintainOpen, setMaintainOpen] = useState(false)");
    expect(pages.bank).toContain("setMaintainOpen(true)");
    expect(pages.bank).toContain("Add a missing bank product record");
    expect(pages.bank).toContain("Create a new approved bank product reference record from source-supported facts.");
    expect(pages.bank).toContain("Correct an existing bank product record");
    expect(pages.bank).toContain("Choose an existing bank product, review the current values, and save a source-supported correction.");
    expect(pages.bank).not.toContain("<Button onClick={openAdd}>");
  });

  it("requires selecting an existing record before correction and then prefills approved values", () => {
    expect(pages.mmf).toContain("Select an existing MMF record");
    expect(pages.mmf).toContain("The correction form opens pre-filled from the approved row.");
    expect(pages.mmf).toContain("onCorrect(fund)");
    expect(pages.mmf).toContain("onCorrect={(fund) => setEditFund(fund)}");
    expect(pages.mmf).toContain("fundName: initial?.fundName ?? \"\"");
    expect(pages.mmf).toContain("company: initial?.company ?? \"\"");
    expect(pages.mmf).toContain("ear: String(initial?.ear ?? \"\")");
    expect(pages.mmf).toContain("Correcting existing MMF record:");

    expect(pages.bank).toContain("Select an existing bank product record");
    expect(pages.bank).toContain("The correction form opens pre-filled from the approved row.");
    expect(pages.bank).toContain("onCorrect(row)");
    expect(pages.bank).toContain("onCorrect={openEdit}");
    expect(pages.bank).toContain("bankName: r.bankName");
    expect(pages.bank).toContain("instrumentType: r.instrumentType");
    expect(pages.bank).toContain("indicativeRate: r.indicativeRate === null ? \"\" : String(r.indicativeRate)");
    expect(pages.bank).toContain("Correcting existing bank product record:");
  });

  it("shows clear empty correction states when there is nothing to correct", () => {
    expect(pages.mmf).toContain("No MMF records are available to correct yet.");
    expect(pages.mmf).toContain("Add a missing record first or use Research Desk");
    expect(pages.mmf).toContain("create draft findings");

    expect(pages.bank).toContain("No bank product records are available to correct yet.");
    expect(pages.bank).toContain("Add a missing record first or use Research Desk");
    expect(pages.bank).toContain("Ask AI to create draft findings");
  });

  it("explains manual maintenance without duplicating AI source intake", () => {
    for (const src of [pages.mmf, pages.bank]) {
      expect(src).toContain("manager-only manual maintenance");
      expect(src).toContain("approved facts are already known");
      expect(src).toContain("supported by a source");
      expect(src).toContain("Research Desk");
      expect(src).toContain("Ask AI");
      expect(src).toContain("URL, pasted text, PDF, or image");
      expect(src).toContain("recorded separately");
    }
  });

  it("keeps MMF and Bank source/as-of/reason protections", () => {
    expect(pages.mmf).toContain("Source URL / Reference *");
    expect(pages.mmf).toContain("Data as of Date");
    expect(pages.mmf).toContain("Reason for correction *");
    expect(pages.mmf).toContain("A correction reason is required for existing MMF records.");

    expect(pages.bank).toContain("Source (URL or note)");
    expect(pages.bank).toContain("Source as-of date");
    expect(pages.bank).toContain("Reason for correction *");
    expect(pages.bank).toContain("A correction reason is required for existing bank product records.");

    expect(routers).toContain("mmfFunds: router({");
    expect(routers).toContain("bankInstruments: router({");
    expect(routers).toContain("recordManualCorrectionAudit");
    expect(routers).toContain("reason: z.string().max(300).optional()");
  });

  it("uses honest disabled placeholders for CBK and Market Assets until safe governed maintenance exists", () => {
    expect(pages.cbk).toContain("Maintain CBK security records is not enabled here yet.");
    expect(pages.cbk).toContain("missing T-bill, FXD, or IFB record");
    expect(pages.cbk).toContain("correcting an existing security after selecting it");
    expect(pages.cbk).toContain("T-bill tenor, yield/rate, auction date, and value date");
    expect(pages.cbk).toContain("FXD issue");
    expect(pages.cbk).toContain("number, coupon, and maturity");
    expect(pages.cbk).toContain("IFB issue number, coupon, maturity, and tax-exempt true");
    expect(pages.cbk).toContain("Source-supported");
    expect(pages.cbk).toContain("manual proposals must go through governed review before catalogue changes.");
    expect(pages.cbk).toContain("Research Desk");
    expect(pages.cbk).toContain("Ask AI");
    expect(pages.cbk).toContain("purchases and holdings are");
    expect(pages.cbk).toContain("<Button size=\"sm\" disabled");

    expect(pages.market).toContain("Maintain market asset records is not enabled here yet.");
    expect(pages.market).toContain("missing Equity, REIT, Offshore fund, or SACCO record");
    expect(pages.market).toContain("correcting an existing market asset after");
    expect(pages.market).toContain("selecting it");
    expect(pages.market).toContain("subtype-specific fields and contracts");
    expect(pages.market).toContain("Source-supported manual proposals");
    expect(pages.market).toContain("go through governed review before catalogue changes");
    expect(pages.market).toContain("Research Desk");
    expect(pages.market).toContain("Ask AI");
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
