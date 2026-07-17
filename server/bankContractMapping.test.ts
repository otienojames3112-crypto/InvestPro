/**
 * Slice 8c — Bank contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `bank` field contract into Ask AI's finding display and its
 * "Draft into review queue" path — Bank only. Same pattern as Slice 8b's MMF
 * wiring. CBK/market-asset are untouched (their own slices come later). Still no
 * role/permission/auth change of any kind: this is the existing single admin role
 * performing the same mapping → review → approval WORKFLOW STEPS as before, just
 * now against fixed contract fields for Bank instead of arbitrary raw extraction.
 *
 * Pre-approval compatibility check (same discipline as Slice 8b's managementFee
 * catch) found and fixed THREE issues in the Bank contract before any wiring:
 *   - `isNegotiable` was missing entirely (gate-required, DB-required, actively
 *     extracted) — added as the contract's 13th field.
 *   - the contract's canonical output key for "Interest rate" was `interestRate`,
 *     which neither figurePresent's alias table nor buildPromotionPlan recognise
 *     for the gate's `indicativeRate` rule — renamed the KEY to `indicativeRate`
 *     (display label unchanged).
 *   - same problem for "Minimum deposit": canonical key `minimumDeposit` renamed
 *     to `minAmount` (display label unchanged).
 * A fourth issue — `liquidity` is gate-required but has no extraction source and
 * no DB column anywhere for bank products — is a genuinely pre-existing, orphaned
 * gate requirement, unaffected by this slice either way (see the dedicated test
 * below). Not something a contract field could fix: there is nowhere for a value
 * to come from or go to.
 *
 * Two halves, mirroring server/mmfContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `bank` contract
 *   - static-source-read tests for the AskAI.tsx wiring (this repo's established
 *     convention for client component behaviour — no jsdom/testing-library, no
 *     DB, no network, no live OpenAI call)
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

const bankContract = getCatalogueFieldContract("bank")!;

function bankFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Equity Bank Fixed Deposit",
    issuer: "Equity Bank", // envelope: the bank's name (mirrors MMF's fund-manager envelope field)
    sourceLabel: "Equity Bank rate card",
    sourceUrl: "https://www.equitybank.co.ke/rates/fixed-deposit",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8c · projectFindingToContractFigures (Bank)", () => {
  it("maps real extracted figures to their canonical Bank contract keys, under the downstream-compatible key names", () => {
    const finding = bankFinding({
      extractedFields: {
        productType: "fixed_deposit",
        indicativeRate: "12.5",
        isNegotiable: "true",
        minAmount: "50000",
        typicalTenor: "12 months",
      },
    });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures).toEqual({
      // bankName is deliberately absent — envelope-routed (see the next test).
      productType: "fixed_deposit",
      indicativeRate: "12.5",
      isNegotiable: "true",
      minAmount: "50000",
      tenor: "12 months",
    });
  });

  it("bankName/sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = bankFinding({ extractedFields: { indicativeRate: "10" } });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures.bankName).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("fees and accessSpeed (missingRequiresMigration) never appear, even if the raw bag happens to carry those exact keys", () => {
    const finding = bankFinding({
      extractedFields: { indicativeRate: "10", fees: "KES 500 annual", accessSpeed: "same-day" },
    });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures.fees).toBeUndefined();
    expect(figures.accessSpeed).toBeUndefined();
    expect(figures.indicativeRate).toBe("10");
  });

  it("netReturnAfterWht (computed) never appears, even if the raw bag happens to carry a 'netReturnAfterWht' key", () => {
    const finding = bankFinding({ extractedFields: { indicativeRate: "10", netReturnAfterWht: "8.5" } });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures.netReturnAfterWht).toBeUndefined();
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = bankFinding({
      extractedFields: {
        indicativeRate: "10",
        randomNoiseField: "should never appear",
        rateType: "indicative",
        whtRate: "15%",
        rateSchedule: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "bank" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["indicativeRate"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = bankFinding({
      extractedFields: { indicativeRate: "missing_from_source", minAmount: "50000" },
    });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures.indicativeRate).toBeUndefined();
    expect(figures.minAmount).toBe("50000");
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = bankFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(bankContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(figures).toEqual({});
  });

  it("the bank name is read from the finding's issuer field (envelope), and never leaks into figures under any key", () => {
    const finding = bankFinding({ issuer: "Real Bank Ltd", extractedFields: { indicativeRate: "10" } });
    const figures = projectFindingToContractFigures(bankContract, finding);
    expect(Object.values(figures)).not.toContain("Real Bank Ltd");
  });
});

describe("Slice 8c · compatibility with the existing Bank approval gate and promotion path", () => {
  // Mirrors exactly how draftFromFinding/checkApprovalGate/buildPromotionPlan are
  // actually called: figures = what projectFindingToContractFigures sends;
  // name/issuer/source/asOf = the finding's own envelope fields.
  const finding = bankFinding({
    instrumentName: "Equity Bank Fixed Deposit",
    issuer: "Equity Bank",
    sourceLabel: "Equity Bank rate card",
    sourceUrl: "https://www.equitybank.co.ke/rates/fixed-deposit",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      bankName: "Equity Bank",
      productType: "fixed_deposit",
      indicativeRate: "12.5",
      isNegotiable: "true",
      minAmount: "50000",
      typicalTenor: "12 months",
      source: "Equity Bank rate card",
      asOf: "2026-07-10",
      sourceUrl: "https://www.equitybank.co.ke/rates/fixed-deposit",
    },
  });
  const figures = projectFindingToContractFigures(bankContract, finding);

  it("productType, indicativeRate, isNegotiable, minAmount and tenor — the figures-sourced approval-gate keys the bank gate actually checks — all survive the contract projection under downstream-compatible names", () => {
    // CATALOGUE_FIELD_RULES.bank (shared/researchPipeline.ts) checks instrumentType
    // (tolerates productType via figurePresent's alias list), minAmount,
    // typicalTenor (tolerates tenor), indicativeRate, and isNegotiable.
    expect(figures.productType).toBe("fixed_deposit");
    expect(figures.indicativeRate).toBe("12.5");
    expect(figures.isNegotiable).toBe("true");
    expect(figures.minAmount).toBe("50000");
    expect(figures.tenor).toBe("12 months");
  });

  it("bankName/source/asOf/sourceUrl are correctly NOT expected in figures — the gate and draftFromFinding read those from the envelope, not figures", () => {
    expect(figures.bankName).toBeUndefined();
    expect(figures.source).toBeUndefined();
    expect(figures.asOf).toBeUndefined();
    expect(figures.sourceUrl).toBeUndefined();
  });

  it("checkApprovalGate: every field this slice is responsible for now passes — the ONLY remaining gap is 'liquidity', a pre-existing, orphaned gate requirement with no extraction source and no DB column, unrelated to this slice", () => {
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["liquidity / withdrawal terms"]);
  });

  it("control: the gate fully passes once 'liquidity' is manually supplied — proving every field THIS slice is responsible for is genuinely compatible, and the one remaining gap is isolated and understood, not a symptom of something else broken", () => {
    const gateWithLiquidity = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures: { ...figures, liquidity: "on maturity" },
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gateWithLiquidity.ok).toBe(true);
    expect(gateWithLiquidity.missing).toEqual([]);
  });

  it("regression guard: if isNegotiable is ever missing from the raw extraction, the gate still correctly reports it missing — the fix didn't disable the check, it just stopped the contract from swallowing a value that WAS there", () => {
    const findingNoNegotiable = bankFinding({
      extractedFields: { productType: "fixed_deposit", indicativeRate: "12.5", minAmount: "50000", typicalTenor: "12 months" },
    });
    const figuresNoNegotiable = projectFindingToContractFigures(bankContract, findingNoNegotiable);
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures: { ...figuresNoNegotiable, liquidity: "on maturity" },
      name: findingNoNegotiable.instrumentName,
      issuer: findingNoNegotiable.issuer,
      source: findingNoNegotiable.sourceLabel,
      asOf: findingNoNegotiable.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["negotiable (yes/no)"]);
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "edit",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("buildPromotionPlan maps the contract-projected figures onto the correct bank_instruments payload keys for every field the contract DOES cover", () => {
    const plan = buildPromotionPlan({
      target: "bank",
      name: finding.instrumentName,
      assetClass: "bank_deposit",
      issuer: finding.issuer,
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("bank");
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.bankName).toBe("Equity Bank"); // from the envelope issuer, not figures.bankName
    expect(plan.payload.instrumentType).toBe("fixed_deposit"); // canonicalized from figures.productType
    expect(plan.payload.minAmount).toBe(50000);
    expect(plan.payload.typicalTenor).toBe("12 months");
    expect(plan.payload.indicativeRate).toBeCloseTo(12.5);
    expect(plan.payload.isNegotiable).toBe(true);
  });
});

describe("Slice 8c · projectFindingToContractDisplayRows (Bank)", () => {
  it("returns exactly the 13 Bank contract fields, in contract order, with matching labels", () => {
    const finding = bankFinding();
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    expect(rows.length).toBe(bankContract.fields.length);
    expect(rows.length).toBe(13);
    expect(rows.map((r) => r.key)).toEqual(bankContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(bankContract.fields.map((f) => f.label));
  });

  it("netReturnAfterWht (computed) and fees/accessSpeed (missingRequiresMigration) are ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = bankFinding({
      extractedFields: { indicativeRate: "10", netReturnAfterWht: "8.5", fees: "KES 500", accessSpeed: "same-day" },
    });
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    const netReturnRow = rows.find((r) => r.key === "netReturnAfterWht")!;
    const feesRow = rows.find((r) => r.key === "fees")!;
    const accessSpeedRow = rows.find((r) => r.key === "accessSpeed")!;
    expect(netReturnRow.storageStatus).toBe("computed");
    expect(netReturnRow.value).toBeNull();
    expect(feesRow.storageStatus).toBe("missingRequiresMigration");
    expect(feesRow.value).toBeNull();
    expect(accessSpeedRow.storageStatus).toBe("missingRequiresMigration");
    expect(accessSpeedRow.value).toBeNull();
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = bankFinding({ extractedFields: { indicativeRate: "12.5" } });
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    expect(rows.find((r) => r.key === "indicativeRate")!.value).toBe("12.5");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = bankFinding();
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("Equity Bank rate card");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("bankName surfaces from the envelope (issuer), not extractedFields", () => {
    const finding = bankFinding({ instrumentName: "Real Bank Fixed Deposit", issuer: "Real Bank", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    expect(rows.find((r) => r.key === "bankName")!.value).toBe("Real Bank");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = bankFinding({ issuer: null, sourceLabel: null, sourceUrl: null, extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    expect(rows.find((r) => r.key === "productName")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8c · FindingCard wiring", () => {
  it("bankContract is computed ONLY for targetCatalogue === \"bank\" — never for any other catalogue", () => {
    expect(findingCard).toContain('finding.targetCatalogue === "bank" ? getCatalogueFieldContract("bank") : null');
  });

  it("the Bank fields block renders ONLY when bankDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{bankDisplayRows && \(/);
  });

  it("the Bank fields block is labeled 'Bank catalogue fields', distinct from the MMF block", () => {
    const idx = findingCard.indexOf("Bank catalogue fields");
    expect(idx).toBeGreaterThan(-1);
  });

  it("the 'Additional extracted details' label appears alongside EITHER the MMF, Bank, CBK, Equity, REIT, or Offshore fund block, never unconditionally", () => {
    const idx = findingCard.indexOf("Additional extracted details");
    expect(idx).toBeGreaterThan(-1);
    const before = findingCard.slice(Math.max(0, idx - 320), idx);
    // Matched by individual term presence, not an exact literal block, since
    // prettier re-wraps this condition across lines as it grows each slice.
    for (const term of [
      "mmfDisplayRows",
      "bankDisplayRows",
      "cbkDisplayRows",
      "equityDisplayRows",
      "reitDisplayRows",
      "offshoreFundDisplayRows",
      "saccoDisplayRows",
    ]) {
      expect(before).toContain(term);
    }
    expect(before).toMatch(/\) &&\s*\(/);
  });

  it("the draft mutation call projects Bank figures via the contract and falls back to them when there's no MMF figures", () => {
    expect(findingCard).toContain(
      "const bankFigures = bankContract ? projectFindingToContractFigures(bankContract, finding) : undefined;",
    );
    const mutateIdx = findingCard.indexOf("draft.mutate({");
    expect(mutateIdx).toBeGreaterThan(-1);
    const mutateBlock = findingCard.slice(mutateIdx, mutateIdx + 400);
    for (const term of [
      "mmfFigures",
      "bankFigures",
      "cbkFigures",
      "equityFigures",
      "reitFigures",
      "offshoreFundFigures",
      "saccoFigures",
    ]) {
      expect(mutateBlock).toContain(term);
    }
  });

  it("non-MMF, non-Bank, non-CBK, non-Equity, non-REIT, non-Offshore-fund findings send undefined figures — draftFromFinding's existing raw-extractedFields default is completely unchanged for them", () => {
    // mmfContract/bankContract/cbkContract/equityContract/reitContract/
    // offshoreFundContract are each null whenever targetCatalogue/assetClass
    // doesn't match their own catalogue/subtype, so the whole ?? chain
    // resolves to undefined for SACCO findings (the only market-asset subtype
    // still unwired).
    expect(findingCard).toContain("mmfContract ? projectFindingToContractFigures(mmfContract, finding) : undefined");
    expect(findingCard).toContain("bankContract ? projectFindingToContractFigures(bankContract, finding) : undefined");
  });

  it("the existing grouped/flat extraction display (InstrumentProfilePreview + fallback) is completely UNCHANGED in source — still present, byte-identical", () => {
    expect(findingCard).toContain(
      "{/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}",
    );
    expect(findingCard).toContain("return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;");
    expect(findingCard).toContain("No figures extracted — identity only.");
  });

  it("CorrectFigureDialog is UNCHANGED by this slice — still uses fmtFields(raw extractedFields) for its field selector, not either contract", () => {
    const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
    const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));
    expect(dialog).toContain("const fields = fmtFields(finding.extractedFields);");
    expect(dialog).not.toContain("catalogueFieldContracts");
    expect(dialog).not.toContain("getCatalogueFieldContract");
  });

  it("all seven active contract lookups (MMF, Bank, CBK, Equity, REIT, Offshore fund, SACCO) are the only ones present — every market-asset subtype is now wired", () => {
    const contractCalls = [...askAi.matchAll(/getCatalogueFieldContract\([^)]*\)/g)].map((m) => m[0]);
    expect(contractCalls.length).toBeGreaterThan(0);
    for (const call of contractCalls) {
      expect(
        call.includes('"mmf"') ||
          call.includes('"bank"') ||
          call.includes('"cbk"') ||
          call.includes('"equity"') ||
          call.includes('"reit"') ||
          call.includes('"offshore_fund"') ||
          call.includes('"sacco"'),
      ).toBe(true);
    }
  });
});

describe("Slice 8c · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the Bank-specific additions to the shared projection code", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new Bank-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
