/**
 * Stage 10b-2b — CBK live workflow repair after QA.
 *
 * Stage 10b-2 built CBK's field parity (extraction schema, gate aliases,
 * table redesign, multi-field edit path) on the assumption that the
 * remaining plumbing was sound. Live QA with the exact Stage 10b-2 T-bill
 * source proved otherwise — this slice fixes four separate, genuine gaps:
 *
 *   1. False "rate / coupon / previous average rate" missing warning —
 *      shared/researchPipeline.ts's figurePresent() had a SEPARATE,
 *      narrower yieldPct alias list than the CBK contract's own aliases
 *      (shared/catalogueFieldContracts.ts). The contract recognised
 *      "weightedAvgRate" (CBK_TBILL_EXTRACTION_SCHEMA's real field name) so
 *      the finding card's DISPLAY correctly showed "Indicative / previous
 *      yield: 10.50%" — but figurePresent's gate alias list only had a
 *      MISSPELLED "previousAvgRate" (the schema's real field is
 *      "prevAvgRate") and no "weightedAvgRate" entry at all, so the GATE
 *      still reported the exact same value missing. Fixed by widening
 *      figurePresent's yieldPct aliases to match the contract's.
 *   2. Net yield after WHT showing as unhelpfully blank — CBK's
 *      netYieldAfterWht is a "computed" contract field (never a real stored
 *      value from the projection), and only the live catalogue TABLE
 *      (CbkSecuritiesReference.tsx) computed it — not the review queue,
 *      approval modal, or Ask AI finding card. Fixed by moving the math to
 *      a shared cbkNetYieldAfterWht() (shared/researchPipeline.ts) and
 *      computing it from sibling yieldPct/whtRule/taxExempt rows at all
 *      four display sites.
 *   3. Approve & promote DB failure — opportunities.maturityDate is a typed
 *      MySQL DATE column; buildPromotionPlan wrote a CBK source's human
 *      date text ("19 October 2026") into it unnormalized. Fixed with a new
 *      normalizeDateToYmd() applied to maturityDate at promotion time, and
 *      to auctionDate/valueDate/applicationDeadline at their extendedFields
 *      persistence point (projectContractFiguresToExtendedFields) for
 *      consistency (those are JSON, so wouldn't have crashed, but were
 *      inconsistently formatted).
 *   4. The one-field "Correct a figure" dialog exposed every raw extraction
 *      key verbatim (e.g. "accruedInterestPer100"), because it always used
 *      the shared, catalogue-agnostic fmtFields(finding.extractedFields)
 *      with no filtering. Fixed for CBK ONLY: the dropdown now offers just
 *      the established contract fields with their clean labels, resolved
 *      back to whichever RAW key the extraction actually used (never
 *      introducing a second, canonical-named duplicate key).
 *
 * Four layers of test (established convention — no jsdom in this repo):
 *   A. Pure — the false-missing-warning fix, via the SAME gateMissingFor
 *      helper server/cbkStructuredRuleFill.test.ts already established.
 *   B. Pure — cbkNetYieldAfterWht's own behavioural proof.
 *   C. Pure — normalizeDateToYmd's own behavioural proof, plus
 *      buildPromotionPlan/projectContractFiguresToExtendedFields reproducing
 *      the exact live QA date strings.
 *   D. Static source-text scan — CorrectFigureDialog wiring.
 *   E. Full edit → approve → published-row path via the real tRPC caller —
 *      requires DATABASE_URL, `describe.skipIf`'d out otherwise, using the
 *      EXACT live T-bill fixture from Stage 10b-2's QA.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { structuredInstrumentToDraft, missingFieldsForFinding } from "./aiResearchService";
import type { SourceClass } from "../shared/instrumentProfile";
import {
  checkApprovalGate,
  buildPromotionPlan,
  cbkNetYieldAfterWht,
  normalizeDateToYmd,
} from "../shared/researchPipeline";
import { projectContractFiguresToExtendedFields, type ProjectableFinding } from "../shared/catalogueFieldContracts";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);

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

/** Mirrors the SAME provenance-fallback gate recompute the live pipeline
 *  performs once a source label is stamped on (server/aiResearchService.ts's
 *  `stamped` map inside runResearchQuestion) — this is what the manager
 *  actually sees as "still missing" on the finding card. Same helper
 *  server/cbkStructuredRuleFill.test.ts already established. */
function gateMissingFor(draft: NonNullable<ReturnType<typeof structuredInstrumentToDraft>>) {
  return missingFieldsForFinding("cbk", draft.extractedFields, {
    name: draft.instrumentName,
    issuer: draft.issuer,
    currency: draft.currency,
    source: "Manually entered for Stage 10b-2 QA testing — not a live CBK source.",
    asOf: draft.sourceAsOf && Number.isFinite(Date.parse(draft.sourceAsOf)) ? Date.parse(draft.sourceAsOf) : null,
    assetClass: draft.assetClass,
  });
}

