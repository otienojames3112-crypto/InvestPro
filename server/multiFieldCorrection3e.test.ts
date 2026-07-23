/**
 * Stage 10b-3e — governed multi-field finding corrections.
 *
 * Static guardrails complement the existing DB-backed Round 92 correction test:
 * no catalogue/database writes run here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCorrectionChanges } from "./db";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const askAi = read("client/src/pages/AskAI.tsx");
const routers = read("server/routers.ts");
const db = read("server/db.ts");
const desk = read("client/src/pages/ResearchDesk.tsx");

const dialogStart = askAi.indexOf("function CorrectFigureDialog(");
const dialogEnd = askAi.indexOf("/* ── A single finding card", dialogStart);
const dialog = askAi.slice(dialogStart, dialogEnd);

describe("Stage 10b-3e · contract-aware Correct fields UI", () => {
  it("reframes the governed modal and renders all editable contract rows instead of a one-field dropdown", () => {
    expect(dialog).toContain("Correct fields");
    expect(dialog).toContain("projectFindingToContractDisplayRows");
    expect(dialog).toContain("managerEditable");
    expect(dialog).toContain("correctedValues");
    expect(dialog).not.toContain("Figure to correct");
    expect(dialog).not.toContain("<Select value={field}");
  });

  it("uses contracts for MMF, Bank, CBK, Equity, REIT, Offshore fund, and SACCO", () => {
    for (const call of [
      'getCatalogueFieldContract("mmf")',
      'getCatalogueFieldContract("bank")',
      'getCatalogueFieldContract("cbk")',
      'getCatalogueFieldContract("market_asset", "equity")',
      'getCatalogueFieldContract("market_asset", "reit")',
      'getCatalogueFieldContract("market_asset", "offshore_fund")',
      'getCatalogueFieldContract("market_asset", "sacco")',
    ]) {
      expect(dialog).toContain(call);
    }
  });

  it("submits only changed fields and blocks a no-change submission with friendly validation", () => {
    expect(dialog).toContain("const changedFields");
    expect(dialog).toContain("changes: changedFields");
    expect(dialog).toMatch(/No fields have changed/i);
    expect(dialog).toContain("setValidationMessage");
  });

  it("keeps one shared required reason and original/different-source governance", () => {
    expect(dialog).toContain("reason.trim().length >= 3");
    expect(dialog).toContain("I have a different source");
    expect(dialog).toContain("Reusing the finding's original source");
    expect(dialog).toContain("sourceRequired");
  });
});

describe("Stage 10b-3e · multi-field API, pending item, and audit", () => {
  it("accepts an array of changes while preserving the legacy one-field input", () => {
    const proc = routers.slice(routers.indexOf("correctFinding: adminProcedure"), routers.indexOf("// Round 89", routers.indexOf("correctFinding: adminProcedure")));
    expect(proc).toContain("changes:");
    expect(proc).toContain("field:");
    expect(proc).toContain("newValue:");
    expect(proc).toContain("correctResearchFinding");
  });

  it("versions once and enqueues one review item containing every changed field", () => {
    const correct = db.slice(db.indexOf("export async function correctResearchFinding"), db.indexOf("/* ── Catalogue audit", db.indexOf("export async function correctResearchFinding")));
    expect(correct).toContain("effectiveChanges");
    expect(correct).toContain("_correctionChanges");
    expect(correct).toContain("_changedFields");
    expect(correct).toContain("_currentValues");
    expect(correct.match(/enqueueResearchUpdate\(/g)).toHaveLength(1);
    expect(correct.match(/db\.insert\(researchFindings\)/g)).toHaveLength(1);
    expect(correct).not.toMatch(/buildPromotionPlan|reviewResearchUpdate\(/);
  });

  it("review queue shows the shared correction reason and clean multi-field diff", () => {
    expect(desk).toContain("_correctionReason");
    expect(desk).toContain("PendingDiffTable");
    expect(desk).toContain("resolveApprovalFigureLabel");
  });

  it("approval writes one old-to-new audit entry for each corrected field", () => {
    expect(db).toContain("parseCorrectionChanges");
    expect(db).toContain("for (const correction of correctionChanges)");
    expect(db).toContain("oldValue: correction.oldValue");
    expect(db).toContain("newValue: correction.newValue");
  });

  it("parses two per-field old-to-new audit records from one review item's metadata", () => {
    expect(
      parseCorrectionChanges(
        JSON.stringify([
          { field: "reitType", oldValue: "Income REIT B", newValue: "Income REIT" },
          { field: "nav", oldValue: "KES 20.00", newValue: "KES 21.50 per unit" },
        ]),
      ),
    ).toEqual([
      { field: "reitType", oldValue: "Income REIT B", newValue: "Income REIT" },
      { field: "nav", oldValue: "KES 20.00", newValue: "KES 21.50 per unit" },
    ]);
  });

  it("ignores malformed audit metadata rather than inventing a correction", () => {
    expect(parseCorrectionChanges("{not json")).toEqual([]);
    expect(parseCorrectionChanges([{ field: "", newValue: "x" }])).toEqual([]);
  });
});
