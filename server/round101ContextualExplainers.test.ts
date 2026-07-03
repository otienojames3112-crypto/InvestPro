/**
 * Round 101 — Parts 6/7/8 tests.
 *
 * Validates:
 * 1. ExplainKind type includes the four new variants added in Round 101
 * 2. Each page-specific system prompt contains required role/allowed/prohibited sections
 * 3. buildExplainPrompt produces correct user-turn content for each kind
 * 4. Glossary expansion: new Part 8 terms exist and total count exceeds 80
 */
import { describe, it, expect } from "vitest";
import {
  type ExplainKind,
  buildExplainPrompt,
} from "./aiExplainService";
import { GLOSSARY, GLOSSARY_BY_ID } from "../client/src/lib/glossary";

// ─── 1. ExplainKind variants ─────────────────────────────────────────────────

describe("Round 101: ExplainKind variants", () => {
  it("should include the original 3 variants from Round 95", () => {
    const kinds: ExplainKind[] = [
      "reconciliation_mismatch",
      "ledger_month",
      "dashboard_status",
    ];
    // Type-level check: if this compiles, the variants exist
    expect(kinds).toHaveLength(3);
  });

  it("should include the 4 new variants added in Round 101", () => {
    const newKinds: ExplainKind[] = [
      "holdings",
      "accrual_tax",
      "reference_catalogue",
      "scenario_allocation",
    ];
    // Type-level check: if this compiles, the variants exist
    expect(newKinds).toHaveLength(4);
  });

  it("all 7 ExplainKind variants should produce valid prompts via buildExplainPrompt", () => {
    const allKinds: ExplainKind[] = [
      "reconciliation_mismatch",
      "ledger_month",
      "dashboard_status",
      "holdings",
      "accrual_tax",
      "reference_catalogue",
      "scenario_allocation",
    ];
    for (const kind of allKinds) {
      const prompt = buildExplainPrompt(kind, `Test title for ${kind}`, "Some facts here");
      expect(prompt).toContain(`Test title for ${kind}`);
      expect(prompt).toContain("Some facts here");
      expect(prompt).toContain("FACTS");
      // Each closing instruction should contain "Remember:" guardrail
      expect(prompt).toContain("Remember:");
    }
  });
});

// ─── 2. Page-specific system prompts ─────────────────────────────────────────

describe("Round 101: Page-specific system prompts", () => {
  // We test the prompts indirectly via the module's exported SYSTEM_BY_KIND
  // Since SYSTEM_BY_KIND is not exported, we test via buildExplainPrompt's behavior
  // and by importing the module source for structural assertions.

  // Instead, let's read the source file to verify prompt content
  const fs = require("fs");
  const path = require("path");
  const source = fs.readFileSync(
    path.join(__dirname, "aiExplainService.ts"),
    "utf-8"
  );

  it("holdings prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Holding explainer");
    expect(source).toContain("Allowed: explain each holding, maturity, liquidity, tax, source");
    expect(source).toContain("NOT allowed: recommend buy/sell");
  });

  it("accrual_tax prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Interest and WHT explainer");
    expect(source).toContain("Allowed: explain day-by-day accrual, WHT, gross/net, withdrawal amount");
    expect(source).toContain("NOT allowed: give tax filing advice");
  });

  it("reference_catalogue prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Research assistant for financial reference data");
    expect(source).toContain("Allowed: extract, compare, sort by factual field, identify missing fields");
    expect(source).toContain("NOT allowed: recommend which product to buy");
  });

  it("scenario_allocation prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Planning explainer");
    expect(source).toContain("Allowed: explain tradeoffs, probability, contribution gap, risk band");
    expect(source).toContain("NOT allowed: say 'this is the best investment'");
  });

  it("reconciliation_mismatch prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Math-audit explainer");
    expect(source).toContain("Allowed: explain what reconciles or what mismatches");
    expect(source).toContain("NOT allowed: edit data automatically");
  });

  it("ledger_month prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Cash-flow explainer");
    expect(source).toContain("Allowed: explain deposits, sweeps, maturities, interest, tax, actual vs projected");
    expect(source).toContain("NOT allowed: change ledger or create transactions");
  });

  it("dashboard_status prompt contains required role and guardrails", () => {
    expect(source).toContain("Role: Portfolio status explainer");
    expect(source).toContain("Allowed: explain current status, on-track/off-track, interest, tax, maturity, concentration");
    expect(source).toContain("NOT allowed: tell user what to invest in");
  });

  it("all prompts share the common EXPLAIN_GUARDRAILS (no investment advice)", () => {
    expect(source).toContain("You EXPLAIN what the figures in front of the manager mean");
    expect(source).toContain("You do NOT give investment advice");
    expect(source).toContain("you do NOT recommend buying/selling/switching anything");
    expect(source).toContain("You cannot change any data");
  });
});

