/**
 * Stage 10b-1b — Bank live workflow parity repair.
 *
 * Stage 10b-1 built the Bank Product Catalogue's DISPLAY layer (explicit
 * columns, clean drawer, multi-field edit path) on the assumption that the
 * underlying extraction/gate/promotion plumbing was sound. Live QA with a
 * real pasted Bank source proved otherwise — this slice fixes four separate,
 * genuine gaps the live test surfaced:
 *
 *   1. Extraction gap — BANK_EXTRACTION_SCHEMA had no `productName` field at
 *      all (only `instrumentName`, "Bank + product name" combined, which
 *      `structuredInstrumentToDraft` treats as metadata and never puts in the
 *      figures bag) and no `feesCharges`/`accessSpeed` fields either — a
 *      source stating them had nowhere to go. Fixed by adding all three, plus
 *      a top-level `asOfDate` (mirroring MMF's `benchmarkDate`) since Bank had
 *      NO source-as-of bridge at all — CBK bridges via auctionDate, MMF via
 *      benchmarkDate, Bank bridged nothing.
 *   2. Gate-alias gap — CATALOGUE_FIELD_RULES.bank's "liquidity" rule checked
 *      figurePresent(figures, "liquidity"), whose alias list was
 *      ["liquidity", "withdrawalTerms"] — TWO keys Bank's extraction schema
 *      and contract have NEVER produced. Every bank finding failed this rule
 *      regardless of completeness, even with tenor/notice and an early
 *      withdrawal rule both present. Fixed by widening the alias list to
 *      include typicalTenor/tenor/noticePeriod/earlyWithdrawalPenalty/
 *      earlyWithdrawalRule/accessSpeed — the established fields that actually
 *      answer "liquidity / withdrawal terms".
 *   3. Numeric-parsing gap — shared/researchPipeline.ts's num() stripped only
 *      commas and a trailing "%", so "10.50% per annum" (trailing words) and
 *      "KES 50,000" (currency prefix) both failed to parse and silently
 *      promoted as null — displayed as "Rate unavailable" / Ksh 0. Fixed by
 *      matching the first numeric token in the string instead of requiring
 *      the whole string to already be a clean number.
 *   4. Storage-tier gap — fees/accessSpeed were `missingRequiresMigration`
 *      even though bank_instruments already has an extendedFields JSON home
 *      (the same one productName/earlyWithdrawalRule use) — moved to
 *      `extendedFields` so a source that states them can actually carry them
 *      through to the catalogue.
 *   5. Display gap — productType/instrumentType rendered as the raw enum
 *      ("fixed_deposit") in the review queue, approval modal, and Ask AI
 *      finding card (BankInstruments.tsx's own catalogue table already had a
 *      clean TYPE_LABEL map; the other three render sites didn't). Fixed with
 *      a shared `bankInstrumentTypeLabel()` reused at all three sites.
 *
 * Four layers of test (established convention — no jsdom in this repo):
 *   A. Pure — num() parsing, via buildPromotionPlan (num() itself is private).
 *   B. Pure — the gate alias widening, via checkApprovalGate directly.
 *   C. Pure — the full live-QA repro through structuredInstrumentToDraft →
 *      contract projection → gate → promotion plan, end to end, no DB/LLM.
 *   D. Static source-text scan — the extraction schema, prompt, and display
 *      wiring across aiResearchService.ts / ResearchDesk.tsx / AskAI.tsx.
 *   E. Full edit → approve → published-row path via the real tRPC caller —
 *      requires DATABASE_URL, `describe.skipIf`'d out otherwise (same
 *      established pattern as bankFieldParity.test.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogueFieldContract,
  projectFindingToContractFigures,
  projectFindingToContractDisplayRows,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan, bankInstrumentTypeLabel } from "../shared/researchPipeline";
import { structuredInstrumentToDraft } from "./aiResearchService";
import type { SourceClass } from "../shared/instrumentProfile";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);
const bankContract = getCatalogueFieldContract("bank")!;

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ── A. num() parsing, via buildPromotionPlan (num() itself is private) ────────

describe("Stage 10b-1b · A — numeric parsing tolerates currency prefixes and unit suffixes (5, 6)", () => {
  const base = { target: "bank" as const, name: "Test Bank Product", assetClass: "bank_deposit", issuer: "Test Bank", source: "QA" };

  it("5. '10.50% per annum' parses to 10.5", () => {
    const plan = buildPromotionPlan({ ...base, figures: { indicativeRate: "10.50% per annum" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.indicativeRate).toBeCloseTo(10.5);
  });

  it("'8.50% per annum' parses to 8.5", () => {
    const plan = buildPromotionPlan({ ...base, figures: { indicativeRate: "8.50% per annum" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.indicativeRate).toBeCloseTo(8.5);
  });

  it("6. 'KES 50,000' parses to 50000", () => {
    const plan = buildPromotionPlan({ ...base, figures: { minAmount: "KES 50,000" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.minAmount).toBe(50000);
  });

  it("6. 'Ksh 50,000' parses to 50000", () => {
    const plan = buildPromotionPlan({ ...base, figures: { minAmount: "Ksh 50,000" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.minAmount).toBe(50000);
  });

  it("a clean, already-numeric string still parses exactly as before (no regression)", () => {
    const plan = buildPromotionPlan({ ...base, figures: { indicativeRate: "12.5", minAmount: "1000" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.indicativeRate).toBe(12.5);
    expect(plan.payload.minAmount).toBe(1000);
  });

  it("a genuinely non-numeric value (missing_from_source, free text with no digits) still parses to null, never a fabricated 0", () => {
    const plan = buildPromotionPlan({ ...base, figures: { indicativeRate: "missing_from_source", minAmount: "not published" } });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.indicativeRate).toBeNull();
    expect(plan.payload.minAmount).toBeNull();
  });
});

// ── B. Gate alias widening, via checkApprovalGate directly ────────────────────

describe("Stage 10b-1b · B — approval gate accepts established Bank fields as satisfying liquidity/withdrawal terms (3, 4)", () => {
  const base = {
    assetClass: "bank_deposit" as const,
    changeKind: "create" as const,
    name: "Test Bank Product",
    issuer: "Test Bank",
    source: "QA",
    asOf: Date.UTC(2026, 6, 17),
  };
  const complete = {
    instrumentType: "fixed_deposit",
    minAmount: "50000",
    indicativeRate: "10.5",
    isNegotiable: "false",
    // Escapes the SEPARATE typicalTenor rule (tenor/notice period is its own
    // required field, distinct from the liquidity/withdrawal-terms rule this
    // block is testing) so each test below isolates the liquidity rule alone.
    fullyLiquid: true,
  };

  it("3. tenor alone satisfies liquidity/withdrawal terms", () => {
    const gate = checkApprovalGate({ ...base, figures: { ...complete, typicalTenor: "90 days" } });
    expect(gate.ok).toBe(true);
  });

  it("3. earlyWithdrawalRule alone satisfies it (even with no tenor)", () => {
    const gate = checkApprovalGate({ ...base, figures: { ...complete, earlyWithdrawalRule: "Interest forfeited if withdrawn before maturity" } });
    expect(gate.ok).toBe(true);
  });

  it("3. accessSpeed alone satisfies it", () => {
    const gate = checkApprovalGate({ ...base, figures: { ...complete, accessSpeed: "Available at maturity within 1 business day" } });
    expect(gate.ok).toBe(true);
  });

  it("4. does not falsely block the live QA test data (tenor + earlyWithdrawalRule + accessSpeed all present)", () => {
    const gate = checkApprovalGate({
      ...base,
      figures: {
        ...complete,
        typicalTenor: "90 days",
        earlyWithdrawalRule: "Interest forfeited if withdrawn before maturity",
        accessSpeed: "Funds available at maturity within 1 business day",
      },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("regression guard: with none of tenor/earlyWithdrawalRule/accessSpeed/liquidity present, the gate still correctly blocks — the fix widened what satisfies the rule, it did not disable it", () => {
    const gate = checkApprovalGate({ ...base, figures: complete });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("tenor / notice, early withdrawal rule, or access speed");
  });

  it("the legacy 'liquidity' key is still recognised (backward compatible, just no longer the only option)", () => {
    const gate = checkApprovalGate({ ...base, figures: { ...complete, liquidity: "on maturity" } });
    expect(gate.ok).toBe(true);
  });
});

// ── C. Full live-QA repro, end to end, pure (no DB/LLM) ────────────────────────

describe("Stage 10b-1b · C — the exact live QA scenario, extraction through promotion plan (1, 2, 7)", () => {
  const sourceText = `Bank name: Test Equity Bank Kenya Ltd
Product name: Test 90-Day Fixed Deposit
Product type: Fixed deposit
Indicative interest rate: 10.00% per annum
Withholding tax (WHT): 15.00%
Net return after WHT: 8.50% per annum
Minimum deposit: KES 50,000
Tenor / lock-in period: 90 days
Early withdrawal rule: Interest forfeited if withdrawn before maturity
Fees / charges: No monthly maintenance fee
Access speed: Funds available at maturity within 1 business day
Negotiable: No
As of: 17 July 2026
Source: Manually entered for Stage 10b-1 QA testing — not a live published source.`;

  // Stands in for what the LLM would have returned against the now-fixed
  // BANK_EXTRACTION_SCHEMA (productName/feesCharges/accessSpeed added), with
  // the user's post-extraction edit already applied (indicativeRate 10.00% →
  // 10.50%), same as round98/tieredSavingsRateScheduleNudge's established
  // convention of calling structuredInstrumentToDraft directly.
  const raw = {
    instrumentName: "Test Equity Bank Kenya Ltd — Test 90-Day Fixed Deposit",
    bankName: "Test Equity Bank Kenya Ltd",
    productName: "Test 90-Day Fixed Deposit",
    productType: "fixed_deposit",
    indicativeRate: "10.50% per annum",
    rateType: "indicative",
    minimumAmount: "KES 50,000",
    tenor: "90 days",
    noticePeriod: null,
    payoutFrequency: null,
    earlyWithdrawalPenalty: "Interest forfeited if withdrawn before maturity",
    feesCharges: "No monthly maintenance fee",
    accessSpeed: "Funds available at maturity within 1 business day",
    negotiable: "false",
    whtRate: "15.00%",
    rateSchedule: null,
    rawExcerpt: "Test 90-Day Fixed Deposit, 10.50% per annum",
    warnings: [],
    confidence: 0.95,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
  };
  const sharedFields = { asOfDate: "2026-07-17" };

  const draft = structuredInstrumentToDraft(raw, "bank_rate_card" as SourceClass, sharedFields, sourceText);

  it("1. productName is extracted into the draft's figures", () => {
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields.productName).toBe("Test 90-Day Fixed Deposit");
  });

  it("2. sourceAsOf is bridged from the shared asOfDate field to '2026-07-17'", () => {
    expect(draft!.sourceAsOf).toBe("2026-07-17");
  });

  it("feesCharges and accessSpeed are extracted into the draft's figures", () => {
    expect(draft!.extractedFields.feesCharges).toBe("No monthly maintenance fee");
    expect(draft!.extractedFields.accessSpeed).toBe("Funds available at maturity within 1 business day");
  });

  const finding: ProjectableFinding = {
    instrumentName: draft!.instrumentName,
    issuer: draft!.issuer,
    sourceLabel: "Manually entered for Stage 10b-1 QA testing — not a live published source.",
    sourceUrl: null,
    sourceAsOf: Date.parse(draft!.sourceAsOf!),
    extractedFields: draft!.extractedFields,
  };
  const figures = projectFindingToContractFigures(bankContract, finding);

  it("7. the contract projection carries productName, tenor, earlyWithdrawalRule, fees, accessSpeed, and indicativeRate through", () => {
    expect(figures.productName).toBe("Test 90-Day Fixed Deposit");
    expect(figures.tenor).toBe("90 days");
    expect(figures.earlyWithdrawalRule).toBe("Interest forfeited if withdrawn before maturity");
    expect(figures.fees).toBe("No monthly maintenance fee");
    expect(figures.accessSpeed).toBe("Funds available at maturity within 1 business day");
    expect(figures.indicativeRate).toBe("10.50% per annum");
  });

  it("10. the review queue / approval modal's full contract projection no longer shows productName/sourceAsOf as Missing for this data", () => {
    const rows = projectFindingToContractDisplayRows(bankContract, finding);
    expect(rows.find((r) => r.key === "productName")!.value).toBe("Test 90-Day Fixed Deposit");
    expect(rows.find((r) => r.key === "sourceAsOf")!.value).not.toBeNull();
  });

  it("4. the approval gate does not falsely block this data", () => {
    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      source: finding.sourceLabel,
      asOf: finding.sourceAsOf as number,
    });
    expect(gate.ok).toBe(true);
  });

  it("7. buildPromotionPlan preserves indicativeRate (10.5, not null/unavailable) and minAmount (50000, not 0) once minAmount is present in figures", () => {
    const plan = buildPromotionPlan({
      target: "bank",
      name: finding.instrumentName,
      assetClass: "bank_deposit",
      issuer: finding.issuer,
      figures: { ...figures, minAmount: "KES 50,000" },
      source: finding.sourceLabel!,
    });
    if (plan.target !== "bank") throw new Error("unreachable");
    expect(plan.payload.indicativeRate).toBeCloseTo(10.5);
    expect(plan.payload.minAmount).toBe(50000);
    expect(plan.payload.instrumentType).toBe("fixed_deposit");
  });
});

// ── D. Static source-text scan ─────────────────────────────────────────────────

const aiResearchSrc = read("server/aiResearchService.ts");
const researchPipelineSrc = read("shared/researchPipeline.ts");
const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");
const askAiPage = read("client/src/pages/AskAI.tsx");

describe("Stage 10b-1b · D — BANK_EXTRACTION_SCHEMA carries productName, feesCharges, accessSpeed, and a source-wide asOfDate", () => {
  const idx = aiResearchSrc.indexOf('const BANK_EXTRACTION_SCHEMA = {');
  const nextIdx = aiResearchSrc.indexOf("/** Market asset extraction schema. */", idx);
  const block = aiResearchSrc.slice(idx, nextIdx);

  it("productName is a distinct schema field, not folded into instrumentName", () => {
    expect(block).toContain("productName:");
    expect(block).toContain('"instrumentName", "bankName", "productName", "productType"');
  });

  it("feesCharges and accessSpeed are schema fields", () => {
    expect(block).toContain("feesCharges:");
    expect(block).toContain("accessSpeed:");
    expect(block).toContain('"feesCharges"');
    expect(block).toContain('"accessSpeed"');
  });

  it("a source-wide asOfDate field exists, mirroring MMF's benchmarkDate bridge", () => {
    expect(block).toContain("asOfDate:");
    expect(block).toContain('required: ["answer", "asOfDate", "instruments"]');
  });

  it("runStructuredExtraction captures parsed.asOfDate into sharedFields", () => {
    expect(aiResearchSrc).toContain("if (parsed.asOfDate) sharedFields.asOfDate = parsed.asOfDate;");
  });

  it("structuredInstrumentToDraft bridges bankSourceAsOf into the final sourceAsOf, alongside mmfBenchmarkAsOf", () => {
    expect(aiResearchSrc).toContain("const bankSourceAsOf =");
    expect(aiResearchSrc).toContain("mmfBenchmarkAsOf ?? bankSourceAsOf");
  });
});

