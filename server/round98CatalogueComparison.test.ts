/**
 * Round 98 — Catalogue Comparison Metadata Pipeline regression suite.
 *
 * Tests:
 *   A. structuredInstrumentToDraft injects comparison metadata (_proposalType, _matchedCurrentRow,
 *      _changedFields, _currentValues, _targetRef, _staleFlag, _impactNote).
 *   B. Extraction schemas include proposalType/matchedCurrentRow/changedFields/currentValues.
 *   C. catalogueReviewInstruction includes comparison output instructions.
 *   D. draftFromFinding auto-populates changeKind/targetRef from comparison metadata.
 *   E. fmtFields/fmtFigures filter out _ prefixed hidden keys.
 *   F. Stale proposals map to changeKind='edit' with _staleFlag.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  structuredInstrumentToDraft,
  catalogueReviewInstruction,
} from "./aiResearchService";
import type { SourceClass } from "../shared/instrumentProfile";

const ROOT = join(__dirname, "..");

/* ─────────────────── A. structuredInstrumentToDraft comparison metadata ─────── */

describe("Round 98 · A — structuredInstrumentToDraft injects comparison metadata", () => {
  it("injects _proposalType='create' for new instruments", () => {
    const raw = {
      instrumentName: "New Fund ABC",
      effectiveAnnualRate: "12.5%",
      proposalType: "create",
      matchedCurrentRow: null,
      changedFields: [],
      currentValues: [],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.8,
    };
    const draft = structuredInstrumentToDraft(raw, "mmf_benchmark" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._proposalType).toBe("create");
    expect(draft!.extractedFields._matchedCurrentRow).toBeUndefined();
    expect(draft!.extractedFields._changedFields).toBeUndefined();
    expect(draft!.extractedFields._currentValues).toBeUndefined();
    expect(draft!.extractedFields._staleFlag).toBeUndefined();
    expect(draft!.extractedFields._impactNote).toContain("New");
  });

  it("injects _proposalType='update' with changedFields and currentValues", () => {
    const raw = {
      instrumentName: "SanlamAllianz MMF",
      effectiveAnnualRate: "13.2%",
      proposalType: "update",
      matchedCurrentRow: "SanlamAllianz MMF",
      changedFields: ["effectiveAnnualRate"],
      currentValues: [{ field: "effectiveAnnualRate", value: "12.8%" }],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.9,
    };
    const draft = structuredInstrumentToDraft(raw, "mmf_benchmark" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._proposalType).toBe("update");
    expect(draft!.extractedFields._matchedCurrentRow).toBe("SanlamAllianz MMF");
    expect(JSON.parse(draft!.extractedFields._changedFields)).toEqual(["effectiveAnnualRate"]);
    expect(JSON.parse(draft!.extractedFields._currentValues)).toEqual([
      { field: "effectiveAnnualRate", value: "12.8%" },
    ]);
    expect(draft!.extractedFields._targetRef).toBe("SanlamAllianz MMF");
    expect(draft!.extractedFields._staleFlag).toBeUndefined();
    expect(draft!.extractedFields._impactNote).toContain("Updates 1 field(s)");
  });

  it("injects _proposalType='stale' with _staleFlag and _targetRef", () => {
    const raw = {
      instrumentName: "Old Defunct Fund",
      proposalType: "stale",
      matchedCurrentRow: "Old Defunct Fund",
      changedFields: ["effectiveAnnualRate"],
      currentValues: [{ field: "effectiveAnnualRate", value: "10.0%" }],
      rawExcerpt: null,
      warnings: ["Fund no longer listed"],
      confidence: 0.7,
    };
    const draft = structuredInstrumentToDraft(raw, "mmf_benchmark" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._proposalType).toBe("stale");
    expect(draft!.extractedFields._staleFlag).toBe("true");
    expect(draft!.extractedFields._targetRef).toBe("Old Defunct Fund");
    expect(draft!.extractedFields._impactNote).toContain("stale");
  });

  it("defaults proposalType to 'create' when missing from raw", () => {
    const raw = {
      instrumentName: "Some Fund",
      effectiveAnnualRate: "11.0%",
      rawExcerpt: null,
      warnings: [],
      confidence: 0.8,
    };
    const draft = structuredInstrumentToDraft(raw, "mmf_factsheet" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._proposalType).toBe("create");
  });

  it("does not set _targetRef for create proposals", () => {
    const raw = {
      instrumentName: "Brand New Fund",
      proposalType: "create",
      matchedCurrentRow: null,
      changedFields: [],
      currentValues: [],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.85,
    };
    const draft = structuredInstrumentToDraft(raw, "mmf_benchmark" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._targetRef).toBeUndefined();
  });

  it("handles bank product update with multiple changed fields", () => {
    const raw = {
      instrumentName: "NCBA Fixed Deposit",
      bankName: "NCBA",
      indicativeRate: "14.0%",
      minimumAmount: "1000000",
      proposalType: "update",
      matchedCurrentRow: "NCBA Fixed Deposit",
      changedFields: ["indicativeRate", "minimumAmount"],
      currentValues: [
        { field: "indicativeRate", value: "12.5%" },
        { field: "minimumAmount", value: "500000" },
      ],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.9,
    };
    const draft = structuredInstrumentToDraft(raw, "bank_rate_card" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._proposalType).toBe("update");
    expect(JSON.parse(draft!.extractedFields._changedFields)).toHaveLength(2);
    expect(JSON.parse(draft!.extractedFields._currentValues)).toHaveLength(2);
    expect(draft!.extractedFields._impactNote).toContain("Updates 2 field(s)");
  });
});

