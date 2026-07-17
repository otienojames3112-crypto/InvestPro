/**
 * Slice 8e-2 — Market asset REIT contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `market_asset`/`reit` field contract into Ask AI's
 * finding display and its "Draft into review queue" path — REIT only. Same
 * pattern as Slices 8b (MMF), 8c (Bank), 8d (CBK) and 8e-1 (Equity).
 * Offshore-fund/SACCO and any other market-asset subtype are untouched
 * (their own slices come later). Still no role/permission/auth change of any
 * kind: this is the existing single admin role performing the same mapping →
 * review → approval WORKFLOW STEPS as before, just now against fixed
 * contract fields for REIT instead of arbitrary raw extraction.
 *
 * Pre-approval compatibility check found and fixed TWO issues, one of them a
 * genuinely NEW failure class this initiative hasn't hit before:
 *   - `currentPrice` renamed to `lastPrice` — same fix as Equity's
 *     currentPrice rename (neither figurePresent's lastPrice alias table nor
 *     buildPromotionPlan's f.lastPrice ?? f.price read recognised it).
 *   - `distributionYield` gained a NEW `alsoWriteKeys: ["yieldPct"]` property
 *     — a brand-new schema mechanism added THIS slice. Unlike every prior
 *     rename, distributionYield could NOT simply be renamed either way:
 *     MARKET_ASSET_SUBTYPE_FIELD_RULES.reit's own additive gate rule strictly
 *     checks the literal key `distributionYield` (figurePresent's alias table
 *     for it is `["distributionYield"]` — no fallback to yieldPct at all),
 *     while buildPromotionPlan's opportunity payload reads
 *     `f.yieldPct ?? f.yield ?? f.coupon` for the promoted column —
 *     `distributionYield` is NOT in that chain. Two independently-keyed
 *     downstream consumers, each needing a DIFFERENT literal key for the SAME
 *     value, with no single key satisfying both. `alsoWriteKeys` duplicates
 *     the found value onto a second output key in
 *     `projectFindingToContractFigures`, entirely confined to
 *     shared/catalogueFieldContracts.ts — no researchPipeline.ts change.
 *   - reitName/sourceLink/sourceAsOf added to ENVELOPE_ROUTED_CONTRACT_KEYS
 *     (buildPromotionPlan's opportunity branch sets name/source/dataAsOf from
 *     the envelope, never from figures — same pattern as MMF/Bank/CBK/Equity;
 *     sourceLink/sourceAsOf were already covered catalogue-wide by 8e-1, only
 *     reitName itself is new this slice).
 *
 * The same pre-existing, OUT-OF-SCOPE `issuer / manager` gate gap documented
 * in Slice 8e-1's file header applies here too (finding.issuer is always null
 * for every AI-originated market-asset finding, REIT included) — reconfirmed
 * by a dedicated test below, not re-explained at length.
 *
 * Two halves, mirroring server/equityContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `market_asset`/`reit` contract
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

const reitContract = getCatalogueFieldContract("market_asset", "reit")!;

function reitFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Acorn Income REIT",
    issuer: null, // pre-existing gap: market-asset findings never carry a real issuer — see file header
    sourceLabel: "NSE daily price list",
    sourceUrl: "https://www.nse.co.ke/market-statistics/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8e-2 · projectFindingToContractFigures (REIT)", () => {
  it("maps real extracted figures to their canonical REIT contract keys, under the downstream-compatible key names", () => {
    const finding = reitFinding({
      extractedFields: {
        marketPrice: "20.00",
        distributionYield: "8.5",
        liquidity: "daily",
      },
    });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures).toEqual({
      // reitName is deliberately absent — envelope-routed (see the next test).
      lastPrice: "20.00",
      distributionYield: "8.5",
      // alsoWriteKeys duplicates the SAME value onto yieldPct too.
      yieldPct: "8.5",
      liquidity: "daily",
    });
  });

  it("distributionYield's value is duplicated onto BOTH its own key and yieldPct (alsoWriteKeys) — proving the dual-key mechanism directly", () => {
    const finding = reitFinding({ extractedFields: { distributionYield: "7.25" } });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures.distributionYield).toBe("7.25");
    expect(figures.yieldPct).toBe("7.25");
  });

  it("reitName/sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = reitFinding({ extractedFields: { marketPrice: "20.00" } });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures.reitName).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("reitType, recentDistribution, occupancyRate, minInvestment and riskLevel (missingRequiresMigration) never appear, even if the raw bag happens to carry those exact keys", () => {
    const finding = reitFinding({
      extractedFields: {
        marketPrice: "20.00",
        reitType: "Income REIT",
        recentDistribution: "KES 1.50 on 2026-04-01",
        occupancyRate: "94%",
        minInvestment: "KES 5,000",
        riskLevel: "Medium",
      },
    });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures.reitType).toBeUndefined();
    expect(figures.recentDistribution).toBeUndefined();
    expect(figures.occupancyRate).toBeUndefined();
    expect(figures.minInvestment).toBeUndefined();
    expect(figures.riskLevel).toBeUndefined();
    expect(figures.lastPrice).toBe("20.00");
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = reitFinding({
      extractedFields: {
        marketPrice: "20.00",
        trailingReturn: "should never appear",
        fee: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "market_asset" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["lastPrice"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string (and does not spuriously populate alsoWriteKeys either)", () => {
    const finding = reitFinding({
      extractedFields: { marketPrice: "missing_from_source", distributionYield: "missing_from_source" },
    });
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures.lastPrice).toBeUndefined();
    expect(figures.distributionYield).toBeUndefined();
    expect(figures.yieldPct).toBeUndefined();
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = reitFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(reitContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(reitContract, finding);
    expect(figures).toEqual({});
  });
});

describe("Slice 8e-2 · compatibility with the existing market-asset approval gate, REIT subtype gate, and promotion path", () => {
  const finding = reitFinding({
    instrumentName: "Acorn Income REIT",
    sourceLabel: "NSE daily price list",
    sourceUrl: "https://www.nse.co.ke/market-statistics/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      exchange: "NSE",
      marketPrice: "20.00",
      distributionYield: "8.5",
      liquidity: "daily",
    },
  });
  const figures = projectFindingToContractFigures(reitContract, finding);

  it("market, lastPrice and distributionYield (plus its yieldPct duplicate) — every figures-sourced key the base gate AND the REIT subtype gate check — survive the contract projection under downstream-compatible names", () => {
    expect(figures.market).toBe("NSE");
    expect(figures.lastPrice).toBe("20.00");
    expect(figures.distributionYield).toBe("8.5");
    expect(figures.yieldPct).toBe("8.5");
  });

  it("checkApprovalGate: the base gate AND the REIT subtype gate's own distributionYield rule both pass — the ONLY remaining gap is 'issuer / manager', the same pre-existing, structurally-unsatisfiable gate requirement from Slice 8e-1 (unrelated to REIT specifically)", () => {
    const gate = checkApprovalGate({
      assetClass: "reit",
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

  it("control: the gate fully passes once 'issuer' is manually supplied — proving every field THIS slice is responsible for (including the REIT subtype gate) is genuinely compatible", () => {
    const gateWithIssuer = checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: "Acorn Holdings", // a manager-vouched issuer, supplied manually
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gateWithIssuer.ok).toBe(true);
    expect(gateWithIssuer.missing).toEqual([]);
  });

  it("regression guard: if distributionYield is ever missing from the raw extraction, BOTH the base price/yield/return requirement (if lastPrice is also absent) AND the REIT subtype's own distributionYield requirement are still correctly reported missing — the fix didn't disable either check", () => {
    const findingBare = reitFinding({ extractedFields: { exchange: "NSE" } });
    const figuresBare = projectFindingToContractFigures(reitContract, findingBare);
    const gate = checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      figures: figuresBare,
      name: findingBare.instrumentName,
      issuer: "Acorn Holdings",
      currency: "KES",
      source: findingBare.sourceLabel,
      asOf: findingBare.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["distribution yield", "price / NAV / yield / return"].sort());
  });

  it("regression guard: distributionYield ALONE (no separate lastPrice) satisfies the base price/yield/return requirement too, via figurePresent's own alias tolerance — confirms the dual-write doesn't need lastPrice to ALSO be present", () => {
    const findingYieldOnly = reitFinding({ extractedFields: { exchange: "NSE", distributionYield: "8.5" } });
    const figuresYieldOnly = projectFindingToContractFigures(reitContract, findingYieldOnly);
    const gate = checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      figures: figuresYieldOnly,
      name: findingYieldOnly.instrumentName,
      issuer: "Acorn Holdings",
      currency: "KES",
      source: findingYieldOnly.sourceLabel,
      asOf: findingYieldOnly.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "reit",
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

  it("buildPromotionPlan maps the contract-projected figures onto the correct opportunities payload keys — distributionYield's alsoWriteKeys duplicate is what actually lets yieldPct reach the promoted column", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "reit",
      issuer: "Acorn Holdings",
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.name).toBe("Acorn Income REIT");
    expect(plan.payload.lastPrice).toBeCloseTo(20.0);
    expect(plan.payload.yieldPct).toBeCloseTo(8.5);
    expect(plan.payload.liquidity).toBe("daily");
  });

  it("buildPromotionPlan's yieldPct would have been null WITHOUT alsoWriteKeys — proving the fix is load-bearing, not redundant", () => {
    // Simulate the pre-fix figures bag: distributionYield present, but no
    // yieldPct duplicate (as if alsoWriteKeys had never been added).
    const preFixFigures = { distributionYield: "8.5", liquidity: "daily" };
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "reit",
      issuer: "Acorn Holdings",
      figures: preFixFigures,
      source: finding.sourceLabel!,
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.yieldPct).toBeNull();
  });
});

describe("Slice 8e-2 · projectFindingToContractDisplayRows (REIT)", () => {
  it("returns exactly the 13 REIT contract fields, in contract order, with matching labels", () => {
    const finding = reitFinding();
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    expect(rows.length).toBe(reitContract.fields.length);
    expect(rows.length).toBe(13); // 12 from the original product list + market (Exchange), added post-approval
    expect(rows.map((r) => r.key)).toEqual(reitContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(reitContract.fields.map((f) => f.label));
  });

  it("distributionYield surfaces as exactly ONE display row (alsoWriteKeys never creates a second row) — display stays single-key even though figures projection is dual-key", () => {
    const finding = reitFinding({ extractedFields: { distributionYield: "8.5" } });
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    const distributionRows = rows.filter((r) => r.key === "distributionYield" || r.key === "yieldPct");
    expect(distributionRows.length).toBe(1);
    expect(distributionRows[0].key).toBe("distributionYield");
    expect(distributionRows[0].value).toBe("8.5");
  });

  it("reitType, recentDistribution, occupancyRate, minInvestment and riskLevel (missingRequiresMigration) are ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = reitFinding({
      extractedFields: {
        reitType: "Income REIT",
        recentDistribution: "KES 1.50",
        occupancyRate: "94%",
        minInvestment: "KES 5,000",
        riskLevel: "Medium",
      },
    });
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    for (const key of ["reitType", "recentDistribution", "occupancyRate", "minInvestment", "riskLevel"]) {
      const row = rows.find((r) => r.key === key)!;
      expect(row.storageStatus).toBe("missingRequiresMigration");
      expect(row.value).toBeNull();
    }
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = reitFinding({ extractedFields: { marketPrice: "20.00" } });
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    expect(rows.find((r) => r.key === "lastPrice")!.value).toBe("20.00");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = reitFinding();
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("NSE daily price list");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("reitName surfaces from the envelope (instrumentName), not extractedFields", () => {
    const finding = reitFinding({ instrumentName: "Real REIT PLC", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    expect(rows.find((r) => r.key === "reitName")!.value).toBe("Real REIT PLC");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = reitFinding({ extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(reitContract, finding);
    expect(rows.find((r) => r.key === "nav")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8e-2 · FindingCard wiring", () => {
  it("reitContract is computed ONLY for targetCatalogue === \"market_asset\" AND assetClass === \"reit\" — never for any other catalogue/subtype", () => {
    expect(findingCard).toContain('finding.targetCatalogue === "market_asset" && finding.assetClass === "reit"');
    expect(findingCard).toContain('getCatalogueFieldContract("market_asset", "reit")');
  });

  it("the REIT fields block renders ONLY when reitDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{reitDisplayRows && \(/);
  });

  it("the REIT fields block is labeled 'REIT catalogue fields', distinct from the MMF/Bank/CBK/Equity blocks", () => {
    const idx = findingCard.indexOf("REIT catalogue fields");
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
    ]) {
      expect(before).toContain(term);
    }
    expect(before).toMatch(/\) &&\s*\(/);
  });

  it("the draft mutation call projects REIT figures via the contract and falls back to them when there's no MMF/Bank/CBK/Equity figures", () => {
    expect(findingCard).toContain(
      "const reitFigures = reitContract ? projectFindingToContractFigures(reitContract, finding) : undefined;",
    );
    const mutateIdx = findingCard.indexOf("draft.mutate({");
    expect(mutateIdx).toBeGreaterThan(-1);
    const mutateBlock = findingCard.slice(mutateIdx, mutateIdx + 300);
    for (const term of [
      "mmfFigures",
      "bankFigures",
      "cbkFigures",
      "equityFigures",
      "reitFigures",
      "offshoreFundFigures",
    ]) {
      expect(mutateBlock).toContain(term);
    }
  });

  it("non-MMF, non-Bank, non-CBK, non-Equity, non-REIT, non-Offshore-fund findings (SACCO) send undefined figures — draftFromFinding's existing raw-extractedFields default is completely unchanged for them", () => {
    expect(findingCard).toContain(
      "reitContract ? projectFindingToContractFigures(reitContract, finding) : undefined",
    );
  });

  it("the existing grouped/flat extraction display (InstrumentProfilePreview + fallback) is completely UNCHANGED in source — still present, byte-identical", () => {
    expect(findingCard).toContain(
      "{/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}",
    );
    expect(findingCard).toContain("return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;");
    expect(findingCard).toContain("No figures extracted — identity only.");
  });

  it("CorrectFigureDialog is UNCHANGED by this slice — still uses fmtFields(raw extractedFields) for its field selector, not any contract", () => {
    const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
    const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));
    expect(dialog).toContain("const fields = fmtFields(finding.extractedFields);");
    expect(dialog).not.toContain("catalogueFieldContracts");
    expect(dialog).not.toContain("getCatalogueFieldContract");
  });

  it("no SACCO market_asset contract lookups exist anywhere yet — only MMF, Bank, CBK, Equity, REIT and Offshore fund are wired", () => {
    const contractCalls = [...askAi.matchAll(/getCatalogueFieldContract\([^)]*\)/g)].map((m) => m[0]);
    expect(contractCalls.length).toBeGreaterThan(0);
    for (const call of contractCalls) {
      expect(
        call.includes('"mmf"') ||
          call.includes('"bank"') ||
          call.includes('"cbk"') ||
          call.includes('"equity"') ||
          call.includes('"reit"') ||
          call.includes('"offshore_fund"'),
      ).toBe(true);
    }
  });
});

describe("Slice 8e-2 · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the REIT-specific additions to the shared projection code, including the new alsoWriteKeys mechanism", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new REIT-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