describe("Stage 10b-1b · D — numeric parsing and gate alias fixes are present in shared/researchPipeline.ts", () => {
  it("num() matches the first numeric token instead of requiring the whole string to already be clean", () => {
    expect(researchPipelineSrc).toContain("const match = stripped.match(/-?\\d+(?:\\.\\d+)?/);");
  });

  it("figurePresent's liquidity alias list includes the established Bank fields", () => {
    const idx = researchPipelineSrc.indexOf("liquidity: [");
    const block = researchPipelineSrc.slice(idx, idx + 260);
    for (const alias of ["typicalTenor", "tenor", "noticePeriod", "earlyWithdrawalPenalty", "earlyWithdrawalRule", "accessSpeed"]) {
      expect(block).toContain(`"${alias}"`);
    }
  });

  it("CATALOGUE_FIELD_RULES.bank's liquidity rule label names the established fields, not the orphaned legacy field", () => {
    expect(researchPipelineSrc).toContain('label: "tenor / notice, early withdrawal rule, or access speed"');
  });

  it("bankInstrumentTypeLabel is exported and canonicalizes both short and long-form product types", () => {
    expect(bankInstrumentTypeLabel("fixed_deposit")).toBe("Fixed deposit");
    expect(bankInstrumentTypeLabel("target_goal_savings")).toBe("Target savings");
    expect(bankInstrumentTypeLabel(null)).toBeNull();
    expect(bankInstrumentTypeLabel("some_unrecognised_type")).toBe("some unrecognised type");
  });
});

