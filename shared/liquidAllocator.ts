/**
 * Round 62 — Liquid-reserve diversification allocator.
 *
 * Spreads the residual LIQUID cash (the portion of the portfolio not locked in
 * term instruments: T-bills, IFB, FXD, fixed deposits) across the eligible
 * liquid homes — the primary MMF, every tracked secondary MMF, and every LIQUID
 * bank instrument (call deposit, ordinary/regular savings, tiered/high-yield
 * savings) — so that no single ISSUER (institution) rests above its per-issuer
 * concentration cap at month-end when that is feasible.
 *
 * This module is intentionally framework-free and pure so it can be unit-tested
 * in isolation and reused by both the projection engine and the React UI.
 *
 * Key rules (from the requirements brief):
 *   - Eligible destinations only: primary MMF, secondary MMFs, liquid bank
 *     instruments. Fixed deposits / T-bills / IFB / FXD are locked and excluded.
 *   - Government securities are sovereign and exempt from the issuer cap (they
 *     are not part of the liquid pot, so they never appear here).
 *   - Per-issuer cap = max(issuerCapFrac, 1/n) where n = number of eligible
 *     liquid homes (the 1/n floor guarantees 100% can always be placed).
 *   - Accounts at the SAME institution count as ONE issuer for the cap.
 *   - Rank homes by NET yield (after WHT), highest first; fill each up to
 *     cap × netWorth, then overflow to the next home.
 *   - Respect each home's minimum balance; a slice below a home's minimum is
 *     skipped and folded into the next home.
 *   - Keep at least the plan's liquid safety floor in immediately-spendable
 *     homes (the MMF + liquid banks all qualify, so the floor is informational
 *     here — it must simply not be pushed into a locked instrument, which this
 *     allocator never does).
 *   - No churn: only flag a home for rebalancing when it drifts more than
 *     driftThresholdFrac of net worth ABOVE its cap.
 *   - Single-home nudge: with only one eligible home, don't fake a split.
 *   - "Too small to diversify yet": when the overflow above the cap is smaller
 *     than the next home's minimum, leave it where it is and label the state.
 *   - Yield-first override: skip the spread and concentrate the whole pot in the
 *     single highest net-yield eligible home (subject to the relaxed cap).
 */

export type LiquidHomeKind =
  | "primary_mmf"
  | "secondary_mmf"
  | "call_deposit"
  | "ordinary_savings"
  | "tiered_savings";

/** Liquid bank instrument kinds that are immediately spendable (not locked). */
export const LIQUID_BANK_KINDS = new Set([
  "call_deposit",
  "ordinary_savings",
  "tiered_savings",
]);

/** Is a bank instrument kind a LIQUID (non-term) home? */
export function isLiquidBankKind(kind: string): boolean {
  return LIQUID_BANK_KINDS.has(kind);
}

/** One eligible liquid home fed into the allocator. */
export interface LiquidHome {
  /** Stable identifier (e.g. "mmf:3", "bank:12"). */
  id: string;
  /** Display label, e.g. "Sanlam MMF" or "Equity call deposit". */
  label: string;
  /** Kind of home. */
  kind: LiquidHomeKind;
  /**
   * Issuer / institution key. Accounts at the same institution share one key so
   * the per-issuer cap treats them as a single issuer. MMFs use the fund manager
   * name; banks use the bank name.
   */
  issuer: string;
  /** GROSS annual yield % (e.g. 8.78). */
  grossYieldPct: number;
  /** WHT rate % applied to this home's yield (e.g. 15). MMFs and most banks 15. */
  whtRatePct: number;
  /** Cash already resting in this home before reallocation (KES). */
  currentBalance: number;
  /** Minimum balance this home requires to hold a slice (KES). 0 if none. */
  minBalance: number;
}

/** Per-home allocation result. */
export interface LiquidAllocationSlice {
  id: string;
  label: string;
  kind: LiquidHomeKind;
  issuer: string;
  /** NET annual yield % after WHT, used for ranking. */
  netYieldPct: number;
  /** Target balance the allocator wants in this home (KES). */
  targetBalance: number;
  /** Target as a share of net worth, 0..1. */
  targetShare: number;
  /** Change from currentBalance to targetBalance (KES; +inflow / −outflow). */
  delta: number;
  /** True if this home should actually be rebalanced (drift exceeds threshold). */
  rebalance: boolean;
}

