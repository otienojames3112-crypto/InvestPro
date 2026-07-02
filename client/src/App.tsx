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
import { LEGACY_REDIRECTS } from "@shared/legacyRoutes";
import { CATALOGUE_TABS } from "./pages/referenceCatalogueTabs";

/**
 * The nested Reference-Catalogue ids (mmf-market, bank-catalogue, cbk-securities,
 * market-assets, all-approved). These are NOT top-level `?tab=` ids — they live
 * under the `reference-catalogues` tab and are selected with `?cat=`. A legacy
 * redirect that names one of these must therefore forward to
 * `reference-catalogues&cat=<id>`, not `?tab=<id>` (which would silently fall
 * back to the Research Desk).
 */
const CATALOGUE_TAB_IDS = new Set(CATALOGUE_TABS.map((t) => t.id));

/**
 * Legacy-route redirect. Each old standalone page now lives as a tab inside one
 * of the consolidated parent areas, so every old path forwards to
 * `/<area>?tab=<id>`. Any extra query params on the old URL (e.g. the
 * allocation→explore `?class=` handoff) are preserved so deep-links keep working.
 */
function TabRedirect({ area, tab }: { area: string; tab: string }) {
  const search = useSearch();
  const existing = new URLSearchParams(search);
  // Nested Reference-Catalogue targets resolve to the reference-catalogues tab
  // with the catalogue selected via ?cat= (preserving any extra params such as
  // the allocation → all-approved ?class= handoff).
  if (area === "research" && CATALOGUE_TAB_IDS.has(tab)) {
    existing.set("tab", "reference-catalogues");
    existing.set("cat", tab);
  } else {
    existing.set("tab", tab);
  }
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

      {/* ---- Legacy route redirects → new area + tab (driven by the canonical
           LEGACY_REDIRECTS map in shared/legacyRoutes.ts so routes and their
           coverage test can never drift) ---- */}
      {LEGACY_REDIRECTS.map((r) => (
        <Route key={r.from} path={r.from}>
          {() => <TabRedirect area={r.area} tab={r.tab} />}
        </Route>
      ))}

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
