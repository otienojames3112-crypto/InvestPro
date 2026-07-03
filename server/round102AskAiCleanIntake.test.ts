/**
 * Round 102 — Regression tests for the Ask AI "Clean Intake" improvements:
 *
 *  1. Intake mode selector and source-class detection panel
 *  2. Follow-up structured extraction gate (extract mode)
 *  3. Instrument Profile Preview component field grouping
 *  4. Missing-field quality (no blanks, no nulls, visual warning)
 *  5. Governance: intakeMode never bypasses the AI principle guardrails
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── 1. Source-class detection panel (backend contract) ─────────────────────

describe("Round 102 — Source-class detection panel", () => {
  it("ResearchAnswer interface includes sourceClass field", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // The interface must declare sourceClass as optional
    expect(src).toContain("sourceClass?: SourceClass | null;");
  });

  it("runResearchQuestion surfaces detectedSourceClass from _extendedFields", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // Must derive sourceClass from the first finding's _extendedFields
    expect(src).toContain("detectedSourceClass");
    expect(src).toContain("return { answer, findings: deduped, model: usedModel, sourceClass: detectedSourceClass }");
  });

  it("ExecuteResearchTaskResult includes sourceClass", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    expect(src).toContain("sourceClass?: string | null;");
  });

  it("executeResearchTask returns sourceClass from the engine result", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    expect(src).toContain("sourceClass: res.sourceClass ?? null,");
  });

  it("Frontend ResearchTaskResult type includes sourceClass", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain("sourceClass?: string | null;");
  });

  it("OpeningPanel renders the detected source-class panel", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain("detectedSourceClass && isSourceClass(detectedSourceClass)");
    expect(src).toContain("catalogueLabelForSourceClass");
  });

  it("catalogueLabelForSourceClass maps all catalogue prefixes", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain('if (sc.startsWith("cbk_")) return "CBK Securities Reference"');
    expect(src).toContain('if (sc.startsWith("mmf_")) return "MMF Market"');
    expect(src).toContain('if (sc.startsWith("bank_")) return "Bank Product Catalogue"');
    expect(src).toContain('if (sc.startsWith("market_asset_")) return "Market Assets Reference"');
  });
});

// ─── 2. Intake mode selector and follow-up extraction gate ──────────────────

describe("Round 102 — Intake mode and follow-up extraction gate", () => {
  it("startResearchTask accepts intakeMode in its input schema", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    expect(src).toContain('intakeMode: z.enum(["ask", "extract"]).optional()');
  });

  it("processResearchTask accepts intakeMode in its input schema", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    // The processResearchTask procedure must also accept intakeMode
    const processBlock = src.slice(src.indexOf("processResearchTask: adminProcedure"));
    expect(processBlock).toContain('intakeMode: z.enum(["ask", "extract"]).optional()');
  });

  it("processResearchTask passes intakeMode to executeResearchTask", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    expect(src).toContain("intakeMode: input.intakeMode ?? null,");
  });

  it("executeResearchTask passes intakeMode to runResearchQuestion", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf8");
    // The executeResearchTask function must pass intakeMode through
    expect(src).toContain("intakeMode: opts.intakeMode");
  });

  it("canTryStructured allows extraction on follow-ups when intakeMode is extract", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    expect(src).toContain(
      'const canTryStructured = Boolean(grounding) && (priorTurns.length === 0 || args.intakeMode === "extract")',
    );
  });

  it("runResearchQuestion accepts intakeMode argument", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    expect(src).toContain('intakeMode?: "ask" | "extract" | null');
  });

  it("Frontend OpeningPanel has intakeMode state", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain('const [intakeMode, setIntakeMode] = useState<"ask" | "extract">("ask")');
  });

  it("Frontend passes intakeMode to startResearchTask and poller", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    // Opening panel passes intakeMode
    expect(src).toContain("intakeMode,\n        });");
    // Poller receives intakeMode opts
    expect(src).toContain("}, { intakeMode });");
  });

  it("Follow-up Conversation auto-switches to extract mode when a new source is attached", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain(
      'const effectiveIntakeMode: "ask" | "extract" = source ? "extract" : intakeMode',
    );
  });

  it("useResearchTaskPoller accepts optional intakeMode opts and passes to processResearchTask", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(src).toContain("opts?: { intakeMode?:");
    expect(src).toContain("process.mutateAsync({ taskId, intakeMode: opts?.intakeMode })");
  });
});

// ─── 3. Instrument Profile Preview component ────────────────────────────────

describe("Round 102 — InstrumentProfilePreview component", () => {
  const previewSrc = fs.readFileSync(
    path.resolve(__dirname, "../client/src/components/InstrumentProfilePreview.tsx"),
    "utf8",
  );

  it("exports InstrumentProfilePreview function", () => {
    expect(previewSrc).toContain("export function InstrumentProfilePreview");
  });

  it("defines field groups for all 4 catalogue types", () => {
    expect(previewSrc).toContain("const CBK_GROUPS: FieldGroup[]");
    expect(previewSrc).toContain("const MMF_GROUPS: FieldGroup[]");
    expect(previewSrc).toContain("const BANK_GROUPS: FieldGroup[]");
    expect(previewSrc).toContain("const MARKET_ASSET_GROUPS: FieldGroup[]");
  });

  it("CBK groups include Identity, Rates & Pricing, Key Dates, Amounts & Rules", () => {
    expect(previewSrc).toContain('"Identity"');
    expect(previewSrc).toContain('"Rates & Pricing"');
    expect(previewSrc).toContain('"Key Dates"');
    expect(previewSrc).toContain('"Amounts & Rules"');
  });

  it("MMF groups include Identity, Rates & Fees, Terms, Composition", () => {
    expect(previewSrc).toContain('"Rates & Fees"');
    expect(previewSrc).toContain('"Composition"');
  });

  it("Bank groups include Identity, Rates, Terms", () => {
    // Bank has 3 groups
    const bankSection = previewSrc.slice(previewSrc.indexOf("const BANK_GROUPS"));
    expect(bankSection).toContain('"Identity"');
    expect(bankSection).toContain('"Rates"');
    expect(bankSection).toContain('"Terms"');
  });

  it("Market Asset groups include Identity, Pricing & Returns, Risk & Liquidity", () => {
    expect(previewSrc).toContain('"Pricing & Returns"');
    expect(previewSrc).toContain('"Risk & Liquidity"');
  });

  it("handles missing_from_source sentinel correctly", () => {
    expect(previewSrc).toContain("isMissingFromSource");
    // Must show a Missing badge, not blank
    expect(previewSrc).toContain("Missing");
  });

  it("parseProfile handles both string and object _extendedFields", () => {
    expect(previewSrc).toContain('typeof raw === "string" ? JSON.parse(raw) : raw');
  });

  it("only renders groups that have at least one populated field", () => {
    expect(previewSrc).toContain("visibleGroups");
    expect(previewSrc).toContain("g.fields.filter");
  });

  it("FindingCard uses InstrumentProfilePreview when _extendedFields is present", () => {
    const askSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
      "utf8",
    );
    expect(askSrc).toContain("InstrumentProfilePreview");
    expect(askSrc).toContain("finding.extractedFields?._extendedFields");
    expect(askSrc).toContain("<InstrumentProfilePreview extendedFieldsRaw={extRaw}");
  });
});

// ─── 4. Missing-field display quality ───────────────────────────────────────

describe("Round 102 — Missing-field display quality", () => {
  const askSrc = fs.readFileSync(
    path.resolve(__dirname, "../client/src/pages/AskAI.tsx"),
    "utf8",
  );

  it("missing fields are shown with a count badge", () => {
    expect(askSrc).toContain(
      '{missing.length} field{missing.length === 1 ? "" : "s"} missing',
    );
  });

  it("each missing field is rendered as an individual Badge", () => {
    expect(askSrc).toContain("missing.map((m) =>");
    expect(askSrc).toContain("<Badge");
  });

  it("missing-field panel includes the actionable hint about vouching at approval", () => {
    expect(askSrc).toContain("vouch a value at approval");
  });

  it("fmtFields filters out null, undefined, and empty-string values", () => {
    expect(askSrc).toContain(
      '.filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && String(v).trim() !== "")',
    );
  });

  it("InstrumentProfilePreview never shows blank or null — only dash or Missing badge", () => {
    const previewSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/components/InstrumentProfilePreview.tsx"),
      "utf8",
    );
    // Null fields return null from displayValue (hidden)
    expect(previewSrc).toContain("if (v === undefined || v === null) return null");
    // Missing sentinel handled separately
    expect(previewSrc).toContain("if (isMissingFromSource(v)) return null");
    // Fallback dash for fields with no display value
    expect(previewSrc).toContain("—");
  });
});

// ─── 5. Governance: intakeMode never bypasses AI principle guardrails ────────

describe("Round 102 — Governance: intakeMode does not bypass guardrails", () => {
  it("intakeMode only affects the extraction gate, not the AI system prompt", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // intakeMode appears ONLY in the canTryStructured gate, never in prompt construction
    const promptSection = src.slice(src.indexOf("SYSTEM PROMPT"), src.indexOf("canTryStructured"));
    // intakeMode must NOT appear in the prompt section
    expect(promptSection).not.toContain("intakeMode");
  });

  it("the AI system prompt still contains the never-recommend guardrail", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // The guardrail uses "Do NOT give ADVICE or RECOMMENDATIONS"
    expect(src).toContain("Do NOT give ADVICE or RECOMMENDATIONS");
  });

  it("the AI system prompt still contains the never-invent guardrail", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    expect(src).toContain("NEVER_INVENT_FIELDS");
  });

  it("extract mode does not bypass source-read gating", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // canTryStructured still requires Boolean(grounding) — no grounding = no extraction
    expect(src).toContain("const canTryStructured = Boolean(grounding)");
  });

  it("extract mode does not skip deduplication or warning generation", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "aiResearchService.ts"), "utf8");
    // suppressDuplicateFindings and addWarnings are called unconditionally after extraction
    expect(src).toContain("suppressDuplicateFindings");
    // The dedup call must come AFTER the structured/generic branch, not inside it
    const afterStructured = src.slice(src.indexOf("if (!usedStructured)"));
    const afterGeneric = afterStructured.slice(afterStructured.indexOf("}"));
    expect(afterGeneric).toContain("suppressDuplicateFindings");
  });
});

// ─── 6. CBK Bond fixture: field groups cover all required fields ────────────

describe("Round 102 — CBK Bond required fields coverage", () => {
  it("InstrumentProfilePreview CBK_GROUPS covers all CBK_BOND_REQUIRED_FIELDS", () => {
    const previewSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/components/InstrumentProfilePreview.tsx"),
      "utf8",
    );
    const profileSrc = fs.readFileSync(
      path.resolve(__dirname, "../shared/instrumentProfile.ts"),
      "utf8",
    );

    // Extract CBK_BOND_REQUIRED_FIELDS from the shared module using indexOf
    const idx = profileSrc.indexOf("CBK_BOND_REQUIRED_FIELDS");
    expect(idx).toBeGreaterThan(0);
    const start = profileSrc.indexOf("[", profileSrc.indexOf("[", idx) + 1); // skip the [] in string[]
    const end = profileSrc.indexOf("];", start);
    const content = profileSrc.slice(start + 1, end);
    const requiredFields = (content.match(/"([^"]+)"/g) ?? []).map((s) =>
      s.replace(/"/g, ""),
    );
    expect(requiredFields.length).toBeGreaterThan(5);

    // Check that each required field appears as a key in CBK_GROUPS
    for (const field of requiredFields) {
      expect(previewSrc).toContain(`key: "${field}"`);
    }
  });
});