export type LiquidAllocationState =
  | "diversified" // pot spread across >1 home respecting caps
  | "concentrated_by_policy" // Yield-first: intentionally in one home
  | "single_home" // only one eligible home exists — needs a second
  | "too_small"; // pot too small for the cap to bind meaningfully

export interface LiquidAllocationResult {
  state: LiquidAllocationState;
  /** Total liquid cash distributed (KES). */
  liquidPot: number;
  /** Net worth used for the cap math (KES). */
  netWorth: number;
  /** Effective per-issuer cap fraction actually applied (after 1/n floor). */
  effectiveIssuerCapFrac: number;
  /** Number of eligible liquid homes considered. */
  homeCount: number;
  /** Number of distinct issuers among the eligible homes. */
  issuerCount: number;
  slices: LiquidAllocationSlice[];
  /** Human-friendly explanation / nudge for the UI. */
  message: string;
}

export interface LiquidAllocatorInput {
  homes: LiquidHome[];
  /** Total portfolio value this month (KES) — the cap denominator. */
  netWorth: number;
  /**
   * Liquid pot to place (KES). When omitted, defaults to the sum of the homes'
   * current balances (i.e. reallocate what's already liquid).
   */
  liquidPot?: number;
  /** Per-issuer cap fraction (0..1). Default 0.25. */
  issuerCapFrac?: number;
  /** Liquid safety floor that must remain immediately spendable (KES). */
  safetyFloor?: number;
  /** Allocation policy. "yield_first" concentrates; others diversify. */
  allocationPolicy?: "balanced" | "yield_first" | "custom";
  /** No-churn drift threshold as a fraction of net worth. Default 0.05. */
  driftThresholdFrac?: number;
}

