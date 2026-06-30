/**
 * Plan-to-ledger contract — the ACTIVE STRATEGY POLICY.
 *
 * The committed allocation tier is not decorative: it must become the concrete
 * operating policy that the projection engine (and therefore the Ledger,
 * Dashboard, Scenarios baseline, Allocation probability and Reconciliation) all
 * execute. This module is the SINGLE place a tier is turned into engine-facing
 * knobs, so every surface that wants "the policy the ledger follows" derives it
 * the same way.
 *
 * Design axis: the five tiers sit on one ascending risk spectrum
 * (capital_preservation → aggressive). We express the policy as a deterministic
 * TILT of the engine's existing per-phase asset mix along a
 * cash/short-T-bill ↔ long-bond (IFB/FXD) axis:
 *
 *   - capital_preservation: collapse the mix to MMF + short T-bills only; never
 *     buy IFB/FXD (maximal end-state liquidity, smallest downside band).
 *   - conservative: move ~half of the long-bond weight back to cash/T-bills.
 *   - balanced: IDENTITY — exactly the engine's current getPhaseAllocation mix,
 *     so committing "balanced" reproduces today's ledger byte-for-byte and every
 *     existing test stays green.
 *   - growth: shift cash/T-bill weight into IFB/FXD (more long bonds).
 *   - aggressive: push the long-bond weight to the cap, thinnest cash buffer the
 *     liquidity guard still permits.
 *
 * The tilt is pure and bounded — it only RE-WEIGHTS the four families the engine
 * already allocates across (mmf, tbill, ifb, fxd) and always re-normalises to
 * sum 1, so no new instrument families or sweep mechanics are introduced. The
 * end-state liquidity guard (no instrument maturing past the goal) is unchanged
 * and still clamps the tilt near the horizon.
 */

import type { AllocationTier } from "./allocationModel";
import { tierRank } from "./allocationModel";

/** Alias so the engine can reference the tier type without importing allocationModel. */
export type EngineTier = AllocationTier;

/** The four families the projection engine sweeps across. */
export interface PhaseMix {
  mmf: number;
  tbill: number;
  ifb: number;
  fxd: number;
}

/** Source of the committed policy. */
export type PolicySource = "suggested" | "user_override";

/**
 * The concrete, persisted operating policy derived from a committed tier. This
 * is the shape the plan-to-ledger contract formalises. It is fully reproducible
 * from `selectedTier` (every field below is a pure function of the tier), so the
 * engine can rebuild the exact path from the stored tier alone; the extra fields
 * are persisted so a surface can DISPLAY the policy without re-deriving it and so
 * Reconciliation can compare "what the projection used" against "what was
 * committed".
 */
export interface StrategyPolicy {
  selectedTier: AllocationTier;
  committedAt: number | null;
  source: PolicySource;
  /**
   * Risk rules: the long-run downside-band multiplier (how wide the projected
   * low–high range is, relative to balanced) and whether long bonds are allowed
   * at all. A safer tier narrows the band; a riskier tier widens it.
   */
  riskRules: {
    /** Multiplier applied to the projection's downside/upside half-band width. */
    bandWidthMultiplier: number;
    /** Whether IFB/FXD long bonds may ever be bought under this tier. */
    allowLongBonds: boolean;
  };
  /**
   * Liquidity rules: how much working cash to keep relative to the engine's
   * derived safety floor. Safer tiers hold more cash; aggressive trims it.
   */
  liquidityRules: {
    /** Multiplier applied to the engine's safety-floor cash buffer. */
    safetyFloorMultiplier: number;
    /** Target end-state liquid share (informational; the guard still governs). */
    endStateLiquidTargetPct: number;
  };
  /**
   * Concentration rules: the max share of the portfolio one instrument family
   * may absorb. Safer tiers diversify harder; aggressive concentrates in the
   * top-yielding permitted family.
   */
  concentrationRules: {
    familyCapFrac: number;
  };
}

/**
 * The risk RANK → tilt strength. Balanced (rank 2) is the identity (0 tilt).
 * Negative = tilt toward cash/short; positive = tilt toward long bonds. The
 * magnitude is the fraction of the opposing side's weight that is moved.
 */
function tierTiltStrength(tier: AllocationTier): number {
  // rank: 0 capital_preservation … 2 balanced … 4 aggressive
  const delta = tierRank(tier) - tierRank("balanced"); // -2 … +2
  return delta * 0.5; // -1.0 … +1.0
}

/**
 * Re-weight a base per-phase mix by the committed tier. Pure and total: returns
 * a fresh PhaseMix that always sums to ~1. `balanced` returns the input mix
 * unchanged (identity) so the engine's current behaviour is preserved exactly.
 *
 * Mechanics:
 *   - long-side weight  = ifb + fxd
 *   - short-side weight = mmf + tbill
 *   - a NEGATIVE tilt moves `|tilt| * longSide` from IFB/FXD into MMF/T-bills
 *     (proportionally within each side); capital_preservation (tilt -1) empties
 *     the long side entirely.
 *   - a POSITIVE tilt moves `tilt * shortSide` from MMF/T-bills into IFB/FXD;
 *     but only the T-bill portion is tapped first (MMF working cash is the last
 *     to be converted) so a riskier tier deploys idle cash before it touches the
 *     liquid buffer.
 */
