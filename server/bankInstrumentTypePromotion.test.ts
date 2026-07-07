/**
 * Stage 3b.1 — bank instrumentType/productType promotion fix (PURE, framework-free).
 *
 * buildPromotionPlan's bank branch previously read ONLY `figures.instrumentType`.
 * The structured bank-extraction schema writes the field as `productType`, and
 * uses a LONGER vocabulary ("target_goal_savings", "tiered_high_yield_savings")
 * than the catalogue's real enum ("target_savings", "tiered_savings") — so every
 * structured extraction silently promoted as "fixed_deposit", and a raw pass-
 * through of the long form would have risked an insert failure against the
 * strict MySQL enum.
 *
 * This suite locks: canonicalizeBankInstrumentType()'s alias table (pure), and
 * buildPromotionPlan's bank branch reading BOTH field names and canonicalizing
 * before it reaches the payload — never writing an unrecognised value through.
 *
 * Scoped to the bank promotion path only: CBK, MMF, market-asset, and the
 * approval gate are untouched and not covered here.
 */
import { describe, expect, it } from "vitest";
import { buildPromotionPlan, canonicalizeBankInstrumentType } from "../shared/researchPipeline";

const baseUpdate = {
  target: "bank" as const,
  name: "Sample Bank Product",
  assetClass: "bank_deposit",
  issuer: "Sample Bank",
  source: "Sample Bank rate card",
};

describe("Stage 3b.1 · canonicalizeBankInstrumentType", () => {
  it("passes through every valid short-form enum value unchanged", () => {
    expect(canonicalizeBankInstrumentType("call_deposit")).toBe("call_deposit");
    expect(canonicalizeBankInstrumentType("fixed_deposit")).toBe("fixed_deposit");
    expect(canonicalizeBankInstrumentType("ordinary_savings")).toBe("ordinary_savings");
    expect(canonicalizeBankInstrumentType("target_savings")).toBe("target_savings");
    expect(canonicalizeBankInstrumentType("tiered_savings")).toBe("tiered_savings");
  });

  it("canonicalizes the structured-extraction schema's long-form values", () => {
    expect(canonicalizeBankInstrumentType("target_goal_savings")).toBe("target_savings");
    expect(canonicalizeBankInstrumentType("tiered_high_yield_savings")).toBe("tiered_savings");
  });

  it("is tolerant of case and spacing/hyphen variants", () => {
    expect(canonicalizeBankInstrumentType("Fixed Deposit")).toBe("fixed_deposit");
    expect(canonicalizeBankInstrumentType("target-goal-savings")).toBe("target_savings");
  });

  it("returns null (never a fabricated match) for missing or unrecognised values", () => {
    expect(canonicalizeBankInstrumentType(undefined)).toBeNull();
    expect(canonicalizeBankInstrumentType(null)).toBeNull();
    expect(canonicalizeBankInstrumentType("")).toBeNull();
    expect(canonicalizeBankInstrumentType("some_unrecognised_product")).toBeNull();
    expect(canonicalizeBankInstrumentType(42)).toBeNull();
  });
});

describe("Stage 3b.1 · buildPromotionPlan bank branch", () => {
  it("1. instrumentType: fixed_deposit promotes as fixed_deposit", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { instrumentType: "fixed_deposit" } });
    expect(plan.target).toBe("bank");
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("fixed_deposit");
  });

  it("2. productType: call_deposit promotes as call_deposit (the bug this fixes)", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { productType: "call_deposit" } });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("call_deposit");
  });

  it("3. productType: ordinary_savings promotes as ordinary_savings", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { productType: "ordinary_savings" } });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("ordinary_savings");
  });

  it("4. productType: target_goal_savings promotes as target_savings", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { productType: "target_goal_savings" } });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("target_savings");
  });

  it("5. productType: tiered_high_yield_savings promotes as tiered_savings", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { productType: "tiered_high_yield_savings" } });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("tiered_savings");
  });

  it("6a. a MISSING product type falls back to fixed_deposit — never null/undefined/invalid", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: {} });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("fixed_deposit");
  });

  it("6b. an UNKNOWN product type falls back to fixed_deposit rather than writing the raw junk value", () => {
    const plan = buildPromotionPlan({ ...baseUpdate, figures: { productType: "some_future_product_the_model_invented" } });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("fixed_deposit");
  });

  it("prefers instrumentType over productType when BOTH are present (generic/manual origin wins)", () => {
    const plan = buildPromotionPlan({
      ...baseUpdate,
      figures: { instrumentType: "call_deposit", productType: "tiered_high_yield_savings" },
    });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("call_deposit");
  });

  it("an unrecognised instrumentType falls back to the safe default — it does NOT then try productType (?? only chains on null/undefined, not on an invalid-but-present value)", () => {
    const plan = buildPromotionPlan({
      ...baseUpdate,
      figures: { instrumentType: "not_a_real_type", productType: "call_deposit" },
    });
    if (plan.target === "bank") expect(plan.payload.instrumentType).toBe("fixed_deposit");
  });
});
