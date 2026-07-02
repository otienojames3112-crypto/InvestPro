/**
 * Round 89 — Per-catalogue "Review source with AI" regression matrix.
 *
 * The four Reference Catalogue pages gain a manager-only "Review <X> source with
 * AI" action that reuses the EXISTING Research Desk pipeline. This suite locks the
 * invariants the feature promises:
 *
 *   A. PURE PROMPT BUILDERS — catalogueReviewInstruction / summariseCatalogueRows /
 *      buildCatalogueReviewQuestion frame a NEUTRAL fact-extraction task against the
 *      current rows, per catalogue. CBK demands one finding PER T-bill tenor
 *      (91/182/364 are separate instruments); MMF keeps EAR vs gross distinct; bank
 *      captures rate/min/tenor/negotiable/liquidity; market captures price/NAV/yield/
 *      trailing. (network-free)
 *   B. PROPOSES, NEVER PUBLISHES — reviewCatalogueSource (LLM mocked) returns findings
 *      in status "new" and touches NO catalogue: an MMF review does not create/edit an
 *      mmf_funds row, and nothing is enqueued into the review queue until the manager
 *      explicitly drafts a finding. Admin-only.
 *   C. CBK EXTRACTS 91/182/364 — a mocked auction source yielding three per-tenor
 *      findings passes all three through, tagged to the review task/thread, each with
 *      its tenorDays figure.
 *   D. BANK REVIEW PROPOSES — a mocked bank rate sheet produces a bank-targeted finding.
 *   E. APPROVAL PUBLISHES + WRITES DATE-EFFECTIVE HISTORY — approving a pending MMF
 *      update (the path a drafted finding feeds) updates MMF Market AND appends a
 *      date-effective mmf_rate_history row; it is forward-only (does not restate past
 *      actuals — proven by ratesOnDate elsewhere and asserted here via effectiveAt).
 *   F. UNAPPROVED CHANGES ARE INERT — a pending research_update never reaches a
 *      catalogue (live row stays absent) so Dashboard/Ledger/Accrual/Tax/Reconciliation,
 *      which read only published catalogues + recorded holdings, cannot see it.
 *   G. UI ROUTES TO THE QUEUE — the shared dialog drafts via research.draftFromFinding,
 *      shows the "nothing changes a catalogue / approvals never rewrite past actuals"
 *      guardrail, and the button is wired (manager-only) into all four catalogue pages.
 *
 * Mix of pure tests (A), LLM-mock runtime tests via the tRPC caller (B, C, D), a real
 * approval-path DB test (E, F) mirroring opportunityMaintainer.test.ts, and static
 * source guards (G) — matching the Round 82/85/86/88 house style.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  catalogueReviewInstruction,
  summariseCatalogueRows,
  buildCatalogueReviewQuestion,
} from "./aiResearchService";
import { appRouter } from "./routers";
import { NOT_ADMIN_ERR_MSG } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

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

/** A well-formed model reply the JSON-schema parser accepts. */
function modelReply(answer: string, findings: unknown[] = []) {
  return {
    model: "test-model",
    choices: [{ message: { content: JSON.stringify({ answer, findings }) } }],
  } as never;
}
function figure(key: string, value: string) {
  return { key, value };
}

/* ─────────────────── A. Pure prompt builders ─────────────────── */