/* ─────────────────── B. Extraction schemas include comparison fields ────────── */

describe("Round 98 · B — Extraction schemas include proposalType/changedFields/currentValues", () => {
  const src = readFileSync(join(ROOT, "server/aiResearchService.ts"), "utf-8");

  it("CBK bond schema has proposalType in required", () => {
    // The first instruments array schema (CBK bond)
    const bondSchemaBlock = src.slice(
      src.indexOf('"instrumentName", "issueNumber", "securityType"'),
      src.indexOf('"instrumentName", "issueNumber", "securityType"') + 500,
    );
    expect(bondSchemaBlock).toContain('"proposalType"');
    expect(bondSchemaBlock).toContain('"matchedCurrentRow"');
    expect(bondSchemaBlock).toContain('"changedFields"');
    expect(bondSchemaBlock).toContain('"currentValues"');
  });

  it("MMF schema has proposalType in required", () => {
    const mmfSchemaBlock = src.slice(
      src.indexOf('"instrumentName", "fundManager", "effectiveAnnualRate"'),
      src.indexOf('"instrumentName", "fundManager", "effectiveAnnualRate"') + 500,
    );
    expect(mmfSchemaBlock).toContain('"proposalType"');
    expect(mmfSchemaBlock).toContain('"changedFields"');
    expect(mmfSchemaBlock).toContain('"currentValues"');
  });

  it("Bank schema has proposalType in required", () => {
    const bankSchemaBlock = src.slice(
      src.indexOf('"instrumentName", "bankName", "productType"'),
      src.indexOf('"instrumentName", "bankName", "productType"') + 500,
    );
    expect(bankSchemaBlock).toContain('"proposalType"');
    expect(bankSchemaBlock).toContain('"changedFields"');
    expect(bankSchemaBlock).toContain('"currentValues"');
  });

  it("Market asset schema has proposalType in required", () => {
    const marketSchemaBlock = src.slice(
      src.indexOf('"instrumentName", "assetType", "ticker"'),
      src.indexOf('"instrumentName", "assetType", "ticker"') + 500,
    );
    expect(marketSchemaBlock).toContain('"proposalType"');
    expect(marketSchemaBlock).toContain('"changedFields"');
    expect(marketSchemaBlock).toContain('"currentValues"');
  });

  it("T-bill schema has proposalType in required", () => {
    const tbillSchemaBlock = src.slice(
      src.indexOf('"instrumentName", "issueNumber", "tenorDays"'),
      src.indexOf('"instrumentName", "issueNumber", "tenorDays"') + 500,
    );
    expect(tbillSchemaBlock).toContain('"proposalType"');
    expect(tbillSchemaBlock).toContain('"changedFields"');
    expect(tbillSchemaBlock).toContain('"currentValues"');
  });
});

