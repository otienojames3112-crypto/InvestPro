/**
 * Slice 8f — source/source-as-of consistency audit and small fixes.
 *
 * Audit finding: `mmf_funds` and `bank_instruments` have no `sourceUrl` column, and
 * the only place a manager's captured source link survived was the audit-trail
 * `mmf_rate_history`/`bank_product_rate_history` tables — never the live row. The
 * live row's `source` column only ever received the LABEL (e.g. "CBK website"),
 * so `MmfFunds.tsx`'s `isUrl(fund.source)`-conditional link never had a real URL to
 * render. `opportunities` fared better (`fieldProvenance`/`dataSource`/`dataAsOf`
 * already captured it), but nothing wrote a matching, easy-to-read stamp into its
 * `extendedFields` either. `SharedProfileFields` (shared/instrumentProfile.ts) has
 * ALWAYS had designated `sourceLabel`/`sourceUrl`/`sourceAsOfDate` slots, so the
 * smallest safe fix is: stamp those three slots onto `extendedFields` at promotion
 * time in `reviewResearchUpdate`, for all three targets, from the SAME envelope
 * values already trusted elsewhere — no new column, no schema change.
 *
 * CORRECTION (still Slice 8f, pre-commit): the first cut of this fix only merged
 * the stamp in when a raw `_extendedFields` blob was ALREADY present (i.e. only
 * for findings that had structured extraction). An approved update with a real
 * `source`/`sourceUrl`/`asOf` but no structured extraction still silently lost the
 * URL — the exact gap this slice exists to close. Fixed so each of the three
 * promotion sites now: merges into the raw blob when one exists; otherwise writes
 * `extendedFields: sourceEnrichment` directly when there's anything to write;
 * otherwise leaves `extendedFields` alone (never fabricates an empty object).
 *
 * Three layers of test, following the Stage 6a (mmfBankPromotionAsOfDate.test.ts)
 * convention:
 *   A. `buildSourceEnrichment` — the pure helper — no DB, always runs.
 *   B. The full approve → promote → published-row path via the real tRPC caller,
 *      for all three promotion targets (mmf, bank, opportunity), proving
 *      `extendedFields` actually receives the stamp and that envelope values win
 *      over any pre-existing raw-extraction noise. Requires DATABASE_URL — guarded
 *      with `describe.skipIf(!hasDb)` so it reports SKIPPED (not failed) locally,
 *      while still running for real wherever DATABASE_URL is set.
 *   C. The same path again but with NO raw `_extendedFields` at all, proving the
 *      correction: the stamp still lands even when there's no structured
 *      extraction blob to merge it into. Also DB-gated.
 */
import { afterAll, describe, expect, it } from "vitest";
import { buildSourceEnrichment } from "./db";
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

describe("Slice 8f · A — buildSourceEnrichment (pure, no DB)", () => {
  it("stamps sourceLabel, sourceUrl, and sourceAsOfDate when all three envelope values are present", () => {
    const asOfDate = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01
    const result = buildSourceEnrichment("CBK website", "https://www.centralbank.go.ke", asOfDate);
    expect(result).toEqual({
      sourceLabel: "CBK website",
      sourceUrl: "https://www.centralbank.go.ke",
      sourceAsOfDate: "2026-07-01",
    });
  });

  it("omits sourceUrl when the envelope has no URL, rather than writing an empty string", () => {
    const asOfDate = new Date(Date.UTC(2026, 6, 1));
    const result = buildSourceEnrichment("CBK website", null, asOfDate);
    expect(result).toEqual({ sourceLabel: "CBK website", sourceAsOfDate: "2026-07-01" });
    expect(result).not.toHaveProperty("sourceUrl");
  });

  it("omits sourceLabel when the envelope has no source label", () => {
    const result = buildSourceEnrichment(undefined, "https://example.com", null);
    expect(result).toEqual({ sourceUrl: "https://example.com" });
    expect(result).not.toHaveProperty("sourceLabel");
    expect(result).not.toHaveProperty("sourceAsOfDate");
  });

  it("omits sourceAsOfDate when there is no as-of date, never fabricating one", () => {
    const result = buildSourceEnrichment("CBK website", "https://example.com", null);
    expect(result).not.toHaveProperty("sourceAsOfDate");
  });

  it("returns an empty object when nothing is present", () => {
    expect(buildSourceEnrichment(null, null, null)).toEqual({});
    expect(buildSourceEnrichment(undefined, undefined, null)).toEqual({});
  });

  it("mirrors reviewResearchUpdate's own branching: an empty enrichment object must never be written as extendedFields — the caller must skip the assignment entirely", () => {
    // This is the exact guard reviewResearchUpdate applies at each of the three
    // promotion sites: `else if (Object.keys(sourceEnrichment).length > 0)`.
    // Proven here as a pure check on the helper's output shape, since the fully
    // empty envelope (no source, no sourceUrl, no asOf) can't be produced through
    // the real enqueueResearchUpdate path — `source` is a mandatory field on every
    // research update (validatePendingUpdate: "A source is required for every
    // research update."). So the guard exists purely as defensive code; this test
    // proves the guard's condition is correct for the one input that would trip it.
    const emptyEnrichment = buildSourceEnrichment(null, null, null);
    expect(Object.keys(emptyEnrichment).length).toBe(0);
  });

  it("formats sourceAsOfDate as a plain YYYY-MM-DD string, matching the mmf/bank asOfDate column's date-only granularity", () => {
    const asOfDate = new Date(Date.UTC(2026, 0, 15, 13, 45, 0)); // has a time component
    const result = buildSourceEnrichment("Source", "https://example.com", asOfDate);
    expect(result.sourceAsOfDate).toBe("2026-01-15");
  });
});

