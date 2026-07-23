import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const desk = read("client/src/pages/ResearchDesk.tsx");
const askAi = read("client/src/pages/AskAI.tsx");
const area = read("client/src/pages/ResearchArea.tsx");

describe("Stage 10b-4 · Research Desk professionalization", () => {
  it("uses the concise page hierarchy and governance copy", () => {
    expect(desk).toContain("Research market facts, review AI drafts");
    expect(desk).toContain("AI drafts are unverified until approved.");
    expect(desk).toContain("holdings change only");
    expect(area).not.toContain("The governed workbench between raw data");
  });

  it("renders the digest as a compact three-status row", () => {
    for (const label of ["Awaiting review", "Sources due refresh", "Open conflicts"]) {
      expect(desk).toContain(`label: "${label}"`);
    }
    expect(desk).toContain('aria-label="Research Desk status"');
    expect(desk).not.toContain("Research Desk digest");
  });

  it("keeps all five desk tabs with quieter underline styling", () => {
    for (const tab of ["Ask AI", "Review queue", "Source conflicts", "Source registry", "Recently approved"]) {
      expect(desk).toContain(tab);
    }
    expect(desk).toContain("data-[state=active]:border-primary");
  });

  it("makes Ask AI the concise primary action without changing its workflow controls", () => {
    expect(askAi).toContain('<Sparkles className="h-4 w-4 text-primary" /> Ask AI');
    expect(askAi).toContain("Search, extract, or explain reference data before sending it to review.");
    expect(askAi).toContain("Ask about yields, rates, prices, tenors, or paste a source below...");
    expect(askAi).toContain("Ask / explain");
    expect(askAi).toContain("Extract facts");
    expect(askAi).toContain("Asset type");
  });

  it("keeps source options collapsed under Add source and accessible", () => {
    expect(askAi).toContain('{show ? "Hide source" : "Add source"}');
    for (const option of ["URL", "Paste text", "Upload PDF", "Upload image"]) {
      expect(askAi).toContain(`label: "${option}"`);
    }
    expect(askAi).toContain("aria-pressed={mode === m.value}");
    expect(askAi).toContain('aria-label="Research question"');
  });

  it("shows a useful review-queue empty state and avoids duplicate embedded governance", () => {
    expect(desk).toContain("No drafts awaiting review.");
    expect(desk).toContain("Ask AI to extract facts from a source, then draft findings into the queue.");
    expect(desk).toContain("Start new enquiry");
    expect(askAi).toContain("{!embedded && <AiPrincipleBanner />}");
  });
});