/* ─────────────────── C. catalogueReviewInstruction includes comparison output ── */

describe("Round 98 · C — catalogueReviewInstruction includes comparison output instructions", () => {
  const catalogues: Array<"mmf" | "bank" | "cbk" | "market_asset"> = ["mmf", "bank", "cbk", "market_asset"];

  for (const cat of catalogues) {
    it(`${cat} instruction mentions proposalType`, () => {
      const instruction = catalogueReviewInstruction(cat);
      expect(instruction).toContain("proposalType");
      expect(instruction).toContain("matchedCurrentRow");
      expect(instruction).toContain("changedFields");
      expect(instruction).toContain("currentValues");
    });

    it(`${cat} instruction mentions 'create', 'update', 'stale'`, () => {
      const instruction = catalogueReviewInstruction(cat);
      expect(instruction).toContain("'create'");
      expect(instruction).toContain("'update'");
      expect(instruction).toContain("'stale'");
    });
  }
});

/* ─────────────────── D. draftFromFinding auto-populates changeKind/targetRef ── */

describe("Round 98 · D — draftFromFinding auto-populates changeKind/targetRef from metadata", () => {
  const routersSrc = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");

  it("reads _proposalType from finding extractedFields", () => {
    expect(routersSrc).toContain("ef._proposalType");
  });

  it("sets effectiveChangeKind to 'edit' for update/stale proposals", () => {
    expect(routersSrc).toContain('if (pt === "update" || pt === "stale") effectiveChangeKind = "edit"');
  });

  it("reads _targetRef from finding extractedFields for targetRef", () => {
    expect(routersSrc).toContain("ef._targetRef");
    expect(routersSrc).toContain("effectiveTargetRef");
  });

  it("passes effectiveChangeKind and effectiveTargetRef to validatePendingUpdate", () => {
    // The validate call should use the effective values
    const validateBlock = routersSrc.slice(
      routersSrc.indexOf("const v = validatePendingUpdate({", routersSrc.indexOf("effectiveChangeKind")),
      routersSrc.indexOf("const v = validatePendingUpdate({", routersSrc.indexOf("effectiveChangeKind")) + 200,
    );
    expect(validateBlock).toContain("targetRef: effectiveTargetRef");
    expect(validateBlock).toContain("changeKind: effectiveChangeKind");
  });

  it("passes effectiveChangeKind and effectiveTargetRef to enqueueResearchUpdate", () => {
    const enqueueBlock = routersSrc.slice(
      routersSrc.indexOf("const pendingId = await enqueueResearchUpdate({", routersSrc.indexOf("effectiveChangeKind")),
      routersSrc.indexOf("const pendingId = await enqueueResearchUpdate({", routersSrc.indexOf("effectiveChangeKind")) + 200,
    );
    expect(enqueueBlock).toContain("targetRef: effectiveTargetRef");
    expect(enqueueBlock).toContain("changeKind: effectiveChangeKind");
  });
});

/* ─────────────────── E. fmtFields/fmtFigures filter _ prefixed keys ─────────── */

describe("Round 98 · E — fmtFields/fmtFigures filter hidden _ prefixed keys", () => {
  const askAiSrc = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf-8");
  const researchDeskSrc = readFileSync(join(ROOT, "client/src/pages/ResearchDesk.tsx"), "utf-8");

  it("AskAI fmtFields filters all _ prefixed keys", () => {
    expect(askAiSrc).toContain('!k.startsWith("_")');
  });

  it("ResearchDesk fmtFigures filters all _ prefixed keys", () => {
    expect(researchDeskSrc).toContain('!k.startsWith("_")');
  });
});

