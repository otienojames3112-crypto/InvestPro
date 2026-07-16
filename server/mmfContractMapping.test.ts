/**
 * Slice 8b — MMF contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `mmf` field contract into Ask AI's finding display and its
 * "Draft into review queue" path — MMF only. CBK/bank/market-asset are untouched
 * (their own slices come later). Still no role/permission/auth change of any kind:
 * this is the existing single admin role performing the same mapping → review →
 * approval WORKFLOW STEPS as before, just now against fixed contract fields for
 * MMF instead of arbitrary raw extraction.
 *
 * Two halves:
 *   - pure tests for the new projection helpers in shared/catalogueFieldContracts.ts
 *   - static-source-read tests for the AskAI.tsx wiring (this repo's established
 *     convention for client component behaviour — see askAiSearchCheckbox.test.ts,
 *     marketAssetSubtypeSelector.test.ts — no jsdom/testing-library, no DB, no
 *     network, no live OpenAI call).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogueFieldContract,
  projectFindingToContractDisplayRows,
  projectFindingToContractFigures,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan } from "../shared/researchPipeline";

const mmfContract = getCatalogueFieldContract("mmf")!;

function mmfFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Example Money Market Fund",
    issuer: "Example Asset Managers",
    sourceLabel: "Example AM Factsheet",
    sourceUrl: "https://www.example-am.co.ke/mmf/factsheet.pdf",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8b · projectFindingToContractFigures (MMF)", () => {
  it("maps real extracted figures to their canonical MMF contract keys", () => {
    const finding = mmfFinding({
      extractedFields: {
        ear: "11.85%",
        grossYield: "12.40%",
        whtRate: "15%",
        minInvestment: "1000",
        aumMillions: "4500",
        withdrawalNoticePeriod: "24 hours",
      },
    });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures).toEqual({
      // fundName is deliberately absent — it's envelope-routed (see the next
      // test) so draftFromFinding/buildPromotionPlan already read it from
      // finding.instrumentName, not from figures.
      ear: "11.85%",
      grossYield: "12.40%",
      wht: "15%",
      minInvestment: "1000",
      aum: "4500",
      withdrawalPeriod: "24 hours",
    });
  });

  it("fundName appearing above is a self-check bug guard — actually confirm fundName/fundManager/sourceLink/sourceAsOf are EXCLUDED (envelope-routed)", () => {
    const finding = mmfFinding({ extractedFields: { ear: "11.2%" } });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures.fundName).toBeUndefined();
    expect(figures.fundManager).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("dailyYield and riskProfile (missingRequiresMigration) never appear, even if the raw bag happens to carry those exact keys", () => {
    const finding = mmfFinding({
      extractedFields: { ear: "11.2%", dailyYield: "0.031%", riskProfile: "Low" },
    });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures.dailyYield).toBeUndefined();
    expect(figures.riskProfile).toBeUndefined();
    expect(figures.ear).toBe("11.2%");
  });

  it("netYield (computed) never appears, even if the raw bag happens to carry a 'netYield' key", () => {
    const finding = mmfFinding({ extractedFields: { ear: "11.2%", netYield: "9.5%" } });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures.netYield).toBeUndefined();
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = mmfFinding({
      extractedFields: {
        ear: "11.2%",
        randomNoiseField: "should never appear",
        fundManagerBioParagraph: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "mmf" }),
        _proposalType: "create",
        _candidatePhrases: "[]",
      },
    });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["ear"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = mmfFinding({ extractedFields: { ear: "missing_from_source", grossYield: "12.4%" } });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures.ear).toBeUndefined();
    expect(figures.grossYield).toBe("12.4%");
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = mmfFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(mmfContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures).toEqual({});
  });

  it("fund manager is read from the finding's issuer field (via the 'company' alias), not from extractedFields", () => {
    const finding = mmfFinding({ issuer: "Real Fund Manager Ltd", extractedFields: { ear: "11%" } });
    const figures = projectFindingToContractFigures(mmfContract, finding);
    // fundManager itself is envelope-routed and excluded (see above) — this test
    // instead proves the envelope value doesn't leak in under some OTHER key.
    expect(Object.values(figures)).not.toContain("Real Fund Manager Ltd");
  });
});

describe("Slice 8b · compatibility with the existing MMF approval gate and promotion path", () => {
  // Mirrors exactly how draftFromFinding/checkApprovalGate/buildPromotionPlan
  // are actually called: figures = what projectFindingToContractFigures sends;
  // name/issuer/source/asOf = the finding's own envelope fields (draftFromFinding
  // sets these independently of `figures`, unaffected by this slice).
  const finding = mmfFinding({
    instrumentName: "Example Money Market Fund",
    issuer: "Example Asset Managers",
    sourceLabel: "Example AM Factsheet",
    sourceUrl: "https://www.example-am.co.ke/mmf/factsheet.pdf",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      // Bare numeric strings, no "%" suffix — matches the format the pipeline's
      // own tests use with buildPromotionPlan (e.g. researchPipeline.round81.test.ts:
      // `figures: { grossYield: 13.2, ear: 13.9, managementFee: 2.0 }`). num()
      // (shared/researchPipeline.ts) does not strip "%", so a percent-suffixed
      // string is a data-format question orthogonal to this compatibility check.
      fundName: "Example Money Market Fund",
      company: "Example Asset Managers",
      ear: "11.85",
      grossYield: "12.40",
      managementFee: "2.00",
      minInvestment: "1000",
      source: "Example AM Factsheet",
      asOf: "2026-07-10",
      sourceUrl: "https://www.example-am.co.ke/mmf/factsheet.pdf",
    },
  });
  const figures = projectFindingToContractFigures(mmfContract, finding);

  it("ear, grossYield, managementFee and minInvestment — the figures-sourced approval-gate keys the MMF gate actually checks — all survive the contract projection", () => {
    // CATALOGUE_FIELD_RULES.mmf (shared/researchPipeline.ts) checks these four
    // keys, by these exact names, against the figures bag.
    expect(figures.ear).toBe("11.85");
    expect(figures.grossYield).toBe("12.40");
    expect(figures.managementFee).toBe("2.00");
    expect(figures.minInvestment).toBe("1000");
  });

  it("fundName/company/source/asOf/sourceUrl are correctly NOT expected in figures — the gate and draftFromFinding read those from the envelope, not figures", () => {
    // checkApprovalGate's mmf rules route name/company/source/asOf to args.name /
    // args.issuer / args.source / args.asOf (the envelope), never args.figures.
    // draftFromFinding independently sets sourceUrl/asOf from the finding's own
    // fields regardless of what's sent as `figures`. Confirms the envelope-routed
    // exclusion in ENVELOPE_ROUTED_CONTRACT_KEYS is correct, not a gap.
    expect(figures.fundName).toBeUndefined();
    expect(figures.company).toBeUndefined();
    expect(figures.source).toBeUndefined();
    expect(figures.asOf).toBeUndefined();
    expect(figures.sourceUrl).toBeUndefined();
  });

  it("FIXED (was a gap during pre-approval review): managementFee is now the 14th MMF contract field, so it survives the contract projection like every other genuine figure", () => {
    // mmf_funds.managementFee is NOT NULL, CATALOGUE_FIELD_RULES.mmf has required
    // figures.managementFee at the approval gate since before this initiative,
    // and buildPromotionPlan writes it straight into the column. It was missing
    // from the original 13-field product list; added as field #14 during Slice
    // 8b's pre-approval compatibility check (see shared/catalogueFieldContracts.ts's
    // note on the field, and server/catalogueFieldContracts.test.ts's file header).
    expect(figures.managementFee).toBe("2.00");
    expect(mmfContract.fields.some((f) => f.key === "managementFee")).toBe(true);
  });

  it("checkApprovalGate now PASSES a CREATE-path draft built from contract-projected figures — management fee flows through automatically, matching pre-8b raw-passthrough behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("regression guard: if managementFee is ever missing from the raw extraction, the gate still correctly reports it missing (the fix didn't disable the check, it just stopped the contract from swallowing a value that WAS there)", () => {
    const findingNoFee = mmfFinding({
      instrumentName: "Example Money Market Fund",
      issuer: "Example Asset Managers",
      sourceLabel: "Example AM Factsheet",
      extractedFields: { ear: "11.85", grossYield: "12.40", minInvestment: "1000" },
    });
    const figuresNoFee = projectFindingToContractFigures(mmfContract, findingNoFee);
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      figures: figuresNoFee,
      name: findingNoFee.instrumentName,
      issuer: findingNoFee.issuer,
      source: findingNoFee.sourceLabel,
      asOf: findingNoFee.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["management fee"]);
  });

  it("an EDIT-path draft (changeKind: 'edit') was always unaffected regardless of the managementFee fix — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "edit",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("buildPromotionPlan maps the contract-projected figures onto the correct mmf_funds payload keys for every field the contract DOES cover", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: finding.instrumentName,
      assetClass: "cash_mmf",
      issuer: finding.issuer,
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("mmf");
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.fundName).toBe("Example Money Market Fund");
    expect(plan.payload.company).toBe("Example Asset Managers");
    expect(plan.payload.ear).toBeCloseTo(11.85);
    expect(plan.payload.grossYield).toBeCloseTo(12.4);
    expect(plan.payload.minInvestment).toBe(1000);
    // Now that managementFee is a genuine contract field, it flows all the way
    // through to the mmf_funds payload too — this is the fix for the gap found
    // during pre-approval review, confirmed end to end.
    expect(plan.payload.managementFee).toBeCloseTo(2.0);
  });
});

describe("Slice 8b · projectFindingToContractDisplayRows (MMF)", () => {
  it("returns exactly the 14 MMF contract fields, in contract order, with matching labels", () => {
    const finding = mmfFinding();
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    expect(rows.length).toBe(mmfContract.fields.length);
    expect(rows.length).toBe(14); // 13 from the original product list + managementFee, added post-approval

    expect(rows.map((r) => r.key)).toEqual(mmfContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(mmfContract.fields.map((f) => f.label));
  });

  it("computed and missingRequiresMigration fields are ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = mmfFinding({
      extractedFields: { ear: "11.2%", netYield: "9.5%", dailyYield: "0.03%", riskProfile: "Low" },
    });
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    const netYieldRow = rows.find((r) => r.key === "netYield")!;
    const dailyYieldRow = rows.find((r) => r.key === "dailyYield")!;
    const riskProfileRow = rows.find((r) => r.key === "riskProfile")!;
    expect(netYieldRow.storageStatus).toBe("computed");
    expect(netYieldRow.value).toBeNull();
    expect(dailyYieldRow.storageStatus).toBe("missingRequiresMigration");
    expect(dailyYieldRow.value).toBeNull();
    expect(riskProfileRow.storageStatus).toBe("missingRequiresMigration");
    expect(riskProfileRow.value).toBeNull();
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = mmfFinding({ extractedFields: { ear: "11.85%" } });
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    expect(rows.find((r) => r.key === "ear")!.value).toBe("11.85%");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = mmfFinding();
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("Example AM Factsheet");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("fundName and fundManager surface from the envelope (instrumentName/issuer), not extractedFields", () => {
    const finding = mmfFinding({ instrumentName: "Real Fund", issuer: "Real Manager", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    expect(rows.find((r) => r.key === "fundName")!.value).toBe("Real Fund");
    expect(rows.find((r) => r.key === "fundManager")!.value).toBe("Real Manager");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = mmfFinding({ instrumentName: "X", issuer: null, sourceLabel: null, sourceUrl: null, extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(mmfContract, finding);
    expect(rows.find((r) => r.key === "minInvestment")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8b · FindingCard wiring", () => {
  it("imports the three new projection helpers from @shared/catalogueFieldContracts", () => {
    // AskAI.tsx uses CRLF line endings, so match line-by-line rather than
    // asserting an exact literal block with embedded \n.
    expect(askAi).toMatch(
      /import \{\r?\n\s*getCatalogueFieldContract,\r?\n\s*projectFindingToContractDisplayRows,\r?\n\s*projectFindingToContractFigures,\r?\n\} from "@shared\/catalogueFieldContracts";/,
    );
  });

  it("mmfContract is computed ONLY for scope === market_asset... no, for targetCatalogue === \"mmf\" — never for any other catalogue", () => {
    expect(findingCard).toContain('finding.targetCatalogue === "mmf" ? getCatalogueFieldContract("mmf") : null');
  });

  it("the fixed MMF fields block renders ONLY when mmfDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{mmfDisplayRows && \(/);
  });

  it("the 'Additional extracted details' label appears only alongside the MMF block, never unconditionally", () => {
    const idx = findingCard.indexOf("Additional extracted details");
    expect(idx).toBeGreaterThan(-1);
    const before = findingCard.slice(Math.max(0, idx - 120), idx);
    expect(before).toContain("mmfDisplayRows &&");
  });

  it("the draft mutation call projects MMF figures via the contract and passes them explicitly", () => {
    expect(findingCard).toContain(
      "const mmfFigures = mmfContract ? projectFindingToContractFigures(mmfContract, finding) : undefined;",
    );
    expect(findingCard).toContain("draft.mutate({ findingId: finding.id, figures: mmfFigures });");
  });

  it("non-MMF findings send undefined figures — draftFromFinding's existing raw-extractedFields default is completely unchanged for them", () => {
    // mmfFigures is undefined whenever mmfContract is null, i.e. whenever
    // targetCatalogue !== "mmf" — proven by the ternary itself (previous test).
    expect(findingCard).toContain("mmfContract ? projectFindingToContractFigures(mmfContract, finding) : undefined");
  });

  it("the existing grouped/flat extraction display (InstrumentProfilePreview + fallback) is completely UNCHANGED in source — still present, byte-identical", () => {
    expect(findingCard).toContain(
      "{/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}",
    );
    expect(findingCard).toContain("return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;");
    expect(findingCard).toContain("No figures extracted — identity only.");
  });

  it("CorrectFigureDialog is UNCHANGED by this slice — still uses fmtFields(raw extractedFields) for its field selector, not the contract", () => {
    const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
    const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));
    expect(dialog).toContain("const fields = fmtFields(finding.extractedFields);");
    expect(dialog).not.toContain("catalogueFieldContracts");
    expect(dialog).not.toContain("getCatalogueFieldContract");
  });

  it("no bank/cbk/market_asset contract lookups exist anywhere yet — this slice is MMF-only", () => {
    const contractCalls = [...askAi.matchAll(/getCatalogueFieldContract\([^)]*\)/g)].map((m) => m[0]);
    expect(contractCalls.length).toBeGreaterThan(0);
    for (const call of contractCalls) {
      expect(call).toContain('"mmf"');
    }
  });
});

describe("Slice 8b · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the new shared projection code", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    // Only check the Slice-8b addition, not the whole 8a file (which legitimately
    // never mentions roles either, but scoping tightens the guard's intent).
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