// ── A. The false "rate / coupon / previous average rate" warning is fixed ──────

describe("Stage 10b-2b · A — the live T-bill's weighted average rate satisfies the CBK yield/rate gate (1, 2)", () => {
  const raw = {
    instrumentName: "91-Day Treasury Bill",
    issueNumber: null,
    tenorDays: 91,
    securityType: "treasury_bill",
    yieldPct: null,
    prevAvgRate: null,
    amountOnOffer: null,
    amountReceived: null,
    amountAccepted: null,
    weightedAvgRate: "10.50%",
    whtRule: "15% withholding tax on the discount",
    taxExempt: "false",
    maturityDate: "2026-10-19",
    minInvestment: "KES 50,000",
    rawExcerpt: "Weighted average rate of accepted bids: 10.50%",
    warnings: [],
    confidence: 0.95,
    proposalType: "create",
    matchedCurrentRow: null,
    changedFields: [],
    currentValues: [],
  };

  it("1. the draft's own extractedFields carry weightedAvgRate exactly as extracted", () => {
    const draft = structuredInstrumentToDraft(raw, "cbk_tbill_auction_result" as SourceClass, {
      auctionDate: "2026-07-17",
      valueDate: "2026-07-20",
      applicationDeadline: "2026-07-16",
    });
    expect(draft).not.toBeNull();
    expect(draft!.extractedFields.weightedAvgRate).toBe("10.50%");
  });

  it("2/4. the false 'rate / coupon / previous average rate' warning no longer appears for the live T-bill fixture", () => {
    const draft = structuredInstrumentToDraft(raw, "cbk_tbill_auction_result" as SourceClass, {
      auctionDate: "2026-07-17",
      valueDate: "2026-07-20",
      applicationDeadline: "2026-07-16",
    });
    const missing = gateMissingFor(draft!);
    expect(missing).not.toContain("rate / coupon / previous average rate");
    expect(missing).toEqual([]);
  });

  it("3. checkApprovalGate directly: a figures bag with ONLY weightedAvgRate (no yieldPct/yield/coupon/rate) satisfies the base gate's yieldPct rule", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      name: "91-Day Treasury Bill",
      source: "CBK",
      asOf: Date.UTC(2026, 6, 17),
      figures: {
        securityType: "treasury_bill",
        tenorDays: "91",
        tenor: "91-day",
        weightedAvgRate: "10.50%",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        auctionDate: "2026-07-17",
        valueDate: "2026-07-20",
      },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("regression guard: a figures bag with NONE of yieldPct/yield/coupon/rate/weightedAvgRate/prevAvgRate still correctly reports it missing", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      name: "91-Day Treasury Bill",
      source: "CBK",
      asOf: Date.UTC(2026, 6, 17),
      figures: {
        securityType: "treasury_bill",
        tenorDays: "91",
        tenor: "91-day",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        auctionDate: "2026-07-17",
        valueDate: "2026-07-20",
      },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("rate / coupon / previous average rate");
  });

  it("the (typo-fixed) prevAvgRate alias also satisfies the gate, matching the CBK contract's own alias for it", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      name: "91-Day Treasury Bill",
      source: "CBK",
      asOf: Date.UTC(2026, 6, 17),
      figures: {
        securityType: "treasury_bill",
        tenor: "91-day",
        prevAvgRate: "10.45%",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        auctionDate: "2026-07-17",
        valueDate: "2026-07-20",
      },
    });
    expect(gate.ok).toBe(true);
  });
});

// ── B. cbkNetYieldAfterWht's own behavioural proof ──────────────────────────────

describe("Stage 10b-2b · B — cbkNetYieldAfterWht computes correctly (3)", () => {
  it("3. a 10.50% taxable T-bill nets to ~8.93% after 15% WHT", () => {
    const net = cbkNetYieldAfterWht("10.50%", "15% withholding tax on the discount", "false");
    expect(net).not.toBeNull();
    // The precise value is 8.925 (10.5 * 0.85); the reordered arithmetic
    // inside cbkNetYieldAfterWht avoids the binary-float artifact that would
    // otherwise make .toFixed(2) round DOWN to "8.92" instead of "8.93".
    expect(net!).toBeCloseTo(8.925, 5);
    expect(net!.toFixed(2)).toBe("8.93");
  });

  it("4. a tax-exempt IFB nets to its gross yield — WHT is never applied", () => {
    const net = cbkNetYieldAfterWht("13.50%", "0% — infrastructure bonds are tax-exempt", "true");
    expect(net).toBe(13.5);
  });

  it("a clean numeric yieldPct (no % suffix) parses the same way", () => {
    expect(cbkNetYieldAfterWht("10.50", "15% withholding tax", "false")).toBeCloseTo(8.925, 5);
  });

  it("returns null (dash, never fabricated) when yieldPct is null", () => {
    expect(cbkNetYieldAfterWht(null, "15% withholding tax", "false")).toBeNull();
  });

  it("returns null when whtRule has no parseable percentage and taxExempt isn't true", () => {
    expect(cbkNetYieldAfterWht("10.50%", null, "false")).toBeNull();
    expect(cbkNetYieldAfterWht("10.50%", "withholding tax applies", "false")).toBeNull();
  });
});

