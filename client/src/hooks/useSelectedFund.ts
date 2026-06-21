/**
 * useSelectedFund
 *
 * Returns the currently-selected MMF fund details for the active portfolio.
 * Falls back to sensible defaults when no fund is selected.
 *
 * Usage:
 *   const { fundName, fundCompany, fundEar, hasFund } = useSelectedFund();
 */
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";

export interface SelectedFundInfo {
  /** Display name, e.g. "Nabo Africa Money Market Fund" */
  fundName: string;
  /** Short label for bucket headers, e.g. "Nabo MMF" */
  fundLabel: string;
  /** Company/manager name, e.g. "Nabo Capital" */
  fundCompany: string;
  /** Effective annual return (gross, before WHT) */
  fundEar: number;
  /** True when a fund has been explicitly selected */
  hasFund: boolean;
  /** Numeric DB id of the selected fund, or null */
  fundId: number | null;
}

const FALLBACK: SelectedFundInfo = {
  fundName: "Money Market Fund",
  fundLabel: "MMF",
  fundCompany: "—",
  fundEar: 8.78,
  hasFund: false,
  fundId: null,
};

export function useSelectedFund(): SelectedFundInfo {
  const { portfolioId } = usePortfolio();

  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  if (!settings?.selectedFundName) return FALLBACK;

  const rawName = settings.selectedFundName;
  // Build a short label: strip common suffixes for compact display
  const shortLabel = rawName
    .replace(/\s*Money Market Fund\s*/i, "")
    .replace(/\s*MMF\s*/i, "")
    .trim();
  const fundLabel = shortLabel ? `${shortLabel} MMF` : rawName;

  return {
    fundName: rawName,
    fundLabel,
    fundCompany: settings.selectedFundCompany ?? "—",
    fundEar: settings.selectedFundEar ?? settings.mmfYield,
    hasFund: true,
    fundId: settings.selectedFundId ?? null,
  };
}
