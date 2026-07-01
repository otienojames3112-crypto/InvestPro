/**
 * Pure derivations behind the Manager-mode Dashboard diagnostics cards.
 *
 * These are intentionally free of React / snapshot-selector coupling so they can
 * be unit-tested directly. The component (`DashboardDiagnostics.tsx`) wires the
 * already-computed snapshot / concentration / typeBreach selectors into these.
 * NONE of these perform projection math — they only reshape existing figures.
 */

export interface IssuerBreach {
  issuer: string;
  value: number;
  share: number; // 0–1 fraction
}

export interface ConcentrationLike {
  cap: number; // 0–1 fraction
  netWorth: number;
  topShare: number; // 0–1 fraction
  breaches: IssuerBreach[];
}

export interface ReconVerdict {
  reconciled: boolean;
  basisOk: boolean;
}

export interface CashEventLike {
  atMs: number;
}

/**
 * Concentration shares, caps, type-shares and liquid-at-goal are stored as 0–1
 * fractions, but `formatPct` expects percent units. Scale by 100.
 */
export function scaleShareToPct(fraction: number | null | undefined): number {
  if (fraction == null || !Number.isFinite(fraction)) return 0;
  return fraction * 100;
}

/**
 * The single worst issuer by share (largest first). Returns null when there are
 * no breaches. Does not mutate the input array.
 */
export function pickTopIssuer(
  concentration?: ConcentrationLike | null,
): IssuerBreach | null {
  if (!concentration?.breaches || concentration.breaches.length === 0) return null;
  return [...concentration.breaches].sort((a, b) => b.share - a.share)[0];
}

/**
 * The top issuer's share as a percent, falling back to the aggregate topShare
 * when there are no discrete breaches.
 */
export function topIssuerSharePct(concentration?: ConcentrationLike | null): number {
  const top = pickTopIssuer(concentration);
  return scaleShareToPct(top?.share ?? concentration?.topShare ?? 0);
}

/**
 * Effective reconciliation state for the Data Health card: prefer the explicit
 * verdict the Dashboard computed (mirrors the Reconciliation page exactly), then
 * fall back to the snapshot flag, then treat as reconciled when unknown.
 */
export function effectiveReconciled(
  verdict?: ReconVerdict | null,
  snapshotReconciledOk?: boolean | null,
): boolean {
  if (verdict) return verdict.reconciled;
  if (snapshotReconciledOk != null) return snapshotReconciledOk;
  return true;
}

/**
 * The next N cash events at or after the snapshot's as-of moment, soonest first.
 * Pure: does not mutate the input array.
 */
export function nextCashEvents<T extends { atMs: number }>(
  events: readonly T[] | null | undefined,
  asOfMs: number,
  count = 3,
): T[] {
  if (!events || events.length === 0) return [];
  return [...events]
    .filter((e) => e.atMs >= asOfMs)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, count);
}

/**
 * The MMF EAR to display: the selected fund's net EAR when present, else the
 * manually-entered MMF yield.
 */
export function effectiveMmfEar(
  selectedFundEar: number | null | undefined,
  manualMmfYield: number,
): number {
  return selectedFundEar ?? manualMmfYield;
}
