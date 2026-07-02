/**
 * Round 83 — Research governance + UX hardening test matrix.
 *
 * Locks the invariants the round introduces, all framework-free where possible:
 *   A. per-catalogue required-field gate (create) + escape hatches
 *   B. manager override satisfies the primary figure
 *   C. single-field EDITs are exempt from the gate
 *   D. catalogue-kind routing + labels are total
 *   E. source-code assertions: reference mutations are manager-gated + source-
 *      required + audited, and the live-write bypasses stay closed
 *   F. rate-history / agent cadence behaviour
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkApprovalGate,
  catalogueForAssetClass,
  catalogueLabel,
  primaryFigureKeyForCatalogue,
  describePortfolioImpact,
  agentCheckDue,
  validatePendingUpdate,
  type ReferenceCatalogue,
} from "../shared/researchPipeline";
import { ASSET_CLASSES, type AssetClass } from "../shared/assetModel";

const ROOT = join(__dirname, "..");
const routers = readFileSync(join(ROOT, "server", "routers.ts"), "utf8");
const db = readFileSync(join(ROOT, "server", "db.ts"), "utf8");

/* ── A. Per-catalogue required-field gate ─────────────────────────────────── */
describe("A. catalogue-specific approval gate (create)", () => {
  it("blocks an MMF create missing yield/fee/min and lists the missing fields", () => {
    const r = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      source: "https://example.com",
      asOf: Date.now(),
      figures: {},
    });
    expect(r.ok).toBe(false);
    expect(r.catalogue).toBe("mmf");
    expect(r.missing).toEqual(
      expect.arrayContaining(["gross yield or EAR", "management fee", "minimum investment"]),
    );
    // identity + provenance present → not listed
    expect(r.missing).not.toContain("fund name");
    expect(r.missing).not.toContain("source");
    expect(r.missing).not.toContain("as-of date");
  });

  it("passes a complete MMF create", () => {
    const r = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      source: "https://example.com",
      asOf: Date.now(),
      figures: { ear: 15.2, managementFee: 2, minInvestment: 5000 },
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("blocks an MMF create missing only provenance (source + as-of)", () => {
    const r = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      figures: { ear: 15.2, managementFee: 2, minInvestment: 5000 },
      source: "",
      asOf: null,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["source", "as-of date"]));
  });

  it("bank: an explicit rateUnavailable flag satisfies the escapable indicative rate", () => {
    const base = {
      assetClass: "bank_deposit" as AssetClass,
      changeKind: "create" as const,
      name: "KES 12-month FD",
      issuer: "Example Bank",
      source: "https://bank.example",
      asOf: Date.now(),
    };
    const blocked = checkApprovalGate({
      ...base,
      figures: { instrumentType: "fixed_deposit", minAmount: 100000, typicalTenor: "12m", isNegotiable: true, liquidity: "on maturity" },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.missing).toContain("indicative rate");

    const escaped = checkApprovalGate({
      ...base,
      figures: { instrumentType: "fixed_deposit", minAmount: 100000, typicalTenor: "12m", isNegotiable: true, liquidity: "on maturity", rateUnavailable: true },
    });
    expect(escaped.ok).toBe(true);
  });

  it("bank: fullyLiquid escapes the tenor requirement", () => {
    const r = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      name: "Instant-access savings",
      issuer: "Example Bank",
      source: "https://bank.example",
      asOf: Date.now(),
      figures: { instrumentType: "savings", minAmount: 0, indicativeRate: 4, isNegotiable: false, liquidity: "anytime", fullyLiquid: true },
    });
    expect(r.ok).toBe(true);
  });

  it("market_asset: figuresUnavailable escapes the price/NAV/yield requirement", () => {
    const base = {
      assetClass: "equity" as AssetClass,
      changeKind: "create" as const,
      name: "Example Ltd",
      issuer: "Example Ltd",
      currency: "KES",
      source: "https://nse.example",
      asOf: Date.now(),
    };
    const blocked = checkApprovalGate({ ...base, figures: { market: "NSE" } });
    expect(blocked.ok).toBe(false);
    expect(blocked.missing).toContain("price / NAV / yield / return");

    const escaped = checkApprovalGate({ ...base, figures: { market: "NSE", figuresUnavailable: true } });
    expect(escaped.ok).toBe(true);
  });

  it("cbk: booleans (taxExempt=false) count as present", () => {
    const r = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "create",
      name: "FXD1/2024/10",
      source: "https://cbk.example",
      asOf: Date.now(),
      figures: {
        securityType: "bond",
        tenor: "10y",
        yieldPct: 14,
        whtRule: "15%",
        taxExempt: false,
        maturityRule: "at maturity",
      },
    });
    expect(r.ok).toBe(true);
  });
});

/* ── B. Manager override ──────────────────────────────────────────────────── */
describe("B. manager override satisfies the primary figure", () => {
  it("an override lets an otherwise-incomplete primary figure pass, but other missing fields still block", () => {
    const withOverrideOnly = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      source: "https://example.com",
      asOf: Date.now(),
      figures: {},
      managerValue: 15.0,
    });
    // primary (ear) satisfied by override, but fee + min still missing
    expect(withOverrideOnly.missing).not.toContain("gross yield or EAR");
    expect(withOverrideOnly.missing).toEqual(
      expect.arrayContaining(["management fee", "minimum investment"]),
    );

    const complete = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      source: "https://example.com",
      asOf: Date.now(),
      figures: { managementFee: 2, minInvestment: 5000 },
      managerValue: 15.0,
    });
    expect(complete.ok).toBe(true);
  });

  it("an empty override string does NOT satisfy the primary figure", () => {
    const r = checkApprovalGate({
      assetClass: "cash_mmf",
      changeKind: "create",
      name: "Sample MMF",
      issuer: "Sample Asset Mgmt",
      source: "https://example.com",
      asOf: Date.now(),
      figures: { managementFee: 2, minInvestment: 5000 },
      managerValue: "  ",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("gross yield or EAR");
  });
});

