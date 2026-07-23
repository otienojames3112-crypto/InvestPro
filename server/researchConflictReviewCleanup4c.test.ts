import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const desk = read("client/src/pages/ResearchDesk.tsx");
const conflicts = read("client/src/pages/SourceConflicts.tsx");

describe("Stage 10b-4c · Conflict Review separation", () => {
  it("renders only source-conflict governance in the Conflict Review tab", () => {
    const start = desk.indexOf('<TabsContent value="conflicts"');
    const end = desk.indexOf("</TabsContent>", start);
    const conflictTab = desk.slice(start, end);

    expect(conflictTab).toContain("<SourceConflicts embedded />");
    expect(conflictTab).not.toContain("<AiReview");
    expect(desk).not.toContain('import AiReview from "./AiReview"');
  });

  it("does not mix legacy document-intake review controls into Conflict Review", () => {
    for (const unrelatedCopy of [
      "AI review queue",
      "Add from a document",
      "Confirm as read",
      "Correct",
      "Reject",
      "hidden from catalog",
    ]) {
      expect(conflicts).not.toContain(unrelatedCopy);
    }
  });

  it("keeps the empty state calm, focused, and explicit about unchanged values", () => {
    expect(conflicts).toContain("No source conflicts.");
    expect(conflicts).toContain(
      "Conflicts appear when a new source disagrees with an approved catalogue value.",
    );
    expect(conflicts).toContain(
      "Approved values stay unchanged until a manager chooses how to resolve the disagreement.",
    );
  });

  it("shows decision guidance only for a non-empty conflict list", () => {
    expect(conflicts).toContain("!isLoading && conflicts.length > 0");
    expect(conflicts).toContain("Keep approved value");
    expect(conflicts).toContain("leaves the catalogue unchanged");
    expect(conflicts).toContain("Use new value");
    expect(conflicts).toContain("Every decision remains auditable.");
  });

  it("retains the existing conflict values and manager actions", () => {
    expect(conflicts).toContain("Current approved value");
    expect(conflicts).toContain("New source value");
    expect(conflicts).toContain('resolution: "dismiss"');
    expect(conflicts).toContain('resolution: "apply"');
    expect(conflicts).toContain("c.scrapedSource");
    expect(conflicts).toContain("fmtAsOf(c.scrapedAsOf)");
  });
});

describe("Stage 10b-4c · Research Desk routing", () => {
  it("keeps Source Library and Conflict Review reachable and identifies the active source tool", () => {
    expect(desk).toContain('onSelect={() => select("sources")}');
    expect(desk).toContain('onSelect={() => select("conflicts")}');
    expect(desk).toContain('active === "sources" ? "Source Library"');
    expect(desk).toContain('active === "conflicts" ? "Conflict Review"');
  });

  it("keeps all status tiles routed to their correct workflow", () => {
    expect(desk).toMatch(/label: "Awaiting review"[\s\S]*?target: "queue"/);
    expect(desk).toMatch(/label: "Sources due refresh"[\s\S]*?target: "sources"/);
    expect(desk).toMatch(/label: "Open conflicts"[\s\S]*?target: "conflicts"/);
  });

  it("keeps the governed pending-update workflow in Review Queue", () => {
    const start = desk.indexOf('<TabsContent value="queue"');
    const end = desk.indexOf("</TabsContent>", start);
    expect(desk.slice(start, end)).toContain("<PendingQueue />");
  });
});