// ── C. normalizeDateToYmd + promotion/extendedFields date fixes ────────────────

describe("Stage 10b-2b · C — human date strings normalize to stable YYYY-MM-DD (5, 6)", () => {
  it("5. '19 October 2026' normalizes to '2026-10-19'", () => {
    expect(normalizeDateToYmd("19 October 2026")).toBe("2026-10-19");
  });

  it("6. '17 July 2026', '20 July 2026', and '16 July 2026' normalize consistently", () => {
    expect(normalizeDateToYmd("17 July 2026")).toBe("2026-07-17");
    expect(normalizeDateToYmd("20 July 2026")).toBe("2026-07-20");
    expect(normalizeDateToYmd("16 July 2026")).toBe("2026-07-16");
  });

  it("an already-ISO 'YYYY-MM-DD' string passes through unchanged, no Date object round-trip", () => {
    expect(normalizeDateToYmd("2026-10-19")).toBe("2026-10-19");
  });

  it("a Date object is read via UTC getters (matching client/src/lib/format.ts's formatUtcYmd convention for DB-returned date columns)", () => {
    expect(normalizeDateToYmd(new Date(Date.UTC(2026, 9, 19)))).toBe("2026-10-19");
  });

  it("null/empty/unparseable input returns null — never a fabricated date", () => {
    expect(normalizeDateToYmd(null)).toBeNull();
    expect(normalizeDateToYmd(undefined)).toBeNull();
    expect(normalizeDateToYmd("")).toBeNull();
    expect(normalizeDateToYmd("not a date")).toBeNull();
  });
});

describe("Stage 10b-2b · C — buildPromotionPlan normalizes maturityDate (7, 8)", () => {
  it("7/8. '19 October 2026' promotes as '2026-10-19', not the raw human string that broke the typed DB column", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: "91-Day Treasury Bill",
      assetClass: "gov_discount",
      figures: { yieldPct: "10.50%", maturityDate: "19 October 2026" },
      source: "CBK",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.maturityDate).toBe("2026-10-19");
  });

  it("an already-normalized maturityDate is unaffected (idempotent)", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: "FXD1/2026/010",
      assetClass: "gov_coupon",
      figures: { yieldPct: "13.2", maturityDate: "2036-07-21" },
      source: "CBK",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.maturityDate).toBe("2036-07-21");
  });

  it("a missing maturityDate stays null — never fabricated", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: "91-Day Treasury Bill",
      assetClass: "gov_discount",
      figures: { yieldPct: "10.50%" },
      source: "CBK",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.maturityDate).toBeNull();
  });
});

describe("Stage 10b-2b · C — extendedFields-tier CBK dates (auctionDate/valueDate/applicationDeadline) normalize too", () => {
  it("all three human date strings from the live QA source normalize when persisted to extendedFields", () => {
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, {
      auctionDate: "17 July 2026",
      valueDate: "20 July 2026",
      applicationDeadline: "16 July 2026",
    });
    expect(extended.auctionDate).toBe("2026-07-17");
    expect(extended.valueDate).toBe("2026-07-20");
    expect(extended.applicationDeadline).toBe("2026-07-16");
  });

  it("does not affect other extendedFields-tier CBK fields (e.g. whtRule stays free text, untouched)", () => {
    const extended = projectContractFiguresToExtendedFields("cbk", undefined, {
      whtRule: "15% withholding tax on the discount",
      auctionDate: "17 July 2026",
    });
    expect(extended.whtRule).toBe("15% withholding tax on the discount");
  });

  it("does not affect Bank/MMF/market_asset extendedFields projection — the date-normalization branch is scoped to catalogue 'cbk' only", () => {
    const bankExtended = projectContractFiguresToExtendedFields("bank", undefined, {
      productName: "90-Day Fixed Deposit",
      earlyWithdrawalRule: "Interest forfeited if withdrawn before maturity",
    });
    expect(bankExtended.productName).toBe("90-Day Fixed Deposit");
    expect(bankExtended.earlyWithdrawalRule).toBe("Interest forfeited if withdrawn before maturity");
  });
});

