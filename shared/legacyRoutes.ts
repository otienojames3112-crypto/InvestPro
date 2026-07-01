/**
 * Phase 7/9 — the ONE canonical map of every legacy standalone route to its new
 * home as a tab inside a consolidated area. App.tsx renders its `<Redirect>`s from
 * this table, and the Phase 9 integration test asserts the table is total and
 * internally consistent. Keeping the map here (framework-free) means the routes
 * and their test can never drift from what the app actually forwards.
 */

export interface LegacyRedirect {
  /** Old standalone path, e.g. "/allocation-plan". */
  from: string;
  /** Consolidated parent area the tab now lives in. */
  area: "plan" | "cashflows" | "holdings" | "research" | "review";
  /** Tab id within that area. */
  tab: string;
}

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  // Plan area
  { from: "/allocation-plan", area: "plan", tab: "allocation" },
  { from: "/scenarios", area: "plan", tab: "scenarios" },
  { from: "/ledger", area: "plan", tab: "ledger" },
  // Cashflows area
  { from: "/deposits", area: "cashflows", tab: "record-in" },
  { from: "/withdrawals", area: "cashflows", tab: "withdraw" },
  { from: "/contributions", area: "cashflows", tab: "scheduled" },
  // Holdings area
  { from: "/mmf-funds", area: "holdings", tab: "mmf" },
  { from: "/securities", area: "holdings", tab: "gov" },
  { from: "/bank-instruments", area: "holdings", tab: "bank" },
  { from: "/other-assets", area: "holdings", tab: "other" },
  // Research area
  { from: "/explore", area: "research", tab: "explore" },
  { from: "/mmf-strategy", area: "research", tab: "mmf-market" },
  { from: "/ai-intake", area: "research", tab: "ai-import" },
  { from: "/ai-review", area: "research", tab: "ai-review" },
  { from: "/source-conflicts", area: "research", tab: "source-conflicts" },
  // Review area
  { from: "/portfolio-review", area: "review", tab: "manager" },
  { from: "/reconciliation", area: "review", tab: "reconciliation" },
  { from: "/mmf-accrual", area: "review", tab: "income" },
  { from: "/tax-summary", area: "review", tab: "tax" },
] as const;

/**
 * Build the destination path for a legacy redirect, preserving any extra query
 * params from the old URL (e.g. an allocation→explore `?class=` handoff). The
 * `tab` param is always (re)written to the target tab.
 */
export function buildRedirectTarget(r: LegacyRedirect, search = ""): string {
  const params = new URLSearchParams(search);
  params.set("tab", r.tab);
  return `/${r.area}?${params.toString()}`;
}
