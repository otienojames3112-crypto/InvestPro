import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const desk = read("client/src/pages/ResearchDesk.tsx");
const conflicts = read("client/src/pages/SourceConflicts.tsx");

describe("Stage 10b-4b · Source Intelligence navigation", () => {
  it("keeps only Ask AI, Review queue, and Recently approved in the primary tab list", () => {
    const start = desk.indexOf('<TabsList className="h-auto min-w-0');
    const end = desk.indexOf("</TabsList>", start);
    const primaryTabs = desk.slice(start, end);
    expect(primaryTabs).toContain('value="ask"');
    expect(primaryTabs).toContain('value="queue"');
    expect(primaryTabs).toContain('value="approved"');
    expect(primaryTabs).not.toContain('value="sources"');
    expect(primaryTabs).not.toContain('value="conflicts"');
  });

  it("makes Source Library and Conflict Review reachable through Source tools", () => {
    expect(desk).toContain('aria-label="Open source tools"');
    expect(desk).toContain('onSelect={() => select("sources")}');
    expect(desk).toContain('onSelect={() => select("conflicts")}');
    expect(desk).toContain("Source Library");
    expect(desk).toContain("Conflict Review");
  });

  it("routes each status tile to its matching operational view", () => {
    expect(desk).toMatch(/label: "Awaiting review"[\s\S]*?target: "queue"/);
    expect(desk).toMatch(/label: "Sources due refresh"[\s\S]*?target: "sources"/);
    expect(desk).toMatch(/label: "Open conflicts"[\s\S]*?target: "conflicts"/);
  });
});

describe("Stage 10b-4b · Source Library", () => {
  it("derives approved source patterns from immutable approval history", () => {
    expect(desk).toContain("researchPipeline.recentlyApproved.useQuery");
    expect(desk).toContain("entry.sourceUrl ?? entry.source");
    expect(desk).toContain("existing.fields.add(entry.field)");
    expect(desk).toContain("existing.linkedRows.set");
  });

  it("explains learning carefully without claiming autonomous publishing", () => {
    expect(desk).toContain("Source Library learns from manager-approved source decisions");
    expect(desk).toContain("Future refreshes can use these patterns");
    expect(desk).toContain("they will still require governed review");
  });

  it("shows useful source metadata and a polished future-ready empty state", () => {
    for (const label of [
      "Fields supported",
      "Last approved use",
      "Approved decisions",
      "Linked catalogue rows",
      "Manager-approved use",
    ]) {
      expect(desk).toContain(label);
    }
    expect(desk).toContain("Approved sources will appear here automatically.");
    expect(desk).toContain("Open source");
    expect(desk).toContain("publishedRowHref");
  });

  it("keeps manual cadence records secondary and optional", () => {
    expect(desk).toContain("Registered source patterns");
    expect(desk).toContain("Optional cadence settings");
    expect(desk).toContain("<RegisteredSourcePatterns />");
  });
});

describe("Stage 10b-4b · Conflict Review", () => {
  it("frames conflicts as pre-change source disagreements", () => {
    expect(conflicts).toContain("Conflict Review captures disagreements before catalogue values change.");
    expect(conflicts).toContain("Current approved value");
    expect(conflicts).toContain("New extracted value");
  });

  it("retains deliberate manager actions and a professional empty state", () => {
    expect(conflicts).toContain("Keep approved value");
    expect(conflicts).toContain("Use new value");
    expect(conflicts).toContain("No source conflicts.");
    expect(conflicts).toContain("Conflicts appear when a new source disagrees with an approved catalogue value.");
  });
});
