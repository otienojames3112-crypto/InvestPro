/**
 * Round 90 — Archive-recoverability on All Approved + deterministic CBK rule-fill.
 *
 * This round adds two things and this suite locks the invariants of each:
 *
 *   A. PURE — deterministic CBK rule-fill. `applyCbkRuleFill` back-fills ONLY the
 *      conventional, non-numeric regulatory fields the approval gate needs (security
 *      type, tenor-in-days, WHT rule, tax-exempt flag, maturity rule) from an
 *      unambiguous tenor/type. It NEVER fills a rate (`yieldPct`), never overwrites a
 *      value the model already extracted, and only fires for a recognised tenor/type.
 *   B. PURE — the finding card and the real approval gate agree. `normaliseFinding`
 *      runs the CBK rule-fill and then computes `missingFields` through the SAME
 *      `checkApprovalGate` the desk uses, so a T-bill with a tenor but no yield stays
 *      flagged as missing exactly the rate — never a spurious "security type" gap.
 *   C. PURE — `assetClassForCatalogue` is total and round-trips each catalogue.
 *   D. STATIC — All Approved's manager-only "Include archived rows" toggle is OFF by
 *      default, gated on `isManager`, merges rows with an `archived` flag, never scores
 *      archived rows (Plan Fit passed `undefined`), and shows a Reactivate control
 *      (CatalogueRowControls `isActive={!r.archived}`). The tab is FIRST.
 *   E. RUNTIME — `explore.approvedArchived` is manager-only and returns rows in the
 *      SAME shape as `approvedList.instruments`; the public `approvedList` never
 *      contains archived rows.
 *   F. RUNTIME — archive-then-reactivate is reversible and audited. Archiving an MMF
 *      removes it from the public approved universe AND surfaces it in the archived
 *      universe; reactivating restores it and clears the archived universe.
 *   G. STATIC — the single governed path is unchanged: source → findings →
 *      `draftFromFinding` → review queue → approval. `reviewCatalogueSource` writes no
 *      catalogue, the shared FindingCard drafts into the queue, and all four catalogue
 *      pages wire the manager-only review + archive controls.
 *
 * Mix of pure tests (A, B, C), static source guards (D, G), and small tRPC-caller
 * runtime tests (E, F) — matching the Round 83/86/89 house style.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyCbkRuleFill,
  normaliseFinding,
  missingFieldsForFinding,
} from "./aiResearchService";
import {
  assetClassForCatalogue,
  checkApprovalGate,
  type ReferenceCatalogue,
} from "../shared/researchPipeline";
import { appRouter } from "./routers";
import { NOT_ADMIN_ERR_MSG } from "../shared/const";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

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

/* ─────────────────── A. Deterministic CBK rule-fill ─────────────────── */

describe("Round 90 · A — applyCbkRuleFill back-fills regulatory fields, never a rate", () => {
  it("fills the conventional T-bill fields for each recognised tenor but NEVER a yield", () => {
    for (const days of [91, 182, 364]) {
      const out = applyCbkRuleFill({ tenorDays: String(days) });
      expect(out.securityType).toBe("treasury_bill");
      expect(out.tenor).toBe(`${days}-day`);
      expect(out.whtRule).toMatch(/15% withholding tax on the discount/);
      expect(out.taxExempt).toBe("false");
      expect(out.maturityRule).toBe(`value date + ${days} days`);
      // The rate must come from the source — the rule-fill never invents it.
      expect(out.yieldPct).toBeUndefined();
    }
  });

  it("recognises an infrastructure bond as tax-exempt and a fixed bond as taxable", () => {
    const ifb = applyCbkRuleFill({ name: "infrastructure bond IFB1/2024/8.5" });
    expect(ifb.securityType).toBe("infrastructure_bond");
    expect(ifb.taxExempt).toBe("true");
    expect(ifb.whtRule).toMatch(/tax-exempt/i);

    const fxd = applyCbkRuleFill({ name: "FXD1/2024/10 fixed coupon treasury bond" });
    expect(fxd.securityType).toBe("treasury_bond");
    expect(fxd.taxExempt).toBe("false");
    expect(fxd.whtRule).toMatch(/withholding tax on coupon/i);
    // Even a bond's rate/coupon is never fabricated.
    expect(fxd.yieldPct).toBeUndefined();
  });

  it("never overwrites a value the source already stated, and no-ops on an unknown type", () => {
    const kept = applyCbkRuleFill({ tenorDays: "91", yieldPct: "15.98", securityType: "custom" });
    expect(kept.yieldPct).toBe("15.98"); // untouched
    expect(kept.securityType).toBe("custom"); // not clobbered

    const unknown = applyCbkRuleFill({ someField: "x" });
    expect(unknown).toEqual({ someField: "x" }); // nothing to infer → unchanged
  });
});