describe("Round 89 · A — catalogue-review prompt builders are neutral, per-catalogue", () => {
  it("MMF instruction keeps EAR vs gross distinct and lists the catalogue figure keys", () => {
    const s = catalogueReviewInstruction("mmf");
    expect(s).toMatch(/MONEY MARKET FUND/i);
    for (const key of ["ear", "grossYield", "managementFee", "minInvestment", "aumMillions"]) {
      expect(s).toContain(key);
    }
    // Must never fold gross into EAR (or vice-versa).
    expect(s).toMatch(/never convert one into the other/i);
  });

  it("CBK instruction demands ONE finding per T-bill tenor (91/182/364 are separate)", () => {
    const s = catalogueReviewInstruction("cbk");
    expect(s).toMatch(/91-day, 182-day and 364-day bills are SEPARATE/i);
    for (const key of ["yieldPct", "prevAvgRate", "tenorDays", "issueNumber", "auctionDate", "valueDate"]) {
      expect(s).toContain(key);
    }
    expect(s).toMatch(/91\/182\/364/);
  });

  it("bank instruction captures rate/min/tenor/negotiable/liquidity + the 15% WHT caveat", () => {
    const s = catalogueReviewInstruction("bank");
    for (const key of ["indicativeRate", "minAmount", "typicalTenor", "isNegotiable"]) {
      expect(s).toContain(key);
    }
    expect(s).toMatch(/liquidity|early-break/i);
    expect(s).toMatch(/15% WHT|withholding/i);
  });

  it("market instruction captures price/NAV, yield, trailing return and flags PAST performance", () => {
    const s = catalogueReviewInstruction("market_asset");
    for (const key of ["lastPrice", "yieldPct", "yieldKind", "trailingReturnPct", "expenseRatioPct"]) {
      expect(s).toContain(key);
    }
    expect(s).toMatch(/PAST performance/i);
  });

  it("summariseCatalogueRows renders the current rows and flags an empty catalogue", () => {
    expect(summariseCatalogueRows("mmf", [])).toMatch(/currently EMPTY/i);
    const one = summariseCatalogueRows("mmf", [
      { fundName: "CIC MMF", company: "CIC", ear: "15.98", grossYield: "16.4", managementFee: "2", minInvestment: "5000", aumMillions: "40000", asOfDate: "2026-05-01", source: "CIC sheet" },
    ]);
    expect(one).toContain("CIC MMF");
    expect(one).toContain("15.98");
    expect(one).toContain("16.4");
  });

  it("buildCatalogueReviewQuestion embeds the instruction, the current rows, and the proposal framing", () => {
    const q = buildCatalogueReviewQuestion("mmf", [
      { fundName: "CIC MMF", company: "CIC", ear: "15.98" },
    ]);
    expect(q).toMatch(/MONEY MARKET FUND/i);
    expect(q).toContain("CURRENT CATALOGUE ROWS");
    expect(q).toContain("CIC MMF");
    expect(q).toMatch(/one structured FINDING per proposed change/i);
    // It is a proposal step, never a write or a recommendation.
    expect(q).toMatch(/never a catalogue write, never a recommendation/i);
  });
});

/* ─────────────────── B. Proposes, never publishes (admin-only) ─────────────────── */

describe("Round 89 · B — reviewCatalogueSource proposes findings but publishes nothing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is admin-only", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.research.reviewCatalogueSource({
        catalogue: "mmf",
        source: { kind: "text", text: "CIC MMF EAR 16.10% as at Jun 2026." },
      }),
    ).rejects.toMatchObject({ message: NOT_ADMIN_ERR_MSG });
  });

  it("returns findings in status 'new' and does NOT create/edit a live MMF row", async () => {
    const proposedName = `ZZ Review-Only MMF ${Date.now()}`;
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply(`From the fact sheet, ${proposedName} quotes an EAR of 16.10%.`, [
        {
          instrumentName: proposedName,
          issuer: "Test AMC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [figure("ear", "16.10%"), figure("grossYield", "16.9%")],
          sourceLabel: "Test fact sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-01",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "Effective annual rate 16.10%",
        },
      ]),
    );

    const { getMmfFunds } = await import("./db");
    const before = await getMmfFunds();
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.reviewCatalogueSource({
      catalogue: "mmf",
      source: { kind: "text", text: `${proposedName} — Effective annual rate 16.10% as at June 2026.` },
      sourceLabel: "Test fact sheet",
    });

    // A proposal came back, grouped under a review task + thread.
    expect(res.catalogue).toBe("mmf");
    expect(typeof res.taskId).toBe("number");
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    // Every finding is a DRAFT (status "new"), never published.
    for (const f of res.findings) expect(f.status).toBe("new");
    expect(res.findings.some((f) => f.instrumentName === proposedName)).toBe(true);

    // The live MMF catalogue is untouched: the proposed fund is not in mmf_funds,
    // and the row count did not grow from this review.
    const after = await getMmfFunds();
    expect(after.some((f) => f.fundName === proposedName)).toBe(false);
    expect(after.length).toBe(before.length);
  });
});