// ─── 3. buildExplainPrompt structure ─────────────────────────────────────────

describe("Round 101: buildExplainPrompt output structure", () => {
  it("holdings prompt closing references describe-only, never recommend buy/sell", () => {
    const prompt = buildExplainPrompt("holdings", "My Holdings", "MMF balance: 500,000");
    expect(prompt).toContain("never recommend buy/sell");
  });

  it("accrual_tax prompt closing references describe-only, never give tax filing advice", () => {
    const prompt = buildExplainPrompt("accrual_tax", "Tax Summary", "WHT: 1,200");
    expect(prompt).toContain("never give tax filing advice");
  });

  it("reference_catalogue prompt closing references describe-only, never recommend which product", () => {
    const prompt = buildExplainPrompt("reference_catalogue", "MMF Market", "Cytonn EAR: 14.5%");
    expect(prompt).toContain("never recommend which product to buy");
  });

  it("scenario_allocation prompt closing references describe-only, never say which option is best", () => {
    const prompt = buildExplainPrompt("scenario_allocation", "Scenarios", "Step-up: 5000");
    expect(prompt).toContain("never say which option is best");
  });
});

// ─── 4. Glossary expansion (Part 8) ─────────────────────────────────────────

describe("Round 101: Glossary expansion (Part 8)", () => {
  it("glossary has 80+ total entries after Round 101 expansion", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(80);
  });

  it("all glossary IDs are unique", () => {
    const ids = GLOSSARY.map((g) => g.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // General terms
  const generalTerms = [
    "portfolio",
    "goal",
    "target-amount",
    "horizon",
    "contribution",
    "projected",
    "actual",
    "market-value",
    "source-as-of",
    "stale-source",
    "verification",
    "clean-price",
    "dirty-price",
  ];
  for (const id of generalTerms) {
    it(`has General term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // MMF terms
  const mmfTerms = [
    "fund-manager",
    "management-fee",
    "aum",
    "crediting-frequency",
    "daily-accrual",
    "withdrawal-notice",
    "fund-composition",
    "gov-bucket",
    "bank-bucket",
    "corporate-bucket",
  ];
  for (const id of mmfTerms) {
    it(`has MMF term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // CBK securities terms
  const cbkTerms = [
    "91-day-tbill",
    "182-day-tbill",
    "364-day-tbill",
    "discount-concept",
    "treasury-bond",
    "coupon-payment-date",
    "issue-number",
    "isin",
    "auction-date",
    "settlement-date",
    "bid-deadline",
    "non-competitive-bid",
    "competitive-bid",
    "secondary-trading",
    "reopening",
    "dhowcsd",
  ];
  for (const id of cbkTerms) {
    it(`has CBK term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // Bank instrument terms
  const bankTerms = [
    "notice-period",
    "negotiated-rate",
    "payout-frequency",
  ];
  for (const id of bankTerms) {
    it(`has Bank term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // Market asset terms
  const marketTerms = [
    "equity",
    "reit",
    "etf",
    "nav",
    "dividend-yield",
    "distribution-yield",
    "trailing-return",
    "fx-risk",
    "capital-risk",
  ];
  for (const id of marketTerms) {
    it(`has Market Asset term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // Planning terms
  const planningTerms = [
    "allocation",
    "glide-path",
    "de-risking",
    "probability-band",
    "worst-case",
    "best-case",
    "scenario",
  ];
  for (const id of planningTerms) {
    it(`has Planning term: ${id}`, () => {
      expect(GLOSSARY_BY_ID[id]).toBeDefined();
      expect(GLOSSARY_BY_ID[id].def.length).toBeGreaterThan(10);
    });
  }

  // Pre-existing terms should still be present
  it("pre-existing terms are still present (ear, wht, tbill, mmf)", () => {
    expect(GLOSSARY_BY_ID["ear"]).toBeDefined();
    expect(GLOSSARY_BY_ID["wht"]).toBeDefined();
    expect(GLOSSARY_BY_ID["tbill"]).toBeDefined();
    expect(GLOSSARY_BY_ID["mmf"]).toBeDefined();
  });
});