describe("Stage 10b-1b · D — fees/accessSpeed moved to extendedFields in the contract", () => {
  const contractSrc = read("shared/catalogueFieldContracts.ts");
  const idx = contractSrc.indexOf('key: "fees",');
  const block = contractSrc.slice(idx, contractSrc.indexOf('key: "sourceLink",', idx));

  it("fees and accessSpeed are storageStatus 'extendedFields', not 'missingRequiresMigration'", () => {
    expect(block).not.toContain('"missingRequiresMigration"');
    const feesBlock = block.slice(0, block.indexOf('key: "accessSpeed"'));
    const accessSpeedBlock = block.slice(block.indexOf('key: "accessSpeed"'));
    expect(feesBlock).toContain('storageStatus: "extendedFields"');
    expect(accessSpeedBlock).toContain('storageStatus: "extendedFields"');
  });
});

describe("Stage 10b-1b · D — BankInstruments.tsx reads fees/accessSpeed from extendedFields instead of hardcoding 'Not available'", () => {
  const bankPage = read("client/src/pages/BankInstruments.tsx");

  it("the table row reads fees/accessSpeed via readContractFieldValue, same pattern as productName/earlyWithdrawalRule", () => {
    expect(bankPage).toContain('const fees = readContractFieldValue(extendedFields, bankFieldByKey("fees")!);');
    expect(bankPage).toContain('const accessSpeed = readContractFieldValue(extendedFields, bankFieldByKey("accessSpeed")!);');
    expect(bankPage).toContain("{fees ?? \"Not available\"}");
    expect(bankPage).toContain("{accessSpeed ?? \"Not available\"}");
  });

  it("the drawer facts read fees/accessSpeed via readContractFieldValue too", () => {
    expect(bankPage).toContain('readContractFieldValue(drawerRow.extendedFields, bankFieldByKey("fees")!) ?? "Not available"');
    expect(bankPage).toContain('readContractFieldValue(drawerRow.extendedFields, bankFieldByKey("accessSpeed")!) ?? "Not available"');
  });
});