/* ─────────────────── B. Card ↔ gate agreement ─────────────────── */

describe("Round 90 · B — normaliseFinding rule-fills then agrees with checkApprovalGate", () => {
  it("a T-bill with a tenor but NO yield is flagged missing exactly the rate (not the type)", () => {
    const f = normaliseFinding({
      instrumentName: "91-Day Treasury Bill",
      assetClass: "treasury bill",
      currency: "KES",
      figures: [{ key: "tenorDays", value: "91" }],
      sourceLabel: "CBK weekly auction results",
      sourceAsOf: "2026-06-20",
      confidence: 0.8,
    });
    expect(f).not.toBeNull();
    expect(f!.targetCatalogue).toBe("cbk");
    // The rule-fill supplied the regulatory fields.
    expect(f!.extractedFields.securityType).toBe("treasury_bill");
    expect(f!.extractedFields.whtRule).toBeTruthy();
    // The ONLY remaining gap is the rate the source must provide.
    expect(f!.missingFields).toEqual(["rate / coupon / previous average rate"]);
    // The `name` rule-fill signal was scrubbed back out of the figures.
    expect(f!.extractedFields.name).toBeUndefined();
  });

  it("the card's missingFields are exactly what checkApprovalGate would report", () => {
    const figures = { tenorDays: "182" };
    const filled = applyCbkRuleFill({ ...figures });
    const gateMissing = checkApprovalGate({
      assetClass: assetClassForCatalogue("cbk"),
      changeKind: "create",
      figures: filled,
      name: "182-Day Treasury Bill",
      source: "CBK weekly auction results",
      asOf: Date.UTC(2026, 5, 20),
    }).missing;
    const cardMissing = missingFieldsForFinding("cbk", filled, {
      name: "182-Day Treasury Bill",
      source: "CBK weekly auction results",
      asOf: Date.UTC(2026, 5, 20),
    });
    expect(cardMissing).toEqual(gateMissing);
    expect(cardMissing).toEqual(["rate / coupon / previous average rate"]);
  });

  it("supplying the rate clears the CBK gate entirely", () => {
    const filled = applyCbkRuleFill({ tenorDays: "364", yieldPct: "16.75" });
    const gate = checkApprovalGate({
      assetClass: assetClassForCatalogue("cbk"),
      changeKind: "create",
      figures: filled,
      name: "364-Day Treasury Bill",
      source: "CBK weekly auction results",
      asOf: Date.UTC(2026, 5, 20),
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});

/* ─────────────────── C. assetClassForCatalogue is total ─────────────────── */

describe("Round 90 · C — assetClassForCatalogue maps every catalogue", () => {
  it("is total over the four catalogues", () => {
    const cats: ReferenceCatalogue[] = ["mmf", "bank", "cbk", "market_asset"];
    const map = Object.fromEntries(cats.map((c) => [c, assetClassForCatalogue(c)]));
    expect(map).toEqual({
      mmf: "cash_mmf",
      bank: "bank_deposit",
      cbk: "gov_discount",
      market_asset: "equity",
    });
  });
});

/* ─────────────────── D. All Approved archive-toggle static guards ─────────────────── */

describe("Round 90 · D — All Approved 'Include archived rows' is manager-only, off by default, never scored", () => {
  const page = read("client/src/pages/AllApprovedInstruments.tsx");
  const tabs = read("client/src/pages/referenceCatalogueTabs.tsx");

  it("the toggle defaults OFF and is gated on the manager role", () => {
    expect(page).toMatch(/useState\(false\)/); // includeArchived default
    expect(page).toContain("const [includeArchived, setIncludeArchived] = useState(false)");
    // The archived query only runs for a manager who turned the toggle on.
    expect(page).toMatch(/enabled:\s*isManager\s*&&\s*includeArchived/);
    expect(page).toContain('trpc.explore.approvedArchived.useQuery');
    // The switch itself is rendered only inside an isManager guard.
    expect(page).toContain('id="include-archived"');
    expect(page).toContain("Include archived rows");
  });

  it("merges archived rows with an `archived` flag and never scores them", () => {
    expect(page).toMatch(/\.\.\.r,\s*archived:\s*false/);
    expect(page).toMatch(/\.\.\.r,\s*archived:\s*true/);
    // Plan Fit is explicitly withheld for archived rows.
    expect(page).toContain("fit={r.archived ? undefined : planFit[r.ref]}");
    // A Plan-Fit sort treats an archived row as unscored.
    expect(page).toContain("const sa = a.archived ? undefined : planFit[a.ref]");
    // The lifecycle control shows Reactivate for an archived row.
    expect(page).toContain("isActive={!r.archived}");
    // The row carries a visible Archived badge.
    expect(page).toMatch(/Archived/);
  });

  it("All Approved is the FIRST reference-catalogue tab", () => {
    // Match the FIRST id inside the CATALOGUE_TABS array (the doc-comment above
    // contains a literal `id: "..."` we must skip).
    const arr = tabs.slice(tabs.indexOf("CATALOGUE_TABS"));
    const firstId = /id:\s*"([^"]+)"/.exec(arr)?.[1];
    expect(firstId).toBe("all-approved");
    expect(tabs).toContain("<AllApprovedInstruments embedded />");
  });

  it("row controls invalidate the archived universe so the toggle stays consistent", () => {
    const controls = read("client/src/components/CatalogueRowControls.tsx");
    expect(controls).toContain("utils.explore?.approvedArchived?.invalidate?.()");
  });
});

/* ─────────────────── E. approvedArchived shape + gating ─────────────────── */

describe("Round 90 · E — explore.approvedArchived is manager-only and mirrors approvedList's shape", () => {
  it("is admin-only", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(caller.explore.approvedArchived()).rejects.toMatchObject({ message: NOT_ADMIN_ERR_MSG });
  });

  it("returns instruments in the SAME row shape as approvedList and never marks them scored", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const archived = await caller.explore.approvedArchived();
    expect(Array.isArray(archived.instruments)).toBe(true);
    // approvedArchived carries no planFit (archived rows are never scored).
    expect((archived as Record<string, unknown>).planFit).toBeUndefined();
    // Every archived row has the federated-instrument fields the table renders.
    for (const r of archived.instruments) {
      expect(typeof r.catalogue).toBe("string");
      expect(typeof r.ref).toBe("string");
      expect(typeof r.name).toBe("string");
      expect(typeof r.targetRef).toBe("string");
      expect("headlineFigure" in r).toBe(true);
      expect("verificationState" in r).toBe(true);
    }
  });
});

