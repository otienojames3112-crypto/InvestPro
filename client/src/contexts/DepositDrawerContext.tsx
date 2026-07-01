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
      bankName: string;
      instrumentType: BankInstrumentType;
      /** Indicative published rate (%). User can edit; bank rates negotiate. */
      indicativeRate?: number | null;
      /** Typical tenor free-text, e.g. "12 months". */
      typicalTenor?: string | null;
    }
  | {
      kind: "gov";
      /** Which government-securities bucket to preselect. */
      bucket: "tbill" | "ifb" | "fxd" | "zero" | "floating";
      /** T-bill tenor in days, when bucket === "tbill". */
      tbillTenorDays?: 91 | 182 | 364;
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