describe.skipIf(!hasDb)(
  "Slice 8f · B — approved updates stamp extendedFields source provenance (requires DATABASE_URL)",
  () => {
    const TEST_FUND = `ZZ Slice8f MMF ${Date.now()}`;
    const TEST_BANK = `ZZ Slice8f Bank ${Date.now()}`;
    const REF = `slice8f-opp-${Date.now()}`;
    const approvedAsOf = Date.UTC(2026, 6, 1); // 2026-07-01
    const SOURCE_LABEL = "Slice 8f promotion test";
    const SOURCE_URL = "https://example.com/slice-8f-source";

    afterAll(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return;
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, TEST_FUND));
      await db
        .update(schema.bankInstruments)
        .set({ isActive: false })
        .where(eq(schema.bankInstruments.bankName, TEST_BANK));
      await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, REF));
    });

    it("an approved MMF create stamps sourceLabel/sourceUrl/sourceAsOfDate onto extendedFields, alongside the structured extraction data", async () => {
      const { enqueueResearchUpdate, getMmfFunds } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        name: TEST_FUND,
        assetClass: "cash_mmf",
        issuer: "Slice 8f AMC",
        currency: "KES",
        figures: {
          ear: "16.5",
          grossYield: "17.0",
          managementFee: "2",
          minInvestment: "5000",
          _extendedFields: JSON.stringify({ fundManager: "Slice 8f AMC" }),
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");

      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getMmfFunds();
      const published = live.find((f) => f.fundName === TEST_FUND);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");
      // The pre-existing structured-extraction merge behaviour is unchanged.
      expect(extended?.fundManager).toBe("Slice 8f AMC");
    });

    it("an approved bank-product create stamps sourceLabel/sourceUrl/sourceAsOfDate onto extendedFields, with envelope values winning over conflicting raw-extraction noise", async () => {
      const { enqueueResearchUpdate, getBankInstruments } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
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
          // Raw extraction noise carrying a DIFFERENT (stale/untrusted) source
          // label/url under the same keys — the envelope must win.
          _extendedFields: JSON.stringify({
            sourceLabel: "Untrusted AI-extracted label",
            sourceUrl: "https://untrusted.example.com/stale",
          }),
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");

      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getBankInstruments();
      const published = live.find((b) => b.bankName === TEST_BANK);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");
    });

    it("an approved opportunity (CBK/market-asset) create stamps extendedFields source provenance alongside the existing fieldProvenance map, without disturbing it", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8f 91-Day Treasury Bill",
        assetClass: "gov_discount",
        currency: "KES",
        figures: {
          securityType: "treasury_bill",
          tenor: "91-day",
          yieldPct: "8.8%",
          whtRule: "15% withholding tax on the discount",
          taxExempt: "false",
          maturityRule: "value date + 91 days",
          _extendedFields: JSON.stringify({ issueNumber: "SLICE8F-1" }),
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");

      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");
      expect(extended?.issueNumber).toBe("SLICE8F-1");
      // fieldProvenance (the pre-existing, per-figure provenance map) is untouched.
      expect(published?.fieldProvenance).toBeTruthy();
    });

    it("an approved MMF create WITHOUT any _extendedFields still stamps extendedFields.sourceUrl from the envelope", async () => {
      const NO_EXT_FUND = `ZZ Slice8f MMF NoExt ${Date.now()}`;
      const { enqueueResearchUpdate, getMmfFunds, getDb } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        name: NO_EXT_FUND,
        assetClass: "cash_mmf",
        issuer: "Slice 8f AMC",
        currency: "KES",
        // No `_extendedFields` key at all in figures — the pre-correction bug meant
        // no extendedFields object was written in this case, silently dropping the
        // captured sourceUrl even though it was right there on the envelope.
        figures: { ear: "16.5", grossYield: "17.0", managementFee: "2", minInvestment: "5000" },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getMmfFunds();
      const published = live.find((f) => f.fundName === NO_EXT_FUND);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");

      const db = await getDb();
      if (db) {
        const schema = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, NO_EXT_FUND));
      }
    });

    it("an approved bank-product create WITHOUT any _extendedFields still stamps extendedFields.sourceUrl from the envelope", async () => {
      const NO_EXT_BANK = `ZZ Slice8f Bank NoExt ${Date.now()}`;
      const { enqueueResearchUpdate, getBankInstruments, getDb } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        name: NO_EXT_BANK,
        assetClass: "bank_deposit",
        issuer: NO_EXT_BANK,
        currency: "KES",
        figures: {
          instrumentType: "fixed_deposit",
          minAmount: "50000",
          typicalTenor: "12 months",
          indicativeRate: "13.5",
          isNegotiable: "false",
          liquidity: "Withdrawable at maturity",
          // No `_extendedFields` key.
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getBankInstruments();
      const published = live.find((b) => b.bankName === NO_EXT_BANK);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");

      const db = await getDb();
      if (db) {
        const schema = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(schema.bankInstruments)
          .set({ isActive: false })
          .where(eq(schema.bankInstruments.bankName, NO_EXT_BANK));
      }
    });

    it("an approved opportunity create WITHOUT any _extendedFields still stamps source enrichment into extendedFields", async () => {
      const NO_EXT_REF = `slice8f-opp-noext-${Date.now()}`;
      const { enqueueResearchUpdate, getOpportunityByRef, getDb } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: NO_EXT_REF,
        name: "Slice 8f 182-Day Treasury Bill",
        assetClass: "gov_discount",
        currency: "KES",
        figures: {
          securityType: "treasury_bill",
          tenor: "182-day",
          yieldPct: "9.1%",
          whtRule: "15% withholding tax on the discount",
          taxExempt: "false",
          maturityRule: "value date + 182 days",
          // No `_extendedFields` key.
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(NO_EXT_REF);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");
      // fieldProvenance (the pre-existing, per-figure provenance map) still works
      // independently of whether extendedFields got a structured-extraction blob.
      expect(published?.fieldProvenance).toBeTruthy();

      const db = await getDb();
      if (db) {
        const schema = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, NO_EXT_REF));
      }
    });

    it("an approved MMF create with _extendedFields carrying a CONFLICTING sourceLabel/sourceUrl still lets the envelope win", async () => {
      const CONFLICT_FUND = `ZZ Slice8f MMF Conflict ${Date.now()}`;
      const { enqueueResearchUpdate, getMmfFunds, getDb } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        name: CONFLICT_FUND,
        assetClass: "cash_mmf",
        issuer: "Slice 8f AMC",
        currency: "KES",
        figures: {
          ear: "16.5",
          grossYield: "17.0",
          managementFee: "2",
          minInvestment: "5000",
          _extendedFields: JSON.stringify({
            fundManager: "Slice 8f AMC",
            sourceLabel: "Untrusted AI-extracted label",
            sourceUrl: "https://untrusted.example.com/stale",
            sourceAsOfDate: "2020-01-01",
          }),
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getMmfFunds();
      const published = live.find((f) => f.fundName === CONFLICT_FUND);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      // Envelope wins over the conflicting raw-extraction noise on all three keys.
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      expect(extended?.sourceAsOfDate).toBe("2026-07-01");
      // Non-conflicting structured-extraction data is still preserved.
      expect(extended?.fundManager).toBe("Slice 8f AMC");

      const db = await getDb();
      if (db) {
        const schema = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db
          .update(schema.mmfFunds)
          .set({ isActive: false })
          .where(eq(schema.mmfFunds.fundName, CONFLICT_FUND));
      }
    });

    it("an approved update WITHOUT a captured source URL leaves sourceUrl unset in extendedFields, rather than fabricating one", async () => {
      const NO_URL_FUND = `ZZ Slice8f NoUrl ${Date.now()}`;
      const { enqueueResearchUpdate, getMmfFunds, getDb } = await import("./db");
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        name: NO_URL_FUND,
        assetClass: "cash_mmf",
        issuer: "Slice 8f AMC",
        currency: "KES",
        figures: { ear: "16.5", grossYield: "17.0", managementFee: "2", minInvestment: "5000" },
        source: SOURCE_LABEL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const live = await getMmfFunds();
      const published = live.find((f) => f.fundName === NO_URL_FUND);
      expect(published).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended && "sourceUrl" in extended).toBe(false);

      const db = await getDb();
      if (db) {
        const schema = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, NO_URL_FUND));
      }
    });
  },
);