/* ─────────────────── C. CBK review extracts 91/182/364 ─────────────────── */

describe("Round 89 · C — a CBK auction source yields the three per-tenor bills", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes through one finding per tenor (91-, 182-, 364-day)", async () => {
    const llm = await import("./_core/llm");
    const mkBill = (days: number, rate: string, issue: string) => ({
      instrumentName: `${days}-Day Treasury Bill`,
      issuer: "CBK",
      assetClass: "treasury bill",
      currency: "KES",
      figures: [figure("yieldPct", rate), figure("tenorDays", String(days)), figure("issueNumber", issue)],
      sourceLabel: "CBK weekly auction results",
      sourceUrl: null,
      sourceAsOf: "2026-06-20",
      confidence: 0.85,
      warnings: [],
      rawExcerpt: `${days}-day bill average rate ${rate}`,
    });
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("Latest weekly T-bill auction: 91, 182 and 364-day results below.", [
        mkBill(91, "15.98%", "2612/091"),
        mkBill(182, "16.20%", "2610/182"),
        mkBill(364, "16.75%", "2585/364"),
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.reviewCatalogueSource({
      catalogue: "cbk",
      source: { kind: "text", text: "T-bill auction 20 Jun 2026: 91d 15.98%, 182d 16.20%, 364d 16.75%." },
      sourceLabel: "CBK weekly auction results",
    });

    const names = res.findings.map((f) => f.instrumentName).sort();
    expect(names).toEqual(["182-Day Treasury Bill", "364-Day Treasury Bill", "91-Day Treasury Bill"]);
    // Each tenor is its own instrument with its tenorDays figure preserved.
    const tenors = res.findings
      .map((f) => (f.extractedFields as Record<string, string>).tenorDays)
      .sort();
    expect(tenors).toEqual(["182", "364", "91"]);
    for (const f of res.findings) expect(f.status).toBe("new");
  });
});

/* ─────────────────── D. Bank review proposes ─────────────────── */

describe("Round 89 · D — a bank rate sheet proposes a bank-targeted finding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns a finding whose target catalogue is the bank catalogue", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("The rate sheet quotes a 12-month fixed deposit at 13.5% (indicative, gross of WHT).", [
        {
          instrumentName: "KCB 12-Month Fixed Deposit",
          issuer: "KCB",
          assetClass: "fixed deposit",
          currency: "KES",
          figures: [figure("indicativeRate", "13.5%"), figure("minAmount", "100000"), figure("typicalTenor", "12 months"), figure("isNegotiable", "true")],
          sourceLabel: "KCB rate sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-15",
          confidence: 0.8,
          warnings: ["Indicative and quoted gross of the 15% WHT."],
          rawExcerpt: "12-month FD 13.5% p.a.",
        },
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.reviewCatalogueSource({
      catalogue: "bank",
      source: { kind: "text", text: "KCB deposit rates — 12-month fixed 13.5% p.a., min KES 100,000." },
      sourceLabel: "KCB rate sheet",
    });

    expect(res.catalogue).toBe("bank");
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    const f = res.findings.find((x) => x.instrumentName === "KCB 12-Month Fixed Deposit");
    expect(f).toBeTruthy();
    expect(f?.targetCatalogue).toBe("bank");
    expect((f?.extractedFields as Record<string, string>).indicativeRate).toBe("13.5%");
    expect(f?.status).toBe("new");
  });
});

/* ─────────── E + F. Approval publishes + writes history; pending stays inert ─────────── */

