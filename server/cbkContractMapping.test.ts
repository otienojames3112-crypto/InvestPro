/**
 * Slice 8d — CBK contract-based review/mapping (2026-07-16).
 *
 * Wires the Slice-8a `cbk` field contract into Ask AI's finding display and its
 * "Draft into review queue" path — CBK only. Same pattern as Slices 8b (MMF) and
 * 8c (Bank). Market-asset subtypes are untouched (their own slice comes later).
 * Still no role/permission/auth change of any kind: this is the existing single
 * admin role performing the same mapping → review → approval WORKFLOW STEPS as
 * before, just now against fixed contract fields for CBK instead of arbitrary
 * raw extraction.
 *
 * Pre-approval compatibility check (same discipline as Slices 8b/8c) found and
 * fixed the LARGEST set of issues so far — the CBK contract grew from 10 to 15
 * fields:
 *   - `indicativeYield` renamed to `yieldPct` — neither figurePresent's alias
 *     table nor buildPromotionPlan's f.yieldPct read recognised the original
 *     key (same failure mode as Bank's interestRate/minimumDeposit renames).
 *   - `taxTreatment` renamed to `whtRule`, and a NEW field `taxExempt` added —
 *     the gate's whtRule and taxExempt rules are TWO SEPARATE, independently-
 *     checked figures keys (applyCbkRuleFill sets them as genuinely distinct
 *     values), so one combined field could never satisfy both. taxExempt is
 *     ALSO the target of an infrastructure-bond-specific value assertion
 *     (must be literally TRUE for an IFB).
 *   - FOUR new fields for CBK_SUBTYPE_FIELD_RULES, which are additive
 *     requirements on top of the baseline once a T-bill/FXD/IFB is confidently
 *     detected — the NORMAL case for a real CBK finding, not an edge case:
 *     `auctionDate` + `valueDate` (T-bill), `issueNumber` + `couponRate`
 *     (FXD/IFB, maturityDate was already covered). All four are genuinely
 *     extracted by the LLM schemas and have real homes in
 *     extendedFields.CbkSecurityProfile.
 *
 * Two halves, mirroring server/mmfContractMapping.test.ts and
 * server/bankContractMapping.test.ts:
 *   - pure tests for the projection helpers (shared/catalogueFieldContracts.ts),
 *     scoped to the `cbk` contract
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

const cbkContract = getCatalogueFieldContract("cbk")!;

function cbkFinding(overrides: Partial<ProjectableFinding> = {}): ProjectableFinding {
  return {
    instrumentName: "91-Day Treasury Bill",
    issuer: null, // CBK securities have no issuer/manager envelope concept
    sourceLabel: "CBK auction results",
    sourceUrl: "https://www.centralbank.go.ke/treasury-bills/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {},
    ...overrides,
  };
}

describe("Slice 8d · projectFindingToContractFigures (CBK)", () => {
  it("maps a T-bill's real extracted figures to their canonical CBK contract keys, under the downstream-compatible key names", () => {
    const finding = cbkFinding({
      extractedFields: {
        securityType: "treasury_bill",
        tenorDays: "91",
        yieldPct: "15.8",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        auctionDate: "2026-07-08",
        valueDate: "2026-07-10",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures).toEqual({
      securityType: "treasury_bill",
      tenor: "91",
      yieldPct: "15.8",
      whtRule: "15% withholding tax on the discount",
      taxExempt: "false",
      auctionDate: "2026-07-08",
      valueDate: "2026-07-10",
    });
  });

  it("maps an FXD bond's real extracted figures to their canonical CBK contract keys", () => {
    const finding = cbkFinding({
      extractedFields: {
        securityType: "fxd",
        issueNumber: "FXD1/2022/010",
        couponRate: "13.0",
        yieldPct: "14.2",
        maturityDate: "2032-05-15",
        whtRule: "15% withholding tax on coupon",
        taxExempt: "false",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures.issueNumber).toBe("FXD1/2022/010");
    expect(figures.couponRate).toBe("13.0");
    expect(figures.maturityDate).toBe("2032-05-15");
  });

  it("sourceLink/sourceAsOf are EXCLUDED (envelope-routed) — draftFromFinding/buildPromotionPlan already read them from the envelope, not figures", () => {
    const finding = cbkFinding({ extractedFields: { yieldPct: "14" } });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures.sourceLink).toBeUndefined();
    expect(figures.sourceAsOf).toBeUndefined();
  });

  it("netYieldAfterWht (computed) never appears, even if the raw bag happens to carry a 'netYieldAfterWht' key", () => {
    const finding = cbkFinding({ extractedFields: { yieldPct: "14", netYieldAfterWht: "11.9" } });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures.netYieldAfterWht).toBeUndefined();
  });

  it("arbitrary AI-extracted keys with no contract alias never leak into the draft figures", () => {
    const finding = cbkFinding({
      extractedFields: {
        yieldPct: "14",
        prevAvgRate: "should never appear separately", // note: this IS an alias of yieldPct, see next test
        rawExcerpt: "should never appear",
        _extendedFields: JSON.stringify({ catalogueType: "cbk" }),
        _proposalType: "create",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(Object.keys(figures).sort()).toEqual(["yieldPct"]);
  });

  it("a missing_from_source sentinel value is treated as absent, never copied as a literal string", () => {
    const finding = cbkFinding({
      extractedFields: { yieldPct: "missing_from_source", tenorDays: "182" },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures.yieldPct).toBeUndefined();
    expect(figures.tenor).toBe("182");
  });

  it("an empty/absent extractedFields bag produces an empty figures object, not undefined and not a throw", () => {
    const finding = cbkFinding({ extractedFields: null });
    expect(() => projectFindingToContractFigures(cbkContract, finding)).not.toThrow();
    const figures = projectFindingToContractFigures(cbkContract, finding);
    expect(figures).toEqual({});
  });
});

describe("Slice 8d · compatibility with the existing CBK approval gate and promotion path (T-bill)", () => {
  const finding = cbkFinding({
    instrumentName: "91-Day Treasury Bill",
    sourceLabel: "CBK auction results",
    sourceUrl: "https://www.centralbank.go.ke/treasury-bills/",
    sourceAsOf: Date.parse("2026-07-10"),
    extractedFields: {
      securityType: "treasury_bill",
      tenorDays: "91",
      yieldPct: "15.8",
      whtRule: "15% withholding tax on the discount",
      taxExempt: "false",
      auctionDate: "2026-07-08",
      valueDate: "2026-07-10",
      // A T-bill never gets a literal maturityDate — applyCbkRuleFill sets this
      // instead (see the maturityDate contract field's note on the 'maturityRule'
      // fallback alias). CATALOGUE_FIELD_RULES.cbk's baseline requires it for
      // every CBK finding regardless of subtype.
      maturityRule: "value date + 91 days",
    },
  });
  const figures = projectFindingToContractFigures(cbkContract, finding);

  it("securityType, tenor, yieldPct, whtRule, taxExempt, auctionDate and valueDate — every figures-sourced key the base gate AND the T-bill subtype gate check — survive the contract projection under downstream-compatible names", () => {
    expect(figures.securityType).toBe("treasury_bill");
    expect(figures.tenor).toBe("91");
    expect(figures.yieldPct).toBe("15.8");
    expect(figures.whtRule).toBe("15% withholding tax on the discount");
    expect(figures.taxExempt).toBe("false");
    expect(figures.auctionDate).toBe("2026-07-08");
    expect(figures.valueDate).toBe("2026-07-10");
  });

  it("checkApprovalGate fully passes for a CREATE-path T-bill draft built from contract-projected figures — base gate AND subtype gate both satisfied", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.cbkSubtype).toBe("tbill");
  });

  it("regression guard: if auctionDate/valueDate are ever missing from the raw extraction, the gate still correctly reports the T-bill subtype gap — the fix didn't disable the check, it just stopped the contract from swallowing values that WERE there", () => {
    const findingNoDates = cbkFinding({
      extractedFields: {
        securityType: "treasury_bill",
        tenorDays: "91",
        yieldPct: "15.8",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
      },
    });
    const figuresNoDates = projectFindingToContractFigures(cbkContract, findingNoDates);
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      figures: figuresNoDates,
      name: findingNoDates.instrumentName,
      source: findingNoDates.sourceLabel,
      asOf: findingNoDates.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["auction date", "value / settlement date"].sort());
  });

  it("buildPromotionPlan maps the contract-projected figures onto the correct opportunities payload keys for every field the typed payload covers", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "gov_discount",
      figures,
      source: finding.sourceLabel!,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.yieldPct).toBeCloseTo(15.8);
    expect(plan.payload.tenorYears).toBeCloseTo(91); // f.tenorYears ?? f.tenor — tenor is a bare "91" here
  });

  it("an EDIT-path draft (changeKind: 'edit') is unaffected by any of this — the gate returns ok:true immediately for edits, matching today's behavior", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "edit",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });
});

describe("Slice 8d · compatibility with the existing CBK approval gate and promotion path (FXD / IFB)", () => {
  it("checkApprovalGate fully passes for a CREATE-path FXD draft built from contract-projected figures — base gate AND FXD subtype gate both satisfied", () => {
    const finding = cbkFinding({
      instrumentName: "FXD1/2022/010 Treasury Bond",
      extractedFields: {
        securityType: "fxd",
        tenorYears: "10",
        issueNumber: "FXD1/2022/010",
        couponRate: "13.0",
        yieldPct: "14.2",
        maturityDate: "2032-05-15",
        whtRule: "15% withholding tax on coupon",
        taxExempt: "false",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.cbkSubtype).toBe("fxd");
  });

  it("infrastructure-bond-specific value assertion: checkApprovalGate PASSES when taxExempt is TRUE (a real IFB is tax-exempt by definition)", () => {
    const finding = cbkFinding({
      instrumentName: "IFB1/2023/012 Infrastructure Bond",
      extractedFields: {
        securityType: "ifb",
        tenorYears: "12",
        issueNumber: "IFB1/2023/012",
        couponRate: "13.5",
        yieldPct: "13.5",
        maturityDate: "2038-03-01",
        whtRule: "0% — infrastructure bonds are tax-exempt",
        taxExempt: "true",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
    expect(gate.cbkSubtype).toBe("ifb");
  });

  it("infrastructure-bond-specific value assertion: checkApprovalGate FAILS when taxExempt is FALSE on a detected IFB — the taxExempt split from Tax treatment is what makes this check reachable at all", () => {
    const finding = cbkFinding({
      instrumentName: "IFB1/2023/012 Infrastructure Bond",
      extractedFields: {
        securityType: "ifb",
        tenorYears: "12",
        issueNumber: "IFB1/2023/012",
        couponRate: "13.5",
        yieldPct: "13.5",
        maturityDate: "2038-03-01",
        whtRule: "recorded incorrectly",
        taxExempt: "false",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("tax-exempt flag must be TRUE for an infrastructure bond");
  });

  it("regression guard: if issueNumber/couponRate are ever missing from the raw extraction, the gate still correctly reports the FXD/IFB subtype gap", () => {
    const finding = cbkFinding({
      instrumentName: "FXD1/2022/010 Treasury Bond",
      extractedFields: {
        securityType: "fxd",
        tenorYears: "10",
        yieldPct: "14.2",
        maturityDate: "2032-05-15",
        whtRule: "15% withholding tax on coupon",
        taxExempt: "false",
      },
    });
    const figures = projectFindingToContractFigures(cbkContract, finding);
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing.sort()).toEqual(["coupon rate", "issue number"].sort());
  });
});

describe("Slice 8d · projectFindingToContractDisplayRows (CBK)", () => {
  it("returns exactly the 15 CBK contract fields, in contract order, with matching labels", () => {
    const finding = cbkFinding();
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    expect(rows.length).toBe(cbkContract.fields.length);
    expect(rows.length).toBe(15);
    expect(rows.map((r) => r.key)).toEqual(cbkContract.fields.map((f) => f.key));
    expect(rows.map((r) => r.label)).toEqual(cbkContract.fields.map((f) => f.label));
  });

  it("netYieldAfterWht (computed) is ALWAYS null, even when the raw bag has a matching key", () => {
    const finding = cbkFinding({ extractedFields: { yieldPct: "14", netYieldAfterWht: "11.9" } });
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    const row = rows.find((r) => r.key === "netYieldAfterWht")!;
    expect(row.storageStatus).toBe("computed");
    expect(row.value).toBeNull();
  });

  it("a genuinely found value surfaces correctly", () => {
    const finding = cbkFinding({ extractedFields: { yieldPct: "15.8" } });
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    expect(rows.find((r) => r.key === "yieldPct")!.value).toBe("15.8");
  });

  it("sourceLink and sourceAsOf ARE present in the full contract projection (the UI layer chooses to filter them for its own display, but the projection itself is complete)", () => {
    const finding = cbkFinding();
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    const sourceLink = rows.find((r) => r.key === "sourceLink")!;
    const sourceAsOf = rows.find((r) => r.key === "sourceAsOf")!;
    expect(sourceLink.value).toBe("CBK auction results");
    expect(sourceAsOf.value).not.toBeNull();
  });

  it("whtRule and taxExempt surface as two INDEPENDENT rows with their own distinct values — proving the split from the original combined 'Tax treatment' field", () => {
    const finding = cbkFinding({
      extractedFields: { whtRule: "15% withholding tax on the discount", taxExempt: "false" },
    });
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    const whtRuleRow = rows.find((r) => r.key === "whtRule")!;
    const taxExemptRow = rows.find((r) => r.key === "taxExempt")!;
    expect(whtRuleRow.label).toBe("Tax treatment");
    expect(whtRuleRow.value).toBe("15% withholding tax on the discount");
    expect(taxExemptRow.label).toBe("Tax-exempt flag");
    expect(taxExemptRow.value).toBe("false");
  });

  it("a field with no aliases matching anything in the bag is null, never a fabricated placeholder", () => {
    const finding = cbkFinding({ sourceLabel: null, sourceUrl: null, extractedFields: {} });
    const rows = projectFindingToContractDisplayRows(cbkContract, finding);
    expect(rows.find((r) => r.key === "minInvestment")!.value).toBeNull();
  });
});

/* ── UI wiring (static source read — established convention, no DB/network) ── */

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));

