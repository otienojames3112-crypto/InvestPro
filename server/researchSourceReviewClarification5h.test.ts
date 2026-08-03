import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const sourceReview = read("client/src/components/CatalogueSourceReview.tsx");
const askAi = read("client/src/pages/AskAI.tsx");
const researchService = read("server/aiResearchService.ts");
const routers = read("server/routers.ts");
const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");

const categoryPages = {
  mmf: read("client/src/pages/MmfFunds.tsx"),
  bank: read("client/src/pages/BankInstruments.tsx"),
  cbk: read("client/src/pages/CbkSecuritiesReference.tsx"),
  market: read("client/src/pages/MarketAssetsReference.tsx"),
};

describe("Stage 10b-5h - Review a source with AI clarification", () => {
  it("standardizes the visible source-review action label", () => {
    expect(sourceReview).toContain('SOURCE_REVIEW_BUTTON_LABEL = "Review a source with AI"');
    for (const src of Object.values(categoryPages)) {
      expect(src).toContain("<CatalogueSourceReviewButton");
    }
    expect(sourceReview).not.toContain("Review MMF source with AI");
    expect(sourceReview).not.toContain("Review bank source with AI");
    expect(sourceReview).not.toContain("Review CBK source with AI");
    expect(sourceReview).not.toContain("Review market source with AI");
  });

  it("does not introduce labels that imply automatic source refresh or catalogue updates", () => {
    for (const forbidden of [
      "Refresh source data",
      "Check source freshness",
      "Auto-review sources",
      "Update catalogue with AI",
    ]) {
      expect(sourceReview).not.toContain(forbidden);
    }
  });

  it("tells the manager to attach URL, pasted text, PDF, or image source material", () => {
    expect(sourceReview).toContain(
      "Attach a URL, pasted text, PDF, or image. AI will extract reference facts and prepare findings for review.",
    );
    for (const label of ["URL", "Paste text", "Upload PDF", "Upload image"]) {
      expect(askAi).toContain(label);
    }
  });

  it("shows the current governed workflow before catalogue rows change", () => {
    for (const step of [
      "Attach source",
      "AI extracts facts",
      "Draft findings",
      "Review Queue approval",
      "Catalogue updates only after approval",
    ]) {
      expect(sourceReview).toContain(step);
    }
    expect(sourceReview).toContain("Approved catalogue rows change only after manager approval.");
    expect(sourceReview).toContain("Every proposal is a draft you send to the Review Queue");
    expect(sourceReview).toContain("FindingCard");
    expect(sourceReview).toContain("draftFromFinding");
  });

  it("does not claim automatic source discovery, refresh, approval, or publishing", () => {
    expect(sourceReview).toContain("Today, attach the source you want AI to review.");
    expect(sourceReview).toContain("AI does not find the source for");
    expect(sourceReview).toContain("refresh rows by itself");
    expect(sourceReview).toContain("approve changes automatically");
    expect(researchService).toContain("Do not search for a newer source.");
    expect(researchService).toContain("never an automatic refresh");
    expect(researchService).toContain("never a source search");
    expect(researchService).toContain("never an automatic approval");
    expect(researchService).toContain("never a catalogue write");
  });

  it("keeps category-specific source examples clear", () => {
    expect(sourceReview).toContain("factsheets, fund pages, or official rate publications");
    expect(sourceReview).toContain("official product pages, tariff sheets, or rate sheets");
    expect(sourceReview).toContain("CBK notices, auction results, DhowCSD references, or official security details");
    expect(sourceReview).toContain("issuer, exchange, fund manager, REIT, offshore fund, or SACCO source documents");
    for (const subtype of ["Equity", "REIT", "Offshore fund", "SACCO"]) {
      expect(sourceReview).toContain(subtype);
      expect(researchService).toContain(subtype);
    }
  });

  it("connects to Source Library as a future pattern signal, not today's automation", () => {
    expect(sourceReview).toContain(
      "Approved source decisions help Source Library learn reusable patterns for future refresh workflows.",
    );
    expect(sourceReview).toContain("Today, attach the source you want AI to review.");
  });

  it("does not reintroduce Plan Fit, reset copy, or investment-advice wording into source-review copy", () => {
    const clarifiedCopy = [sourceReview, researchService].join("\n");
    expect(clarifiedCopy).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
    expect(sourceReview).not.toMatch(/\bbest\b|\bbuy\b|\bsell\b|\bprofit\b|choose this|\bopportunity\b/i);
    expect(sourceReview).not.toMatch(/Reset catalogues to seed|resetToSeed|researchAdmin\.resetToSeed/i);
  });

  it("leaves How to read this catalogue and reset safety intact", () => {
    for (const src of Object.values(categoryPages)) {
      expect(src).toContain("HOW_TO_READ_CATALOGUE_LABEL");
    }
    expect(allApproved).toContain("HOW_TO_READ_CATALOGUE_LABEL");
    expect(allApproved).toContain("Disabled until safe sandbox reset is implemented.");
    expect(allApproved).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(allApproved).not.toContain("resetToSeed.mutate");
  });

  it("keeps All Approved out of per-category source review until a catalogue target is chosen", () => {
    expect(allApproved).not.toContain("CatalogueSourceReviewButton");
    expect(routers).toContain("catalogue: z.enum([\"mmf\", \"bank\", \"cbk\", \"market_asset\"])");
  });
});