/* ─────────────────── F. Archive → reactivate is reversible + audited ─────────────────── */

describe("Round 90 · F — archiving hides from the public universe and surfaces in the archived one; reactivate restores", () => {
  const FUND = `ZZ Round90 Archive Fund ${Date.now()}`;

  afterAll(async () => {
    // Hard teardown: physically remove the seeded fund (and any meta rows keyed to it)
    // so it can never leak into another suite's before/after catalogue diff. We delete
    // directly rather than just deactivating, since a deactivated row still exists in
    // mmf_funds and would perturb a sibling suite's row set.
    try {
      const { getDb } = await import("./db");
      const { mmfFunds, referenceRowMeta } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        await db
          .delete(referenceRowMeta)
          .where(and(eq(referenceRowMeta.catalogue, "mmf"), eq(referenceRowMeta.targetRef, FUND)));
        await db.delete(mmfFunds).where(eq(mmfFunds.fundName, FUND));
      }
    } catch {
      /* best-effort cleanup */
    }
  });

  it("a live MMF appears in the public approved universe and NOT in the archived one", async () => {
    const { addMmfFund } = await import("./db");
    await addMmfFund({
      fundName: FUND,
      company: "Round 90 AMC",
      grossYield: "17.90",
      ear: "17.25",
    });

    const pub = appRouter.createCaller(ctxFor("admin"));
    const approved = await pub.explore.approvedList();
    expect(approved.instruments.some((r) => r.name === FUND)).toBe(true);

    const archived = await pub.explore.approvedArchived();
    expect(archived.instruments.some((r) => r.name === FUND)).toBe(false);
  });

  it("archiving removes it from the public universe and adds it to the archived universe", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.catalogue.setActive({
      catalogue: "mmf",
      targetRef: FUND,
      active: false,
      reason: "Round 90 archive test",
    });
    expect(res.ok).toBe(true);

    const approved = await caller.explore.approvedList();
    expect(approved.instruments.some((r) => r.name === FUND)).toBe(false);

    const archived = await caller.explore.approvedArchived();
    const found = archived.instruments.find((r) => r.name === FUND);
    expect(found).toBeTruthy();
    expect(found?.catalogue).toBe("mmf");
    expect(found?.targetRef).toBe(FUND);
  });

  it("reactivating restores it to the public universe and clears it from the archived one", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.catalogue.setActive({
      catalogue: "mmf",
      targetRef: FUND,
      active: true,
      reason: "Round 90 reactivate test",
    });
    expect(res.ok).toBe(true);

    const approved = await caller.explore.approvedList();
    expect(approved.instruments.some((r) => r.name === FUND)).toBe(true);

    const archived = await caller.explore.approvedArchived();
    expect(archived.instruments.some((r) => r.name === FUND)).toBe(false);
  });
});

