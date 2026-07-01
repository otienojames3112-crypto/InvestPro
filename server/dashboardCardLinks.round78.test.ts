import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dashboardHref } from "@shared/navigation";

/**
 * Round 78 — Dashboard card-link acceptance test.
 *
 * The Dashboard's cards/tiles must render their destinations from the typed
 * `dashboardHref` map (or an event's own `href`), never a hand-written route
 * string. That is what makes the "click a card → 404" bug impossible: the
 * link-integrity scanner (navigation.round78.test.ts) proves every
 * `dashboardHref` value is a real route, and this test proves the cards
 * actually use those helpers.
 *
 * The assertions are static (read the .tsx source) so they need no DOM render
 * and stay fast + deterministic.
 */

const CLIENT_SRC = join(__dirname, "..", "client", "src");
const commandCentre = readFileSync(
  join(CLIENT_SRC, "components", "DashboardCommandCentre.tsx"),
  "utf8",
);
const diagnostics = readFileSync(
  join(CLIENT_SRC, "components", "DashboardDiagnostics.tsx"),
  "utf8",
);

describe("Round 78 — command centre tiles link via dashboardHref", () => {
  const expectedKeys = [
    "fullNetWorth",
    "goalRemaining",
    "onTrack",
    "reconciliation",
    "mmf",
    "gov",
    "bank",
    "other",
    "interestToDate",
    "whtToDate",
    "projectionLedger",
    "scenarios",
    "scheduledContributions",
  ] as const;

  for (const key of expectedKeys) {
    it(`references dashboardHref.${key}`, () => {
      expect(commandCentre).toContain(`dashboardHref.${key}`);
    });
  }

  it("does not hand-write /holdings?tab=, /plan?tab=, /review?tab= or /cashflows?tab= strings", () => {
    // Every internal area link in the command centre must come from a helper.
    const rawLinks = commandCentre.match(/["'`]\/(holdings|plan|review|cashflows)\?tab=[a-z0-9-]+["'`]/g);
    expect(rawLinks, `Hand-written links found: ${rawLinks?.join(", ")}`).toBeNull();
  });

  it("Full Net Worth tile uses the Holdings Overview destination", () => {
    expect(commandCentre).toContain("dashboardHref.fullNetWorth");
    expect(dashboardHref.fullNetWorth).toBe("/holdings?tab=overview");
  });

  it("the next-maturity tile renders its own event href (nextMaturity.href)", () => {
    expect(commandCentre).toMatch(/nextMaturity[^\n]*href/);
  });
});

describe("Round 78 — diagnostics cards link via dashboardHref / event.href", () => {
  it("Risk Snapshot card links to dashboardHref.risk", () => {
    expect(diagnostics).toContain("dashboardHref.risk");
  });

  it("Data Health card links to rates (stale) or reconciliation via helpers", () => {
    expect(diagnostics).toContain("dashboardHref.rates");
    expect(diagnostics).toContain("dashboardHref.reconciliation");
  });

  it("Assumption Summary card links to the canonical rates destination", () => {
    // dashboardHref.rates is the /settings redirect that lands on Plan → Goal & Plan.
    expect(dashboardHref.rates).toBe("/settings");
    expect(diagnostics).toContain("dashboardHref.rates");
  });

  it("Next 3 Cash Events rows deep-link via each event's own href", () => {
    expect(diagnostics).toMatch(/events\[0\]\?\.href/);
  });

  it("does not hand-write /setup links (the former 404 source)", () => {
    expect(diagnostics.includes("/setup")).toBe(false);
    expect(commandCentre.includes("/setup")).toBe(false);
  });
});
