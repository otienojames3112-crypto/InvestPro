/**
 * Slice 8g-2 — CBK/SACCO promotion persistence fix, closing 8g-1's audit
 * headline finding: contract-drafted findings never carry `_extendedFields`
 * (the draft button submits ONLY `projectFindingToContractFigures`'s output),
 * so every contract field with `storageStatus: "extendedFields"` that was ALSO
 * gate-required (CBK's whtRule/taxExempt/issueNumber/auctionDate/valueDate/
 * couponRate; every one of SACCO's subtype-defining figures) passed
 * `checkApprovalGate` and then vanished forever at promotion — no typed
 * column for any of them, and nothing merged the figures bag into
 * `extendedFields` except the never-populated raw `_extendedFields` blob.
 *
 * Fix: `projectContractFiguresToExtendedFields(catalogue, subtype, figures)`
 * (shared/catalogueFieldContracts.ts) — the read-side counterpart of
 * `projectFindingToContractFigures`, projecting a SUBMITTED figures bag (the
 * SAME `figuresIn` the gate already validated) into exactly the
 * extendedFields-only tier a promotion should persist. Deliberately generic
 * across all 7 contracts (not CBK/SACCO-specific), per the instruction to use
 * central contract metadata rather than a hand-picked list. Wired into
 * `reviewResearchUpdate`'s OPPORTUNITY branch only (server/db.ts) — MMF/Bank
 * branches are untouched.
 *
 * DISCOVERED SIDE EFFECT while implementing this generically (reported before
 * commit, per instruction): the `market` field on Equity/REIT/Offshore fund
 * was mislabeled `storageStatus: "extendedFields"` in the contract even though
 * `buildPromotionPlan` already writes it to the real `opportunities.market`
 * column unconditionally — corrected to `storageStatus: "column"` so the new
 * helper doesn't duplicate an already-promoted value. This also means the
 * generic helper newly starts persisting a few PREVIOUSLY-INERT extendedFields-
 * tier fields beyond CBK/SACCO, none of them gate-required, none of them
 * duplicating a typed column:
 *   - Equity: `ticker` (explicitly anticipated in the 8g-2 instructions).
 *   - REIT: `distributionYield` (distinct from the `yieldPct` COLUMN it also
 *     reaches via `alsoWriteKeys` — this is the canonical, subtype-specific
 *     label, not a duplicate) and `nav`.
 *   - Offshore fund: `fxRiskNote`.
 * All three are tested explicitly below (not silently allowed to pass).
 *
 * BUG CAUGHT WHILE WRITING THESE TESTS (fixed before commit): the first cut
 * reused `readAliasValue` (the same lookup `projectFindingToContractFigures`
 * uses), which only checks a field's `aliases`, never its own canonical `key`.
 * That function's usual input is RAW pre-contract extraction data, which never
 * contains the contract's own output key — but `projectContractFiguresToExtendedFields`
 * reads `figuresIn` at PROMOTION time, which for a contract-drafted update is
 * already `projectFindingToContractFigures`'s OUTPUT, keyed by each field's
 * canonical `key`. Several fields' `aliases` don't include their own key
 * (SACCO's `dividendRate` → `shareCapitalDividendRate`/`depositRebateRate`
 * only; CBK's `applicationDeadline`/`minInvestment` via one differently-named
 * alias each; Offshore fund's `fxRiskNote` → `fxRisk`) — the real, already-
 * gate-validated data for exactly those fields would have been silently
 * missed. Fixed with a new `readCanonicalOrAliasValue` that checks the
 * canonical key first, then falls back to aliases (kept, defensively, for any
 * non-contract-drafted figures bag still keyed by an alias).
 *
 * SACCO `assetType` decision (reported per instruction): NOT persisted into
 * the live row's `extendedFields`. It is a projector-level routing signal
 * for `detectMarketAssetSacco()`, checked only against the PENDING update's
 * figures bag at gate time — no code anywhere reads a live catalogue row's
 * `extendedFields.assetType` (verified by grep: only the contract module's own
 * doc comment mentions it, as an aspirational example, never an implemented
 * check). Persisting it would be inert data with no reader.
 *
 * Two layers of test, following the Slice 8f/8h convention:
 *   A. `projectContractFiguresToExtendedFields` — pure, no DB — imported and
 *      called directly for real behavioural proof.
 *   B. The full approve → promote → published-row path via
 *      `reviewResearchUpdate`, requires DATABASE_URL — guarded with
 *      `describe.skipIf(!hasDb)` so it reports SKIPPED (not failed) locally.
 */