describe("Stage 10b-1b · D — Bank productType displays cleanly (not the raw enum) in the review queue, approval modal, and Ask AI (8)", () => {
  it("fmtFigures (ResearchDesk.tsx pending-card raw figures) maps bank productType/instrumentType through bankInstrumentTypeLabel", () => {
    const idx = researchDeskPage.indexOf("function fmtFigures(");
    const block = researchDeskPage.slice(idx, researchDeskPage.indexOf("function DigestHeader", idx));
    expect(block).toContain('contract?.catalogue === "bank" && (k === "productType" || k === "instrumentType")');
    expect(block).toContain("bankInstrumentTypeLabel(raw)");
  });

  it("the approval modal's contractRows render maps bank productType through bankInstrumentTypeLabel", () => {
    // Stage 10b-2b widened this window — the block grew (CBK's isCbk/
    // securityType/taxExempt/netYieldAfterWht branches) — landmark-bounded
    // instead of a fixed offset so it doesn't re-break as the block grows again.
    const idx = researchDeskPage.indexOf("{contractRows.map((row) => {");
    const nextIdx = researchDeskPage.indexOf("</div>", idx);
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain('data?.catalogue === "bank" && row.key === "productType"');
    expect(block).toContain("bankInstrumentTypeLabel(raw)");
  });

  it("the pending-card contractRows render maps bank productType through bankInstrumentTypeLabel", () => {
    const idx = researchDeskPage.indexOf("{contractRows.map((row) => {", researchDeskPage.indexOf("{contractRows.map((row) => {") + 1);
    const nextIdx = researchDeskPage.indexOf("</div>", idx);
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain('contract.catalogue === "bank" && row.key === "productType"');
    expect(block).toContain("bankInstrumentTypeLabel(raw)");
  });

  it("AskAI.tsx's Bank catalogue fields block maps productType through bankInstrumentTypeLabel", () => {
    const idx = askAiPage.indexOf("Bank catalogue fields");
    const block = askAiPage.slice(idx, idx + 700);
    expect(block).toContain('row.key === "productType"');
    expect(block).toContain("bankInstrumentTypeLabel(row.value)");
  });

  it("bankInstrumentTypeLabel is imported into both ResearchDesk.tsx and AskAI.tsx from the shared module", () => {
    expect(researchDeskPage).toContain("bankInstrumentTypeLabel");
    expect(askAiPage).toContain("bankInstrumentTypeLabel");
  });
});