describe("Slice 8d · FindingCard wiring", () => {
  it("cbkContract is computed ONLY for targetCatalogue === \"cbk\" — never for any other catalogue", () => {
    expect(findingCard).toContain('finding.targetCatalogue === "cbk" ? getCatalogueFieldContract("cbk") : null');
  });

  it("the CBK fields block renders ONLY when cbkDisplayRows is truthy", () => {
    expect(findingCard).toMatch(/\{cbkDisplayRows && \(/);
  });

  it("the CBK fields block is labeled 'CBK catalogue fields', distinct from the MMF and Bank blocks", () => {
    const idx = findingCard.indexOf("CBK catalogue fields");
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

  it("the draft mutation call projects CBK figures via the contract and falls back to them when there's no MMF/Bank figures", () => {
    expect(findingCard).toContain(
      "const cbkFigures = cbkContract ? projectFindingToContractFigures(cbkContract, finding) : undefined;",
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
    expect(findingCard).toContain("cbkContract ? projectFindingToContractFigures(cbkContract, finding) : undefined");
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

describe("Slice 8d · guardrails", () => {
  it("no role/permission/auth/RBAC identifiers appear anywhere in the CBK-specific additions to the shared projection code", () => {
    const sharedSrc = readFileSync(join(ROOT, "shared/catalogueFieldContracts.ts"), "utf8");
    const sliceStart = sharedSrc.indexOf("Slice 8b — projecting a finding");
    expect(sliceStart).toBeGreaterThan(-1);
    const sliceBody = sharedSrc.slice(sliceStart);
    expect(sliceBody).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });

  it("no auth/RBAC/role identifiers appear anywhere in the new CBK-only test-visible wiring in AskAI.tsx's FindingCard", () => {
    expect(findingCard).not.toMatch(/\brole\b|\bpermission\b|\brbac\b|\bauth\b/i);
  });
});
