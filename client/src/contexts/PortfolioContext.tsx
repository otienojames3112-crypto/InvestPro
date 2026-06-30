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
  concentrationSnoozeUntil?: number | null;
  /** Round 62: per-portfolio allocation policy. */
  allocationPolicy?: "balanced" | "yield_first" | "custom";
  /** Round 62: when the Yield-first risk acknowledgment was recorded (Unix ms). */
  yieldFirstAckAt?: number | null;
  mmfFundId: number | null;
  cbkSourceUrl: string | null;
  sanlamSourceUrl: string | null;
  ratesLastUpdatedAt: Date | null;
  isSandbox: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type PortfolioMode = "live" | "sandbox";

/**
 * Surface complexity level. `simple` shows only the everyday areas (Dashboard,
 * Plan, Cashflows) and hides the deeper analysis/research tooling; `manager`
 * exposes the full 7-area surface. Stored in localStorage; defaults to manager
 * so existing users see no functionality vanish on first load.
 */
type UserMode = "simple" | "manager";

interface PortfolioContextValue {
  mode: PortfolioMode;
  setMode: (mode: PortfolioMode) => void;
  userMode: UserMode;
  setUserMode: (mode: UserMode) => void;
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
  userMode: "manager",
  setUserMode: () => {},
  portfolioId: null,
  portfolio: null,
  portfolios: [],
  isLoading: true,
  setPortfolioId: () => {},
  refetch: () => {},
});

const STORAGE_KEY = "kes5m_active_portfolio_id";
const MODE_KEY = "kes5m_portfolio_mode";
const USER_MODE_KEY = "kes5m_user_mode";

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [mode, setModeState] = useState<PortfolioMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "sandbox" ? "sandbox" : "live";
  });

  const [userMode, setUserModeState] = useState<UserMode>(() => {
    const stored = localStorage.getItem(USER_MODE_KEY);
    return stored === "simple" ? "simple" : "manager";
  });

  const setUserMode = useCallback((next: UserMode) => {
    setUserModeState(next);
    localStorage.setItem(USER_MODE_KEY, next);
  }, []);

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
      value={{ mode, setMode, userMode, setUserMode, portfolioId, portfolio, portfolios, isLoading, setPortfolioId, refetch }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
