import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useSearch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DepositDrawerProvider } from "./contexts/DepositDrawerContext";
import { PortfolioProvider } from "./contexts/PortfolioContext";
import Dashboard from "./pages/Dashboard";
import GettingStarted from "./pages/GettingStarted";
import Learn from "./pages/Learn";
import { TimeMachine } from "./pages/TimeMachine";
import OpportunityDetail from "./pages/OpportunityDetail";
import AddInstrument from "./pages/AddInstrument";
import PlanArea from "./pages/PlanArea";
import CashflowsArea from "./pages/CashflowsArea";
import HoldingsArea from "./pages/HoldingsArea";
import ResearchArea from "./pages/ResearchArea";
import ReviewArea from "./pages/ReviewArea";

/**
 * Legacy-route redirect. Each old standalone page now lives as a tab inside one
 * of the consolidated parent areas, so every old path forwards to
 * `/<area>?tab=<id>`. Any extra query params on the old URL (e.g. the
 * allocation→explore `?class=` handoff) are preserved so deep-links keep working.
 */
function TabRedirect({ area, tab }: { area: string; tab: string }) {
  const search = useSearch();
  const existing = new URLSearchParams(search);
  existing.set("tab", tab);
  return <Redirect to={`/${area}?${existing.toString()}`} replace />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />

      {/* ---- Consolidated parent areas (the 7 manager-grade surfaces) ---- */}
      <Route path="/plan" component={PlanArea} />
      <Route path="/cashflows" component={CashflowsArea} />
      <Route path="/holdings" component={HoldingsArea} />
      <Route path="/research" component={ResearchArea} />
      <Route path="/review" component={ReviewArea} />

      {/* ---- Guide / Help ---- */}
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/learn" component={Learn} />

      {/* ---- Setup ---- */}
      <Route path="/settings">{() => <TabRedirect area="plan" tab="goal" />}</Route>

      {/* ---- Sandbox-only ---- */}
      <Route path="/time-machine" component={TimeMachine} />

      {/* ---- Full-screen deep pages (kept standalone; opened from Research→Explore) ---- */}
      <Route path="/explore/new" component={AddInstrument} />
      <Route path="/explore/:ref" component={OpportunityDetail} />

      {/* ---- Legacy route redirects → new area + tab ---- */}
      {/* Plan area */}
      <Route path="/allocation-plan">{() => <TabRedirect area="plan" tab="allocation" />}</Route>
      <Route path="/scenarios">{() => <TabRedirect area="plan" tab="scenarios" />}</Route>
      <Route path="/ledger">{() => <TabRedirect area="plan" tab="ledger" />}</Route>

      {/* Cashflows area */}
      <Route path="/deposits">{() => <TabRedirect area="cashflows" tab="record-in" />}</Route>
      <Route path="/withdrawals">{() => <TabRedirect area="cashflows" tab="withdraw" />}</Route>
      <Route path="/contributions">{() => <TabRedirect area="cashflows" tab="scheduled" />}</Route>

      {/* Holdings area */}
      <Route path="/mmf-funds">{() => <TabRedirect area="holdings" tab="mmf" />}</Route>
      <Route path="/securities">{() => <TabRedirect area="holdings" tab="gov" />}</Route>
      <Route path="/bank-instruments">{() => <TabRedirect area="holdings" tab="bank" />}</Route>
      <Route path="/other-assets">{() => <TabRedirect area="holdings" tab="other" />}</Route>

      {/* Research area */}
      <Route path="/explore">{() => <TabRedirect area="research" tab="explore" />}</Route>
      <Route path="/mmf-strategy">{() => <TabRedirect area="research" tab="mmf-comparison" />}</Route>
      <Route path="/ai-intake">{() => <TabRedirect area="research" tab="ai-import" />}</Route>
      <Route path="/ai-review">{() => <TabRedirect area="research" tab="ai-review" />}</Route>
      <Route path="/source-conflicts">{() => <TabRedirect area="research" tab="source-conflicts" />}</Route>

      {/* Review area */}
      <Route path="/portfolio-review">{() => <TabRedirect area="review" tab="manager" />}</Route>
      <Route path="/reconciliation">{() => <TabRedirect area="review" tab="reconciliation" />}</Route>
      <Route path="/mmf-accrual">{() => <TabRedirect area="review" tab="income" />}</Route>
      <Route path="/tax-summary">{() => <TabRedirect area="review" tab="tax" />}</Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <PortfolioProvider>
            <DepositDrawerProvider>
              <Toaster />
              <Router />
            </DepositDrawerProvider>
          </PortfolioProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
