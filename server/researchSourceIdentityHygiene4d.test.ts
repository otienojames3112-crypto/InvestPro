import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  classifySourceIdentity,
  sourceLibraryFieldLabel,
} from "../client/src/lib/sourceIdentity";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const desk = read("client/src/pages/ResearchDesk.tsx");

describe("Stage 10b-4d · source identity classification", () => {
  it("classifies an internal InvestPro Render URL as audit-only", () => {
    const result = classifySourceIdentity({
      label: "Research queue",
      url: "https://investpro-d0fh.onrender.com/research?desk=queue",
    });
    expect(result).toMatchObject({
      kind: "internal",
      badge: "Internal/not a source",
      displayName: "Internal InvestPro page",
      trusted: false,
      readiness: "Audit only",
    });
  });

  it("classifies the current app hostname and localhost as internal", () => {
    expect(
      classifySourceIdentity({
        label: "Queue",
        url: "https://app.example.com/research?desk=queue",
        appHostname: "app.example.com",
      }).kind,
    ).toBe("internal");
    expect(classifySourceIdentity({ label: null, url: "http://localhost:3000/research" }).kind).toBe("internal");
  });

  it.each([
    "Pasted source text",
    "Manually entered for Stage 10b-3c QA testing",
    "Manually entered for Stage 10b-3c QA testing — not a live SACCO source.",
  ])("classifies %s as manual/pasted", (label) => {
    expect(classifySourceIdentity({ label, url: null })).toMatchObject({
      kind: "manual",
      badge: "Manual/pasted",
      displayName: "Manual / pasted source",
      trusted: false,
    });
  });

  it("conservatively identifies regulator, exchange, issuer, official, and unknown sources", () => {
    expect(
      classifySourceIdentity({ label: "Central Bank of Kenya", url: "https://www.centralbank.go.ke" }).badge,
    ).toBe("Regulator");
    expect(
      classifySourceIdentity({ label: "Nairobi Securities Exchange", url: "https://www.nse.co.ke" }).badge,
    ).toBe("Exchange");
    expect(classifySourceIdentity({ label: "KCB Bank rate sheet", url: "https://ke.kcbgroup.com" }).badge).toBe(
      "Issuer",
    );
    expect(classifySourceIdentity({ label: "National Treasury", url: "https://www.treasury.go.ke" }).badge).toBe(
      "Official",
    );
    expect(classifySourceIdentity({ label: "Example research", url: "https://example.com" }).badge).toBe("Unknown");
  });
});

describe("Stage 10b-4d · clean Source Library field labels", () => {
  it.each([
    ["mmf", "whtRate", "WHT rate"],
    ["bank", "sourceAsOfDate", "Source as-of date"],
    ["market_asset", "minimumMonthlyContribution", "Minimum monthly contribution"],
    ["market_asset", "distributionYield", "Distribution yield"],
    ["market_asset", "nav", "Net asset value / NAV"],
    ["bank", "earlyWithdrawal", "Early withdrawal rule"],
    ["bank", "productName", "Product name"],
  ] as const)("renders %s.%s as %s", (catalogue, key, expected) => {
    expect(sourceLibraryFieldLabel(catalogue, key)).toBe(expected);
  });

  it("uses contract labels before an acronym-aware camelCase fallback", () => {
    expect(sourceLibraryFieldLabel("bank", "indicativeRate")).toBe("Interest rate");
    expect(sourceLibraryFieldLabel("mmf", "fxRiskFlag")).toBe("FX risk flag");
  });
});

describe("Stage 10b-4d · Source Library grouping and card hygiene", () => {
  it("separates reusable patterns from manual, pasted, internal, and unknown history", () => {
    expect(desk).toContain("source.identity.trusted");
    expect(desk).toContain("Trusted / reusable source patterns");
    expect(desk).toContain("Manual, pasted, and internal sources");
    expect(desk).toContain("reusableSources");
    expect(desk).toContain("auditOnlySources");
  });

  it("keeps manual/internal history visible but not preferred for future refreshes", () => {
    expect(desk).toContain("remain in the audit trail but are not preferred automation sources");
    expect(desk).toContain("No reusable source patterns identified yet.");
    expect(desk).toContain("<SourceLibraryCards sources={auditOnlySources} />");
  });

  it("retains source identity, families, clean fields, counts, and links on cards", () => {
    for (const value of [
      "source.identity.displayName",
      "source.identity.badge",
      "source.identity.readiness",
      "source.catalogues",
      "sourceLibraryFieldLabel",
      "Approved decisions",
      "Linked catalogue rows",
      "Open source",
      "Open recorded link",
      "publishedRowHref",
    ]) {
      expect(desk).toContain(value);
    }
  });

  it("retains a polished empty state when no approved source history exists", () => {
    expect(desk).toContain("Approved sources will appear here automatically.");
    expect(desk).toContain("approvedSources.length === 0");
  });
});
