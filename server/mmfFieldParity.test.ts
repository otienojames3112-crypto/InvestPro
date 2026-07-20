/**
 * Stage 10a — MMF end-to-end catalogue field parity repair.
 *
 * Reproduces the exact Stage 9f-1 live-test data (a pasted-text MMF source
 * with EAR 12.50%, gross yield 14.20%, management fee 2.00%, minimum
 * investment KES 1,000, AUM KES 500 million, as-of 17 July 2026) and proves
 * the four real product breaks that test exposed are fixed:
 *
 *   1. The approval modal falsely warned fund name/company/source/as-of were
 *      missing when they were present — `impactOf` (server/routers.ts) never
 *      passed name/issuer/currency/source/asOf into checkApprovalGate, so
 *      every envelope-sourced gate rule always read them as undefined. Fixed
 *      by passing all five, matching what reviewResearchUpdate (server/db.ts)
 *      already did correctly.
 *   2. The review queue only showed filled figures, not the full established
 *      MMF field set. Fixed by reusing projectFindingToContractDisplayRows
 *      (already correct for AskAI.tsx's finding card) against an adapted
 *      update object, in both the pending-queue card and the approval modal.
 *   3. Correct Figure supported only one field and then dead-ended. Fixed by
 *      a new EditCatalogueFieldsDialog + updatePendingResearchUpdateFigures,
 *      which edits a PENDING update's figures in place (merged, not
 *      replaced) so a manager can save one field and keep editing another.
 *   4. EAR 12.50%/gross yield 14.20% promoted as 0.00%. Root cause: `num()`
 *      (shared/researchPipeline.ts) never stripped a trailing "%" — a
 *      documented, known gap since Slice 8b (see
 *      server/mmfContractMapping.test.ts's compatibility-test comment) that
 *      was never actually fixed until now. Fixed in `num()` itself, which
 *      also (harmlessly) benefits Bank/CBK/Market-asset promotion, though
 *      this slice tests MMF only per its explicit scope.
 *
 * Also closes two smaller, explicitly-listed field-parity gaps: WHT and AUM
 * are real mmf_funds columns promotion never wrote (documented gaps since
 * Slice 8b); withdrawal period has no column and is now folded into
 * extendedFields at promotion time, same pattern as sourceEnrichment.
 *
 * Three layers of test (established convention — no jsdom in this repo):
 *   A. Pure/behavioural — buildPromotionPlan, checkApprovalGate — no DB.
 *   B. Static source-text scan — ResearchDesk.tsx / MmfFunds.tsx / AskAI.tsx
 *      wiring.
 *   C. Full approve → promote → published-row path via the real tRPC caller
 *      — requires DATABASE_URL, `describe.skipIf`'d out otherwise (same
 *      established pattern as mmfBankPromotionAsOfDate.test.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPromotionPlan, checkApprovalGate } from "../shared/researchPipeline";
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

// The exact Stage 9f-1 live-test data, verbatim as Ask AI would have carried
// it through in a percent-suffixed figures bag.
const STAGE_9F1_FIGURES = {
  ear: "12.50%",
  grossYield: "14.20%",
  managementFee: "2.00%",
  minInvestment: "1000",
  wht: "15%",
  aum: "500",
};
const STAGE_9F1_NAME = "Test MMF Fund (Stage 9f-1 QA)";
const STAGE_9F1_ISSUER = "Test Asset Managers Kenya Ltd";
const STAGE_9F1_SOURCE = "Manually entered for Stage 9f-1 QA testing — not a live published source.";
const STAGE_9F1_ASOF = Date.UTC(2026, 6, 17); // 2026-07-17

// ── A. Pure/behavioural — no DB ─────────────────────────────────────────────

describe("Stage 10a · A — buildPromotionPlan: percent-suffixed MMF figures no longer collapse to 0", () => {
  it("7. EAR 12.50% and gross yield 14.20% promote as 12.5/14.2, not 0", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: STAGE_9F1_FIGURES,
      source: STAGE_9F1_SOURCE,
    });
    expect(plan.target).toBe("mmf");
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.ear).toBe(12.5);
    expect(plan.payload.grossYield).toBe(14.2);
    expect(plan.payload.ear).not.toBe(0);
    expect(plan.payload.grossYield).not.toBe(0);
  });

  it("management fee and minimum investment survive the same percent-suffixed format", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: STAGE_9F1_FIGURES,
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.managementFee).toBe(2);
    expect(plan.payload.minInvestment).toBe(1000);
  });

  it("a bare (non-percent) numeric string still parses exactly as before — no regression for the common case", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: { ear: "11.85", grossYield: "12.40" },
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.ear).toBe(11.85);
    expect(plan.payload.grossYield).toBe(12.4);
  });

  it("a thousands-separated value with a percent sign still parses correctly (both stripped)", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: { minInvestment: "1,000%" },
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.minInvestment).toBe(1000);
  });

  it("a genuinely unparseable value still returns null, never a fabricated number", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: { ear: "unavailable" },
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.ear).toBeNull();
  });
});

describe("Stage 10a · A — buildPromotionPlan: WHT/AUM/withdrawal period now flow through", () => {
  it("5. WHT and AUM are read into the MMF promotion payload (previously always dropped)", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      figures: STAGE_9F1_FIGURES,
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.wht).toBe(15);
    expect(plan.payload.aumMillions).toBe(500);
  });

  it("withdrawal period is read via either canonical key or the extraction-schema alias", () => {
    const viaCanonical = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      figures: { withdrawalPeriod: "24 hours" },
      source: STAGE_9F1_SOURCE,
    });
    const viaAlias = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      figures: { withdrawalNoticePeriod: "48 hours" },
      source: STAGE_9F1_SOURCE,
    });
    if (viaCanonical.target !== "mmf" || viaAlias.target !== "mmf") throw new Error("unreachable");
    expect(viaCanonical.payload.withdrawalPeriod).toBe("24 hours");
    expect(viaAlias.payload.withdrawalPeriod).toBe("48 hours");
  });

  it("WHT/AUM/withdrawal period are null (not fabricated) when the update never carried them", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: STAGE_9F1_NAME,
      assetClass: "cash_mmf",
      figures: { ear: "12" },
      source: STAGE_9F1_SOURCE,
    });
    if (plan.target !== "mmf") throw new Error("unreachable");
    expect(plan.payload.wht).toBeNull();
    expect(plan.payload.aumMillions).toBeNull();
    expect(plan.payload.withdrawalPeriod).toBeNull();
  });
});

describe("Stage 10a · A — checkApprovalGate: no false missing-field warning when values are present", () => {
  it("3. name/issuer/source/asOf all present → gate reports ok, nothing missing (the exact Stage 9f-1 repro shape)", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      figures: STAGE_9F1_FIGURES,
      name: STAGE_9F1_NAME,
      issuer: STAGE_9F1_ISSUER,
      source: STAGE_9F1_SOURCE,
      asOf: STAGE_9F1_ASOF,
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("regression guard: when name/issuer/source/asOf are genuinely absent, the gate still correctly reports them missing", () => {
    const gate = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      figures: STAGE_9F1_FIGURES,
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("fund name");
    expect(gate.missing.some((m) => m.includes("company") || m.includes("manager"))).toBe(true);
    expect(gate.missing).toContain("source");
    expect(gate.missing).toContain("as-of date");
  });
});

// ── B. Static source-text scan — ResearchDesk.tsx / MmfFunds.tsx / AskAI.tsx ─

const routersPage = read("server/routers.ts");
const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");
const mmfFundsPage = read("client/src/pages/MmfFunds.tsx");
const askAiPage = read("client/src/pages/AskAI.tsx");

describe("Stage 10a · B — impactOf now passes the full envelope into checkApprovalGate", () => {
  it("2. root cause of the false missing-field warning: name/issuer/currency/source/asOf are all passed", () => {
    const idx = routersPage.indexOf("impactOf: adminProcedure");
    const nextIdx = routersPage.indexOf("listSources: adminProcedure");
    const block = routersPage.slice(idx, nextIdx);
    expect(block).toContain("checkApprovalGate({");
    expect(block).toContain("name: update.name,");
    expect(block).toContain("issuer: update.issuer,");
    expect(block).toContain("currency: update.currency,");
    expect(block).toContain("source: update.source,");
    expect(block).toContain("asOf: update.asOf,");
  });
});

describe("Stage 10a · B — ResearchDesk.tsx: review queue shows the full established field set", () => {
  it("1. the pending-queue card renders contractRows via projectFindingToContractDisplayRows, not just filled figures", () => {
    expect(researchDeskPage).toContain("projectFindingToContractDisplayRows(fullContract, {");
    expect(researchDeskPage).toContain("Catalogue fields");
  });

  it("missing values render as a clean 'Missing' label, never a raw camelCase key", () => {
    // Stage 10b-1b widened the gap between "Catalogue fields" and the
    // "Missing" fallback (the Bank productType label-formatting lines) —
    // bounded by the next DialogFooter landmark instead of a fixed offset so
    // this doesn't re-break the next time this block grows.
    const idx = researchDeskPage.indexOf("Catalogue fields");
    const nextIdx = researchDeskPage.indexOf("<DialogFooter>", idx);
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain("Missing");
    expect(block).toContain("row.label");
    expect(block).not.toContain("{row.key}:");
  });

  it("existing fmtFigures/PendingDiffTable wiring (Slice 9b) is untouched", () => {
    expect(researchDeskPage).toContain("fmtFigures(u.figures as Record<string, unknown> | null, contract)");
    expect(researchDeskPage).toContain("<PendingDiffTable");
  });
});

describe("Stage 10a · B — ResearchDesk.tsx: approval modal shows full fields and offers an edit path", () => {
  it("4. ApproveDialog renders the same contract-projected rows, gated behind fullContract && update", () => {
    const idx = researchDeskPage.indexOf("function ApproveDialog(");
    const nextIdx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain("trpc.researchPipeline.getUpdate.useQuery(");
    expect(block).toContain("projectFindingToContractDisplayRows(fullContract, {");
    expect(block).toContain("Catalogue fields");
  });

  it("the approval modal offers an Edit entry point that opens the multi-field edit dialog", () => {
    expect(researchDeskPage).toContain("onEditFields");
    expect(researchDeskPage).toContain("onClick={onEditFields}");
  });

  it("the override control is only ever shown when the gate is actually blocked — never forced when required fields are present", () => {
    const idx = researchDeskPage.indexOf("function ApproveDialog(");
    const nextIdx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain("blocked && !overrideSatisfied");
    expect(block).toContain("const blocked = gate && !gate.ok;");
  });
});

describe("Stage 10a · B — ResearchDesk.tsx: multi-field edit dialog", () => {
  it("EditCatalogueFieldsDialog exists and calls the updatePendingFields mutation (Stage 10b-1 generalized this from MMF-only to MMF + Bank, Stage 10b-2 extended it further to CBK)", () => {
    expect(researchDeskPage).toContain("function EditCatalogueFieldsDialog(");
    expect(researchDeskPage).toContain("trpc.researchPipeline.updatePendingFields.useMutation(");
    const idx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const nextIdx = researchDeskPage.indexOf("/* ── Pending update review queue");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain('const isSupported = catalogue === "mmf" || catalogue === "bank" || catalogue === "cbk";');
    // Renders one labeled input per editable contract field, not a single field.
    expect(block).toContain("editableRows.map((row) =>");
    expect(block).toContain("managerEditable === true");
  });

  it("the Edit fields entry point on the pending card is gated to MMF, Bank, or CBK (Stage 10b-1 extended it from MMF-only, Stage 10b-2 added CBK) — see server/bankFieldParity.test.ts and server/cbkLiveWorkflowParity.test.ts for the catalogue-specific proofs", () => {
    expect(researchDeskPage).toContain('(contract.catalogue === "mmf" || contract.catalogue === "bank" || contract.catalogue === "cbk") && (');
    expect(researchDeskPage).toContain("Edit fields");
  });

  it("updatePendingFields mutation exists server-side and merges figures rather than replacing them", () => {
    expect(routersPage).toContain("updatePendingFields: adminProcedure");
    const dbPage = read("server/db.ts");
    expect(dbPage).toContain("export async function updatePendingResearchUpdateFigures(");
    const idx = dbPage.indexOf("export async function updatePendingResearchUpdateFigures(");
    const block = dbPage.slice(idx, idx + 1600);
    expect(block).toContain("...((current.figures as Record<string, unknown> | null) ?? {}),");
    expect(block).toContain("...(args.figures ?? {}),");
    // Guards against editing a no-longer-pending row.
    expect(block).toContain('current.status !== "pending"');
  });
});

describe("Stage 10a · B — MmfFunds.tsx: detail drawer surfaces Net yield/WHT/Withdrawal period/Risk profile", () => {
  it("6. MmfDetailDrawer exists and reads labels from the mmf contract, not hand-typed strings", () => {
    expect(mmfFundsPage).toContain("function MmfDetailDrawer(");
    expect(mmfFundsPage).toContain('getCatalogueFieldContract("mmf")');
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain('fieldByKey("netYield")');
    expect(block).toContain('fieldByKey("wht")');
    expect(block).toContain('fieldByKey("withdrawalPeriod")');
    expect(block).toContain('fieldByKey("riskProfile")');
  });

  it("Net yield is computed client-side from EAR and WHT, never a raw fabricated figure", () => {
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain("fund.ear * (1 - whtRate / 100)");
  });

  it("Risk profile is shown honestly as unavailable, never fabricated — matches the contract's own missingRequiresMigration status", () => {
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain('value="Not available"');
  });

  it("11. no raw camelCase keys are interpolated as literal display text in the drawer", () => {
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).not.toContain("{fund.whtRate}%"); // raw, unlabeled — must go through DrawerFact + a contract label
    expect(block).toContain("DrawerFact label={fieldByKey(");
  });

  it("the row action menu opens the drawer without any destructive/promoting side effect", () => {
    expect(mmfFundsPage).toContain("onClick={() => setDetailFund(fund)}");
    expect(mmfFundsPage).toContain("View full details");
  });
});

describe("Stage 10a · B — as-of date rendering uses a shared helper consistently (no more 3 different formats)", () => {
  // Stage 10a-2 correction: this originally read `formatLocalYmd` (local
  // getters). A Stage 10a-2 test proved that's the WRONG tool for THIS
  // pipeline's asOf/sourceAsOf values specifically — they're constructed via
  // `Date.parse("YYYY-MM-DD")` (an <input type="date"> value, or a source's
  // printed date), which parses to UTC midnight per spec, not local midnight.
  // Local getters on a UTC-anchored value drift a day backward for any viewer
  // behind UTC. Stage 10a-2 switched these call sites to `formatUtcYmd`
  // (client/src/lib/format.ts) instead — see mmfFieldParity2.test.ts for the
  // full root-cause writeup and the behavioural proof this really doesn't
  // drift. `formatLocalYmd` itself is untouched and remains correct for
  // locally-constructed date-only values elsewhere in the app.
  it("8. AskAI.tsx no longer uses toLocaleDateString()/toISOString().slice for finding.sourceAsOf display", () => {
    // The only remaining toISOString().slice(0, 10) usage in the file is the
    // unrelated default-date-input seed (new Date().toISOString()...), not a
    // sourceAsOf/asOf display — checked precisely via the surrounding text.
    expect(askAiPage).not.toContain("new Date(finding.sourceAsOf).toLocaleDateString()");
    expect(askAiPage).not.toContain("new Date(finding.sourceAsOf).toISOString().slice(0, 10)");
    expect(askAiPage).not.toContain("new Date(asOf).toLocaleDateString()");
    expect(askAiPage).toContain("formatUtcYmd(finding.sourceAsOf)");
    expect(askAiPage).toContain("formatUtcYmd(asOf)");
  });

  it("ResearchDesk.tsx's pending-card as-of display uses the same helper", () => {
    expect(researchDeskPage).not.toContain("new Date(u.asOf).toLocaleDateString()");
    expect(researchDeskPage).toContain("formatUtcYmd(u.asOf)");
  });

  it("9. formatUtcYmd never applies a UTC-vs-local shift — 17 July 2026 renders as 17 July, not 16", () => {
    const formatPath = join(ROOT, "client/src/lib/format.ts");
    const formatSrc = readFileSync(formatPath, "utf8");
    expect(formatSrc).toContain("export function formatUtcYmd(");
    // formatUtcYmd formats via toISOString — the SAME clock the value was
    // parsed against (Date.parse of a date-only string is UTC per spec), so
    // construction and display agree regardless of the viewer's timezone.
    const idx = formatSrc.indexOf("export function formatUtcYmd(");
    const block = formatSrc.slice(idx, idx + 300);
    expect(block).toContain("d.toISOString().slice(0, 10)");
  });
});

// ── C. Full approve → promote → published-row path (requires DATABASE_URL) ──

describe.skipIf(!hasDb)("Stage 10a · C — full Stage 9f-1 repro via the real tRPC caller (requires DATABASE_URL)", () => {
  const TEST_FUND = `ZZ Stage10a MMF ${Date.now()}`;
  let pendingId: number | null = null;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, TEST_FUND));
  });

  it("10. impactOf no longer falsely warns fund name/company/source/as-of are missing when they're present", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_FUND,
      assetClass: "cash_mmf",
      issuer: STAGE_9F1_ISSUER,
      currency: "KES",
      figures: STAGE_9F1_FIGURES,
      source: STAGE_9F1_SOURCE,
      asOf: STAGE_9F1_ASOF,
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const preview = await caller.researchPipeline.impactOf({ id: pendingId as number });
    expect(preview.gate.ok).toBe(true);
    expect(preview.gate.missing).toEqual([]);
  });

  it("multi-field edit (updatePendingFields) merges a correction onto the SAME pending update without losing the rest", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.updatePendingFields({
      id: pendingId as number,
      figures: { managementFee: "2.25%" },
    });
    expect(res.update.status).toBe("pending");
    const figures = res.update.figures as Record<string, unknown>;
    expect(figures.managementFee).toBe("2.25%");
    // The rest of the Stage 9f-1 figures survive the merge, untouched.
    expect(figures.ear).toBe(STAGE_9F1_FIGURES.ear);
    expect(figures.grossYield).toBe(STAGE_9F1_FIGURES.grossYield);
  });

  it("approving publishes EAR/gross yield/fee/min investment/WHT/AUM correctly — none collapse to 0.00, and the as-of date is 2026-07-17 with no timezone drift", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const { getMmfFunds } = await import("./db");
    const live = await getMmfFunds();
    const published = live.find((f) => f.fundName === TEST_FUND);
    expect(published).toBeTruthy();

    expect(Number(published!.ear)).toBe(12.5);
    expect(Number(published!.grossYield)).toBe(14.2);
    expect(Number(published!.ear)).not.toBe(0);
    expect(Number(published!.grossYield)).not.toBe(0);
    // The edited management fee (2.25, from the multi-field edit above) survived promotion.
    expect(Number(published!.managementFee)).toBe(2.25);
    expect(Number(published!.minInvestment)).toBe(1000);
    expect(Number(published!.whtRate)).toBe(15);
    expect(Number(published!.aumMillions)).toBe(500);

    expect(published?.asOfDate).toBeTruthy();
    expect(new Date(published!.asOfDate as unknown as string).toISOString().slice(0, 10)).toBe("2026-07-17");
  });
});
