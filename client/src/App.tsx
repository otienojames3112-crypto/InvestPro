import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DepositDrawerProvider } from "./contexts/DepositDrawerContext";
import { PortfolioProvider } from "./contexts/PortfolioContext";
import Dashboard from "./pages/Dashboard";
import Ledger from "./pages/Ledger";
import Contributions from "./pages/Contributions";
import Settings from "./pages/Settings";
import Securities from "./pages/Securities";
import Scenarios from "./pages/Scenarios";
import GettingStarted from "./pages/GettingStarted";
import Deposits from "./pages/Deposits";
import MmfFunds from "./pages/MmfFunds";
import OtherAssets from "./pages/OtherAssets";
import MmfAccrual from "./pages/MmfAccrual";
import TaxSummary from "./pages/TaxSummary";
import MmfStrategy from "./pages/MmfStrategy";
import BankInstruments from "./pages/BankInstruments";
import PortfolioReview from "./pages/PortfolioReview";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ledger" component={Ledger} />
      <Route path="/contributions" component={Contributions} />
      <Route path="/securities" component={Securities} />
      <Route path="/scenarios" component={Scenarios} />
      <Route path="/settings" component={Settings} />
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/deposits" component={Deposits} />
      <Route path="/mmf-funds" component={MmfFunds} />
      <Route path="/mmf-accrual" component={MmfAccrual} />
      <Route path="/mmf-strategy" component={MmfStrategy} />
      <Route path="/bank-instruments" component={BankInstruments} />
      <Route path="/tax-summary" component={TaxSummary} />
      <Route path="/portfolio-review" component={PortfolioReview} />
      <Route path="/other-assets" component={OtherAssets} />
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
