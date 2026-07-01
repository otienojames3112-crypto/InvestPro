/**
 * Round 79 — the ONE place the Dashboard's "Next action" and priority-alert
 * routing is derived. Previously this logic was inlined inside the command-centre
 * IIFE in Dashboard.tsx, mixing rendering with routing and making it impossible to
 * unit-test that (a) the right thing shows first and (b) every alert deep-links to
 * a valid destination. Extracting it here keeps the Dashboard thin and lets the
 * acceptance test assert the action/alert contract directly.
 *
 * These are PURE functions — no React, no tRPC. Callers pass already-derived
 * scalars from the snapshot/decision surface; we only decide text, tone, ordering
 * and href (always a typed `dashboardHref` value, never a hand-written string).
 */
import { dashboardHref } from "./navigation";

export type AlertTone = "red" | "amber";

export interface CommandAlertModel {
  id: string;
  label: string;
  detail?: string;
  tone: AlertTone;
  /** Where clicking the alert takes the user to resolve / understand it. */
  href: string;
}

/**
 * The single most-important next action. `actionable === false` means the plan is
 * genuinely all-clear: the UI should render a calm, non-clickable "you're on
 * track" state rather than a link that dead-ends on a form with nothing to do.
 */
export interface NextActionModel {
  text: string;
  href: string;
  actionable: boolean;
}

export interface DashboardActionInputs {
  /** Pace is "behind" — contribution is lagging the plan. */
  behind: boolean;
  /** A feasible step-up exists to get back on pace. */
  stepUpFeasible: boolean;
  /** Recommended monthly step-up (KES) when behind + feasible. */
  recommendedStepUp: number;
  /** Rates are so old the projection can't be trusted. */
  ratesVeryStale: boolean;
  /** Rates are stale (softer than veryStale). */
  ratesStale: boolean;
  /** This month has a planned contribution that hasn't been recorded yet. */
  contributionDue: boolean;
  /** Number of maturities inside the next 90 days (from the canonical feed). */
  maturitiesNext90: number;
  /** Face total (KES) of those maturities. */
  maturitiesFaceTotal: number;
  /** A concentration cap is breached. */
  concentrationBreached: boolean;
  /** Sources disagree on today's value. */
  reconciliationMismatch: boolean;
  /** Pace shortfall (KES) when behind. */
  paceShortfall: number;
  /** Planned contribution this month (KES), for the missed-contribution detail. */
  plannedThis: number;
  /** Preformatted currency strings (injected so this stays framework-free). */
  fmt: {
    kes: (n: number) => string;
    kesCompact: (n: number) => string;
  };
  /** Human label for the stale-rate age, e.g. "3 months ago". */
  rateStaleLabel?: string;
}

/**
 * Decide the single next action. Priority (highest first):
 *  1. Behind pace with a feasible step-up → raise step-up.
 *  2. Rates stale → refresh snapshot.
 *  3. Contribution due → record it.
 *  4. Otherwise → all-clear (non-actionable).
 */
export function buildNextAction(i: DashboardActionInputs): NextActionModel {
  if (i.behind && i.stepUpFeasible) {
    return {
      text: `Raise step-up by ${i.fmt.kes(i.recommendedStepUp)}/mo to stay on pace`,
      href: dashboardHref.changeContribution,
      actionable: true,
    };
  }
  if (i.ratesStale) {
    return {
      text: "Refresh your CBK rate snapshot",
      href: dashboardHref.rates,
      actionable: true,
    };
  }
  if (i.contributionDue) {
    return {
      text: "Record this month's contribution",
      href: dashboardHref.recordDeposit,
      actionable: true,
    };
  }
  return {
    text: "Nothing today — you're on track",
    href: dashboardHref.projectionLedger,
    actionable: false,
  };
}

/**
 * Build the priority alert list, red before amber, each deep-linked to where it
 * is resolved. Mirrors the exact conditions the Dashboard used inline.
 */
export function buildCommandAlerts(i: DashboardActionInputs): CommandAlertModel[] {
  const alerts: CommandAlertModel[] = [];

  if (i.contributionDue) {
    alerts.push({
      id: "missed",
      label: "This month's contribution not recorded",
      detail: `${i.fmt.kes(i.plannedThis)} planned`,
      tone: "amber",
      href: dashboardHref.recordDeposit,
    });
  }
  if (i.maturitiesNext90 > 0) {
    alerts.push({
      id: "mat",
      label: `${i.maturitiesNext90} maturit${i.maturitiesNext90 === 1 ? "y" : "ies"} in next 90 days`,
      detail: i.fmt.kesCompact(i.maturitiesFaceTotal),
      tone: "amber",
      href: dashboardHref.gov,
    });
  }
  if (i.ratesVeryStale) {
    alerts.push({
      id: "rates",
      label: `Rates outdated${i.rateStaleLabel ? ` — ${i.rateStaleLabel}` : ""}`,
      tone: "red",
      href: dashboardHref.rates,
    });
  }
  if (i.concentrationBreached) {
    alerts.push({
      id: "conc",
      label: "Concentration cap breach",
      tone: "amber",
      href: dashboardHref.risk,
    });
  }
  if (i.reconciliationMismatch) {
    alerts.push({
      id: "recon",
      label: "Reconciliation mismatch",
      detail: "Sources disagree on today's value",
      tone: "red",
      href: dashboardHref.reconciliation,
    });
  }
  if (i.behind) {
    alerts.push({
      id: "pace",
      label: `Behind pace by ${i.fmt.kesCompact(i.paceShortfall)}`,
      tone: "red",
      href: dashboardHref.changeContribution,
    });
  }

  // Red before amber; preserve insertion order within a tone.
  return alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
}

/** Every href a Dashboard alert/action can emit — for the acceptance test. */
export const DASHBOARD_ACTION_HREFS: readonly string[] = [
  dashboardHref.changeContribution,
  dashboardHref.rates,
  dashboardHref.recordDeposit,
  dashboardHref.gov,
  dashboardHref.risk,
  dashboardHref.reconciliation,
  dashboardHref.projectionLedger,
] as const;
