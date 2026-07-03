import { createContext, useContext, useState } from "react";
import { DepositDrawer } from "@/components/DepositDrawer";
import type { BankInstrumentType } from "@shared/const";

/**
 * Optional prefill passed when opening the deposit drawer from a reference /
 * catalogue page. The drawer stays the single source of truth for creating an
 * ACTUAL holding; the prefill only seeds the form so the user still confirms
 * every figure (amount, date, rate) before anything is written.
 */
export type DepositPrefill =
  | {
      kind: "bank";
      /** Round 93: provenance link to the reference-catalog row this came from. */
      bankInstrumentId?: number | null;
      bankName: string;
      instrumentType: BankInstrumentType;
      /** Indicative published rate (%). User can edit; bank rates negotiate. */
      indicativeRate?: number | null;
      /** Typical tenor free-text, e.g. "12 months". */
      typicalTenor?: string | null;
      /** Typical tenor in months (parsed), seeds the tenor field for term deposits. */
      tenorMonths?: number | null;
      /** Minimum amount (KES) — seeds the amount field as a starting point. */
      minAmount?: number | null;
      /** Source label/URL for the catalogue row (shown in the confirm summary). */
      source?: string | null;
      /** As-of date for the indicative rate. */
      asOfDate?: string | null;
      // ── Round 99: additional catalogue terms for richer prefill ──
      /** Withholding tax rate (%). */
      whtRate?: number | null;
      /** Payout frequency. */
      payoutFrequency?: "maturity" | "monthly" | "quarterly" | "on_call" | null;
      /** Early-withdrawal penalty (% of interest forfeited). */
      earlyWithdrawalPenalty?: number | null;
      /** Notice period description. */
      noticePeriod?: string | null;
    }
  | {
      kind: "gov";
      /** Which government-securities bucket to preselect. */
      bucket: "tbill" | "ifb" | "fxd" | "zero" | "floating";
      /** T-bill tenor in days, when bucket === "tbill". */
      tbillTenorDays?: 91 | 182 | 364;
      // ── Round 99: full CBK catalogue terms for snapshot + prefill ──
      /** Opportunities row id for the CBK catalogue entry. */
      opportunityId?: number | null;
      /** Security type from catalogue. */
      securityType?: "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" | "zero_coupon" | "floating_rate";
      /** Issue number, e.g. "FXD1/2022/010". */
      issueNumber?: string | null;
      /** ISIN code. */
      isin?: string | null;
      /** Annual coupon rate (%). */
      couponRate?: number | null;
      /** Withholding tax rate (%). */
      whtRate?: number | null;
      /** Whether tax-exempt (IFB). */
      taxExempt?: boolean | null;
      /** Maturity date (ISO). */
      maturityDate?: string | null;
      /** Settlement date (ISO). */
      settlementDate?: string | null;
      /** Coupon payment dates (ISO date strings). */
      couponPaymentDates?: string[] | null;
      /** Clean price per KES 100 face. */
      cleanPrice?: number | null;
      /** Accrued interest per KES 100 face. */
      accruedInterest?: number | null;
      /** Dirty price per KES 100 face. */
      dirtyPrice?: number | null;
      /** Secondary trading lot size (KES). */
      secondaryTradingLotSize?: number | null;
      /** Rediscounting rule. */
      rediscountingRule?: string | null;
      /** Tenor in years (bonds). */
      tenorYears?: number | null;
      /** Yield/discount rate (%). */
      yieldRate?: number | null;
    }
  | {
      /**
       * Round 93: record a deposit into a money-market fund from the MMF Market
       * catalogue. The drawer can only route into an MMF the user ACTUALLY holds
       * (primary or secondary account), so we pass the catalogue fund id and the
       * drawer preselects the matching held destination when one exists. When the
       * fund is not held yet, the drawer opens with no MMF preselected and hints
       * the user to add it as a secondary account first.
       */
      kind: "mmf";
      /** The catalogue fund id (mmf_funds.id) the user picked. */
      mmfFundId: number;
      /** Fund name for the not-held hint copy. */
      fundName?: string;
    };

interface DepositDrawerContextValue {
  /** Open the drawer, optionally seeded with a reference product. */
  openDrawer: (prefill?: DepositPrefill) => void;
  closeDrawer: () => void;
}

const DepositDrawerContext = createContext<DepositDrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function DepositDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<DepositPrefill | null>(null);
  return (
    <DepositDrawerContext.Provider
      value={{
        openDrawer: (p) => {
          setPrefill(p ?? null);
          setOpen(true);
        },
        closeDrawer: () => setOpen(false),
      }}
    >
      {children}
      <DepositDrawer
        open={open}
        onClose={() => setOpen(false)}
        prefill={prefill}
      />
    </DepositDrawerContext.Provider>
  );
}

export function useDepositDrawer() {
  return useContext(DepositDrawerContext);
}
