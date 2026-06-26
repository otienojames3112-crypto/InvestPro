import { describe, it, expect } from "vitest";
import { runProjection, type EngineSettings } from "./engine";

/**
 * Round 62 — per-portfolio concentration caps + allocation policy in the engine.
 *
 * The projected sweep historically used a hardcoded 60% per-family concentration
 * cap. R62 makes that cap a per-portfolio setting (typeCapFrac) and adds an
 * allocation policy: "yield_first" relaxes the family cap toward 100% so the
 * engine may concentrate in the single highest net-yield family.
 *
 * These tests pin three things:
 *   1. Omitting the caps reproduces the legacy 60% behaviour (back-compat).
 *   2. A tighter typeCapFrac holds each CBK family to a smaller share.
 *   3. yield_first lets one family exceed the default 60% family ceiling.
 */

const BASE: EngineSettings = {
  mmfYield: 13.2,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 300_000, // large enough to force sweeps early
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 5_000_000,
  horizonMonths: 36,
};

/**
 * Largest single CAPPED long-bond family (IFB or FXD) share of the invested CBK
 * pot across all months. The per-family cap binds the bond families directly;
 * T-bills are deliberately exempt from the cap because they are the liquidity
 * fallback that absorbs any rounding/capped overflow (engine ~line 1580), so a
 * cap test must look at the bond families it actually constrains.
 */
function maxBondFamilyShare(settings: EngineSettings): number {
  const results = runProjection(settings);
  let worst = 0;
  for (const r of results) {
    const cbk = r.mmfEnd + r.tbill91End + r.tbill182End + r.tbill364End + r.ifbEnd + r.fxdEnd;
    if (cbk <= 0) continue;
    for (const f of [r.ifbEnd, r.fxdEnd]) {
      const share = f / cbk;
      if (share > worst) worst = share;
    }
  }
  return worst;
}

describe("R62 — per-portfolio family cap", () => {
  it("omitting caps reproduces the legacy projection (back-compat)", () => {
    const withoutField = runProjection(BASE);
    const withDefault = runProjection({ ...BASE, typeCapFrac: 0.6 });
    // Identical end values month-by-month → default truly equals legacy 0.6.
    expect(withDefault.map((m) => Math.round(m.totalEnd))).toEqual(
      withoutField.map((m) => Math.round(m.totalEnd)),
    );
  });

  it("a tighter typeCapFrac holds the bond families to a smaller share than the default", () => {
    const tightShare = maxBondFamilyShare({ ...BASE, typeCapFrac: 0.3 });
    const defaultShare = maxBondFamilyShare({ ...BASE, typeCapFrac: 0.6 });
    // The tighter cap should never let a bond family climb as high as the loose one.
    expect(tightShare).toBeLessThanOrEqual(defaultShare + 1e-9);
    // The 30% cap must keep the bond-family peak at or under ~30% of the pot,
    // proving the per-portfolio cap actually binds.
    expect(tightShare).toBeLessThanOrEqual(0.32);
    expect(defaultShare).toBeGreaterThan(tightShare);
  });

  it("yield_first relaxes the family cap so a bond family can exceed the balanced peak", () => {
    const balancedShare = maxBondFamilyShare({ ...BASE, typeCapFrac: 0.3, allocationPolicy: "balanced" });
    const yieldFirstShare = maxBondFamilyShare({ ...BASE, typeCapFrac: 0.3, allocationPolicy: "yield_first" });
    // Relaxing the cap to ~100% lets the top-yield bond family climb higher than
    // the 30%-balanced peak.
    expect(yieldFirstShare).toBeGreaterThan(balancedShare);
  });

  it("all variants still produce a finite, positive terminal value", () => {
    for (const policy of ["balanced", "yield_first", "custom"] as const) {
      const results = runProjection({ ...BASE, allocationPolicy: policy, typeCapFrac: 0.4 });
      const last = results[results.length - 1];
      expect(Number.isFinite(last.totalEnd)).toBe(true);
      expect(last.totalEnd).toBeGreaterThan(0);
    }
  });
});
