import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 7 — legacy-route redirect coverage.
 *
 * The consolidation collapsed ~19 standalone pages into 5 tabbed parent areas.
 * Every old path must forward to `/<area>?tab=<id>` and every target tab id must
 * actually exist in the corresponding area component — otherwise a redirect lands
 * on the area's default tab silently (a regression that is easy to miss visually).
 *
 * This test reads App.tsx's TabRedirect declarations and each *Area.tsx file's
 * declared tab ids, then asserts (a) all the legacy routes we promised are still
 * wired, and (b) every redirect target is a real tab in that area.
 */

const root = join(__dirname, "..", "client", "src");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Pull `<TabRedirect area="X" tab="Y" />` pairs out of App.tsx. */
function parseRedirects(src: string): { area: string; tab: string }[] {
  const re = /<TabRedirect\s+area="([^"]+)"\s+tab="([^"]+)"\s*\/>/g;
  const out: { area: string; tab: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ area: m[1], tab: m[2] });
  return out;
}

/** Pull the route path that wraps each redirect, e.g. /securities. */
function parseRedirectRoutes(src: string): { path: string; area: string; tab: string }[] {
  const re =
    /<Route\s+path="([^"]+)">\{\(\)\s*=>\s*<TabRedirect\s+area="([^"]+)"\s+tab="([^"]+)"\s*\/>\}<\/Route>/g;
  const out: { path: string; area: string; tab: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push({ path: m[1], area: m[2], tab: m[3] });
  return out;
}

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
  const redirectRoutes = parseRedirectRoutes(app);

  it("parses a non-trivial set of redirect routes from App.tsx", () => {
    // Guards against the regex silently matching nothing after a refactor.
    expect(redirectRoutes.length).toBeGreaterThanOrEqual(18);
  });

  it("every redirect target is a real tab id in its area", () => {
    const tabsByArea: Record<string, string[]> = {};
    for (const [area, file] of Object.entries(AREA_FILE)) {
      tabsByArea[area] = parseTabIds(read(file));
    }
    for (const r of parseRedirects(app)) {
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
      "/mmf-strategy": { area: "research", tab: "mmf-comparison" },
      "/ai-intake": { area: "research", tab: "ai-import" },
      "/ai-review": { area: "research", tab: "ai-review" },
      "/source-conflicts": { area: "research", tab: "source-conflicts" },
      "/portfolio-review": { area: "review", tab: "manager" },
      "/reconciliation": { area: "review", tab: "reconciliation" },
      "/mmf-accrual": { area: "review", tab: "income" },
      "/tax-summary": { area: "review", tab: "tax" },
      "/settings": { area: "plan", tab: "goal" },
    };
    const byPath = new Map(redirectRoutes.map((r) => [r.path, r]));
    for (const [path, want] of Object.entries(promised)) {
      const got = byPath.get(path);
      expect(got, `missing redirect for legacy path ${path}`).toBeTruthy();
      expect(got).toMatchObject(want);
    }
  });

  it("does not leave the consolidated standalone pages mounted as their own routes", () => {
    // These paths must be redirects now, not `component={X}` / inline render routes
    // that bypass the parent area (which would resurrect the old fragmented nav).
    const mustNotRenderDirectly = [
      "/securities",
      "/ledger",
      "/deposits",
      "/tax-summary",
      "/portfolio-review",
    ];
    for (const path of mustNotRenderDirectly) {
      const directComponent = new RegExp(
        `<Route\\s+path="${path}"\\s+component=`,
      );
      expect(directComponent.test(app), `${path} should redirect, not mount directly`).toBe(
        false,
      );
    }
  });
});