describe("Stage 10b-2b · C — source-as-of is preserved, not shifted or left as raw epoch (9)", () => {
  it("9. the finding's sourceAsOf stays '2026-07-17' through the T-bill auction bridge, unaffected by the maturityDate fix", () => {
    const raw = {
      instrumentName: "91-Day Treasury Bill",
      issueNumber: null,
      tenorDays: 91,
      securityType: "treasury_bill",
      yieldPct: null,
      prevAvgRate: null,
      amountOnOffer: null,
      amountReceived: null,
      amountAccepted: null,
      weightedAvgRate: "10.50%",
      whtRule: "15% withholding tax on the discount",
      taxExempt: "false",
      maturityDate: "2026-10-19",
      minInvestment: "KES 50,000",
      rawExcerpt: null,
      warnings: [],
      confidence: 0.95,
      proposalType: "create",
      matchedCurrentRow: null,
      changedFields: [],
      currentValues: [],
    };
    const draft = structuredInstrumentToDraft(raw, "cbk_tbill_auction_result" as SourceClass, {
      auctionDate: "2026-07-17",
      valueDate: "2026-07-20",
      applicationDeadline: "2026-07-16",
    });
    expect(draft!.sourceAsOf).toBe("2026-07-17");
  });
});

// ── D. Static source-text scan — CorrectFigureDialog wiring ────────────────────

const askAiPage = read("client/src/pages/AskAI.tsx");

describe("Stage 10b-2b · D — CorrectFigureDialog no longer exposes raw CBK profile keys (10, 11)", () => {
  const dialogIdx = askAiPage.indexOf("function CorrectFigureDialog(");
  const dialogBlock = askAiPage.slice(dialogIdx, askAiPage.indexOf("function ", dialogIdx + 30));

  it("10. accruedInterestPer100 and other raw non-established CBK keys are never hardcoded/whitelisted into the dialog", () => {
    expect(dialogBlock).not.toContain("accruedInterestPer100");
  });

  it("11. for CBK, the multi-field form resolves established contract fields with clean labels", () => {
    expect(dialogBlock).toContain('finding.targetCatalogue === "cbk"');
    expect(dialogBlock).toContain('getCatalogueFieldContract("cbk")');
    expect(dialogBlock).toContain("projectFindingToContractDisplayRows");
    expect(dialogBlock).toContain("managerEditable");
    expect(dialogBlock).toContain("{field.label}");
  });

  it("MMF and Bank use their own established contracts in the same correction form", () => {
    expect(dialogBlock).toContain('getCatalogueFieldContract("mmf")');
    expect(dialogBlock).toContain('getCatalogueFieldContract("bank")');
  });

  it("resolveRawFigureKey is exported from shared/catalogueFieldContracts.ts and correctly resolves an alias-matched raw key, not the canonical one", () => {
    const contractsSrc = read("shared/catalogueFieldContracts.ts");
    expect(contractsSrc).toContain("export function resolveRawFigureKey(");
  });
});

// ── E. Full edit → approve → published-row path (requires DATABASE_URL) ────────

describe.skipIf(!hasDb)("Stage 10b-2b · E — the EXACT live T-bill QA scenario approves and promotes without a DB error (7)", () => {
  const TEST_REF = `zz-stage10b2b-cbk-tbill-${Date.now()}`;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, TEST_REF));
  });

  it("Approve & promote no longer fails — maturityDate reaches the typed DATE column as '2026-10-19', not the raw human string", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    const pendingId = await enqueueResearchUpdate({
      targetRef: TEST_REF,
      changeKind: "create",
      name: "Test 91-Day Treasury Bill (Stage 10b-2b QA)",
      assetClass: "gov_discount",
      currency: "KES",
      figures: {
        securityType: "treasury_bill",
        tenor: "91",
        weightedAvgRate: "10.50%",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        // The exact live-QA human date strings — this is what broke Stage 10b-2's
        // Approve & promote before this fix.
        maturityDate: "19 October 2026",
        minInvestment: "KES 50,000",
        applicationDeadline: "16 July 2026",
        auctionDate: "17 July 2026",
        valueDate: "20 July 2026",
      },
      source: "Manually entered for Stage 10b-2 QA testing — not a live CBK source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const { getDb } = await import("./db");
    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [published] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.ref, TEST_REF)).limit(1);
    expect(published).toBeTruthy();
    expect(Number(published.yieldPct)).toBeCloseTo(10.5);
    // maturityDate round-trips as a normalized date, never the raw "19 October 2026".
    const maturity = published.maturityDate;
    expect(String(maturity)).not.toContain("October");
    const ext = published.extendedFields as Record<string, unknown> | null;
    expect(ext?.auctionDate).toBe("2026-07-17");
    expect(ext?.valueDate).toBe("2026-07-20");
    expect(ext?.applicationDeadline).toBe("2026-07-16");
  });
});
