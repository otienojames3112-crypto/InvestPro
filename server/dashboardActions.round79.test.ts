/**
 * Round 79 — acceptance tests for the centralized Dashboard action/alert routing
 * (shared/dashboardActions.ts). These lock in three things that previously lived
 * inline in Dashboard.tsx and could silently regress:
 *   1. The "Next action" priority order and the all-clear (non-actionable) state.
 *   2. Every alert deep-links to a VALID area?tab= destination (or /settings).
 *   3. Alerts are ordered red-before-amber.
 */
import { describe, it, expect } from "vitest";
import {
  buildNextAction,
  buildCommandAlerts,
  DASHBOARD_ACTION_HREFS,
  type DashboardActionInputs,
} from "@shared/dashboardActions";
import { AREA_TABS, isValidAreaTab, type AreaName } from "@shared/navigation";

const fmt = {
  kes: (n: number) => `KES ${Math.round(n).toLocaleString()}`,
  kesCompact: (n: number) => `KES ${Math.round(n / 1000)}K`,
};

function baseInputs(over: Partial<DashboardActionInputs> = {}): DashboardActionInputs {
  return {
    behind: false,
    stepUpFeasible: false,
    recommendedStepUp: 0,
    ratesVeryStale: false,
    ratesStale: false,
    contributionDue: false,
    maturitiesNext90: 0,
    maturitiesFaceTotal: 0,
    concentrationBreached: false,
    reconciliationMismatch: false,
    paceShortfall: 0,
    plannedThis: 0,
    fmt,
    rateStaleLabel: undefined,
    ...over,
  };
}

/** A href is valid if it's an /area?tab=validTab or the /settings redirect. */
function hrefIsValid(href: string): boolean {
  if (href === "/settings") return true;
  const m = href.match(/^\/([a-z]+)\?tab=([a-z0-9-]+)$/);
  if (!m) return false;
  const [, area, tab] = m;
  if (!(area in AREA_TABS)) return false;
  return isValidAreaTab(area as AreaName, tab);
}

describe("buildNextAction — priority & all-clear", () => {
  it("all-clear plan yields a non-actionable 'Nothing today' state", () => {
    const a = buildNextAction(baseInputs());
    expect(a.actionable).toBe(false);
    expect(a.text).toMatch(/nothing today/i);
    expect(hrefIsValid(a.href)).toBe(true);
  });

  it("behind + feasible step-up takes top priority", () => {
    const a = buildNextAction(
      baseInputs({ behind: true, stepUpFeasible: true, recommendedStepUp: 2500, contributionDue: true, ratesStale: true }),
    );
    expect(a.actionable).toBe(true);
    expect(a.text).toMatch(/step-up/i);
  });

  it("stale rates outrank a due contribution", () => {
    const a = buildNextAction(baseInputs({ ratesStale: true, contributionDue: true }));
    expect(a.text).toMatch(/rate snapshot/i);
  });

  it("due contribution is surfaced when nothing higher applies", () => {
    const a = buildNextAction(baseInputs({ contributionDue: true }));
    expect(a.text).toMatch(/record this month/i);
    expect(a.actionable).toBe(true);
  });
});

describe("buildCommandAlerts — validity & ordering", () => {
  it("returns no alerts for an all-clear plan", () => {
    expect(buildCommandAlerts(baseInputs())).toEqual([]);
  });

  it("every possible alert deep-links to a valid destination", () => {
    const all = buildCommandAlerts(
      baseInputs({
        contributionDue: true,
        plannedThis: 10000,
        maturitiesNext90: 2,
        maturitiesFaceTotal: 150000,
        ratesVeryStale: true,
        rateStaleLabel: "3 months ago",
        concentrationBreached: true,
        reconciliationMismatch: true,
        behind: true,
        paceShortfall: 42000,
      }),
    );
    // All six alert kinds present.
    expect(all.map((a) => a.id).sort()).toEqual(["conc", "mat", "missed", "pace", "rates", "recon"]);
    for (const alert of all) {
      expect(hrefIsValid(alert.href), `${alert.id} → ${alert.href}`).toBe(true);
    }
  });

  it("orders red alerts before amber", () => {
    const all = buildCommandAlerts(
      baseInputs({
        contributionDue: true, // amber
        plannedThis: 10000,
        reconciliationMismatch: true, // red
      }),
    );
    const firstAmber = all.findIndex((a) => a.tone === "amber");
    const lastRed = all.map((a) => a.tone).lastIndexOf("red");
    expect(lastRed).toBeLessThan(firstAmber);
  });

  it("missed-contribution detail shows the planned amount", () => {
    const all = buildCommandAlerts(baseInputs({ contributionDue: true, plannedThis: 10000 }));
    const missed = all.find((a) => a.id === "missed");
    expect(missed?.detail).toContain("10,000");
  });
});

describe("DASHBOARD_ACTION_HREFS — static safety net", () => {
  it("every declared action href is valid", () => {
    for (const href of DASHBOARD_ACTION_HREFS) {
      expect(hrefIsValid(href), href).toBe(true);
    }
  });
});
