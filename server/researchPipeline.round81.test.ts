/**
 * Round 81 — Research pipeline governance test matrix.
 *
 * Locks the invariants of the new "raw intake → pending research_updates → typed
 * promotion → live catalogue" pipeline, the fixed-income ModelDrawer safety guard,
 * the collapsed Research Desk tab structure, and the source-cadence digest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  validatePendingUpdate,
  promotionTargetForAssetClass,
  buildPromotionPlan,
  canBeCreatedApproved,
  requiresHumanApproval,
  sourceDueStatus,
  slugRef,
  type UpdateOrigin,
} from "../shared/researchPipeline";
import { holdingsRouteForAssetClass } from "../shared/modeling";
import { ASSET_CLASSES, type AssetClass } from "../shared/assetModel";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ───────────────────────── Governance invariants ─────────────────────────── */

describe("Round 81 · pending-update governance", () => {
  it("no origin may ever be born approved — approval is always a separate human step", () => {
    const origins: UpdateOrigin[] = ["ai", "manual", "scrape"];
    for (const o of origins) {
      expect(canBeCreatedApproved(o)).toBe(false);
      expect(requiresHumanApproval(o)).toBe(true);
    }
  });

  it("every pending update must cite a source", () => {
    const res = validatePendingUpdate({
      changeKind: "create",
      name: "Some Fund",
      assetClass: "cash_mmf",
      source: "",
      origin: "ai",
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/source is required/i);
  });

  it("rejects an unknown asset class", () => {
    const res = validatePendingUpdate({
      changeKind: "create",
      name: "Mystery",
      assetClass: "crypto_moon",
      source: "CBK",
      origin: "manual",
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/unknown asset class/i);
  });

  it("an edit update must reference the row it changes", () => {
    const res = validatePendingUpdate({
      changeKind: "edit",
      name: "CIC MMF",
      assetClass: "cash_mmf",
      source: "CIC factsheet",
      origin: "manual",
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/targetRef/i);
  });

  it("refuses to route an update to the wrong catalogue", () => {
    const res = validatePendingUpdate({
      changeKind: "create",
      name: "Some T-bill",
      assetClass: "gov_discount",
      target: "mmf", // wrong — gov promotes into the opportunity catalogue
      source: "CBK auction",
      origin: "manual",
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/promotes into "opportunity", not "mmf"/i);
  });

  it("accepts a well-formed proposal and derives the target from the asset class", () => {
    const res = validatePendingUpdate({
      changeKind: "create",
      name: "Sanlam Money Market Fund",
      assetClass: "cash_mmf",
      source: "Sanlam factsheet 2026-06",
      origin: "ai",
    });
    expect(res.ok).toBe(true);
    expect(res.target).toBe("mmf");
    expect(res.assetClass).toBe("cash_mmf");
  });
});

/* ───────────────────────── Promotion routing ─────────────────────────────── */

describe("Round 81 · promotion target is total over every asset class", () => {
  it("maps each catalog class to exactly one catalogue table", () => {
    const expected: Record<AssetClass, "mmf" | "bank" | "opportunity"> = {
      cash_mmf: "mmf",
      bank_deposit: "bank",
      gov_discount: "opportunity",
      gov_coupon: "opportunity",
      equity: "opportunity",
      reit: "opportunity",
      offshore_fund: "opportunity",
      alt: "opportunity",
    };
    for (const ac of ASSET_CLASSES) {
      expect(promotionTargetForAssetClass(ac)).toBe(expected[ac]);
    }
  });

  it("builds a typed MMF payload that never fabricates a missing figure", () => {
    const plan = buildPromotionPlan({
      target: "mmf",
      name: "CIC Money Market Fund",
      assetClass: "cash_mmf",
      issuer: "CIC Asset Management",
      figures: { grossYield: 13.2, ear: 13.9, managementFee: 2.0 },
      source: "CIC factsheet",
    });
    expect(plan.target).toBe("mmf");
    if (plan.target === "mmf") {
      expect(plan.payload.fundName).toBe("CIC Money Market Fund");
      expect(plan.payload.company).toBe("CIC Asset Management");
      expect(plan.payload.grossYield).toBe(13.2);
      expect(plan.payload.ear).toBe(13.9);
      expect(plan.payload.minInvestment).toBeNull(); // not supplied → not invented
    }
  });

  it("builds a typed bank payload (negotiable defaults true)", () => {
    const plan = buildPromotionPlan({
      target: "bank",
      name: "KCB 12-month fixed deposit",
      assetClass: "bank_deposit",
      issuer: "KCB Bank",
      figures: { minAmount: 100000, typicalTenor: "12m", indicativeRate: 11.5 },
      source: "KCB rate sheet",
    });
    expect(plan.target).toBe("bank");
    if (plan.target === "bank") {
      expect(plan.payload.bankName).toBe("KCB Bank");
      expect(plan.payload.indicativeRate).toBe(11.5);
      expect(plan.payload.isNegotiable).toBe(true);
    }
  });

  it("builds a typed opportunity payload with a stable ref when none supplied", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: "364-day Treasury Bill",
      assetClass: "gov_discount",
      issuer: "Central Bank of Kenya",
      figures: { yieldPct: 15.9, tenorYears: 1 },
      source: "CBK auction results",
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target === "opportunity") {
      expect(plan.payload.ref).toMatch(/^gov-/);
      expect(plan.payload.assetClass).toBe("gov_discount");
      expect(plan.payload.yieldPct).toBe(15.9);
      expect(plan.payload.lastPrice).toBeNull();
    }
  });

  it("slugRef produces a stable, prefixed slug", () => {
    expect(slugRef("gov", "364-day Treasury Bill")).toBe("gov-364-day-treasury-bill");
    expect(slugRef("mkt", "")).toBe("mkt-item");
  });
});

/* ───────────────────── Fixed-income ModelDrawer safety ────────────────────── */

describe("Round 81 · fixed-income modeling safety", () => {
  it("classes with a maturity/coupon must use their own register (never Other)", () => {
    for (const ac of ["cash_mmf", "bank_deposit", "gov_discount", "gov_coupon"] as AssetClass[]) {
      const r = holdingsRouteForAssetClass(ac);
      expect(r.usesRegisterForm).toBe(true);
      expect(r.tab).not.toBe("other");
    }
  });

  it("price-driven market assets are tracked under Other", () => {
    for (const ac of ["equity", "reit", "offshore_fund", "alt"] as AssetClass[]) {
      const r = holdingsRouteForAssetClass(ac);
      expect(r.usesRegisterForm).toBe(false);
      expect(r.tab).toBe("other");
    }
  });

  it("modeling.commit refuses to store a fixed-income class as an Other holding (server-enforced)", () => {
    const src = read("server/routers.ts");
    // The guard runs BEFORE buildHoldingDraft/addOtherHolding and throws for register-form classes.
    expect(src).toMatch(/holdingsRouteForAssetClass\(input\.assetClass/);
    expect(src).toMatch(/if \(route\.usesRegisterForm\) \{[\s\S]*?BAD_REQUEST/);
  });

  it("ModelDrawer routes fixed-income to the register instead of committing", () => {
    const src = read("client/src/components/ModelDrawer.tsx");
    expect(src).toMatch(/route\.usesRegisterForm \?/);
    expect(src).toMatch(/Continue on/);
  });
});

/* ───────────────────────── Research Desk structure ───────────────────────── */

describe("Round 81 · Research Desk consolidation", () => {
  it("collapses AI Import / AI Review / Source Conflicts into a single Research Desk tab", () => {
    const area = read("client/src/pages/ResearchArea.tsx");
    // The standalone intake tab ids are gone from the top tab bar.
    expect(area).not.toMatch(/id:\s*["']ai-import["']/);
    expect(area).not.toMatch(/id:\s*["']ai-review["']/);
    expect(area).not.toMatch(/id:\s*["']source-conflicts["']/);
    // Research Desk exists.
    expect(area).toMatch(/research-desk/);
  });

  it("navigation exposes the collapsed Research tab set and points legacy intake routes at the Desk", () => {
    const nav = read("shared/navigation.ts");
    expect(nav).toMatch(/research-desk/);
    const legacy = read("shared/legacyRoutes.ts");
    expect(legacy).toMatch(/research-desk/);
  });

  it("Research Desk shows the pending-update review queue and the digest", () => {
    const desk = read("client/src/pages/ResearchDesk.tsx");
    expect(desk).toMatch(/researchPipeline\./);
    expect(desk).toMatch(/digest/i);
  });
});

/* ───────────────────────── Source cadence digest ─────────────────────────── */

describe("Round 81 · source cadence", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it("a never-reviewed source is immediately due", () => {
    const s = sourceDueStatus(
      { key: "cbk", label: "CBK", cadenceDays: 7, lastReviewedAt: null, active: true },
      now,
    );
    expect(s.neverReviewed).toBe(true);
    expect(s.isDue).toBe(true);
  });

  it("a source within cadence is not due; past cadence is due", () => {
    const fresh = sourceDueStatus(
      { key: "nse", label: "NSE", cadenceDays: 7, lastReviewedAt: now - 2 * DAY, active: true },
      now,
    );
    expect(fresh.isDue).toBe(false);
    expect(fresh.dueInDays).toBe(5);

    const stale = sourceDueStatus(
      { key: "nse", label: "NSE", cadenceDays: 7, lastReviewedAt: now - 10 * DAY, active: true },
      now,
    );
    expect(stale.isDue).toBe(true);
    expect(stale.dueInDays).toBeLessThan(0);
  });
});
