/**
 * Shared rate-staleness helper.
 *
 * Computes a human-readable freshness label for the portfolio's rate snapshot
 * and flags whether it is stale (>= 7 days) or very stale (>= 30 days / never).
 * Used by the Dashboard rate card and the sidebar staleness badge so both use
 * identical thresholds and copy.
 */
export interface RateStaleness {
  label: string;
  isStale: boolean;
  isVeryStale: boolean;
}

export function rateStaleness(updatedAt: Date | string | null | undefined): RateStaleness {
  if (!updatedAt) return { label: "never", isStale: true, isVeryStale: true };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000);
  let label: string;
  if (minutes < 2) label = "just now";
  else if (minutes < 60) label = `${minutes} minutes ago`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  else label = `${days} day${days !== 1 ? "s" : ""} ago`;
  return { label, isStale: days >= 7, isVeryStale: days >= 30 };
}