export function tieredPhaseMix(
  base: PhaseMix,
  tier: AllocationTier,
): PhaseMix {
  const tilt = tierTiltStrength(tier);
  if (tilt === 0) return { ...base };

  const out: PhaseMix = { ...base };

  if (tilt < 0) {
    // Move long-bond weight back into cash/short, proportionally.
    const moveFrac = Math.min(1, -tilt);
    const fromIfb = out.ifb * moveFrac;
    const fromFxd = out.fxd * moveFrac;
    out.ifb -= fromIfb;
    out.fxd -= fromFxd;
    const moved = fromIfb + fromFxd;
    // Land it on the short side, keeping the existing mmf:tbill ratio (or split
    // evenly if the short side is currently empty).
    const shortSide = out.mmf + out.tbill;
    if (shortSide > 0) {
      out.mmf += moved * (out.mmf / shortSide);
      out.tbill += moved * (out.tbill / shortSide);
    } else {
      out.mmf += moved * 0.5;
      out.tbill += moved * 0.5;
    }
  } else {
    // Move cash/short weight into long bonds. Tap T-bills first, then MMF — the
    // MMF working balance is the last thing a riskier tier converts.
    const moveFrac = Math.min(1, tilt);
    const fromTbill = out.tbill * moveFrac;
    // Only dip into MMF once T-bills are exhausted at full tilt.
    const fromMmf = out.mmf * Math.max(0, moveFrac - 0.5) * 2 * 0.5;
    out.tbill -= fromTbill;
    out.mmf -= fromMmf;
    const moved = fromTbill + fromMmf;
    // Land it on the long side, keeping the existing ifb:fxd ratio (or split
    // evenly when the base has no long bonds in this phase, e.g. foundation).
    const longSide = out.ifb + out.fxd;
    if (longSide > 0) {
      out.ifb += moved * (out.ifb / longSide);
      out.fxd += moved * (out.fxd / longSide);
    } else {
      out.ifb += moved * 0.6;
      out.fxd += moved * 0.4;
    }
  }

  // Re-normalise defensively against float drift.
  const sum = out.mmf + out.tbill + out.ifb + out.fxd;
  if (sum > 0) {
    out.mmf /= sum;
    out.tbill /= sum;
    out.ifb /= sum;
    out.fxd /= sum;
  }
  return out;
}

/**
 * Build the full concrete policy from a committed tier. Pure: every field is a
 * deterministic function of the tier, so the engine can reproduce the path from
 * the stored tier alone and a display surface can render the policy without
 * recomputation.
 */
export function buildStrategyPolicy(args: {
  selectedTier: AllocationTier;
  committedAt: number | null;
  source: PolicySource;
}): StrategyPolicy {
  const { selectedTier, committedAt, source } = args;
  const rank = tierRank(selectedTier); // 0 (CP) … 2 (balanced) … 4 (aggressive)

  // Downside/upside band width, recentred so balanced is exactly 1.0:
  //   CP 0.6 · conservative 0.8 · balanced 1.0 · growth 1.2 · aggressive 1.4
  const bandWidth = 1 + (rank - 2) * 0.2;

  // Long bonds are forbidden only under capital preservation.
  const allowLongBonds = selectedTier !== "capital_preservation";

  // Working-cash buffer relative to the engine's derived safety floor:
  //   CP 1.5 · conservative 1.25 · balanced 1.0 · growth 0.75 · aggressive 0.5
  const safetyFloorMultiplier = Math.max(0.5, 1 + (2 - rank) * 0.25);

  // Target end-state liquid share: safer keeps more liquid at the goal date.
  //   CP 100 · conservative 85 · balanced 70 · growth 55 · aggressive 40
  const endStateLiquidTargetPct = Math.max(40, 100 - rank * 15);

  // Family concentration cap, recentred on the engine's historical 0.6 default:
  //   CP 0.4 · conservative 0.5 · balanced 0.6 · growth 0.7 · aggressive 0.8
  const familyCapFrac = Math.min(0.9, Math.max(0.3, 0.6 + (rank - 2) * 0.1));

  return {
    selectedTier,
    committedAt,
    source,
    riskRules: {
      bandWidthMultiplier: Number(bandWidth.toFixed(3)),
      allowLongBonds,
    },
    liquidityRules: {
      safetyFloorMultiplier: Number(safetyFloorMultiplier.toFixed(3)),
      endStateLiquidTargetPct,
    },
    concentrationRules: {
      familyCapFrac: Number(familyCapFrac.toFixed(3)),
    },
  };
}
