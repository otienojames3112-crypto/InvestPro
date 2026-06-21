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
  cbkSourceUrl: string | null;
  sanlamSourceUrl: string | null;
  ratesLastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PortfolioContextValue {
  portfolioId: number | null;
  portfolio: Portfolio | null;
  portfolios: Portfolio[];
  isLoading: boolean;
  setPortfolioId: (id: number) => void;
  refetch: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  portfolioId: null,
  portfolio: null,
  portfolios: [],
  isLoading: true,
  setPortfolioId: () => {},
  refetch: () => {},
});

const STORAGE_KEY = "kes5m_active_portfolio_id";

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [portfolioId, setPortfolioIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: portfolios = [], isLoading, refetch } = trpc.portfolios.list.useQuery(undefined, {
    enabled: !!user,
  });

  // Auto-select: if stored ID is gone or no selection yet, pick the first portfolio
  useEffect(() => {
    if (isLoading || !portfolios.length) return;
    const ids = portfolios.map((p) => p.id);
    if (!portfolioId || !ids.includes(portfolioId)) {
      const first = portfolios[0].id;
      setPortfolioIdState(first);
      localStorage.setItem(STORAGE_KEY, String(first));
    }
  }, [portfolios, isLoading, portfolioId]);

  const setPortfolioId = useCallback((id: number) => {
    setPortfolioIdState(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const portfolio = portfolios.find((p) => p.id === portfolioId) ?? null;

  return (
    <PortfolioContext.Provider value={{ portfolioId, portfolio, portfolios, isLoading, setPortfolioId, refetch }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