import { afterAll, describe, expect, it } from "vitest";
import { projectContractFiguresToExtendedFields } from "../shared/catalogueFieldContracts";
import { checkApprovalGate } from "../shared/researchPipeline";
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

// ── A. projectContractFiguresToExtendedFields (pure, no DB) ───────────────────

describe("Slice 8g-2 · A — projectContractFiguresToExtendedFields (pure, no DB)", () => {
  describe("CBK", () => {
    it("1. persists whtRule and taxExempt (the baseline gate-required extendedFields-only fields)", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        whtRule: "15% withholding tax on the discount",
        taxExempt: "false",
      });
      expect(result.whtRule).toBe("15% withholding tax on the discount");
      expect(result.taxExempt).toBe("false");
    });

    it("2. persists FXD/IFB subtype fields (issueNumber, couponRate) when submitted", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        issueNumber: "FXD1/2026/10",
        couponRate: "12.5",
      });
      expect(result.issueNumber).toBe("FXD1/2026/10");
      expect(result.couponRate).toBe("12.5");
    });

    it("3. persists T-bill subtype fields (auctionDate, valueDate) when submitted", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        auctionDate: "2026-07-15",
        valueDate: "2026-07-17",
      });
      expect(result.auctionDate).toBe("2026-07-15");
      expect(result.valueDate).toBe("2026-07-17");
    });

    it("4. also persists the non-gate-required extendedFields-tier fields (securityType, applicationDeadline, minInvestment) — the generic helper doesn't hand-pick only the gate-required ones", () => {
      // Canonical keys, matching the real shape figuresIn has at promotion time
      // for a contract-drafted finding (projectFindingToContractFigures's own
      // output, keyed by each field's `key` — not its `aliases`).
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        securityType: "treasury_bill",
        applicationDeadline: "2026-07-14",
        minInvestment: "100000",
      });
      expect(result.securityType).toBe("treasury_bill");
      expect(result.applicationDeadline).toBe("2026-07-14");
      expect(result.minInvestment).toBe("100000");
    });

    it("4b. also readable via aliases when the canonical key isn't present (defensive — a manual/non-contract-drafted figures bag may still be alias-keyed)", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        bidSubmissionDeadline: "2026-07-14", // applicationDeadline's only alias
        nonCompetitiveMin: "100000", // minInvestment's only alias
      });
      expect(result.applicationDeadline).toBe("2026-07-14");
      expect(result.minInvestment).toBe("100000");
    });

    it("5. never includes a typed-column field (tenor, yieldPct, maturityDate all reach opportunities columns via buildPromotionPlan already)", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        tenor: "91-day",
        yieldPct: "8.8",
        maturityDate: "2026-10-15",
        whtRule: "15%",
      });
      expect(result).not.toHaveProperty("tenor");
      expect(result).not.toHaveProperty("yieldPct");
      expect(result).not.toHaveProperty("maturityDate");
      expect(result.whtRule).toBe("15%");
    });

    it("6. never includes an envelope-routed field (sourceLink/sourceAsOf's own aliases) — those are handled by sourceEnrichment, not this helper", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        source: "CBK auction results",
        dataSource: "CBK auction results",
        asOf: "2026-07-15",
        whtRule: "15%",
      });
      expect(result).not.toHaveProperty("sourceLink");
      expect(result).not.toHaveProperty("sourceAsOf");
    });

    it("alias-tolerant: reads via a field's alias, not only its canonical key (whtRule via 'withholdingTaxRate')", () => {
      const result = projectContractFiguresToExtendedFields("cbk", undefined, {
        withholdingTaxRate: "15% withholding tax",
      });
      expect(result.whtRule).toBe("15% withholding tax");
    });
  });

  describe("SACCO", () => {
    it("7. persists all 6 SACCO-specific extendedFields-tier figures when submitted, using canonical keys (the real shape figuresIn has at promotion time)", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "sacco", {
        productType: "BOSA",
        dividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "1000",
        withdrawalTerms: "30 days notice",
        regulatoryStatus: "SASRA-regulated",
      });
      expect(result).toEqual({
        assetType: "sacco",
        productType: "BOSA",
        dividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "1000",
        withdrawalTerms: "30 days notice",
        regulatoryStatus: "SASRA-regulated",
      });
    });

    it("7b. dividendRate also readable via its alias shareCapitalDividendRate when the canonical key isn't present (dividendRate's own aliases don't include itself)", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "sacco", {
        shareCapitalDividendRate: "12%",
      });
      expect(result.dividendRate).toBe("12%");
    });

    it("8. persists assetType so generic alt rows remain reliably routable as SACCO", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "sacco", {
        assetType: "sacco",
        dividendRate: "12%",
      });
      expect(result.assetType).toBe("sacco");
    });

    it("excludes typed identity but also preserves verbatim liquidity beside its compact typed facet", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "sacco", {
        saccoName: "Stima SACCO",
        liquidity: "withdrawable",
        dividendRate: "12%",
      });
      expect(result).not.toHaveProperty("saccoName");
      expect(result.liquidity).toBe("withdrawable");
    });
  });

  describe("Equity/REIT/Offshore fund — the 'market' storageStatus correction's side effects", () => {
    it("Equity: persists ONLY ticker (market is now correctly a typed-column exclusion)", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "equity", {
        ticker: "SCOM",
        market: "NSE",
        lastPrice: "18.50",
        yieldPct: "5.2",
      });
      expect(result).toEqual({ ticker: "SCOM" });
    });

    it("REIT: persists distributionYield and nav (market is now correctly a typed-column exclusion)", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "reit", {
        distributionYield: "7.5",
        nav: "20.10",
        market: "NSE",
        lastPrice: "18.00",
      });
      expect(result).toEqual({ distributionYield: "7.5", nav: "20.10" });
    });

    it("Offshore fund: persists ONLY fxRiskNote (market is now correctly a typed-column exclusion)", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "offshore_fund", {
        fxRiskNote: "USD-denominated, KES investor bears FX risk",
        market: "NASDAQ",
        currency: "USD",
      });
      expect(result).toEqual({ fxRiskNote: "USD-denominated, KES investor bears FX risk" });
    });

    it("Offshore fund: fxRiskNote also readable via its alias fxRisk when the canonical key isn't present", () => {
      const result = projectContractFiguresToExtendedFields("market_asset", "offshore_fund", {
        fxRisk: "USD-denominated",
      });
      expect(result.fxRiskNote).toBe("USD-denominated");
    });
  });

  describe("MMF/Bank — the helper itself is safely generic, even though it is NOT wired into their promotion branch", () => {
    it("MMF: returns withdrawalPeriod when present (proves the helper works for MMF's shape too — a test-only compatibility check, not a behavior change)", () => {
      const result = projectContractFiguresToExtendedFields("mmf", undefined, {
        withdrawalNoticePeriod: "24 hours",
      });
      expect(result.withdrawalPeriod).toBe("24 hours");
    });

    it("Bank: returns productName and earlyWithdrawalRule when present", () => {
      const result = projectContractFiguresToExtendedFields("bank", undefined, {
        productName: "Fixed Deposit Plus",
        earlyWithdrawalPenalty: "2% of principal",
      });
      expect(result.productName).toBe("Fixed Deposit Plus");
      expect(result.earlyWithdrawalRule).toBe("2% of principal");
    });
  });

  describe("Edge cases", () => {
    it("returns {} when no contract is found (market_asset with no subtype)", () => {
      expect(projectContractFiguresToExtendedFields("market_asset", undefined, { anything: "x" })).toEqual({});
    });

    it("returns {} for null/undefined/empty figures — never fabricates a value", () => {
      expect(projectContractFiguresToExtendedFields("cbk", undefined, null)).toEqual({});
      expect(projectContractFiguresToExtendedFields("cbk", undefined, undefined)).toEqual({});
      expect(projectContractFiguresToExtendedFields("cbk", undefined, {})).toEqual({});
    });
  });
});

