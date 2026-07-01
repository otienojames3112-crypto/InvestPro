/**
 * Canonical navigation map — the SINGLE source of truth for which `?tab=` ids
 * are valid inside each consolidated parent area, plus typed href helpers for
 * every Dashboard card/alert destination.
 *
 * Why this exists (Round 78): the app moved to 7 consolidated tabbed areas, but
 * the Dashboard still carried hand-written route strings with stale tab ids
 * (e.g. `/cashflows?tab=record`, `/review?tab=rates`) that 404 or silently fall
 * back to the wrong tab. Centralising the valid ids here lets a link-integrity
 * test statically prove no internal `/area?tab=` link points at a non-existent
 * tab, and lets Dashboard render destinations from typed helpers instead of raw
 * strings. Keep this map in lockstep with each area file's `const tabs` — the
 * `navigation.tabs.test.ts` guard asserts they never drift.
 */

export type AreaName = "plan" | "cashflows" | "holdings" | "research" | "review";

/** Valid `?tab=` ids per area, mirroring each area file's `AreaTab[]` list. */
export const AREA_TABS: Record<AreaName, readonly string[]> = {
  plan: ["goal", "allocation", "scenarios", "ledger"],
  cashflows: ["record-in", "withdraw", "scheduled", "actual-vs-planned"],
  holdings: ["overview", "mmf", "gov", "bank", "other"],
  research: [
    "explore",
    "mmf-market",
    "bank-catalogue",
    "cbk-securities",
    "market-assets",
    "ai-import",
    "ai-review",
    "source-conflicts",
  ],
  review: ["manager", "reconciliation", "income", "tax"],
} as const;

/** True when `tab` is a real tab of `area`. */
export function isValidAreaTab(area: AreaName, tab: string): boolean {
  return AREA_TABS[area].includes(tab);
}

/**
 * Build an `/area?tab=id` path, validated at runtime in dev. Throws in
 * non-production if the tab id is not real, so a bad link surfaces immediately
 * rather than shipping a 404.
 */
export function areaTab(area: AreaName, tab: string): string {
  if (!isValidAreaTab(area, tab)) {
    const msg = `[navigation] invalid tab "${tab}" for area "${area}". Valid: ${AREA_TABS[area].join(", ")}`;
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      throw new Error(msg);
    }
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
  return `/${area}?tab=${tab}`;
}

/**
 * Typed destinations for every Dashboard card / alert / action. Rendering from
 * these (never a hand-written string) is what keeps the Dashboard's links valid
 * by construction. The Dashboard card-link acceptance test asserts each card
 * uses exactly these.
 */
export const dashboardHref = {
  // Portfolio status
  fullNetWorth: areaTab("holdings", "overview"),
  goalRemaining: areaTab("plan", "goal"),
  onTrack: areaTab("plan", "allocation"),
  reconciliation: areaTab("review", "reconciliation"),

  // Live actuals pockets
  mmf: areaTab("holdings", "mmf"),
  gov: areaTab("holdings", "gov"),
  bank: areaTab("holdings", "bank"),
  other: areaTab("holdings", "other"),
  interestToDate: areaTab("review", "income"),
  whtToDate: areaTab("review", "tax"),

  // Projection / plan
  projectionLedger: areaTab("plan", "ledger"),
  scenarios: areaTab("plan", "scenarios"),

  // Actions / alerts
  recordDeposit: areaTab("cashflows", "record-in"),
  scheduledContributions: areaTab("cashflows", "scheduled"),
  changeContribution: areaTab("plan", "goal"),
  risk: areaTab("review", "manager"),
  // Research (market reference) — where to compare products before buying.
  bankCatalogue: areaTab("research", "bank-catalogue"),
  mmfMarket: areaTab("research", "mmf-market"),
  cbkSecurities: areaTab("research", "cbk-securities"),
  marketAssets: areaTab("research", "market-assets"),
  /** Rate settings live on Plan → Goal & Plan; `/settings` redirects there. */
  rates: "/settings",
} as const;

export type DashboardHrefKey = keyof typeof dashboardHref;
