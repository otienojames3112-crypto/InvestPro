/**
 * Format a number as a KES currency string.
 */
export function formatKES(value: number, decimals = 0): string {
  if (!isFinite(value)) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format a number as a compact KES string (e.g. KES 1.2M).
 */
export function formatKESCompact(value: number): string {
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `KES ${(value / 1_000).toFixed(1)}K`;
  return `KES ${value.toFixed(0)}`;
}

/**
 * Format a percentage.
 */
export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Get the month name and year from a start date and month offset.
 */
export function getMonthLabel(startDate: string, monthNumber: number): string {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + monthNumber - 1);
  return d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
}

/**
 * Get the phase label for display.
 */
export function getPhaseName(phase: string): string {
  switch (phase) {
    case "foundation": return "Foundation";
    case "growth": return "Growth Engine";
    case "de-risking": return "De-risking";
    case "final-liquidity": return "Final Liquidity";
    default: return phase;
  }
}

/**
 * Get the phase color class.
 */
export function getPhaseColorClass(phase: string): string {
  switch (phase) {
    case "foundation": return "phase-foundation";
    case "growth": return "phase-growth";
    case "de-risking": return "phase-de-risking";
    case "final-liquidity": return "phase-final-liquidity";
    default: return "";
  }
}

/**
 * Build a "Mon YYYY – Mon YYYY" date range from a start date and horizon in months.
 * The end is the month in which the horizon completes (start + horizonMonths - 1).
 */
export function formatDateRange(startDate: string | null | undefined, horizonMonths: number | null | undefined): string {
  if (!startDate || !horizonMonths || horizonMonths < 1) return "";
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start);
  end.setMonth(end.getMonth() + horizonMonths - 1);
  const fmt = (d: Date) => d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Get security type label.
 */
export function getSecurityLabel(type: string): string {
  switch (type) {
    case "tbill_91": return "91-Day T-Bill";
    case "tbill_182": return "182-Day T-Bill";
    case "tbill_364": return "364-Day T-Bill";
    case "ifb": return "Infrastructure Bond (IFB)";
    case "fxd": return "Fixed Coupon Bond (FXD)";
    default: return type;
  }
}