/* ─────────────────── G. Single governed path unchanged ─────────────────── */

describe("Round 90 · G — the one governed path (source → findings → queue → approval) is intact", () => {
  const routers = read("server/routers.ts");
  const askAi = read("client/src/pages/AskAI.tsx");
  const reviewDialog = read("client/src/components/CatalogueSourceReview.tsx");

  it("reviewCatalogueSource proposes findings and writes NO catalogue", () => {
    expect(routers).toContain("reviewCatalogueSource: adminProcedure");
    expect(routers).toMatch(/writes NOTHING to any catalogue/);
    expect(routers).toMatch(/draftFromFinding/);
  });

  it("draftFromFinding enqueues a PENDING update — it is NOT a catalogue write", () => {
    expect(routers).toContain("draftFromFinding: adminProcedure");
    expect(routers).toMatch(/Still NOT a catalogue[\s\S]*?write/);
    expect(routers).toContain("enqueueResearchUpdate(");
  });

  it("the shared FindingCard drafts into the review queue (never mutates a catalogue)", () => {
    expect(askAi).toContain("trpc.research.draftFromFinding.useMutation");
    expect(askAi).toContain("Draft into review queue");
    expect(askAi).toMatch(/nothing changes until you approve it there/);
  });

  it("the review dialog shows the guardrail and drafts through the same FindingCard", () => {
    expect(reviewDialog).toMatch(/Nothing here changes a catalogue/);
    expect(reviewDialog).toMatch(/approvals never rewrite past actuals/);
    expect(reviewDialog).toContain("FindingCard");
    expect(reviewDialog).toContain("if (!isManager) return null");
  });

  it("all four catalogue pages wire the manager-only review + archive controls", () => {
    const pages = {
      mmf: read("client/src/pages/MmfFunds.tsx"),
      bank: read("client/src/pages/BankInstruments.tsx"),
      cbk: read("client/src/pages/CbkSecuritiesReference.tsx"),
      market: read("client/src/pages/MarketAssetsReference.tsx"),
    };
    for (const [key, src] of Object.entries(pages)) {
      const cat = key === "market" ? "market_asset" : key;
      expect(src).toContain(`CatalogueSourceReviewButton catalogue="${cat}"`);
      expect(src).toContain("isManager={isManager}");
      expect(src).toContain(`ArchivedRowsPanel catalogue="${cat}"`);
    }
  });
});
