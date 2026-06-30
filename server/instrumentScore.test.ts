import { describe, it, expect } from "vitest";
import {
  scoreInstrument,
  scoreAndRank,
  applySovereignPreferenceToScored,
  bucketForAssetClass,
  DEFAULT_SCORE_WEIGHTS,
  type ScoreInput,
} from "@shared/instrumentScore";

const NOW = Date.UTC(2026, 5, 30); // 2026-06-30

function base(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    ref: over.ref ?? "X",
    name: over.name ?? "Instrument X",
    assetClass: over.assetClass ?? "cash_mmf",
    issuer: over.issuer ?? "Some Manager",
    currency: over.currency ?? "KES",
    netYieldPct: "netYieldPct" in over ? (over.netYieldPct as number | null) : 10,
    expenseRatioPct: over.expenseRatioPct ?? null,
    liquidity: over.liquidity ?? "daily",
    dataAsOf: "dataAsOf" in over ? (over.dataAsOf as number | null) : NOW,
    verificationState: over.verificationState ?? "human_verified",
    active: over.active ?? true,
  };
}

describe("bucketForAssetClass", () => {
  it("maps gov classes to gov, bank to bank, rest to other", () => {
    expect(bucketForAssetClass("gov_discount")).toBe("gov");
    expect(bucketForAssetClass("gov_coupon")).toBe("gov");
    expect(bucketForAssetClass("bank_deposit")).toBe("bank");
    expect(bucketForAssetClass("cash_mmf")).toBe("other");
    expect(bucketForAssetClass("equity")).toBe("other");
  });
});

describe("scoreInstrument — net yield is the headline positive", () => {
  it("scores net yield at the configured points per pct", () => {
    const r = scoreInstrument(base({ netYieldPct: 12 }), { nowMs: NOW });
    const ny = r.components.find((c) => c.key === "net_yield")!;
    expect(ny.points).toBe(12 * DEFAULT_SCORE_WEIGHTS.netYieldPerPct);
    expect(r.eligible).toBe(true);
  });

  it("a higher net yield produces a higher score, all else equal", () => {
    const lo = scoreInstrument(base({ ref: "lo", netYieldPct: 8 }), { nowMs: NOW });
    const hi = scoreInstrument(base({ ref: "hi", netYieldPct: 11 }), { nowMs: NOW });
    expect(hi.score).toBeGreaterThan(lo.score);
  });
});

describe("scoreInstrument — penalties are signed and itemised", () => {
  it("applies a term-lock liquidity penalty", () => {
    const r = scoreInstrument(base({ liquidity: "term" }), { nowMs: NOW });
    const liq = r.components.find((c) => c.key === "liquidity")!;
    expect(liq.points).toBe(-DEFAULT_SCORE_WEIGHTS.liquidityTermPenalty);
  });

  it("applies an expense penalty proportional to the ratio", () => {
    const r = scoreInstrument(base({ expenseRatioPct: 2 }), { nowMs: NOW });
    const exp = r.components.find((c) => c.key === "expense")!;
    expect(exp.points).toBe(-2 * DEFAULT_SCORE_WEIGHTS.expensePerPct);
  });

  it("applies the concentration penalty only for a concentrated issuer", () => {
    const without = scoreInstrument(base({ issuer: "Bank A" }), { nowMs: NOW });
    const withC = scoreInstrument(base({ issuer: "Bank A" }), {
      nowMs: NOW,
      concentratedIssuers: ["Bank A"],
    });
    const c0 = without.components.find((c) => c.key === "concentration")!;
    const c1 = withC.components.find((c) => c.key === "concentration")!;
    expect(c0.points).toBe(0);
    expect(c1.points).toBe(-DEFAULT_SCORE_WEIGHTS.concentrationPenalty);
  });

  it("applies a stale penalty past STALE_AFTER_DAYS and more past VERY_STALE", () => {
    const stale = scoreInstrument(
      base({ dataAsOf: NOW - 40 * 86400000, verificationState: "scraped_unverified" }),
      { nowMs: NOW },
    );
    const veryStale = scoreInstrument(
      base({ dataAsOf: NOW - 100 * 86400000, verificationState: "scraped_unverified" }),
      { nowMs: NOW },
    );
    const s = stale.components.find((c) => c.key === "stale")!;
    const v = veryStale.components.find((c) => c.key === "stale")!;
    expect(s.points).toBe(-DEFAULT_SCORE_WEIGHTS.stalePenalty);
    expect(v.points).toBe(
      -(DEFAULT_SCORE_WEIGHTS.stalePenalty + DEFAULT_SCORE_WEIGHTS.veryStalePenalty),
    );
  });

  it("penalises unverified (scraped/ai) figures and not human-checked ones", () => {
    const scraped = scoreInstrument(base({ verificationState: "scraped_unverified", dataAsOf: NOW }), { nowMs: NOW });
    const human = scoreInstrument(base({ verificationState: "human_verified" }), { nowMs: NOW });
    expect(scraped.components.find((c) => c.key === "unverified")!.points).toBe(
      -DEFAULT_SCORE_WEIGHTS.unverifiedPenalty,
    );
    expect(human.components.find((c) => c.key === "unverified")!.points).toBe(0);
  });

  it("score equals the sum of its components for an eligible row", () => {
    const r = scoreInstrument(base({ liquidity: "term", expenseRatioPct: 1 }), { nowMs: NOW });
    const sum = r.components.reduce((s, c) => s + c.points, 0);
    expect(r.score).toBeCloseTo(Math.round(sum * 10) / 10, 5);
  });
});

