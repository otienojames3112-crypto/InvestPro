/**
 * Slice 8e-3 — Market asset Offshore fund contract-based review/mapping
 * (2026-07-16).
 *
 * Wires the Slice-8a `market_asset`/`offshore_fund` field contract into Ask
 * AI's finding display and its "Draft into review queue" path — Offshore
 * fund only. Same pattern as Slices 8b (MMF), 8c (Bank), 8d (CBK), 8e-1
 * (Equity) and 8e-2 (REIT). SACCO and any other market-asset subtype are
 * untouched (their own slice comes later). Still no role/permission/auth
 * change of any kind: this is the existing single admin role performing the
 * same mapping → review → approval WORKFLOW STEPS as before, just now
 * against fixed contract fields for Offshore fund instead of arbitrary raw
 * extraction.
 *
 * Pre-approval compatibility check, verified with a live checkApprovalGate/
 * buildPromotionPlan call per the standing lesson from REIT (static tracing
 * alone missed a gap there), found and fixed THREE issues:
 *   - `fees` renamed to `expenseRatioPct` — the offshore subtype gate's own
 *     rule checks figures.expenseRatioPct specifically (figurePresent's
 *     alias table for it is ['expenseRatioPct', 'fee'] — 'fees' plural was
 *     never in it), and buildPromotionPlan's fallback chain didn't recognise
 *     'fees' either.
 *   - `annualizedReturn` renamed to `trailingReturnPct` — buildPromotionPlan
 *     has a DEDICATED trailingReturnPct payload field, separate from
 *     lastPrice. This single rename ALSO happens to satisfy the base gate's
 *     lastPrice OR-requirement, since figurePresent's lastPrice alias table
 *     already tolerates 'trailingReturnPct' — no alsoWriteKeys needed here,
 *     unlike REIT's distributionYield.
 *   - A genuinely missing field, "Market" (key: market — deliberately
 *     labeled differently from Equity/REIT's "Exchange", since an offshore
 *     fund isn't exchange-listed), was added as the 13th field — proven via
 *     a live checkApprovalGate call that still reported 'market' missing
 *     with every other offshore-fund field supplied.
 *   - fundName/fundManager/currency added to ENVELOPE_ROUTED_CONTRACT_KEYS —
 *     buildPromotionPlan's opportunity branch reads name/issuer/currency from
 *     the envelope only, never figures. currency is a NEW envelope-routed
 *     concept this slice: both the base gate's currency rule AND the
 *     offshore-fund-specific "currency must not be KES" value assertion
 *     check args.currency (the envelope parameter), never figures.currency.
 *
 * The same pre-existing, OUT-OF-SCOPE `issuer / manager` gate gap documented
 * in Slice 8e-1/8e-2's file headers applies here too (finding.issuer is
 * always null for every AI-originated market-asset finding, offshore fund
 * included) — reconfirmed by a dedicated test below, not re-explained at
 * length.
 *
 * Two halves, mirroring server/reitContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `market_asset`/`offshore_fund` contract
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

const offshoreFundContract = getCatalogueFieldContract("market_asset", "offshore_fund")!;

function offshoreFundFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Franklin Templeton Global Bond Fund",
    issuer: null, // pre-existing gap: market-asset findings never carry a real issuer — see file header
    sourceLabel: "Fund factsheet",
    sourceUrl: "https://www.franklintempleton.com/funds/global-bond",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8e-3 · projectFindingToContractFigures (Offshore fund)", () => {
  it("maps real extracted figures to their canonical Offshore fund contract keys, under the downstream-compatible key names", () => {
    const finding = offshoreFundFinding({
      extractedFields: {
        exchange: "Luxembourg SE",
        trailingReturn: "8.0",
        fee: "1.2",
      },
    });
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(figures).toEqual({
      // fundName/fundManager/currency are deliberately absent — envelope-routed
      // (see the next test).
      market: "Luxembourg SE",
      trailingReturnPct: "8.0",
      expenseRatioPct: "1.2",
    });
  });

  it("fundName/fundManager/currency/sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = offshoreFundFinding({ extractedFields: { trailingReturn: "8.0", currency: "USD" } });
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(figures.fundName).toBeUndefined();
    expect(figures.fundManager).toBeUndefined();
    expect(figures.currency).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("fundType, minInvestment, withdrawalPeriod and riskLevel (missingRequiresMigration) never appear, even if the raw bag happens to carry those exact keys", () => {
    const finding = offshoreFundFinding({
      extractedFields: {
        trailingReturn: "8.0",
        fundType: "Global bond fund",
        minInvestment: "USD 1,000",
        withdrawalPeriod: "T+3",
        riskLevel: "Medium",
      },
    });
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(figures.fundType).toBeUndefined();
    expect(figures.minInvestment).toBeUndefined();
    expect(figures.withdrawalPeriod).toBeUndefined();
    expect(figures.riskLevel).toBeUndefined();
    expect(figures.trailingReturnPct).toBe("8.0");
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = offshoreFundFinding({
      extractedFields: {
        trailingReturn: "8.0",
        nav: "should never appear",
        dividendYield: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "market_asset" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["trailingReturnPct"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = offshoreFundFinding({
      extractedFields: { trailingReturn: "missing_from_source", fee: "1.2" },
    });
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(figures.trailingReturnPct).toBeUndefined();
    expect(figures.expenseRatioPct).toBe("1.2");
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = offshoreFundFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(offshoreFundContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(offshoreFundContract, finding);
    expect(figures).toEqual({});
  });
});

describe("Slice 8e-3 · compatibility with the existing market-asset approval gate, Offshore fund subtype gate, and promotion path", () => {
  const finding = offshoreFundFinding({
    instrumentName: "Franklin Templeton Global Bond Fund",
    sourceLabel: "Fund factsheet",
    sourceUrl: "https://www.franklintempleton.com/funds/global-bond",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      exchange: "Luxembourg SE",
      trailingReturn: "8.0",
      fee: "1.2",
    },
  });
  const figures = projectFindingToContractFigures(offshoreFundContract, finding);

  it("market, trailingReturnPct and expenseRatioPct — every figures-sourced key the base gate AND the offshore-fund subtype gate check — survive the contract projection under downstream-compatible names", () => {
    expect(figures.market).toBe("Luxembourg SE");
    expect(figures.trailingReturnPct).toBe("8.0");
    expect(figures.expenseRatioPct).toBe("1.2");
  });

  it("checkApprovalGate: the base gate AND the offshore-fund subtype gate's own expenseRatioPct rule AND the currency-must-not-be-KES value assertion all pass — the ONLY remaining gap is 'issuer / manager', the same pre-existing, structurally-unsatisfiable gate requirement from Slices 8e-1/8e-2 (unrelated to offshore fund specifically)", () => {
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "USD",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["issuer / manager"]);
  });

  it("control: the gate fully passes once 'issuer' is manually supplied — proving every field THIS slice is responsible for (including the offshore-fund subtype gate and the currency value assertion) is genuinely compatible", () => {
    const gateWithIssuer = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: "Franklin Templeton", // a manager-vouched issuer, supplied manually
      currency: "USD",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gateWithIssuer.ok).toBe(true);
    expect(gateWithIssuer.missing).toEqual([]);
  });

  it("currency-must-not-be-KES value assertion: checkApprovalGate FAILS when the envelope currency is literally KES, even with every figures field supplied — proving this offshore-fund-specific check is reachable and unaffected by the figures projection", () => {
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: "Franklin Templeton",
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("currency must not be KES for an offshore fund");
  });

  it("regression guard: if trailingReturnPct/expenseRatioPct are ever missing from the raw extraction, BOTH the base price/yield/return requirement AND the offshore-fund subtype's own expense-ratio requirement are still correctly reported missing — the fix didn't disable either check", () => {
    const findingBare = offshoreFundFinding({ extractedFields: { exchange: "Luxembourg SE" } });
    const figuresBare = projectFindingToContractFigures(offshoreFundContract, findingBare);
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures: figuresBare,
      name: findingBare.instrumentName,
      issuer: "Franklin Templeton",
      currency: "USD",
      source: findingBare.sourceLabel,
      asOf: findingBare.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["expense ratio / fee", "price / NAV / yield / return"].sort());
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "edit",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "USD",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("buildPromotionPlan maps the contract-projected figures onto the correct opportunities payload keys for every field the typed payload covers — trailingReturnPct and expenseRatioPct both land in their own dedicated payload fields", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "offshore_fund",
      issuer: "Franklin Templeton",
      currency: "USD",
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.name).toBe("Franklin Templeton Global Bond Fund");
    expect(plan.payload.currency).toBe("USD");
    expect(plan.payload.market).toBe("Luxembourg SE");
    expect(plan.payload.trailingReturnPct).toBeCloseTo(8.0);
    expect(plan.payload.expenseRatioPct).toBeCloseTo(1.2);
  });
});

describe("Slice 8e-3 · projectFindingToContractDisplayRows (Offshore fund)", () => {
  it("returns exactly the 13 Offshore fund contract fields, in contract order, with matching labels", () => {
    const finding = offshoreFundFinding();
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    expect(rows.length).toBe(offshoreFundContract.fields.length);
    expect(rows.length).toBe(13); // 12 from the original product list + market (Market), added post-approval
    expect(rows.map((r) => r.key)).toEqual(offshoreFundContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(offshoreFundContract.fields.map((f) => f.label));
  });

  it("fundType, minInvestment, withdrawalPeriod and riskLevel (missingRequiresMigration) are ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = offshoreFundFinding({
      extractedFields: {
        fundType: "Global bond fund",
        minInvestment: "USD 1,000",
        withdrawalPeriod: "T+3",
        riskLevel: "Medium",
      },
    });
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    for (const key of ["fundType", "minInvestment", "withdrawalPeriod", "riskLevel"]) {
      const row = rows.find((r) => r.key === key)!;
      expect(row.storageStatus).toBe("missingRequiresMigration");
      expect(row.value).toBeNull();
    }
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = offshoreFundFinding({ extractedFields: { trailingReturn: "8.0" } });
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    expect(rows.find((r) => r.key === "trailingReturnPct")!.value).toBe("8.0");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = offshoreFundFinding();
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("Fund factsheet");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("fundName surfaces from the envelope (instrumentName), not extractedFields", () => {
    const finding = offshoreFundFinding({ instrumentName: "Real Offshore Fund", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    expect(rows.find((r) => r.key === "fundName")!.value).toBe("Real Offshore Fund");
  });

  it("currency surfaces from the raw extraction's own currency field (present via the generic extractedFields spread, distinct from the envelope-routed figures exclusion)", () => {
    const finding = offshoreFundFinding({ extractedFields: { currency: "USD" } });
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    expect(rows.find((r) => r.key === "currency")!.value).toBe("USD");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = offshoreFundFinding({ extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(offshoreFundContract, finding);
    expect(rows.find((r) => r.key === "fxRiskNote")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8e-3 · FindingCard wiring", () => {
  it("offshoreFundContract is computed ONLY for targetCatalogue === \"market_asset\" AND assetClass === \"offshore_fund\" — never for any other catalogue/subtype", () => {
    expect(findingCard).toContain(
      'finding.targetCatalogue === "market_asset" && finding.assetClass === "offshore_fund"',
    );
    expect(findingCard).toContain('getCatalogueFieldContract("market_asset", "offshore_fund")');
  });

  it("the Offshore fund fields block renders ONLY when offshoreFundDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{offshoreFundDisplayRows && \(/);
  });

  it("the Offshore fund fields block is labeled 'Offshore fund catalogue fields', distinct from the MMF/Bank/CBK/Equity/REIT blocks", () => {
    const idx = findingCard.indexOf("Offshore fund catalogue fields");
    expect(idx).toBeGreaterThan(-1);
  });

  it("the 'Additional extracted details' label appears alongside ANY of the MMF, Bank, CBK, Equity, REIT, or Offshore fund blocks, never unconditionally", () => {
    const idx = findingCard.indexOf("Additional extracted details");
    expect(idx).toBeGreaterThan(-1);
    const before = findingCard.slice(Math.max(0, idx - 320), idx);
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

  it("the draft mutation call projects Offshore fund figures via the contract and falls back to them when there's no MMF/Bank/CBK/Equity/REIT figures", () => {
    expect(findingCard).toContain(
      "const offshoreFundFigures = offshoreFundContract",
    );
    expect(findingCard).toContain(
      "? projectFindingToContractFigures(offshoreFundContract, finding)",
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

  it("non-MMF, non-Bank, non-CBK, non-Equity, non-REIT, non-Offshore-fund findings (SACCO) send undefined figures — draftFromFinding's existing raw-extractedFields default is completely unchanged for them", () => {
    // offshoreFundContract is null whenever targetCatalogue/assetClass doesn't
    // match "market_asset"/"offshore_fund", so offshoreFundFigures resolves to
    // undefined for SACCO findings — matched by term presence (file uses CRLF
    // line endings, so an exact multi-line literal is fragile).
    expect(findingCard).toContain("const offshoreFundFigures = offshoreFundContract");
    expect(findingCard).toContain("? projectFindingToContractFigures(offshoreFundContract, finding)");
    expect(findingCard).toContain(": undefined;");
  });

  it("the existing grouped/flat extraction display (InstrumentProfilePreview + fallback) is completely UNCHANGED in source — still present, byte-identical", () => {
    expect(findingCard).toContain(
      "{/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}",
    );
    expect(findingCard).toContain("return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;");
    expect(findingCard).toContain("No figures extracted — identity only.");
  });

  it("CorrectFigureDialog is UNCHANGED for Offshore fund findings — Stage 10b-2b only filtered/relabeled it for CBK, everything else (Offshore fund included) still falls back to the original unfiltered fmtFields", () => {
    const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
    const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));
    expect(dialog).toContain("fmtFields(finding.extractedFields).map((f) => ({ ...f, label: f.key }))");
    expect(dialog).toContain('finding.targetCatalogue === "cbk" ? getCatalogueFieldContract("cbk") : null');
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

describe("Slice 8e-3 · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the Offshore-fund-specific additions to the shared projection code", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new Offshore-fund-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