// ── E. Full edit → approve → published-row path (requires DATABASE_URL) ────────

describe.skipIf(!hasDb)("Stage 10b-1b · E — the exact live QA workflow round-trips through the real DB (requires DATABASE_URL)", () => {
  const TEST_BANK = `ZZ Stage10b1b Bank ${Date.now()}`;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.bankInstruments).set({ isActive: false }).where(eq(schema.bankInstruments.bankName, TEST_BANK));
  });

  it("11/12/13. a pending Bank update carrying the QA scenario's figures — including a post-draft rate edit via updatePendingFields — approves cleanly and publishes every field correctly, matching the reported live bug list item for item", async () => {
    const { enqueueResearchUpdate, getBankInstruments } = await import("./db");
    const pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_BANK,
      assetClass: "bank_deposit",
      issuer: TEST_BANK,
      currency: "KES",
      figures: {
        instrumentType: "fixed_deposit",
        minAmount: "KES 50,000",
        typicalTenor: "90 days",
        indicativeRate: "10.00% per annum",
        isNegotiable: "false",
        productName: "Test 90-Day Fixed Deposit",
        earlyWithdrawalRule: "Interest forfeited if withdrawn before maturity",
        fees: "No monthly maintenance fee",
        accessSpeed: "Funds available at maturity within 1 business day",
      },
      source: "Manually entered for Stage 10b-1 QA testing — not a live published source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));

    // The user's edit: correcting the rate to 10.50% before approving, via the
    // same multi-field edit path (updatePendingFields) MMF already uses.
    const edited = await caller.researchPipeline.updatePendingFields({
      id: pendingId as number,
      figures: { indicativeRate: "10.50% per annum" },
    });
    expect((edited.update.figures as Record<string, unknown>).indicativeRate).toBe("10.50% per annum");

    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const live = await getBankInstruments();
    const published = live.find((b) => b.bankName === TEST_BANK);
    expect(published).toBeTruthy();
    // 5. rate promoted correctly, not "Rate unavailable" (null).
    expect(published!.indicativeRate).toBeCloseTo(10.5);
    // 6. minimum deposit promoted correctly, not 0.
    expect(published!.minAmount).toBe(50000);
    // 8. product type canonicalized, not raw.
    expect(published!.instrumentType).toBe("fixed_deposit");
    const ext = published?.extendedFields as Record<string, unknown> | null;
    // 1. product name preserved.
    expect(ext?.productName).toBe("Test 90-Day Fixed Deposit");
    // 7. fees/access speed preserved.
    expect(ext?.fees).toBe("No monthly maintenance fee");
    expect(ext?.accessSpeed).toBe("Funds available at maturity within 1 business day");
  });
});
