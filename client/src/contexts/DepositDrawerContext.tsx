import { createContext, useContext, useState } from "react";
import { DepositDrawer } from "@/components/DepositDrawer";

interface DepositDrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
}

const DepositDrawerContext = createContext<DepositDrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function DepositDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DepositDrawerContext.Provider value={{ openDrawer: () => setOpen(true), closeDrawer: () => setOpen(false) }}>
      {children}
      <DepositDrawer open={open} onClose={() => setOpen(false)} />
    </DepositDrawerContext.Provider>
  );
}

export function useDepositDrawer() {
  return useContext(DepositDrawerContext);
}
