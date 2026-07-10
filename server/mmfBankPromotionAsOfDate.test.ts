/**
 * Stage 6a — the MMF/bank promotion as-of write gap.
 *
 * Approving a Research Desk update into `mmfFunds`/`bankInstruments` previously
 * never wrote the approved `asOf` onto the row's `asOfDate` column — only the
 * SEPARATE manual mmfFunds.update/add mutations did. So a fund/product published
 * via Research Desk approval could carry a real source label but a permanently
 * null as-of date, even though the approved update genuinely had one (captured
 * only for the rate-history `effectiveAt`, never the row itself).
 *
 * Two layers of test:
 *   A. `asOfDateFromEpochMs` — the pure conversion helper — no DB, always runs.
 *   B/C. The full approve → promote → published-row path via the real tRPC caller.
 *      This requires a live DATABASE_URL. This repo's existing DB-dependent suites
 *      (round89CatalogueReview, round90ArchiveAndRuleFill, etc.) don't guard against
 *      a missing DB — they simply fail locally, which is this repo's established
 *      35-failure/13-file baseline. Rather than adding a 14th failing file to that
 *      baseline, these two describe blocks use Vitest's own `describe.skipIf` keyed
 *      on `process.env.DATABASE_URL` so they report as SKIPPED (not failed) here,
 *      while still running for real — and actually proving the fix — wherever
 *      DATABASE_URL is set (CI / production-adjacent environments). The assertions
 *      themselves are unchanged either way; only local visibility differs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asOfDateFromEpochMs } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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

describe("Stage 6a · A — asOfDateFromEpochMs (pure, no DB)", () => {
  it("converts a positive epoch-ms value to the equivalent Date", () => {
    const ms = Date.UTC(2026, 5, 1); // 2026-06-01
    const d = asOfDateFromEpochMs(ms);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(ms);
  });

  it("returns null for null/undefined — never fabricates a date", () => {
    expect(asOfDateFromEpochMs(null)).toBeNull();
    expect(asOfDateFromEpochMs(undefined)).toBeNull();
  });

  it("returns null for zero or a negative value (never a nonsensical as-of)", () => {
    expect(asOfDateFromEpochMs(0)).toBeNull();
    expect(asOfDateFromEpochMs(-1)).toBeNull();
  });

  it("matches the exact conversion the manual mmfFunds.update/add mutations use for an ISO input (same underlying Date construction)", () => {
    const iso = "2026-06-01T00:00:00.000Z";
    const viaManualPattern = new Date(iso); // routers.ts: new Date(input.asOfDate)
    const viaHelper = asOfDateFromEpochMs(Date.parse(iso));
    expect(viaHelper?.getTime()).toBe(viaManualPattern.getTime());
  });
});

describe.skipIf(!hasDb)("Stage 6a · B — approved MMF/bank updates now preserve asOfDate (requires DATABASE_URL)", () => {
  const TEST_FUND = `ZZ Stage6a MMF ${Date.now()}`;
  const TEST_BANK = `ZZ Stage6a Bank ${Date.now()}`;
  const approvedAsOf = Date.UTC(2026, 6, 1); // 2026-07-01
  let mmfPendingId: number | null = null;
  let bankPendingId: number | null = null;

  afterAll(async () => {
    // Best-effort teardown — deactivate what this suite published so the seeded
    // catalogue is not polluted. No-op when there's no DB (nothing was created).
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, TEST_FUND));
    await db.update(schema.bankInstruments).set({ isActive: false }).where(eq(schema.bankInstruments.bankName, TEST_BANK));
  });

  it("approving a complete MMF create publishes the fund with asOfDate matching the approved as-of", async () => {
    const { enqueueResearchUpdate, getMmfFunds } = await import("./db");
    mmfPendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_FUND,
      assetClass: "cash_mmf",
      issuer: "Stage 6a AMC",
      currency: "KES",
      figures: { ear: "16.5", grossYield: "17.0", managementFee: "2", minInvestment: "5000" },
      source: "Stage 6a promotion test",
      asOf: approvedAsOf,
      origin: "manual",
    });
    expect(typeof mmfPendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: mmfPendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const live = await getMmfFunds();
    const published = live.find((f) => f.fundName === TEST_FUND);
    expect(published).toBeTruthy();
    // The core Stage 6a fix: asOfDate is no longer left null after a Research Desk approval.
    expect(published?.asOfDate).toBeTruthy();
    expect(new Date(published!.asOfDate as unknown as string).toISOString().slice(0, 10)).toBe(
      new Date(approvedAsOf).toISOString().slice(0, 10),
    );
    // Existing source behaviour is unchanged.
    expect(published?.source).toBe("Stage 6a promotion test");
  });

  it("approving a complete bank-product create publishes it with asOfDate matching the approved as-of", async () => {
    const { enqueueResearchUpdate, getBankInstruments } = await import("./db");
    bankPendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_BANK,
      assetClass: "bank_deposit",
      issuer: TEST_BANK,
      currency: "KES",
      figures: {
        instrumentType: "fixed_deposit",
        minAmount: "50000",
        typicalTenor: "12 months",
        indicativeRate: "13.5",
        isNegotiable: "false",
        liquidity: "Withdrawable at maturity",
      },
      source: "Stage 6a promotion test",
      asOf: approvedAsOf,
      origin: "manual",
    });
    expect(typeof bankPendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: bankPendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const live = await getBankInstruments();
    const published = live.find((b) => b.bankName === TEST_BANK);
    expect(published).toBeTruthy();
    expect(published?.asOfDate).toBeTruthy();
    expect(new Date(published!.asOfDate as unknown as string).toISOString().slice(0, 10)).toBe(
      new Date(approvedAsOf).toISOString().slice(0, 10),
    );
    expect(published?.source).toBe("Stage 6a promotion test");
  });

  it("an approved MMF update WITHOUT an as-of leaves asOfDate unset, rather than fabricating one", async () => {
    const NO_ASOF_FUND = `ZZ Stage6a NoAsOf ${Date.now()}`;
    const { enqueueResearchUpdate, getMmfFunds } = await import("./db");
    const pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: NO_ASOF_FUND,
      assetClass: "cash_mmf",
      issuer: "Stage 6a AMC",
      currency: "KES",
      figures: { ear: "16.5", grossYield: "17.0", managementFee: "2", minInvestment: "5000" },
      source: "Stage 6a no-asof test",
      asOf: null,
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");
    const caller = appRouter.createCaller(ctxFor("admin"));
    // Gate requires an as-of; approve with an explicit gate override so the row still
    // publishes (mirrors the manager's "approve anyway" path), isolating just the
    // asOfDate-write behaviour under test.
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true, overrideGate: true });
    expect(res.ok).toBe(true);

    const live = await getMmfFunds();
    const published = live.find((f) => f.fundName === NO_ASOF_FUND);
    expect(published).toBeTruthy();
    expect(published?.asOfDate).toBeFalsy();

    const { getDb } = await import("./db");
    const db = await getDb();
    if (db) {
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, NO_ASOF_FUND));
    }
  });
});

describe.skipIf(!hasDb)("Stage 6a · C — unaffected paths stay unaffected (requires DATABASE_URL)", () => {
  it("an approved 'opportunity' (CBK/market-asset) update still gets its as-of via promotionProvenance — untouched by this change", async () => {
    const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
    const REF = `stage6a-cbk-${Date.now()}`;
    const approvedAsOf = Date.UTC(2026, 6, 2);
    const pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      targetRef: REF,
      name: "Stage 6a 91-Day Treasury Bill",
      assetClass: "gov_discount",
      currency: "KES",
      figures: {
        securityType: "treasury_bill",
        tenor: "91-day",
        yieldPct: "8.8%",
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
      },
      source: "Stage 6a opportunity test",
      asOf: approvedAsOf,
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const published = await getOpportunityByRef(REF);
    expect(published).toBeTruthy();
    expect(published?.dataAsOf).toBeTruthy();

    const { getDb } = await import("./db");
    const db = await getDb();
    if (db) {
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, REF));
    }
  });

  it("the manual mmfFunds.update mutation's own asOfDate handling is untouched (still accepts an explicit ISO date)", async () => {
    const { addMmfFund, updateMmfFund, getMmfFund } = await import("./db");
    const NAME = `ZZ Stage6a ManualEdit ${Date.now()}`;
    await addMmfFund({
      fundName: NAME,
      company: "Manual AMC",
      grossYield: "15",
      ear: "14.5",
      managementFee: "2",
      minInvestment: "1000",
      source: "Manual entry",
      isActive: true,
    });
    const { getMmfFunds } = await import("./db");
    const created = (await getMmfFunds()).find((f) => f.fundName === NAME);
    expect(created).toBeTruthy();
    await updateMmfFund(created!.id, { asOfDate: new Date("2026-06-15") });
    const after = await getMmfFund(created!.id);
    expect(after?.asOfDate).toBeTruthy();
    expect(String(after?.asOfDate)).toContain("2026-06-15");

    const { getDb } = await import("./db");
    const db = await getDb();
    if (db) {
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, NAME));
    }
  });
});