// ── No approval-gate behavior change (pure — checkApprovalGate is untouched) ──

describe("Slice 8g-2 · gate untouched", () => {
  it("checkApprovalGate's CBK T-bill result is unchanged by this slice — same missing set as before", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_discount",
      changeKind: "create",
      figures: {
        securityType: "treasury_bill",
        tenor: "91-day",
        yieldPct: "8.8",
        whtRule: "15%",
        taxExempt: "false",
        maturityRule: "value date + 91 days",
        auctionDate: "2026-07-15",
        valueDate: "2026-07-17",
      },
      name: "91-Day Treasury Bill",
      source: "CBK auction results",
      asOf: Date.UTC(2026, 6, 1),
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("checkApprovalGate's SACCO result is unchanged by this slice", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures: {
        assetType: "sacco",
        dividendRate: "12%",
        minimumShareCapital: "5000",
        minimumMonthlyDeposit: "1000",
        withdrawalTerms: "30 days notice",
        regulatoryStatus: "SASRA-regulated",
      },
      name: "Stima SACCO",
      issuer: "Stima SACCO",
      currency: "KES",
      source: "SACCO factsheet",
      asOf: Date.UTC(2026, 6, 1),
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});

// ── B. Full approve → promote → published-row path (requires DATABASE_URL) ───

describe.skipIf(!hasDb)(
  "Slice 8g-2 · B — CBK/SACCO promotions persist extendedFields-tier figures (requires DATABASE_URL)",
  () => {
    const approvedAsOf = Date.UTC(2026, 6, 1);
    const SOURCE_LABEL = "Slice 8g-2 promotion test";
    const SOURCE_URL = "https://example.com/slice-8g-2-source";
    const refs: string[] = [];

    afterAll(async () => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return;
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      for (const ref of refs) {
        await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, ref));
      }
    });

    it("1/2/3/5. a T-bill promotion (no _extendedFields) persists whtRule/taxExempt/auctionDate/valueDate into extendedFields, leaving the typed payload unchanged", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-cbk-tbill-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 91-Day Treasury Bill",
        assetClass: "gov_discount",
        currency: "KES",
        figures: {
          securityType: "treasury_bill",
          tenor: "91-day",
          yieldPct: "8.8",
          whtRule: "15% withholding tax on the discount",
          taxExempt: "false",
          maturityRule: "value date + 91 days",
          auctionDate: "2026-07-15",
          valueDate: "2026-07-17",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(published).toBeTruthy();
      // Typed payload unchanged.
      expect(Number(published?.yieldPct)).toBeCloseTo(8.8, 5);
      expect(published?.factNote ?? null).toBe(null);
      // Newly persisted extendedFields-tier figures.
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.whtRule).toBe("15% withholding tax on the discount");
      expect(extended?.taxExempt).toBe("false");
      expect(extended?.auctionDate).toBe("2026-07-15");
      expect(extended?.valueDate).toBe("2026-07-17");
      expect(extended?.securityType).toBe("treasury_bill");
    });

    it("2. an FXD promotion persists issueNumber and couponRate into extendedFields", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-cbk-fxd-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 FXD1/2026/10",
        assetClass: "gov_coupon",
        currency: "KES",
        figures: {
          securityType: "fxd",
          tenor: "10-year",
          yieldPct: "13.5",
          whtRule: "15% withholding tax on the coupon",
          taxExempt: "false",
          maturityDate: "2036-07-15",
          issueNumber: "FXD1/2026/10",
          couponRate: "13.5",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(published).toBeTruthy();
      expect(published?.maturityDate).toBeTruthy();
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.issueNumber).toBe("FXD1/2026/10");
      expect(extended?.couponRate).toBe("13.5");
    });

    it("4. source enrichment still wins over conflicting raw _extendedFields, and contract-derived figures merge alongside it", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-cbk-conflict-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Conflict Treasury Bill",
        assetClass: "gov_discount",
        currency: "KES",
        figures: {
          securityType: "treasury_bill",
          tenor: "182-day",
          yieldPct: "9.1",
          whtRule: "15% withholding tax on the discount",
          taxExempt: "false",
          maturityRule: "value date + 182 days",
          auctionDate: "2026-07-20",
          valueDate: "2026-07-22",
          // Raw extraction noise carrying a conflicting source label/url.
          _extendedFields: JSON.stringify({
            sourceLabel: "Untrusted AI-extracted label",
            sourceUrl: "https://untrusted.example.com/stale",
            issueNumber: "should-not-override-contract-derived",
          }),
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      // Envelope wins over the conflicting raw noise.
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended?.sourceUrl).toBe(SOURCE_URL);
      // Contract-derived figures still land alongside it.
      expect(extended?.whtRule).toBe("15% withholding tax on the discount");
      expect(extended?.auctionDate).toBe("2026-07-20");
    });

    it("6/7. a SACCO promotion (no _extendedFields) persists all 5 subtype-defining figures into extendedFields, and liquidity/source/as-of reach their existing homes unchanged", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-sacco-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Test SACCO",
        assetClass: "alt",
        issuer: "Slice 8g-2 Test SACCO",
        currency: "KES",
        figures: {
          assetType: "sacco",
          dividendRate: "12%",
          minimumShareCapital: "5000",
          minimumMonthlyDeposit: "1000",
          withdrawalTerms: "30 days notice",
          regulatoryStatus: "SASRA-regulated",
          liquidity: "withdrawable_with_notice",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(published).toBeTruthy();
      // Existing behavior unchanged.
      expect(published?.liquidity).toBe("withdrawable_with_notice");
      expect(published?.dataSource).toBe(SOURCE_LABEL);
      expect(published?.dataAsOf).toBeTruthy();
      // Newly persisted SACCO-specific figures.
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.dividendRate).toBe("12%");
      expect(extended?.minimumShareCapital).toBe("5000");
      expect(extended?.minimumMonthlyDeposit).toBe("1000");
      expect(extended?.withdrawalTerms).toBe("30 days notice");
      expect(extended?.regulatoryStatus).toBe("SASRA-regulated");
    });

    it("8. SACCO's assetType is NOT written into the live row's extendedFields", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-sacco-assettype-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 AssetType Test SACCO",
        assetClass: "alt",
        issuer: "Slice 8g-2 AssetType Test SACCO",
        currency: "KES",
        figures: {
          assetType: "sacco",
          dividendRate: "12%",
          minimumShareCapital: "5000",
          minimumMonthlyDeposit: "1000",
          withdrawalTerms: "30 days notice",
          regulatoryStatus: "SASRA-regulated",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      await caller.researchPipeline.review({ id: pendingId as number, approve: true });

      const published = await getOpportunityByRef(REF);
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended && "assetType" in extended).toBe(false);
    });

    it("9. REIT promotion — typed payload unchanged; nav/distributionYield now newly appear in extendedFields (flagged side effect, tested not silently allowed)", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-reit-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Test REIT",
        assetClass: "reit",
        issuer: "Slice 8g-2 REIT Manager",
        currency: "KES",
        figures: {
          lastPrice: "20.00",
          distributionYield: "7.5",
          nav: "21.00",
          market: "NSE",
          liquidity: "daily",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      // Typed payload unchanged: distributionYield still reaches yieldPct via
      // alsoWriteKeys, market still reaches the opportunities.market column.
      expect(Number(published?.yieldPct)).toBeCloseTo(7.5, 5);
      expect(published?.market).toBe("NSE");
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.nav).toBe("21.00");
      expect(extended?.distributionYield).toBe("7.5");
      // market must NOT be duplicated into extendedFields too (it's a real column now).
      expect(extended && "market" in extended).toBe(false);
    });

    it("10a. Offshore fund promotion — typed payload unchanged; fxRiskNote now newly appears in extendedFields (flagged side effect)", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-offshore-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Test Offshore Fund",
        assetClass: "offshore_fund",
        issuer: "Slice 8g-2 Fund Manager",
        currency: "USD",
        figures: {
          trailingReturnPct: "9.0",
          expenseRatioPct: "1.2",
          market: "NASDAQ",
          fxRiskNote: "USD-denominated, KES investor bears FX risk",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(Number(published?.trailingReturnPct)).toBeCloseTo(9.0, 5);
      expect(published?.market).toBe("NASDAQ");
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.fxRiskNote).toBe("USD-denominated, KES investor bears FX risk");
      expect(extended && "market" in extended).toBe(false);
    });

    it("10b. Equity promotion — typed payload unchanged; ticker now newly appears in extendedFields (explicitly anticipated side effect)", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-equity-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Test Equity",
        assetClass: "equity",
        issuer: "Slice 8g-2 Listed Co",
        currency: "KES",
        figures: {
          lastPrice: "18.50",
          yieldPct: "5.2",
          market: "NSE",
          ticker: "T8G2",
          liquidity: "daily",
        },
        source: SOURCE_LABEL,
        sourceUrl: SOURCE_URL,
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      expect(Number(published?.lastPrice)).toBeCloseTo(18.5, 5);
      expect(published?.market).toBe("NSE");
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      expect(extended?.ticker).toBe("T8G2");
    });

    it("no extendedFields object is fabricated when there is nothing real to persist on any of the three sources", async () => {
      const { enqueueResearchUpdate, getOpportunityByRef } = await import("./db");
      const REF = `slice8g2-empty-${Date.now()}`;
      const pendingId = await enqueueResearchUpdate({
        changeKind: "create",
        targetRef: REF,
        name: "Slice 8g-2 Minimal Equity",
        assetClass: "equity",
        issuer: "Slice 8g-2 Listed Co",
        currency: "KES",
        figures: {
          lastPrice: "18.50",
          yieldPct: "5.2",
          market: "NSE",
          liquidity: "daily",
          // No ticker, no _extendedFields.
        },
        source: SOURCE_LABEL,
        // No sourceUrl this time, so sourceEnrichment only carries sourceLabel/asOf.
        asOf: approvedAsOf,
        origin: "manual",
      });
      expect(typeof pendingId).toBe("number");
      refs.push(REF);
      const caller = appRouter.createCaller(ctxFor("admin"));
      const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
      expect(res.ok).toBe(true);

      const published = await getOpportunityByRef(REF);
      const extended = published?.extendedFields as Record<string, unknown> | null | undefined;
      // sourceEnrichment still has sourceLabel/sourceAsOfDate, so extendedFields
      // is not null — but no ticker/contract-derived noise, and no fabricated
      // empty object either way.
      expect(extended?.sourceLabel).toBe(SOURCE_LABEL);
      expect(extended && "ticker" in extended).toBe(false);
    });
  },
);
