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
    }
  | {
      kind: "gov";
      /** Which government-securities bucket to preselect. */
      bucket: "tbill" | "ifb" | "fxd" | "zero" | "floating";
      /** T-bill tenor in days, when bucket === "tbill". */
      tbillTenorDays?: 91 | 182 | 364;
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
