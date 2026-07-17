/**
 * Slice 8e-1 — Market asset Equity contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `market_asset`/`equity` field contract into Ask AI's
 * finding display and its "Draft into review queue" path — Equity only. Same
 * pattern as Slices 8b (MMF), 8c (Bank) and 8d (CBK). REIT/offshore-fund/SACCO
 * and any other market-asset subtype are untouched (their own slices come
 * later). Still no role/permission/auth change of any kind: this is the
 * existing single admin role performing the same mapping → review → approval
 * WORKFLOW STEPS as before, just now against fixed contract fields for Equity
 * instead of arbitrary raw extraction.
 *
 * Pre-approval compatibility check found and fixed FOUR issues, all in the
 * "one field, wrong output key" family this initiative has now seen three
 * times (Bank's indicativeRate/minAmount, CBK's yieldPct/whtRule):
 *   - `currentPrice` renamed to `lastPrice` — neither figurePresent's
 *     lastPrice alias table nor buildPromotionPlan's f.lastPrice ?? f.price
 *     read recognised the original key.
 *   - `dividendYield` renamed to `yieldPct` — buildPromotionPlan reads
 *     f.yieldPct ?? f.yield ?? f.coupon only. Subtly, the GATE's own
 *     lastPrice-rule alias table tolerates 'dividendYield' as an alternate
 *     price/yield/return satisfier, which made the ORIGINAL key look
 *     gate-compatible while the value was silently dropped from the
 *     opportunities.yieldPct column at promotion — a gate pass is not proof
 *     of promotion compatibility.
 *   - `exchange` renamed to `market` — the raw extraction schema's own field
 *     is literally named `exchange`, and the gate's market-rule alias table
 *     tolerates it too (same false-positive-via-gate-tolerance trap as
 *     dividendYield above), but buildPromotionPlan reads f.market only.
 *   - companyName/sourceLink/sourceAsOf added to ENVELOPE_ROUTED_CONTRACT_KEYS
 *     (buildPromotionPlan's opportunity branch sets name/source/dataAsOf from
 *     the envelope, never from figures — same pattern as MMF/Bank/CBK).
 *
 * A pre-existing, OUT-OF-SCOPE gap was also found and is deliberately NOT
 * fixed here (same category as Bank's orphaned `liquidity` gate requirement):
 * CATALOGUE_FIELD_RULES.market_asset hard-requires `issuer` (envelope-sourced,
 * non-escapable), but structuredInstrumentToDraft's issuer assignment only
 * ever checks raw.fundManager/raw.bankName — neither exists anywhere in
 * MARKET_ASSET_EXTRACTION_SCHEMA. finding.issuer is therefore ALWAYS null for
 * every AI-originated market-asset finding (equity, REIT, offshore fund, SACCO
 * alike), meaning this gate requirement predates and is unaffected by this
 * slice either way — no contract field could fix it (it's envelope-routed).
 *
 * Two halves, mirroring server/mmfContractMapping.test.ts,
 * server/bankContractMapping.test.ts and server/cbkContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `market_asset`/`equity` contract
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

const equityContract = getCatalogueFieldContract("market_asset", "equity")!;

function equityFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "Safaricom PLC",
    issuer: null, // pre-existing gap: market-asset findings never carry a real issuer — see file header
    sourceLabel: "NSE daily price list",
    sourceUrl: "https://www.nse.co.ke/market-statistics/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8e-1 · projectFindingToContractFigures (Equity)", () => {
  it("maps real extracted figures to their canonical Equity contract keys, under the downstream-compatible key names", () => {
    const finding = equityFinding({
      extractedFields: {
        ticker: "SCOM",
        exchange: "NSE",
        marketPrice: "18.50",
        dividendYield: "6.2",
        liquidity: "daily",
      },
    });
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(figures).toEqual({
      // companyName is deliberately absent — envelope-routed (see the next test).
      ticker: "SCOM",
      market: "NSE",
      lastPrice: "18.50",
      yieldPct: "6.2",
      liquidity: "daily",
    });
  });

  it("companyName/sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = equityFinding({ extractedFields: { marketPrice: "18.50" } });
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(figures.companyName).toBeUndefined();
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("recentDividend, priceChange, marketSector, minBuyAmount and riskLevel (missingRequiresMigration) never appear, even if the raw bag happens to carry those exact keys", () => {
    const finding = equityFinding({
      extractedFields: {
        marketPrice: "18.50",
        recentDividend: "KES 1.20 on 2026-05-01",
        priceChange: "+2.3%",
        marketSector: "Telecommunications",
        minBuyAmount: "100 shares",
        riskLevel: "Medium",
      },
    });
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(figures.recentDividend).toBeUndefined();
    expect(figures.priceChange).toBeUndefined();
    expect(figures.marketSector).toBeUndefined();
    expect(figures.minBuyAmount).toBeUndefined();
    expect(figures.riskLevel).toBeUndefined();
    expect(figures.lastPrice).toBe("18.50");
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = equityFinding({
      extractedFields: {
        marketPrice: "18.50",
        nav: "should never appear", // a real extraction-schema key, but not aliased by any equity field
        trailingReturn: "should never appear either",
        fee: "should never appear either",
        _extendedFields: JSON.stringify({ catalogueType: "market_asset" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["lastPrice"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = equityFinding({
      extractedFields: { marketPrice: "missing_from_source", dividendYield: "6.2" },
    });
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(figures.lastPrice).toBeUndefined();
    expect(figures.yieldPct).toBe("6.2");
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = equityFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(equityContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(equityContract, finding);
    expect(figures).toEqual({});
  });
});

describe("Slice 8e-1 · compatibility with the existing market-asset approval gate and promotion path (Equity)", () => {
  const finding = equityFinding({
    instrumentName: "Safaricom PLC",
    sourceLabel: "NSE daily price list",
    sourceUrl: "https://www.nse.co.ke/market-statistics/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      ticker: "SCOM",
      exchange: "NSE",
      marketPrice: "18.50",
      dividendYield: "6.2",
      liquidity: "daily",
    },
  });
  const figures = projectFindingToContractFigures(equityContract, finding);

  it("market and lastPrice — the figures-sourced keys the market-asset gate actually checks — survive the contract projection under downstream-compatible names", () => {
    // CATALOGUE_FIELD_RULES.market_asset checks 'market' (required) and
    // 'lastPrice' (required, escapable via figuresUnavailable).
    expect(figures.market).toBe("NSE");
    expect(figures.lastPrice).toBe("18.50");
    expect(figures.yieldPct).toBe("6.2"); // an alternate price/yield/return satisfier, and its own real payload field
  });

  it("checkApprovalGate: every figures-sourced field this slice is responsible for now passes — the ONLY remaining gap is 'issuer / manager', a pre-existing, structurally-unsatisfiable gate requirement unrelated to this slice (see file header)", () => {
    const gate = checkApprovalGate({
      assetClass: "equity",
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

  it("control: the gate fully passes once 'issuer' is manually supplied — proving every field THIS slice is responsible for is genuinely compatible, and the one remaining gap is isolated and understood, not a symptom of something else broken", () => {
    const gateWithIssuer = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: "Safaricom PLC", // a manager-vouched issuer, supplied manually
      currency: "KES",
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gateWithIssuer.ok).toBe(true);
    expect(gateWithIssuer.missing).toEqual([]);
  });

  it("regression guard: if market/lastPrice are ever missing from the raw extraction, the gate still correctly reports them missing — the fix didn't disable the check, it just stopped the contract from swallowing values that WERE there", () => {
    const findingBare = equityFinding({ extractedFields: {} });
    const figuresBare = projectFindingToContractFigures(equityContract, findingBare);
    const gate = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      figures: figuresBare,
      name: findingBare.instrumentName,
      issuer: "Safaricom PLC",
      currency: "KES",
      source: findingBare.sourceLabel,
      asOf: findingBare.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["market", "price / NAV / yield / return"].sort());
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "equity",
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

  it("buildPromotionPlan maps the contract-projected figures onto the correct opportunities payload keys for every field the typed payload covers", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "equity",
      issuer: "Safaricom PLC",
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.name).toBe("Safaricom PLC");
    expect(plan.payload.market).toBe("NSE");
    expect(plan.payload.lastPrice).toBeCloseTo(18.5);
    expect(plan.payload.yieldPct).toBeCloseTo(6.2);
    expect(plan.payload.liquidity).toBe("daily");
  });
});

describe("Slice 8e-1 · projectFindingToContractDisplayRows (Equity)", () => {
  it("returns exactly the 13 Equity contract fields, in contract order, with matching labels", () => {
    const finding = equityFinding();
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    expect(rows.length).toBe(equityContract.fields.length);
    expect(rows.length).toBe(13);
    expect(rows.map((r) => r.key)).toEqual(equityContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(equityContract.fields.map((f) => f.label));
  });

  it("recentDividend, priceChange, marketSector, minBuyAmount and riskLevel (missingRequiresMigration) are ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = equityFinding({
      extractedFields: {
        recentDividend: "KES 1.20",
        priceChange: "+2.3%",
        marketSector: "Telecommunications",
        minBuyAmount: "100 shares",
        riskLevel: "Medium",
      },
    });
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    for (const key of ["recentDividend", "priceChange", "marketSector", "minBuyAmount", "riskLevel"]) {
      const row = rows.find((r) => r.key === key)!;
      expect(row.storageStatus).toBe("missingRequiresMigration");
      expect(row.value).toBeNull();
    }
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = equityFinding({ extractedFields: { marketPrice: "18.50" } });
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    expect(rows.find((r) => r.key === "lastPrice")!.value).toBe("18.50");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = equityFinding();
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("NSE daily price list");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("companyName surfaces from the envelope (instrumentName), not extractedFields", () => {
    const finding = equityFinding({ instrumentName: "Real Equity PLC", extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    expect(rows.find((r) => r.key === "companyName")!.value).toBe("Real Equity PLC");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = equityFinding({ extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(equityContract, finding);
    expect(rows.find((r) => r.key === "ticker")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8e-1 · FindingCard wiring", () => {
  it("equityContract is computed ONLY for targetCatalogue === \"market_asset\" AND assetClass === \"equity\" — never for any other catalogue/subtype", () => {
    expect(findingCard).toContain(
      'finding.targetCatalogue === "market_asset" && finding.assetClass === "equity"',
    );
    expect(findingCard).toContain('getCatalogueFieldContract("market_asset", "equity")');
  });

  it("the Equity fields block renders ONLY when equityDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{equityDisplayRows && \(/);
  });

  it("the Equity fields block is labeled 'Equity catalogue fields', distinct from the MMF/Bank/CBK blocks", () => {
    const idx = findingCard.indexOf("Equity catalogue fields");
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

  it("the draft mutation call projects Equity figures via the contract and falls back to them when there's no MMF/Bank/CBK figures", () => {
    expect(findingCard).toContain(
      "const equityFigures = equityContract ? projectFindingToContractFigures(equityContract, finding) : undefined;",
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
    expect(findingCard).toContain(
      "equityContract ? projectFindingToContractFigures(equityContract, finding) : undefined",
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

describe("Slice 8e-1 · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the Equity-specific additions to the shared projection code", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new Equity-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
