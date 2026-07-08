/**
 * Stage 3b.5 - tiered-savings rate-schedule nudge.
 *
 * This slice is deliberately non-blocking: it captures a tier schedule when the
 * source prints one and warns when a tiered savings product only has a headline
 * rate. It does not change the bank approval gate or promotion semantics.
 */
import { describe, expect, it } from "vitest";
import {
  structuredInstrumentToDraft,
  TIERED_SAVINGS_RATE_SCHEDULE_WARNING,
} from "../server/aiResearchService";
import { buildPromotionPlan, checkApprovalGate } from "../shared/researchPipeline";

const baseRaw = {
  instrumentName: "Example Bank Savings",
  bankName: "Example Bank",
  productType: "ordinary_savings",
  indicativeRate: "7.5%",
  rateType: "indicative",
  minimumAmount: "KES 1,000",
  tenor: "on call",
  noticePeriod: "none",
  payoutFrequency: "monthly",
  earlyWithdrawalPenalty: "none",
  negotiable: "false",
  whtRate: "15%",
  rateSchedule: "missing_from_source",
  rawExcerpt: "Example Bank savings product.",
  warnings: [],
  confidence: 0.9,
  proposalType: "create",
  matchedCurrentRow: null,
  changedFields: [],
  currentValues: [],
};

function draftFor(overrides: Record<string, unknown> = {}) {
  const draft = structuredInstrumentToDraft(
    {
      ...baseRaw,
      ...overrides,
    },
    "bank_rate_card",
  );
  expect(draft).not.toBeNull();
  return draft!;
}

function extendedFields(fields: Record<string, string>): Record<string, unknown> {
  const raw = fields._extendedFields;
  expect(raw).toBeTruthy();
  return JSON.parse(raw);
}

describe("Stage 3b.5 - tiered savings rateSchedule preservation and nudge", () => {
  it("preserves rateSchedule for tiered savings and does not add the warning", () => {
    const draft = draftFor({
      productType: "tiered_high_yield_savings",
      rateSchedule: "KES 0-99,999: 5.0%; KES 100,000-999,999: 7.5%; KES 1,000,000+: 9.0%",
    });

    expect(draft.extractedFields.rateSchedule).toContain("KES 0-99,999");
    expect(extendedFields(draft.extractedFields).rateSchedule).toContain("KES 1,000,000+");
    expect(draft.warnings).not.toContain(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);
  });

  it("warns for tiered savings without rateSchedule but does not make it an approval-gate requirement", () => {
    const draft = draftFor({
      productType: "tiered_savings",
      rateSchedule: "missing_from_source",
    });

    expect(draft.warnings).toContain(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);

    const gate = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Example Bank rate card",
      asOf: Date.UTC(2026, 5, 30),
      figures: {
        ...draft.extractedFields,
        liquidity: "withdrawable on demand",
      },
    });

    expect(gate.ok).toBe(true);
    expect(gate.missing).not.toContain("rate schedule");
  });

  it("treats tiered_high_yield_savings as tiered savings for the nudge", () => {
    const draft = draftFor({
      productType: "tiered_high_yield_savings",
      rateSchedule: "not available",
    });

    expect(draft.warnings).toContain(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);
  });

  it("leaves ordinary savings without rateSchedule unaffected", () => {
    const draft = draftFor({
      productType: "ordinary_savings",
      rateSchedule: "missing_from_source",
    });

    expect(draft.warnings).not.toContain(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);
  });

  it("leaves fixed deposit and call deposit without rateSchedule unaffected", () => {
    for (const productType of ["fixed_deposit", "call_deposit"] as const) {
      const draft = draftFor({
        productType,
        rateSchedule: "missing_from_source",
      });

      expect(draft.warnings).not.toContain(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);
    }
  });
});

describe("Stage 3b.5 - bank promotion remains unchanged", () => {
  it("still writes one canonical instrumentType and one indicativeRate", () => {
    const plan = buildPromotionPlan({
      target: "bank",
      name: "Example Bank Tiered Savings",
      assetClass: "bank_deposit",
      issuer: "Example Bank",
      source: "Example Bank rate card",
      figures: {
        productType: "tiered_high_yield_savings",
        indicativeRate: "9.0",
        minAmount: "1000",
        rateSchedule: "KES 0-99,999: 5.0%; KES 100,000+: 9.0%",
      },
    });

    expect(plan.target).toBe("bank");
    if (plan.target === "bank") {
      expect(plan.payload.instrumentType).toBe("tiered_savings");
      expect(plan.payload.indicativeRate).toBe(9);
      expect(plan.payload).not.toHaveProperty("rateSchedule");
    }
  });
});