/** Net yield after WHT. */
export function netYield(grossPct: number, whtPct: number): number {
  const g = Number(grossPct) || 0;
  const w = Math.min(100, Math.max(0, Number(whtPct) || 0));
  return g * (1 - w / 100);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run the liquid-reserve diversification allocator. Pure and deterministic.
 */
export function allocateLiquidReserve(
  input: LiquidAllocatorInput,
): LiquidAllocationResult {
  const homes = input.homes ?? [];
  const netWorth = Math.max(0, Number(input.netWorth) || 0);
  const issuerCapFrac =
    typeof input.issuerCapFrac === "number" && input.issuerCapFrac > 0
      ? input.issuerCapFrac
      : 0.25;
  const safetyFloor = Math.max(0, Number(input.safetyFloor) || 0);
  const policy = input.allocationPolicy ?? "balanced";
  const driftThreshold =
    typeof input.driftThresholdFrac === "number" && input.driftThresholdFrac >= 0
      ? input.driftThresholdFrac
      : 0.05;

  const liquidPot =
    typeof input.liquidPot === "number"
      ? Math.max(0, input.liquidPot)
      : homes.reduce((s, h) => s + (Number(h.currentBalance) || 0), 0);

  const n = homes.length;
  const issuerSet = new Set(homes.map((h) => h.issuer));
  const issuerCount = issuerSet.size;

  // Rank homes by net yield (desc), tie-break by larger current balance then id
  // for determinism.
  const ranked = homes
    .map((h) => ({
      home: h,
      net: netYield(h.grossYieldPct, h.whtRatePct),
    }))
    .sort(
      (a, b) =>
        b.net - a.net ||
        (Number(b.home.currentBalance) || 0) - (Number(a.home.currentBalance) || 0) ||
        a.home.id.localeCompare(b.home.id),
    );

  // Empty case.
  if (n === 0 || liquidPot <= 0) {
    return {
      state: "too_small",
      liquidPot,
      netWorth,
      effectiveIssuerCapFrac: issuerCapFrac,
      homeCount: n,
      issuerCount,
      slices: [],
      message:
        n === 0
          ? "No eligible liquid homes. Add a money market fund or a call deposit to hold liquid cash."
          : "No liquid cash to place this month.",
    };
  }

  // Single-home nudge: don't fake a split.
  if (issuerCount <= 1) {
    const top = ranked[0].home;
    const slices: LiquidAllocationSlice[] = [
      {
        id: top.id,
        label: top.label,
        kind: top.kind,
        issuer: top.issuer,
        netYieldPct: round2(ranked[0].net),
        targetBalance: round2(liquidPot),
        targetShare: netWorth > 0 ? liquidPot / netWorth : 1,
        delta: round2(liquidPot - (Number(top.currentBalance) || 0)),
        rebalance: false,
      },
    ];
    return {
      state: "single_home",
      liquidPot,
      netWorth,
      effectiveIssuerCapFrac: issuerCapFrac,
      homeCount: n,
      issuerCount,
      slices,
      message:
        "100% of your liquid cash is in one place. Add a second liquid account (a call deposit or another MMF) to diversify.",
    };
  }

  // Yield-first override: concentrate everything in the single highest net-yield
  // home (subject to the relaxed cap, which Yield-first treats as ~100%).
  if (policy === "yield_first") {
    const top = ranked[0].home;
    const slices: LiquidAllocationSlice[] = ranked.map((r, i) => {
      const target = i === 0 ? liquidPot : 0;
      return {
        id: r.home.id,
        label: r.home.label,
        kind: r.home.kind,
        issuer: r.home.issuer,
        netYieldPct: round2(r.net),
        targetBalance: round2(target),
        targetShare: netWorth > 0 ? target / netWorth : i === 0 ? 1 : 0,
        delta: round2(target - (Number(r.home.currentBalance) || 0)),
        rebalance: i === 0 && Math.abs(target - (Number(r.home.currentBalance) || 0)) > 0,
      };
    });
    return {
      state: "concentrated_by_policy",
      liquidPot,
      netWorth,
      effectiveIssuerCapFrac: 1,
      homeCount: n,
      issuerCount,
      slices,
      message: `Yield-first policy: liquid cash is concentrated in ${top.label} (highest net yield) within your chosen policy.`,
    };
  }

  // ── Balanced / Custom: spread by net yield, respecting the per-issuer cap ──
  // Effective per-issuer cap with the 1/n floor (uses issuer count so 100% can
  // always be placed even when there are few institutions).
  const effIssuerCapFrac = Math.max(issuerCapFrac, 1 / issuerCount);
  const capDenominator = netWorth > 0 ? netWorth : liquidPot;
  const issuerCapKES = effIssuerCapFrac * capDenominator;

  // Track per-issuer allocated total so accounts at one institution share the cap.
  const issuerAllocated = new Map<string, number>();
  const allocated = new Map<string, number>(); // per-home
  for (const h of homes) allocated.set(h.id, 0);

  let remaining = liquidPot;

  // First pass: fill each home (in yield order) up to the room left under its
  // issuer cap, honouring the home's minimum balance.
  for (const r of ranked) {
    if (remaining <= 0.005) break;
    const h = r.home;
    const issuerSoFar = issuerAllocated.get(h.issuer) ?? 0;
    const issuerRoom = Math.max(0, issuerCapKES - issuerSoFar);
    if (issuerRoom <= 0.005) continue;
    let slice = Math.min(remaining, issuerRoom);
    // Minimum-balance gate: if the slice can't clear this home's minimum, skip
    // it and fold into the next home.
    if (h.minBalance > 0 && slice < h.minBalance) continue;
    if (slice <= 0.005) continue;
    allocated.set(h.id, (allocated.get(h.id) ?? 0) + slice);
    issuerAllocated.set(h.issuer, issuerSoFar + slice);
    remaining -= slice;
  }

  // Second pass: if anything is left (e.g. all remaining homes failed their
  // minimum, or rounding), park the residual in the top-yield home so 100% is
  // always placed even if it nudges that issuer above its cap (overflow case).
  if (remaining > 0.005) {
    const top = ranked[0].home;
    allocated.set(top.id, (allocated.get(top.id) ?? 0) + remaining);
    remaining = 0;
  }

  // Build slices and detect the "too small" state (the cap never bound because
  // the whole pot fits under one issuer's cap — i.e. only one home received it).
  const homesWithMoney = Array.from(allocated.values()).filter((v) => v > 0.005);
  // No-churn threshold: a slice is only flagged for rebalancing when the move
  // (|target − current|) exceeds driftThresholdFrac of net worth, so the UI
  // doesn't nag the user about tiny adjustments.
  const churnKES = driftThreshold * capDenominator;
  const slices: LiquidAllocationSlice[] = ranked.map((r) => {
    const target = allocated.get(r.home.id) ?? 0;
    const current = Number(r.home.currentBalance) || 0;
    const move = Math.abs(target - current);
    return {
      id: r.home.id,
      label: r.home.label,
      kind: r.home.kind,
      issuer: r.home.issuer,
      netYieldPct: round2(r.net),
      targetBalance: round2(target),
      targetShare: capDenominator > 0 ? target / capDenominator : 0,
      delta: round2(target - current),
      rebalance: move > churnKES,
    };
  });

  let state: LiquidAllocationState = "diversified";
  let message = `Liquid cash spread across ${homesWithMoney.length} home${homesWithMoney.length === 1 ? "" : "s"}, keeping each issuer at or under ${Math.round(effIssuerCapFrac * 100)}% of net worth.`;
  if (homesWithMoney.length <= 1) {
    state = "too_small";
    message =
      "Too small to diversify yet — the whole liquid balance fits under one issuer's cap. It stays in the highest-yield home until it grows or you add another liquid account.";
  }
  if (safetyFloor > 0) {
    message += ` At least KES ${Math.round(safetyFloor).toLocaleString()} stays immediately spendable.`;
  }

  return {
    state,
    liquidPot,
    netWorth,
    effectiveIssuerCapFrac: effIssuerCapFrac,
    homeCount: n,
    issuerCount,
    slices,
    message,
  };
}


/**
 * Round 63 — turn an allocation result into a concrete list of "move money from
 * A → B" transfers a user can action one by one.
 *
 * The allocator gives each home a target balance and a delta (target − current).
 * Homes with a negative delta are SOURCES (cash to pull out); homes with a
 * positive delta are DESTINATIONS (cash to push in). We greedily match the
 * largest source against the largest destination so the number of transfers is
 * minimal, producing a clean payment plan. Only homes flagged `rebalance`
 * (drift beyond the no-churn threshold) participate, so tiny adjustments never
 * generate a transfer instruction.
 */
export interface LiquidTransfer {
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  /** Amount to move (KES, positive). */
  amount: number;
}

export function buildTransferPlan(
  result: Pick<LiquidAllocationResult, "slices">,
): LiquidTransfer[] {
  const byId = new Map(result.slices.map((s) => [s.id, s]));
  // Only actionable (rebalance) slices generate real moves.
  const sources = result.slices
    .filter((s) => s.rebalance && s.delta < -0.5)
    .map((s) => ({ id: s.id, label: s.label, amount: -s.delta }))
    .sort((a, b) => b.amount - a.amount);
  const dests = result.slices
    .filter((s) => s.rebalance && s.delta > 0.5)
    .map((s) => ({ id: s.id, label: s.label, amount: s.delta }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: LiquidTransfer[] = [];
  let si = 0;
  let di = 0;
  while (si < sources.length && di < dests.length) {
    const src = sources[si];
    const dst = dests[di];
    const move = Math.min(src.amount, dst.amount);
    if (move > 0.5) {
      transfers.push({
        fromId: src.id,
        fromLabel: byId.get(src.id)?.label ?? src.label,
        toId: dst.id,
        toLabel: byId.get(dst.id)?.label ?? dst.label,
        amount: round2(move),
      });
    }
    src.amount -= move;
    dst.amount -= move;
    if (src.amount <= 0.5) si += 1;
    if (dst.amount <= 0.5) di += 1;
  }
  return transfers;
}


/**
 * R66 — drift-threshold evaluation. Given per-home drift (actual − target),
 * the portfolio net worth, the threshold (% of net worth), and whether any home
 * has been reconciled, decide whether to raise a rebalancing alert.
 *
 * Total drift is the sum of absolute per-home drifts. The alert fires only when
 * the user has reconciled at least one home (otherwise drift is meaningless) and
 * net worth is positive.
 */
export interface DriftThresholdResult {
  totalDrift: number;
  thresholdValue: number;
  breached: boolean;
}

export function evaluateDriftThreshold(args: {
  drifts: number[];
  netWorth: number;
  thresholdPct: number;
  hasActuals: boolean;
}): DriftThresholdResult {
  const totalDrift = args.drifts.reduce((sum, d) => sum + Math.abs(d), 0);
  const thresholdValue = (args.thresholdPct / 100) * args.netWorth;
  const breached =
    args.hasActuals && args.netWorth > 0 && totalDrift > thresholdValue;
  return {
    totalDrift: Math.round(totalDrift * 100) / 100,
    thresholdValue: Math.round(thresholdValue * 100) / 100,
    breached,
  };
}
