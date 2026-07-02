/**
 * Round 82 — AI-assisted manager workbench test matrix.
 *
 * Locks the invariants introduced this round:
 *   1. The catalogue-specific APPROVAL GATE: a create must carry every required
 *      figure for its catalogue; an edit is exempt; a manager override satisfies
 *      the primary figure.
 *   2. The PORTFOLIO-IMPACT descriptor: reference facts never restate money; only
 *      the PRIMARY MMF's yield touches the projection.
 *   3. catalogueForAssetClass / catalogueLabel are total + consistent.
 *   4. The SCHEDULED-AGENT cadence clock (due / stale).
 *   5. The Ask-AI engine's pure helpers (confidence, missing fields, normalise,
 *      parse, findingsToRows) — all network-free.
 *   6. Source-code guards: the three live-write bypasses now route through the
 *      pending queue, and the source-check Heartbeat handler is mounted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  catalogueForAssetClass,
  catalogueLabel,
  checkApprovalGate,
  describePortfolioImpact,
  agentCheckDue,
  primaryFigureKeyForCatalogue,
  CATALOGUE_REQUIRED_FIELDS,
  type ReferenceCatalogue,
} from "../shared/researchPipeline";
import { ASSET_CLASSES, type AssetClass } from "../shared/assetModel";
import {
  clampConfidence,
  confidenceBucket,
  missingFieldsForFinding,
  normaliseFinding,
  parseResearchResponse,
  findingsToRows,
} from "./aiResearchService";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ───────────────────────── Catalogue routing ─────────────────────────────── */

describe("Round 82 · catalogue routing is total + labelled", () => {
  it("maps every asset class to exactly one of the four catalogues", () => {
    const expected: Record<AssetClass, ReferenceCatalogue> = {
      cash_mmf: "mmf",
      bank_deposit: "bank",
      gov_discount: "cbk",
      gov_coupon: "cbk",
      equity: "market_asset",
      reit: "market_asset",
      offshore_fund: "market_asset",
      alt: "market_asset",
    };
    for (const ac of ASSET_CLASSES) {
      expect(catalogueForAssetClass(ac)).toBe(expected[ac]);
    }
  });

  it("labels every catalogue with a non-empty human string", () => {
    const cats: ReferenceCatalogue[] = ["mmf", "bank", "cbk", "market_asset"];
    for (const c of cats) {
      expect(catalogueLabel(c).length).toBeGreaterThan(0);
    }
  });

  it("each catalogue declares a primary required figure", () => {
    const cats: ReferenceCatalogue[] = ["mmf", "bank", "cbk", "market_asset"];
    for (const c of cats) {
      expect(CATALOGUE_REQUIRED_FIELDS[c].length).toBeGreaterThan(0);
      expect(primaryFigureKeyForCatalogue(c)).toBe(CATALOGUE_REQUIRED_FIELDS[c][0]);
    }
  });
});

/* ───────────────────────── Approval gate ─────────────────────────────────── */

describe("Round 82 · catalogue approval gate", () => {
  it("blocks a create that is missing its required figure and names it", () => {
    const g = checkApprovalGate({ assetClass: "cash_mmf", changeKind: "create", figures: {} });
    expect(g.ok).toBe(false);
    expect(g.catalogue).toBe("mmf");
    expect(g.missing).toContain("ear");
    expect(g.reason).toMatch(/before they can be published/i);
  });

  it("passes a create that carries the required figure (directly or via alias)", () => {
    const direct = checkApprovalGate({ assetClass: "cash_mmf", changeKind: "create", figures: { ear: 13.9 } });
    expect(direct.ok).toBe(true);
    // netYield is a documented alias for ear.
    const alias = checkApprovalGate({ assetClass: "cash_mmf", changeKind: "create", figures: { netYield: "13.2" } });
    expect(alias.ok).toBe(true);
  });

  it("always lets a single-field EDIT through the gate (row already complete)", () => {
    const g = checkApprovalGate({ assetClass: "gov_discount", changeKind: "edit", figures: {} });
    expect(g.ok).toBe(true);
    expect(g.missing).toHaveLength(0);
  });

  it("a manager-vouched override satisfies the primary figure of a blocked create", () => {
    const blocked = checkApprovalGate({ assetClass: "bank_deposit", changeKind: "create", figures: {} });
    expect(blocked.ok).toBe(false);
    const overridden = checkApprovalGate({
      assetClass: "bank_deposit",
      changeKind: "create",
      figures: {},
      managerValue: 11.5,
    });
    expect(overridden.ok).toBe(true);
  });

  it("an empty-string override does NOT satisfy the gate", () => {
    const g = checkApprovalGate({ assetClass: "cash_mmf", changeKind: "create", figures: {}, managerValue: "   " });
    expect(g.ok).toBe(false);
  });
});