describe("scoreInstrument — eligibility gates are exclusions, not penalties", () => {
  it("gates out an inactive row", () => {
    const r = scoreInstrument(base({ active: false }), { nowMs: NOW });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReasons).toContain("inactive");
    expect(r.score).toBe(-Infinity);
  });

  it("gates out a row with no yield figure", () => {
    const r = scoreInstrument(base({ netYieldPct: null }), { nowMs: NOW });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReasons).toContain("no_yield_figure");
  });

  it("gates out a currency not in the allowed set", () => {
    const r = scoreInstrument(base({ currency: "USD" }), {
      nowMs: NOW,
      allowedCurrencies: ["KES"],
    });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReasons).toContain("currency_excluded");
  });
});

describe("applySovereignPreferenceToScored — gov outranks bank when close", () => {
  it("demotes a bank candidate that only narrowly beats the best gov", () => {
    const scored = [
      { ref: "bank", bucket: "bank" as const, netYieldPct: 13.2, score: 132, eligible: true },
      { ref: "gov", bucket: "gov" as const, netYieldPct: 13.0, score: 130, eligible: true },
    ];
    const ranked = applySovereignPreferenceToScored(scored, 0.5);
    expect(ranked[0].ref).toBe("gov");
    expect(ranked[1].ref).toBe("bank");
  });

  it("keeps a bank candidate ahead when it beats gov by more than the threshold", () => {
    const scored = [
      { ref: "bank", bucket: "bank" as const, netYieldPct: 14.0, score: 140, eligible: true },
      { ref: "gov", bucket: "gov" as const, netYieldPct: 13.0, score: 130, eligible: true },
    ];
    const ranked = applySovereignPreferenceToScored(scored, 0.5);
    expect(ranked[0].ref).toBe("bank");
  });

  it("always sorts ineligible rows last", () => {
    const scored = [
      { ref: "gated", bucket: "other" as const, netYieldPct: 99, score: -Infinity, eligible: false },
      { ref: "ok", bucket: "other" as const, netYieldPct: 5, score: 50, eligible: true },
    ];
    const ranked = applySovereignPreferenceToScored(scored);
    expect(ranked[0].ref).toBe("ok");
    expect(ranked[1].ref).toBe("gated");
  });
});

describe("scoreAndRank — end-to-end ordering", () => {
  it("ranks by composite with the sovereign tie-break, eligible-first", () => {
    const inputs: ScoreInput[] = [
      base({ ref: "gov", assetClass: "gov_discount", netYieldPct: 13.0, liquidity: "term" }),
      base({ ref: "bank", assetClass: "bank_deposit", netYieldPct: 13.3, liquidity: "term" }),
      base({ ref: "dead", assetClass: "cash_mmf", netYieldPct: 20, active: false }),
    ];
    const ranked = scoreAndRank(inputs, { nowMs: NOW });
    // gov demoted-above-bank because bank only beats it by 0.3 (< 0.5 threshold).
    expect(ranked[0].ref).toBe("gov");
    expect(ranked[1].ref).toBe("bank");
    // inactive always last regardless of its huge nominal yield.
    expect(ranked[2].ref).toBe("dead");
    expect(ranked[2].eligible).toBe(false);
  });
});

describe("non-advisory contract", () => {
  it("never emits advisory language in any component detail", () => {
    const r = scoreInstrument(base({ liquidity: "illiquid", expenseRatioPct: 3, verificationState: "scraped_unverified", dataAsOf: NOW - 200 * 86400000 }), { nowMs: NOW });
    const banned = /\b(best|recommended|optimal|top pick|preferred|should buy|you should)\b/i;
    for (const c of r.components) {
      expect(c.detail).not.toMatch(banned);
    }
  });
});
