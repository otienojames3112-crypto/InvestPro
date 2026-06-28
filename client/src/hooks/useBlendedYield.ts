/**
 * useBlendedYield
 *
 * Single source of truth for the portfolio's blended net yield and real
 * (after-inflation) yield. Extracted from Portfolio Review so the Dashboard
 * front page surfaces the SAME numbers — balance-weighted gross/net yield across
 * the primary MMF, secondary MMFs, bank instruments and CBK securities, minus
 * the inflation benchmark for the real yield.
 *
 * Both pages call this hook, so the front-page yield can never disagree with
 * Portfolio Review (and, per Part 1, agrees with the fixed YTM).
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { bankHoldingValue, buildAllocation, blendedYield } from "@shared/actuals";

const ASSET_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  equity: "Equities",
  etf: "ETFs",
  pension: "Pension",
  sacco: "SACCO",
  business: "Business",
  crypto: "Crypto",
  insurance: "Insurance",
  other: "Other",
};

export interface BlendedYieldSummary {
  /** Balance-weighted gross yield % (pre-WHT). */
  grossYield: number;
  /** Balance-weighted net yield % (after WHT; IFB tax-exempt). */
  netYield: number;
  /** Inflation benchmark % used for the real-yield subtraction. */
  inflation: number;
  /**
   * Real (after-inflation) yield % = display yield − inflation. Mirrors Portfolio
   * Review, which compares the headline `yourYield` (gross) against inflation.
   */
  realYield: number;
  /** Yield shown as the headline ("yourYield" on Review): gross, or fund EAR when no balances. */
  displayYield: number;
  /** Number of interest-bearing parts blended (1 = single fund). */
  partCount: number;
  /** Total interest-bearing balance the yield is weighted over (KES). */
  totalBalance: number;
  /** True once the underlying queries have resolved enough to trust the numbers. */
  ready: boolean;
}

export function useBlendedYield(portfolioId: number | null | undefined): BlendedYieldSummary {
  const enabled = !!portfolioId;
  const fund = useSelectedFund();
  const { data: deposits } = trpc.deposits.list.useQuery({ portfolioId: portfolioId! }, { enabled });
  const { data: holdings } = trpc.otherHoldings.list.useQuery({ portfolioId: portfolioId! }, { enabled });
  const { data: securities } = trpc.securities.list.useQuery({ portfolioId: portfolioId! }, { enabled });
  const { data: benchmarks } = trpc.benchmarks.list.useQuery();
  const { data: secondary } = trpc.secondaryMmfs.list.useQuery({ portfolioId: portfolioId! }, { enabled });
  const { data: bankHoldings } = trpc.bankHoldings.list.useQuery({ portfolioId: portfolioId! }, { enabled });
  const { data: pSettings } = trpc.settings.get.useQuery({ portfolioId: portfolioId! }, { enabled });

  const bench = useMemo(() => {
    const map: Record<string, { label: string; value: number }> = {};
    (benchmarks ?? []).forEach((b) => {
      map[b.metricKey] = { label: b.label, value: b.value };
    });
    return map;
  }, [benchmarks]);

  const alloc = useMemo(
    () =>
      buildAllocation({
        deposits: (deposits ?? []) as never,
        securities: (securities ?? []) as never,
        secondaryMmfs: (secondary ?? []) as never,
        bankHoldings: (bankHoldings ?? []) as never,
        otherHoldings: (holdings ?? []) as never,
        assetLabels: ASSET_LABELS,
        primaryFundId: fund.fundId,
      }),
    [deposits, securities, secondary, bankHoldings, holdings, fund.fundId],
  );

  return useMemo(() => {
    const mmfBucket = alloc.primaryMmf;
    const result = blendedYield({
      primaryMmf: mmfBucket,
      primaryMmfRate: fund.fundEar,
      secondaryMmfs: (secondary ?? []).map((s) => ({
        balance: Number(s.currentBalance ?? 0),
        rate: Number(s.ear ?? 0),
      })),
      bankHoldings: (bankHoldings ?? [])
        .filter((b) => b.isActive)
        .map((b) => ({
          value: bankHoldingValue({
            principal: Number(b.principal ?? 0),
            interestRate: Number(b.interestRate ?? 0),
            isActive: b.isActive,
            currentValue: Number(b.currentValue ?? 0),
          }),
          rate: Number(b.interestRate ?? 0),
        })),
      securities: (securities ?? [])
        .filter((s) => !s.isMatured && Number(s.faceValue ?? 0) > 0)
        .map((s) => {
          let rate: number;
          if (s.securityType === "ifb") rate = bench["ifb_coupon"]?.value ?? 12.5;
          else if (s.securityType === "fxd") rate = bench["fxd_coupon"]?.value ?? 12.35;
          else rate = bench["tbill_91"]?.value ?? 8.82;
          return { value: Number(s.faceValue ?? 0), rate, taxExempt: s.securityType === "ifb" };
        }),
      whtRate: pSettings?.withholdingTax ?? 15,
    });

    const partCount =
      (mmfBucket > 0 ? 1 : 0) +
      (secondary ?? []).filter((s) => Number(s.currentBalance ?? 0) > 0).length +
      (bankHoldings ?? []).filter((b) => b.isActive && Number(b.principal ?? 0) > 0).length +
      (securities ?? []).filter((s) => !s.isMatured && Number(s.faceValue ?? 0) > 0).length;

    const inflation = bench["inflation"]?.value ?? 0;
    const displayYield = result.base > 0 ? result.grossYield : fund.fundEar;

    return {
      grossYield: result.grossYield,
      netYield: result.netYield,
      inflation,
      realYield: displayYield - inflation,
      displayYield,
      partCount,
      totalBalance: result.base,
      ready: !!benchmarks,
    };
  }, [alloc.primaryMmf, secondary, bankHoldings, securities, fund.fundEar, bench, pSettings?.withholdingTax, benchmarks]);
}
