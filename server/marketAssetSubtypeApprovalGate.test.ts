/**
 * Stage 3b.3 — market-asset sub-type approval-gate tightening (REIT / offshore
 * fund only; PURE, framework-free).
 *
 * `checkApprovalGate`'s baseline market_asset rules (name, issuer, market,
 * currency, one of price/NAV/yield/return, source, as-of) apply to every market
 * asset. This suite locks the ADDITIONAL, sub-type-specific requirements layered
 * on top for REIT and offshore fund — hard-required, no escape flag:
 *   - REIT needs its distribution yield.
 *   - Offshore fund needs its expense ratio, AND its currency must not be "KES"
 *     (an offshore fund's whole point is FX exposure).
 *
 * Unlike CBK, NO separate sub-type detector was needed: since Stage 3b.2,
 * `assetClass` itself is "reit"/"offshore_fund" whenever the source stated it
 * unambiguously, so checkApprovalGate branches directly on the assetClass
 * argument it already receives.
 *
 * The FX check here is deliberately NARROW: it never requires an FX rate (that
 * is a Holdings-creation concern — assetGuardIssues, shared/assetModel.ts) — it
 * only catches a currency of literally "KES" being inconsistent with an
 * offshore-fund classification. Note this ALSO catches a currency that was
 * never stated at all (structuredInstrumentToDraft defaults an absent currency
 * to "KES"), which is intentional: either way, the manager should confirm the
 * real currency before an offshore-fund row publishes.
 *
 * Scoped to REIT and offshore fund only: SACCO, bank, CBK, MMF are untouched.
 *
 * NOTE: `market` is a FIGURES-bag field (baseline rule source: "figures"), not a
 * top-level checkApprovalGate argument — every figures fixture below includes it
 * explicitly so the baseline "market" requirement doesn't itself block the test.
 */
import { describe, expect, it } from "vitest";
import { checkApprovalGate } from "../shared/researchPipeline";

const baseReit = {
  assetClass: "reit" as const,
  changeKind: "create" as const,
  name: "Example REIT",
  issuer: "Example REIT Manager",
  currency: "KES",
  source: "Example REIT factsheet",
  asOf: Date.now(),
};

const baseOffshore = {
  assetClass: "offshore_fund" as const,
  changeKind: "create" as const,
  name: "Example Offshore Fund",
  issuer: "Example Fund Manager",
  source: "Example fund factsheet",
  asOf: Date.now(),
};

describe("Stage 3b.3 · REIT requires its distribution yield", () => {
  it("blocks a REIT missing distributionYield even with a price present", () => {
    const gate = checkApprovalGate({ ...baseReit, figures: { market: "NSE", lastPrice: "12.50" } });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("distribution yield");
  });

  it("clears once distributionYield is supplied (alongside a price)", () => {
    const gate = checkApprovalGate({
      ...baseReit,
      figures: { market: "NSE", lastPrice: "12.50", distributionYield: "8.2" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("distributionYield ALSO satisfies the baseline price/NAV/yield/return requirement on its own (no separate price needed)", () => {
    const gate = checkApprovalGate({ ...baseReit, figures: { market: "NSE", distributionYield: "8.2" } });
    expect(gate.ok).toBe(true);
  });
});

describe("Stage 3b.3 · offshore fund requires its expense ratio", () => {
  it("blocks an offshore fund missing expenseRatioPct/fee even with a price present", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "USD",
      figures: { market: "Global", lastPrice: "104.20" },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("expense ratio / fee");
  });

  it("clears with the canonical expenseRatioPct key", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "USD",
      figures: { market: "Global", lastPrice: "104.20", expenseRatioPct: "0.75" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("also accepts the raw `fee` key the extraction schema actually emits", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "USD",
      figures: { market: "Global", lastPrice: "104.20", fee: "0.75" },
    });
    expect(gate.ok).toBe(true);
  });
});

describe("Stage 3b.3 · offshore fund's currency must not be KES", () => {
  it("blocks an offshore fund whose currency is KES, even with everything else present", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "KES",
      figures: { market: "Global", lastPrice: "104.20", expenseRatioPct: "0.75" },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("currency must not be KES for an offshore fund");
  });

  it("an offshore fund with NO currency at all is blocked by the pre-existing baseline currency requirement, not the new KES check (this gate never sees an absent currency default to KES — structuredInstrumentToDraft does that upstream, before figures reach this gate)", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: undefined,
      figures: { market: "Global", lastPrice: "104.20", expenseRatioPct: "0.75" },
    });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("currency");
    expect(gate.missing).not.toContain("currency must not be KES for an offshore fund");
  });

  it("clears entirely with a non-KES currency, expense ratio, and a price", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "USD",
      figures: { market: "Global", lastPrice: "104.20", expenseRatioPct: "0.75" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("the currency check is case-insensitive", () => {
    const gate = checkApprovalGate({
      ...baseOffshore,
      currency: "kes",
      figures: { market: "Global", lastPrice: "104.20", expenseRatioPct: "0.75" },
    });
    expect(gate.ok).toBe(false);
  });
});

describe("Stage 3b.3 · equity and alt are completely unaffected", () => {
  it("equity gets no new requirements (distributionYield/expenseRatioPct are irrelevant)", () => {
    const gate = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      name: "Example Ltd",
      issuer: "Example Ltd",
      currency: "KES",
      source: "https://nse.example",
      asOf: Date.now(),
      figures: { market: "NSE", lastPrice: "42.00" },
    });
    expect(gate.ok).toBe(true);
  });

  it("alt gets no new requirements", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      name: "Example Sacco",
      issuer: "Example Sacco",
      currency: "KES",
      source: "Example sacco statement",
      asOf: Date.now(),
      figures: { market: "OTC", lastPrice: "1.00" },
    });
    expect(gate.ok).toBe(true);
  });

  it("an offshore fund's KES-currency check does not leak onto equity", () => {
    const gate = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      name: "Example Ltd",
      issuer: "Example Ltd",
      currency: "KES",
      source: "https://nse.example",
      asOf: Date.now(),
      figures: { market: "NSE", lastPrice: "42.00" },
    });
    expect(gate.missing).not.toContain("currency must not be KES for an offshore fund");
  });
});

describe("Stage 3b.3 · an EDIT is exempt, exactly like the baseline gate", () => {
  it("a single-field edit never triggers REIT/offshore-fund sub-type requirements", () => {
    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "edit",
      name: "Example Offshore Fund",
      currency: "KES",
      figures: { lastPrice: "104.20" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});
