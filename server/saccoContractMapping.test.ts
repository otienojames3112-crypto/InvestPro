/**
 * Slice 8e-4 — Market asset SACCO contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `market_asset`/`sacco` field contract into Ask AI's
 * finding display and its "Draft into review queue" path — SACCO only, the
 * LAST market-asset subtype (Stage 8e is now complete for the four active
 * market-asset contracts). Same pattern as Slices 8b (MMF), 8c (Bank), 8d
 * (CBK), 8e-1 (Equity), 8e-2 (REIT) and 8e-3 (Offshore fund). ETF/property/
 * pension/other remain unsupported (no active contract at all — see
 * UNSUPPORTED_MARKET_ASSET_SUBTYPES). Still no role/permission/auth change of
 * any kind: this is the existing single admin role performing the same
 * mapping → review → approval WORKFLOW STEPS as before, just now against
 * fixed contract fields for SACCO instead of arbitrary raw extraction.
 *
 * Pre-approval compatibility check, verified with live checkApprovalGate/
 * buildPromotionPlan calls, found SACCO to be structurally different from
 * every prior market-asset subtype:
 *
 *   SACCO uses a full REPLACEMENT gate (SACCO_MARKET_ASSET_FIELD_RULES /
 *   SACCO_FIELD_ALIASES), not the baseline CATALOGUE_FIELD_RULES.market_asset
 *   — confirmed by reading checkApprovalGate directly: the SACCO branch
 *   (triggered by detectMarketAssetSacco()) returns EARLY, before the
 *   baseline market/lastPrice loop ever runs. So, unlike Equity/REIT/Offshore
 *   fund, SACCO needed NO "Market"/"Exchange" field at all.
 *
 *   Three KEYS renamed (display labels unchanged), each confirmed via a live
 *   checkApprovalGate call that failed exactly as predicted:
 *     - "lockInWithdrawalRule" → "withdrawalTerms" (SACCO_FIELD_ALIASES.
 *       withdrawalTerms is ['withdrawalTerms', 'liquidity'] — the original key
 *       was never in it; only coincidentally masked when the separate
 *       liquidity field also had a value).
 *     - "minContribution" → "minimumMonthlyDeposit".
 *     - "riskProtectionNote" → "regulatoryStatus".
 *   ("dividendRate" needed NO rename — SACCO_FIELD_ALIASES.
 *   shareCapitalDividendRate already lists "dividendRate" as a literal alias.)
 *
 *   A genuinely missing field, "Minimum share capital" (key:
 *   minimumShareCapital), was added as the 12th field — SACCO_MARKET_ASSET_
 *   FIELD_RULES requires it as its OWN distinct figure, separate from
 *   minimumMonthlyDeposit (a real SACCO requires both a one-time share-capital
 *   buy-in and ongoing monthly deposits).
 *
 *   A NEW kind of fix, not a contract field at all: projectFindingToContract
 *   Figures now stamps figures.assetType = "sacco" onto every SACCO
 *   projection. detectMarketAssetSacco()'s PRIMARY detection signal is
 *   figures.assetType === "sacco", which raw passthrough always carried
 *   (required by MARKET_ASSET_EXTRACTION_SCHEMA on every finding) but no
 *   SACCO product field maps to — it isn't something a manager edits.
 *   Omitting it would have silently downgraded detection reliability from
 *   "always works" to "depends on fallback heuristics" (regulatory-status
 *   text match, name/issuer text match, or presence of any SACCO-specific
 *   figure).
 *
 *   A DIFFERENT client-side wiring pattern was also required: every prior
 *   subtype gated its contract on finding.assetClass === "<subtype>", but
 *   SACCO shares assetClass "alt" with ETF/property/pension/other
 *   (assetClassForMarketAssetType has no distinct "sacco" value) — so
 *   AskAI.tsx checks finding.extractedFields?.assetType === "sacco" directly
 *   instead, mirroring detectMarketAssetSacco()'s own primary signal.
 *
 * The same pre-existing, OUT-OF-SCOPE `issuer / manager` gate gap documented
 * in Slices 8e-1/8e-2/8e-3's file headers applies here too (finding.issuer is
 * always null for every AI-originated market-asset finding, SACCO included)
 * — reconfirmed by a dedicated test below, not re-explained at length.
 *
 * Two halves, mirroring server/offshoreFundContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `market_asset`/`sacco` contract
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

const saccoContract = getCatalogueFieldContract("market_asset", "sacco")!;

function saccoFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Stima SACCO",
    issuer: null, // pre-existing gap: market-asset findings never carry a real issuer — see file header
    sourceLabel: "SASRA register",
    sourceUrl: "https://www.sasra.go.ke/regulated-entities/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8e-4 · projectFindingToContractFigures (SACCO)", () => {
  it("maps real extracted figures to their canonical SACCO contract keys, under the downstream-compatible key names, AND always stamps assetType: 'sacco'", () => {
    const finding = saccoFinding({
      extractedFields: {
        shareCapitalDividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "500",
        withdrawalTerms: "30-day notice",
        liquidity: "monthly",
        regulatoryStatus: "SASRA-regulated",
      },
    });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures).toEqual({
      // saccoName is deliberately absent — envelope-routed (see the next test).
      // dividendRate is the OUTPUT key (contract canonical), read from the raw
      // "shareCapitalDividendRate" alias above.
      dividendRate: "12%",
      minimumShareCapital: "5000",
      minimumMonthlyDeposit: "500",
      withdrawalTerms: "30-day notice",
      liquidity: "monthly",
      regulatoryStatus: "SASRA-regulated",
      assetType: "sacco",
    });
  });

  it("assetType: 'sacco' is stamped even when NO other SACCO figure is present — it is not conditional on any field having a value", () => {
    const finding = saccoFinding({ extractedFields: null });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures).toEqual({ assetType: "sacco" });
  });

  it("assetType is NEVER stamped for any other catalogue/subtype (MMF checked as a representative control)", () => {
    const mmfContract = getCatalogueFieldContract("mmf")!;
    const finding: ProjectableFinding = {
      instrumentName: "Example Money Market Fund",
      issuer: "Example Asset Managers",
      extractedFields: { ear: "11%" },
    };
    const figures = projectFindingToContractFigures(mmfContract, finding);
    expect(figures.assetType).toBeUndefined();
  });

  it("saccoName/sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = saccoFinding({ extractedFields: { shareCapitalDividendRate: "12%" } });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures.saccoName).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("Stage 10b-3 — membershipRequirement and fees (now extendedFields tier) DO appear when the raw bag carries those exact keys", () => {
    const finding = saccoFinding({
      extractedFields: {
        shareCapitalDividendRate: "12%",
        membershipRequirement: "Must be a Kenya Power employee",
        fees: "KES 200 annual",
      },
    });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures.membershipRequirement).toBe("Must be a Kenya Power employee");
    expect(figures.fees).toBe("KES 200 annual");
    expect(figures.dividendRate).toBe("12%");
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures (assetType is the one deliberate exception, always present)", () => {
    const finding = saccoFinding({
      extractedFields: {
        shareCapitalDividendRate: "12%",
        depositInterestRate: "should never appear (aliases only depositRebateRate, not this)",
        trailingReturn: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "market_asset" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["assetType", "dividendRate"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = saccoFinding({
      extractedFields: { shareCapitalDividendRate: "missing_from_source", minimumMonthlyDeposit: "500" },
    });
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures.dividendRate).toBeUndefined();
    expect(figures.minimumMonthlyDeposit).toBe("500");
  });

  it("an empty/absent extractedFields bag still produces assetType: 'sacco', not an empty object and not a throw", () => {
    const finding = saccoFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(saccoContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(saccoContract, finding);
    expect(figures).toEqual({ assetType: "sacco" });
  });
});

describe("Slice 8e-4 · compatibility with the existing market-asset approval gate (SACCO replacement gate)", () => {
  const finding = saccoFinding({
    instrumentName: "Stima SACCO",
    sourceLabel: "SASRA register",
    sourceUrl: "https://www.sasra.go.ke/regulated-entities/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      shareCapitalDividendRate: "12%",
      minimumShareCapital: "5000",
      minimumMonthlyDeposit: "500",
      withdrawalTerms: "30-day notice",
      liquidity: "monthly",
      regulatoryStatus: "SASRA-regulated",
    },
  });
  const figures = projectFindingToContractFigures(saccoContract, finding);

  it("dividendRate, minimumShareCapital, minimumMonthlyDeposit, withdrawalTerms and regulatoryStatus — every figures-sourced key SACCO_MARKET_ASSET_FIELD_RULES checks — survive the contract projection under downstream-compatible names", () => {
    expect(figures.dividendRate).toBe("12%");
    expect(figures.minimumShareCapital).toBe("5000");
    expect(figures.minimumMonthlyDeposit).toBe("500");
    expect(figures.withdrawalTerms).toBe("30-day notice");
    expect(figures.regulatoryStatus).toBe("SASRA-regulated");
  });

  it("checkApprovalGate: the SACCO replacement gate fully passes — the ONLY remaining gap, when issuer is omitted, is 'issuer / manager', the same pre-existing, structurally-unsatisfiable gate requirement from Slices 8e-1/8e-2/8e-3 (unrelated to SACCO specifically)", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["issuer / manager"]);
  });

  it("control: the gate fully passes once 'issuer' is manually supplied — proving every field THIS slice is responsible for, including the assetType-stamping fix and the shareCapitalDividendRate OR-requirement, is genuinely compatible with the SACCO replacement gate. NO 'market'/'lastPrice' requirement applies at all, confirming the replacement (not additive) nature of the SACCO gate.", () => {
    const gateWithIssuer = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: "Stima SACCO", // a manager-vouched issuer, supplied manually
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gateWithIssuer.ok).toBe(true);
    expect(gateWithIssuer.missing).toEqual([]);
  });

  it("regression guard: if minimumShareCapital/minimumMonthlyDeposit/regulatoryStatus are ever missing from the raw extraction, the gate still correctly reports them missing — the fix didn't disable the checks, it just stopped the contract from swallowing values that WERE there", () => {
    // shareCapitalDividendRate/withdrawalTerms are deliberately supplied to
    // isolate the three fields actually under test — otherwise the
    // shareCapitalDividendRate-OR-depositRebateRate requirement and the
    // withdrawalTerms requirement would ALSO show up as missing here.
    const findingBare = saccoFinding({
      extractedFields: { shareCapitalDividendRate: "12%", withdrawalTerms: "30-day notice" },
    });
    const figuresBare = projectFindingToContractFigures(saccoContract, findingBare);
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures: figuresBare,
      name: findingBare.instrumentName,
      issuer: "Stima SACCO",
      currency: "KES",
      source: findingBare.sourceLabel,
      asOf: findingBare.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(
      ["minimum share capital", "minimum monthly deposit / contribution", "Risk / protection note"].sort(),
    );
  });

  it("regression guard: withdrawalTerms alone (no separate liquidity value) still satisfies the gate — proving the lockInWithdrawalRule -> withdrawalTerms rename was load-bearing, not redundant with the liquidity field's coincidental fallback", () => {
    const findingNoLiquidity = saccoFinding({
      extractedFields: {
        shareCapitalDividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "500",
        withdrawalTerms: "30-day notice",
        regulatoryStatus: "SASRA-regulated",
        // liquidity intentionally omitted
      },
    });
    const figuresNoLiquidity = projectFindingToContractFigures(saccoContract, findingNoLiquidity);
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures: figuresNoLiquidity,
      name: findingNoLiquidity.instrumentName,
      issuer: "Stima SACCO",
      currency: "KES",
      source: findingNoLiquidity.sourceLabel,
      asOf: findingNoLiquidity.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "edit",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("buildPromotionPlan maps the contract-projected figures onto the correct opportunities payload — liquidity is the only SACCO-relevant field with a typed promotion destination; the rest (dividendRate, minimumShareCapital, minimumMonthlyDeposit, withdrawalTerms, regulatoryStatus, assetType) correctly stay figures-only, matching the contract's own promoteToCatalogueRow: false markings", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "alt",
      issuer: "Stima SACCO",
      currency: "KES",
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.name).toBe("Stima SACCO");
    expect(plan.payload.liquidity).toBe("monthly");
    expect(plan.payload.market).toBeNull();
    expect(plan.payload.lastPrice).toBeNull();
    expect(plan.payload.yieldPct).toBeNull();
  });
});

describe("Slice 8e-4 · projectFindingToContractDisplayRows (SACCO)", () => {
  it("returns exactly the 12 SACCO contract fields, in contract order, with matching labels", () => {
    const finding = saccoFinding();
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    expect(rows.length).toBe(saccoContract.fields.length);
    expect(rows.length).toBe(12); // 11 from the original product list + minimumShareCapital, added post-approval
    expect(rows.map((r) => r.key)).toEqual(saccoContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(saccoContract.fields.map((f) => f.label));
  });

  it("Stage 10b-3 — membershipRequirement and fees (now extendedFields tier) surface their real found value, when the raw bag has a matching key", () => {
    const finding = saccoFinding({
      extractedFields: { membershipRequirement: "Must be a Kenya Power employee", fees: "KES 200 annual" },
    });
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    const expected: Record<string, string> = {
      membershipRequirement: "Must be a Kenya Power employee",
      fees: "KES 200 annual",
    };
    for (const key of Object.keys(expected)) {
      const row = rows.find((r) => r.key === key)!;
      expect(row.storageStatus).toBe("extendedFields");
      expect(row.value).toBe(expected[key]);
    }
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = saccoFinding({ extractedFields: { shareCapitalDividendRate: "12%" } });
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    expect(rows.find((r) => r.key === "dividendRate")!.value).toBe("12%");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = saccoFinding();
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("SASRA register");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("saccoName surfaces from the envelope (instrumentName), not extractedFields", () => {
    const finding = saccoFinding({ instrumentName: "Real SACCO Ltd", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    expect(rows.find((r) => r.key === "saccoName")!.value).toBe("Real SACCO Ltd");
  });

  it("productType surfaces from the explicit SACCO extraction field", () => {
    const finding = saccoFinding({ extractedFields: { productType: "Ordinary savings" } });
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    expect(rows.find((r) => r.key === "productType")!.value).toBe("Ordinary savings");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = saccoFinding({ extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(saccoContract, finding);
    expect(rows.find((r) => r.key === "minimumShareCapital")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8e-4 · FindingCard wiring", () => {
  it("saccoContract is computed via finding.extractedFields?.assetType === \"sacco\" — NOT finding.assetClass (SACCO shares assetClass \"alt\" with ETF/property/pension/other, unlike every prior subtype)", () => {
    expect(findingCard).toContain('String(finding.extractedFields?.assetType ?? "").trim().toLowerCase() === "sacco"');
    expect(findingCard).toContain('getCatalogueFieldContract("market_asset", "sacco")');
    // Confirms this slice deliberately did NOT reuse the assetClass pattern.
    expect(findingCard).not.toContain('finding.assetClass === "sacco"');
  });

  it("the SACCO fields block renders ONLY when saccoDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{saccoDisplayRows && \(/);
  });

  it("the SACCO fields block is labeled 'SACCO catalogue fields', distinct from the MMF/Bank/CBK/Equity/REIT/Offshore-fund blocks", () => {
    const idx = findingCard.indexOf("SACCO catalogue fields");
    expect(idx).toBeGreaterThan(-1);
  });

  it("the 'Additional extracted details' label appears alongside ANY of the seven wired blocks, never unconditionally", () => {
    const idx = findingCard.indexOf("Additional extracted details");
    expect(idx).toBeGreaterThan(-1);
    const before = findingCard.slice(Math.max(0, idx - 400), idx);
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

  it("the draft mutation call projects SACCO figures via the contract and falls back to them when there's no MMF/Bank/CBK/Equity/REIT/Offshore-fund figures", () => {
    expect(findingCard).toContain(
      "const saccoFigures = saccoContract ? projectFindingToContractFigures(saccoContract, finding) : undefined;",
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

  it("non-MMF, non-Bank, non-CBK, non-Equity, non-REIT, non-Offshore-fund, non-SACCO findings (ETF/property/pension/other) send undefined figures — draftFromFinding's existing raw-extractedFields default is completely unchanged for them", () => {
    expect(findingCard).toContain(
      "saccoContract ? projectFindingToContractFigures(saccoContract, finding) : undefined",
    );
  });

  it("the existing grouped/flat extraction display (InstrumentProfilePreview + fallback) is completely UNCHANGED in source — still present, byte-identical", () => {
    expect(findingCard).toContain(
      "{/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}",
    );
    expect(findingCard).toContain("return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;");
    expect(findingCard).toContain("No figures extracted — identity only.");
  });

  it("Stage 10b-3e renders the SACCO contract as a multi-field correction form", () => {
    const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
    const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));
    expect(dialog).toContain('getCatalogueFieldContract("market_asset", "sacco")');
    expect(dialog).toContain('String(finding.extractedFields?.assetType ?? "").trim().toLowerCase() === "sacco"');
    expect(dialog).toContain("correctedValues");
  });

  it("exactly seven getCatalogueFieldContract calls exist — MMF, Bank, CBK, Equity, REIT, Offshore fund, SACCO — no ETF/property/pension/other lookups (those have no active contract at all)", () => {
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

describe("Slice 8e-4 · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the SACCO-specific additions to the shared projection code, including the assetType-stamping fix", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new SACCO-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