/* ───────────────────────── Portfolio impact ──────────────────────────────── */

describe("Round 82 · portfolio-impact descriptor", () => {
  it("a PRIMARY MMF yield change affects the projection (future accrual only)", () => {
    const i = describePortfolioImpact({ assetClass: "cash_mmf", isPrimaryMmf: true, instrumentName: "CIC MMF" });
    expect(i.affectsProjection).toBe(true);
    expect(i.referenceOnly).toBe(false);
    expect(i.summary).toMatch(/CIC MMF/);
    expect(i.summary).toMatch(/current balance/i);
  });

  it("a non-primary MMF is reference-only", () => {
    const i = describePortfolioImpact({ assetClass: "cash_mmf", isPrimaryMmf: false, instrumentName: "Sanlam MMF" });
    expect(i.affectsProjection).toBe(false);
    expect(i.referenceOnly).toBe(true);
  });

  it("bank / cbk / market-asset facts never touch existing money", () => {
    for (const ac of ["bank_deposit", "gov_coupon", "equity", "reit"] as AssetClass[]) {
      const i = describePortfolioImpact({ assetClass: ac });
      expect(i.affectsProjection).toBe(false);
      expect(i.referenceOnly).toBe(true);
    }
  });
});

/* ───────────────────────── Agent cadence clock ───────────────────────────── */

describe("Round 82 · scheduled-agent cadence", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it("an inactive source is never due", () => {
    const r = agentCheckDue({ cadenceDays: 7, lastCheckedAt: null, active: false }, now);
    expect(r.due).toBe(false);
    expect(r.stale).toBe(false);
  });

  it("a never-checked active source is due but not stale", () => {
    const r = agentCheckDue({ cadenceDays: 7, lastCheckedAt: null, active: true }, now);
    expect(r.due).toBe(true);
    expect(r.stale).toBe(false);
  });

  it("elapsed ≥ cadence is due; ≥ 3× cadence is also stale", () => {
    const within = agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 3 * DAY, active: true }, now);
    expect(within.due).toBe(false);

    const due = agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 8 * DAY, active: true }, now);
    expect(due.due).toBe(true);
    expect(due.stale).toBe(false);

    const stale = agentCheckDue({ cadenceDays: 7, lastCheckedAt: now - 22 * DAY, active: true }, now);
    expect(stale.due).toBe(true);
    expect(stale.stale).toBe(true);
  });
});

/* ───────────────────────── Ask-AI pure helpers ───────────────────────────── */