/* ─────────────────── F. Stale proposals map to changeKind='edit' ─────────────── */

describe("Round 98 · F — Stale proposals use changeKind='edit' with _staleFlag", () => {
  it("structuredInstrumentToDraft sets _staleFlag='true' for stale proposals", () => {
    const raw = {
      instrumentName: "Stale Security",
      proposalType: "stale",
      matchedCurrentRow: "Stale Security",
      changedFields: ["yieldPct"],
      currentValues: [{ field: "yieldPct", value: "8.5%" }],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.6,
    };
    const draft = structuredInstrumentToDraft(raw, "cbk_bond_prospectus" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._staleFlag).toBe("true");
    expect(draft!.extractedFields._proposalType).toBe("stale");
  });

  it("stale proposals do NOT set _staleFlag for non-stale types", () => {
    const raw = {
      instrumentName: "Updated Security",
      proposalType: "update",
      matchedCurrentRow: "Updated Security",
      changedFields: ["yieldPct"],
      currentValues: [{ field: "yieldPct", value: "8.5%" }],
      rawExcerpt: null,
      warnings: [],
      confidence: 0.9,
    };
    const draft = structuredInstrumentToDraft(raw, "cbk_bond_prospectus" as SourceClass);
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields._staleFlag).toBeUndefined();
  });

  it("DB schema only supports create|edit changeKind (no stale enum)", () => {
    const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");
    // The changeKind enum should only have 'create' and 'edit'
    const changeKindMatch = schema.match(/changeKind.*mysqlEnum.*\[([^\]]+)\]/);
    expect(changeKindMatch).not.toBeNull();
    expect(changeKindMatch![1]).toContain('"create"');
    expect(changeKindMatch![1]).toContain('"edit"');
    expect(changeKindMatch![1]).not.toContain('"stale"');
  });
});

/* ─────────────────── G. ComparisonDiffTable + PendingDiffTable components ────── */

describe("Round 98 · G — Diff table components exist in UI", () => {
  const askAiSrc = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf-8");
  const researchDeskSrc = readFileSync(join(ROOT, "client/src/pages/ResearchDesk.tsx"), "utf-8");

  it("AskAI has ComparisonDiffTable component", () => {
    expect(askAiSrc).toContain("function ComparisonDiffTable");
    expect(askAiSrc).toContain("<ComparisonDiffTable");
  });

  it("ComparisonDiffTable renders field/current/proposed columns", () => {
    expect(askAiSrc).toContain("Field");
    expect(askAiSrc).toContain("Current");
    expect(askAiSrc).toContain("Proposed");
  });

  it("ResearchDesk has PendingDiffTable component", () => {
    expect(researchDeskSrc).toContain("function PendingDiffTable");
    expect(researchDeskSrc).toContain("<PendingDiffTable");
  });

  it("PendingDiffTable renders field/current/proposed columns", () => {
    expect(researchDeskSrc).toContain("Field");
    expect(researchDeskSrc).toContain("Current");
    expect(researchDeskSrc).toContain("Proposed");
  });

  it("PendingQueue shows proposal-type-aware badge (Stale/Update)", () => {
    expect(researchDeskSrc).toContain("Stale row");
    expect(researchDeskSrc).toContain("_proposalType");
    expect(researchDeskSrc).toContain("_staleFlag");
  });

  it("FindingCard shows proposal type badges (New/Update/Stale)", () => {
    expect(askAiSrc).toContain("_proposalType");
    // Check for the three badge labels
    expect(askAiSrc).toContain("> New");
    expect(askAiSrc).toContain("> Update");
    expect(askAiSrc).toContain("> Stale");
  });
});
