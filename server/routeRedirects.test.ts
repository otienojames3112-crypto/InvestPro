import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_REDIRECTS } from "@shared/legacyRoutes";

/**
 * Phase 7/9 — legacy-route redirect coverage.
 *
 * The consolidation collapsed ~19 standalone pages into 5 tabbed parent areas.
 * The redirects are now driven by the canonical `LEGACY_REDIRECTS` map (single
 * source of truth) which App.tsx renders. This test asserts:
 *   (a) the map still covers every legacy path we promised,
 *   (b) every redirect target is a REAL tab id in its area component, and
 *   (c) App.tsx actually consumes the map (and keeps the standalone `/settings`
 *       redirect), so nobody can re-fragment the nav by hand.
 */

const root = join(__dirname, "..", "client", "src");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Pull `id: "..."` tab ids out of an area component. */
function parseTabIds(src: string): string[] {
  const re = /\bid:\s*"([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const AREA_FILE: Record<string, string> = {
  plan: "pages/PlanArea.tsx",
  cashflows: "pages/CashflowsArea.tsx",
  holdings: "pages/HoldingsArea.tsx",
  research: "pages/ResearchArea.tsx",
  review: "pages/ReviewArea.tsx",
};

describe("Phase 7 — legacy route redirects", () => {
  const app = read("App.tsx");

  it("the canonical map carries a non-trivial set of redirects", () => {
    expect(LEGACY_REDIRECTS.length).toBeGreaterThanOrEqual(18);
  });

  it("every redirect target is a real tab id in its area", () => {
    const tabsByArea: Record<string, string[]> = {};
    for (const [area, file] of Object.entries(AREA_FILE)) {
      tabsByArea[area] = parseTabIds(read(file));
    }
    for (const r of LEGACY_REDIRECTS) {
      expect(AREA_FILE[r.area], `unknown area "${r.area}"`).toBeTruthy();
      expect(
        tabsByArea[r.area],
        `area "${r.area}" has no tab "${r.tab}" (tabs: ${tabsByArea[r.area]?.join(", ")})`,
      ).toContain(r.tab);
    }
  });

  it("covers every legacy standalone path that was consolidated", () => {
    const promised: Record<string, { area: string; tab: string }> = {
      "/allocation-plan": { area: "plan", tab: "allocation" },
      "/scenarios": { area: "plan", tab: "scenarios" },
      "/ledger": { area: "plan", tab: "ledger" },
      "/deposits": { area: "cashflows", tab: "record-in" },
      "/withdrawals": { area: "cashflows", tab: "withdraw" },
      "/contributions": { area: "cashflows", tab: "scheduled" },
      "/mmf-funds": { area: "holdings", tab: "mmf" },
      "/securities": { area: "holdings", tab: "gov" },
      "/bank-instruments": { area: "holdings", tab: "bank" },
      "/other-assets": { area: "holdings", tab: "other" },
      "/explore": { area: "research", tab: "explore" },
      "/mmf-strategy": { area: "research", tab: "mmf-market" },
      "/ai-intake": { area: "research", tab: "research-desk" },
      "/ai-review": { area: "research", tab: "research-desk" },
      "/source-conflicts": { area: "research", tab: "research-desk" },
      "/portfolio-review": { area: "review", tab: "manager" },
      "/reconciliation": { area: "review", tab: "reconciliation" },
      "/mmf-accrual": { area: "review", tab: "income" },
      "/tax-summary": { area: "review", tab: "tax" },
    };
    const byPath = new Map(LEGACY_REDIRECTS.map((r) => [r.from, r]));
    for (const [path, want] of Object.entries(promised)) {
      const got = byPath.get(path);
      expect(got, `missing redirect for legacy path ${path}`).toBeTruthy();
      expect(got).toMatchObject(want);
    }
  });

  it("App.tsx renders the redirects FROM the canonical map (not hand-wired JSX)", () => {
    expect(app).toContain("LEGACY_REDIRECTS");
    expect(app).toMatch(/LEGACY_REDIRECTS\.map/);
  });

  it("keeps the standalone /settings → plan?tab=goal redirect", () => {
    expect(app).toMatch(/path="\/settings"[\s\S]*?TabRedirect\s+area="plan"\s+tab="goal"/);
  });

  it("does not leave the consolidated standalone pages mounted as their own routes", () => {
    // These paths must be redirects now, not `component={X}` / inline render routes
    // that bypass the parent area (which would resurrect the old fragmented nav).
    const mustNotRenderDirectly = ["/securities", "/ledger", "/deposits", "/tax-summary", "/portfolio-review"];
    for (const path of mustNotRenderDirectly) {
      const directComponent = new RegExp(`<Route\\s+path="${path}"\\s+component=`);
      expect(directComponent.test(app), `${path} should redirect, not mount directly`).toBe(false);
    }
  });
});
