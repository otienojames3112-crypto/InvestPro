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
import Reconciliation from "./pages/Reconciliation";
import Withdrawals from "./pages/Withdrawals";
import Learn from "./pages/Learn";
import { TimeMachine } from "./pages/TimeMachine";
import Explore from "./pages/Explore";
import OpportunityDetail from "./pages/OpportunityDetail";
import SourceConflicts from "./pages/SourceConflicts";
import AiIntake from "./pages/AiIntake";
import AiReview from "./pages/AiReview";
import AddInstrument from "./pages/AddInstrument";
import AllocationPlan from "./pages/AllocationPlan";
import PlanArea from "./pages/PlanArea";
import CashflowsArea from "./pages/CashflowsArea";
import HoldingsArea from "./pages/HoldingsArea";
import ResearchArea from "./pages/ResearchArea";
import ReviewArea from "./pages/ReviewArea";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ledger">{() => <Ledger />}</Route>
      <Route path="/contributions">{() => <Contributions />}</Route>
      <Route path="/securities">{() => <Securities />}</Route>
      <Route path="/scenarios">{() => <Scenarios />}</Route>
      <Route path="/settings">{() => <Settings />}</Route>
      <Route path="/plan" component={PlanArea} />
      <Route path="/cashflows" component={CashflowsArea} />
      <Route path="/holdings" component={HoldingsArea} />
      <Route path="/research" component={ResearchArea} />
      <Route path="/review" component={ReviewArea} />
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/learn" component={Learn} />
      <Route path="/deposits">{() => <Deposits />}</Route>
      <Route path="/withdrawals">{() => <Withdrawals />}</Route>
      <Route path="/mmf-funds">{() => <MmfFunds />}</Route>
      <Route path="/mmf-accrual">{() => <MmfAccrual />}</Route>
      <Route path="/mmf-strategy">{() => <MmfStrategy />}</Route>
      <Route path="/bank-instruments">{() => <BankInstruments />}</Route>
      <Route path="/tax-summary">{() => <TaxSummary />}</Route>
      <Route path="/portfolio-review">{() => <PortfolioReview />}</Route>
      <Route path="/allocation-plan">{() => <AllocationPlan />}</Route>
      <Route path="/reconciliation">{() => <Reconciliation />}</Route>
      <Route path="/other-assets">{() => <OtherAssets />}</Route>
      <Route path="/explore">{() => <Explore />}</Route>
      <Route path="/explore/new" component={AddInstrument} />
      <Route path="/explore/:ref" component={OpportunityDetail} />
      <Route path="/source-conflicts">{() => <SourceConflicts />}</Route>
      <Route path="/ai-intake">{() => <AiIntake />}</Route>
      <Route path="/ai-review">{() => <AiReview />}</Route>
      <Route path="/time-machine" component={TimeMachine} />
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
