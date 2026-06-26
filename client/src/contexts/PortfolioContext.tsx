import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface Portfolio {
  id: number;
  name: string;
  description?: string | null;
  targetAmount: number;
  startDate: string;
  horizonMonths: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  foundationFrac: number;
  growthFrac: number;
  deRiskingFrac: number;
  concentrationCapPct?: number;
  typeConcentrationCapPct?: number;
  mmfFundId: number | null;
  cbkSourceUrl: string | null;
  sanlamSourceUrl: string | null;
  ratesLastUpdatedAt: Date | null;
  isSandbox: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type PortfolioMode = "live" | "sandbox";

interface PortfolioContextValue {
  mode: PortfolioMode;
  setMode: (mode: PortfolioMode) => void;
  portfolioId: number | null;
  portfolio: Portfolio | null;
  portfolios: Portfolio[];
  isLoading: boolean;
  setPortfolioId: (id: number) => void;
  refetch: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  mode: "live",
  setMode: () => {},
  portfolioId: null,
  portfolio: null,
  portfolios: [],
  isLoading: true,
  setPortfolioId: () => {},
  refetch: () => {},
});

const STORAGE_KEY = "kes5m_active_portfolio_id";
const MODE_KEY = "kes5m_portfolio_mode";

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [mode, setModeState] = useState<PortfolioMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "sandbox" ? "sandbox" : "live";
  });

  // Active portfolio id is tracked per mode so switching modes restores the
  // last-selected portfolio in that mode.
  const [portfolioId, setPortfolioIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(`${STORAGE_KEY}_${mode}`);
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: portfolios = [], isLoading, refetch } = trpc.portfolios.list.useQuery(
    { isSandbox: mode === "sandbox" },
    { enabled: !!user }
  );

  const setMode = useCallback((next: PortfolioMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    const stored = localStorage.getItem(`${STORAGE_KEY}_${next}`);
    setPortfolioIdState(stored ? parseInt(stored, 10) : null);
  }, []);

  // Auto-select: if stored ID is gone or no selection yet, pick the first portfolio
  useEffect(() => {
    if (isLoading) return;
    if (!portfolios.length) {
      // Nothing in this mode yet — clear selection so empty/onboarding states show.
      if (portfolioId !== null) setPortfolioIdState(null);
      return;
    }
    const ids = portfolios.map((p) => p.id);
    if (!portfolioId || !ids.includes(portfolioId)) {
      const first = portfolios[0].id;
      setPortfolioIdState(first);
      localStorage.setItem(`${STORAGE_KEY}_${mode}`, String(first));
    }
  }, [portfolios, isLoading, portfolioId, mode]);

  const setPortfolioId = useCallback(
    (id: number) => {
      setPortfolioIdState(id);
      localStorage.setItem(`${STORAGE_KEY}_${mode}`, String(id));
    },
    [mode]
  );

  const portfolio = portfolios.find((p) => p.id === portfolioId) ?? null;

  return (
    <PortfolioContext.Provider
      value={{ mode, setMode, portfolioId, portfolio, portfolios, isLoading, setPortfolioId, refetch }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