describe("Round 89 · E/F — approval publishes MMF Market + date-effective history; pending is inert", () => {
  const TEST_FUND = `ZZ Round89 Approval Fund ${Date.now()}`;
  let pendingId: number | null = null;

  afterAll(async () => {
    // Best-effort teardown: deactivate the fund the approval published so the seeded
    // catalogue is not polluted. Rate-history rows are additive bookkeeping (kept).
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, TEST_FUND));
  });

  it("a PENDING MMF update does not appear in the live MMF catalogue (Dashboard/Ledger/etc. can't see it)", async () => {
    const { enqueueResearchUpdate, getMmfFunds } = await import("./db");
    // A create must carry the full MMF envelope to pass the catalogue approval gate
    // (fund name, company/issuer, ear, management fee, minimum investment, source,
    // as-of). This mirrors what a drafted finding + a complete review would enqueue.
    pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_FUND,
      assetClass: "cash_mmf",
      issuer: "Round 89 AMC",
      currency: "KES",
      figures: { ear: "17.25", grossYield: "17.9", managementFee: "2", minInvestment: "5000" },
      source: "Round 89 approval test",
      asOf: Date.UTC(2026, 5, 1),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    // While pending, the fund is NOT in the live catalogue that the projection reads.
    const live = await getMmfFunds();
    expect(live.some((f) => f.fundName === TEST_FUND)).toBe(false);
  });

  it("approving it publishes the fund AND appends a date-effective rate-history row", async () => {
    expect(pendingId).toBeTruthy();
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    // Not blocked by the gate (ear was supplied): a real publish happened.
    expect(res.ok).toBe(true);

    const { getMmfFunds, mmfRateHistoryFor } = await import("./db");
    const live = await getMmfFunds();
    const published = live.find((f) => f.fundName === TEST_FUND);
    expect(published).toBeTruthy();
    expect(Number(published?.ear)).toBeCloseTo(17.25, 2);

    // A date-effective history row was written with the as-of as its effective date.
    const history = await mmfRateHistoryFor(TEST_FUND);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const latest = history[0];
    expect(latest.value).toBeCloseTo(17.25, 2);
    // Effective date is the source as-of (forward-only), not an arbitrary "now".
    expect(latest.effectiveAt).toBe(Date.UTC(2026, 5, 1));
  });
});

/* ─────────────────── G. UI routes to the queue + guardrails ─────────────────── */

describe("Round 89 · G — the catalogue-review UI routes to the queue and shows guardrails", () => {
  const dialog = read("client/src/components/CatalogueSourceReview.tsx");

  it("calls the shared engine and lets the manager draft each finding into the queue", () => {
    expect(dialog).toContain("research.reviewCatalogueSource");
    // Findings render via the shared FindingCard, whose action drafts to the queue.
    expect(dialog).toContain("FindingCard");
    expect(dialog).toContain("draftFromFinding");
  });

  it("shows the 'nothing changes a catalogue / approvals never rewrite past actuals' guardrail", () => {
    expect(dialog).toMatch(/Nothing here changes a catalogue/i);
    expect(dialog).toMatch(/Review Queue/i);
    expect(dialog).toMatch(/never rewrite past actuals/i);
  });

  it("offers the four per-catalogue review actions with the right copy", () => {
    expect(dialog).toContain("Review MMF source with AI");
    expect(dialog).toContain("Review bank source with AI");
    expect(dialog).toContain("Review CBK source with AI");
    expect(dialog).toContain("Review market source with AI");
    // CBK blurb advertises the 91/182/364 extraction.
    expect(dialog).toMatch(/91 \/ 182 \/ 364-day/);
  });

  it("the manager-only button is wired into all four catalogue pages", () => {
    const pages = ["MmfFunds", "BankInstruments", "CbkSecuritiesReference", "MarketAssetsReference"];
    for (const p of pages) {
      const src = read(`client/src/pages/${p}.tsx`);
      expect(src).toContain("CatalogueSourceReviewButton");
      expect(src).toMatch(/isManager=\{isManager\}/);
    }
  });

  it("the button renders nothing for a non-manager (manager-only surface)", () => {
    const btn = dialog.slice(dialog.indexOf("export function CatalogueSourceReviewButton"));
    expect(btn).toMatch(/if \(!isManager\) return null/);
  });
});