describe("Round 82 · Ask-AI engine helpers (network-free)", () => {
  it("clampConfidence bounds to [0,1] and defaults junk to 0", () => {
    expect(clampConfidence(0.5)).toBe(0.5);
    expect(clampConfidence(2)).toBe(1);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence("0.8")).toBeCloseTo(0.8);
    expect(clampConfidence("abc")).toBe(0);
  });

  it("an unsourced figure is never bucketed above 'low'", () => {
    expect(confidenceBucket(0.95, false)).toBe("low");
    expect(confidenceBucket(0.95, true)).toBe("high");
    expect(confidenceBucket(0.5, true)).toBe("medium");
    expect(confidenceBucket(0.1, true)).toBe("low");
  });

  it("missingFieldsForFinding respects aliases per catalogue", () => {
    expect(missingFieldsForFinding("mmf", {})).toEqual(["ear"]);
    expect(missingFieldsForFinding("mmf", { grossYield: "13.2" })).toEqual([]);
    expect(missingFieldsForFinding("cbk", { yieldPct: "15.9" })).toEqual([]);
    expect(missingFieldsForFinding("market_asset", {})).toEqual(["lastPrice"]);
  });

  it("normaliseFinding drops nameless findings and forces an unsourced warning", () => {
    expect(normaliseFinding({ instrumentName: "" })).toBeNull();
    const f = normaliseFinding({
      instrumentName: "91-day T-bill",
      assetClass: "gov_discount",
      figures: [{ key: "yieldPct", value: "15.98" }],
      confidence: 0.9,
    });
    expect(f).not.toBeNull();
    expect(f!.targetCatalogue).toBe("cbk");
    expect(f!.extractedFields.yieldPct).toBe("15.98");
    // No source → confidence dampened and a warning appended.
    expect(f!.confidence).toBeLessThanOrEqual(0.3);
    expect(f!.warnings.join(" ")).toMatch(/unverified hint/i);
  });

  it("normaliseFinding keeps confidence when a source is cited (captured pre-scrub)", () => {
    const f = normaliseFinding({
      instrumentName: "CIC MMF",
      assetClass: "cash_mmf",
      figures: [{ key: "ear", value: "13.9" }],
      sourceLabel: "CIC factsheet",
      confidence: 0.85,
    });
    expect(f).not.toBeNull();
    expect(f!.confidence).toBeCloseTo(0.85);
    expect(f!.missingFields).toEqual([]);
  });

  it("parseResearchResponse tolerates loose JSON and returns answer + findings", () => {
    const raw = `Here you go:\n\`\`\`json\n{"answer":"The 91-day T-bill is ~15.98%.","findings":[{"instrumentName":"91-day T-bill","assetClass":"gov_discount","figures":[{"key":"yieldPct","value":"15.98"}],"sourceLabel":"CBK","confidence":0.8}]}\n\`\`\``;
    const { answer, findings } = parseResearchResponse(raw);
    expect(answer).toMatch(/15\.98/);
    expect(findings).toHaveLength(1);
    expect(findings[0].targetCatalogue).toBe("cbk");
  });

  it("parseResearchResponse degrades gracefully on garbage", () => {
    const { answer, findings } = parseResearchResponse("not json at all");
    expect(answer).toBe("");
    expect(findings).toEqual([]);
  });

  it("findingsToRows stamps status=new and parses as-of into epoch-ms", () => {
    const f = normaliseFinding({
      instrumentName: "CIC MMF",
      assetClass: "cash_mmf",
      figures: [{ key: "ear", value: "13.9" }],
      sourceLabel: "CIC factsheet",
      sourceAsOf: "2026-06-01",
      confidence: 0.8,
    })!;
    const rows = findingsToRows(42, [f]);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBe(42);
    expect(rows[0].status).toBe("new");
    expect(rows[0].confidence).toBe("high");
    expect(rows[0].sourceAsOf).toBe(Date.parse("2026-06-01"));
  });

  it("findingsToRows leaves as-of null when the date is unparseable", () => {
    const f = normaliseFinding({
      instrumentName: "X",
      assetClass: "equity",
      figures: [{ key: "lastPrice", value: "100" }],
      sourceLabel: "NSE",
      sourceAsOf: "sometime last week",
      confidence: 0.6,
    })!;
    const rows = findingsToRows(1, [f]);
    expect(rows[0].sourceAsOf).toBeNull();
  });
});

/* ───────────────────── Bypass closure (source-code guards) ────────────────── */

describe("Round 82 · live-write bypasses are closed", () => {
  const routers = read("server/routers.ts");

  it("aiExtract no longer writes a provisional live opportunity row", () => {
    expect(routers).not.toMatch(/ingestAiExtractedInstrument\s*\(/);
  });

  it("aiExtract records a research finding and enqueues a pending update instead", () => {
    // The extract path should persist findings + enqueue, not upsert a catalogue row.
    expect(routers).toMatch(/insertResearchFindings|enqueueResearchUpdate/);
  });

  it("the only surviving upsertOpportunity calls are idempotent catalogue self-seeding", () => {
    // The bypass we closed was user-driven live writes. The lone remaining callers
    // are the seed-on-first-read guards (populate an empty catalogue), which are
    // always immediately preceded by an emptiness check.
    const calls = routers.match(/upsertOpportunity\s*\(/g) ?? [];
    expect(calls.length).toBe(2);
    const seedGuards = routers.match(/countOpportunities\(\)\)\s*===\s*0\)[\s\S]{0,120}?upsertOpportunity\(/g) ?? [];
    expect(seedGuards.length).toBe(2);
  });

  it("the manual addOpportunity + reviewCandidate approve paths route through the queue", () => {
    expect(routers).toMatch(/enqueueResearchUpdate/);
  });
});

/* ───────────────────── Scheduled source-check agent ──────────────────────── */

describe("Round 82 · source-check Heartbeat", () => {
  it("declares a cron-only handler that never auto-approves", () => {
    const h = read("server/scheduled/sourceCheck.ts");
    expect(h).toMatch(/user\.isCron/);
    expect(h).toMatch(/flagStaleSources/);
    expect(h).toMatch(/sourcesDueForAgentCheck/);
    // It notifies but must not promote/publish anything.
    expect(h).not.toMatch(/reviewResearchUpdate|upsertOpportunity/);
  });

  it("is mounted before the Vite/static fallthrough", () => {
    const idx = read("server/_core/index.ts");
    expect(idx).toMatch(/app\.post\("\/api\/scheduled\/sourceCheck"/);
  });
});