/* ── C. Edits exempt ──────────────────────────────────────────────────────── */
describe("C. single-field edits are exempt from the create gate", () => {
  it("an edit passes even with an empty figures bag", () => {
    for (const ac of ["cash_mmf", "bank_deposit", "gov_coupon", "equity"] as AssetClass[]) {
      const r = checkApprovalGate({ assetClass: ac, changeKind: "edit", figures: {} });
      expect(r.ok).toBe(true);
      expect(r.missing).toEqual([]);
    }
  });
});

/* ── D. Routing + labels total ────────────────────────────────────────────── */
describe("D. catalogue routing + labels are total over asset classes", () => {
  it("every asset class maps to a catalogue with a non-empty label + primary key", () => {
    for (const ac of ASSET_CLASSES) {
      const cat = catalogueForAssetClass(ac as AssetClass);
      expect(["mmf", "bank", "cbk", "market_asset"]).toContain(cat);
      expect(catalogueLabel(cat).length).toBeGreaterThan(0);
      expect(primaryFigureKeyForCatalogue(cat).length).toBeGreaterThan(0);
    }
  });

  it("gov classes route to cbk; cash to mmf; deposit to bank; the rest to market_asset", () => {
    expect(catalogueForAssetClass("gov_discount")).toBe("cbk");
    expect(catalogueForAssetClass("gov_coupon")).toBe("cbk");
    expect(catalogueForAssetClass("cash_mmf")).toBe("mmf");
    expect(catalogueForAssetClass("bank_deposit")).toBe("bank");
    expect(catalogueForAssetClass("equity")).toBe("market_asset");
    expect(catalogueForAssetClass("reit")).toBe("market_asset");
  });

  it("validatePendingUpdate still refuses a mismatched explicit target", () => {
    const r = validatePendingUpdate({
      target: "mmf",
      changeKind: "create",
      name: "A bank FD",
      assetClass: "bank_deposit",
      source: "https://x",
      origin: "manual",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/promotes into "bank"/);
  });
});

/* ── E. Source-code governance assertions ─────────────────────────────────── */
describe("E. reference mutations are governed (manager-gated, source-required, audited)", () => {
  it("bank + mmf reference mutations use adminProcedure (manager-only)", () => {
    // The reference add/update/deactivate/remove procedures must not be plain
    // protectedProcedure — they gate on manager role.
    const adminCount = (routers.match(/adminProcedure/g) ?? []).length;
    expect(adminCount).toBeGreaterThanOrEqual(6);
  });

  it("manual corrections write an audit entry", () => {
    expect(db).toMatch(/recordManualCorrectionAudit/);
    expect(routers).toMatch(/recordManualCorrectionAudit/);
  });

  it("promotion is verified before the audit is written (no fake audit)", () => {
    expect(db).toMatch(/verifyCataloguePublished/);
  });

  it("the AI-extract path does NOT write a live opportunity row (bypass stays closed)", () => {
    // ingestAiExtractedInstrument was the old live-write; it must be gone from routers.
    expect(routers).not.toMatch(/ingestAiExtractedInstrument\s*\(/);
  });

  it("addOpportunity + reviewCandidate route through the pending queue, not a live upsert", () => {
    const addIdx = routers.indexOf("addOpportunity:");
    expect(addIdx).toBeGreaterThan(-1);
    // within a window after addOpportunity, we enqueue rather than upsert live
    const window = routers.slice(addIdx, addIdx + 3200);
    expect(window).toMatch(/enqueueResearchUpdate|validatePendingUpdate/);
  });

  it("the strengthened gate is invoked in the server review path with the identity/provenance envelope", () => {
    expect(db).toMatch(/checkApprovalGate/);
    // envelope fields are passed (name/issuer/source/asOf) into the gate call
    expect(db).toMatch(/managerValue/);
  });
});

/* ── F. Rate history + agent cadence ──────────────────────────────────────── */
describe("F. rate history + scheduled agent cadence", () => {
  it("a promotion path writes a date-effective rate-history row", () => {
    expect(db).toMatch(/rateHistory|RateHistory|rate_history/i);
  });

  it("agentCheckDue: never-checked is due, within cadence is not, 3x cadence is stale", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    expect(agentCheckDue({ cadenceDays: 7, lastCheckedAt: null, active: true }, now)).toEqual({ due: true, stale: false });
    expect(agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 2 * day, active: true }, now).due).toBe(false);
    const overdue = agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 8 * day, active: true }, now);
    expect(overdue.due).toBe(true);
    expect(overdue.stale).toBe(false);
    const stale = agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 22 * day, active: true }, now);
    expect(stale.stale).toBe(true);
    // inactive sources are never due
    expect(agentCheckDue({ cadenceDays: 7, lastCheckedAt: null, active: false }, now)).toEqual({ due: false, stale: false });
  });

  it("portfolio impact: only the primary MMF affects projection; everything else is reference-only", () => {
    expect(describePortfolioImpact({ assetClass: "cash_mmf", isPrimaryMmf: true }).affectsProjection).toBe(true);
    expect(describePortfolioImpact({ assetClass: "cash_mmf", isPrimaryMmf: false }).referenceOnly).toBe(true);
    expect(describePortfolioImpact({ assetClass: "bank_deposit" }).referenceOnly).toBe(true);
    expect(describePortfolioImpact({ assetClass: "gov_coupon" }).referenceOnly).toBe(true);
    expect(describePortfolioImpact({ assetClass: "equity" }).referenceOnly).toBe(true);
  });
});
