import { ClipboardList, Scale, Coins, Receipt } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import PortfolioReview from "./PortfolioReview";
import Reconciliation from "./Reconciliation";
import MmfAccrual from "./MmfAccrual";
import TaxSummary from "./TaxSummary";

/**
 * Review — the consolidated "check the health of the plan" area.
 *
 * Groups the surfaces a manager uses to audit the portfolio: the manager-grade
 * review (concentration, risk limits, diversification), reconciliation (plan vs
 * recorded actuals), the income/accrual ledger, and the tax summary. Each tab
 * reuses its existing page verbatim (rendered embedded).
 */
const tabs: AreaTab[] = [
  {
    id: "manager",
    label: "Manager",
    icon: ClipboardList,
    hint: "A portfolio-manager view: how concentrated your holdings are, whether they breach your risk limits, and where to diversify.",
    render: () => <PortfolioReview embedded />,
  },
  {
    id: "reconciliation",
    label: "Reconciliation",
    icon: Scale,
    hint: "Compare what the plan expected against what you actually recorded — so the numbers stay honest.",
    render: () => <Reconciliation embedded />,
  },
  {
    id: "income",
    label: "Income",
    icon: Coins,
    hint: "Day-by-day money-market interest: gross earned, tax deducted, and what's actually added to your balance.",
    render: () => <MmfAccrual embedded />,
  },
  {
    id: "tax",
    label: "Tax",
    icon: Receipt,
    hint: "The withholding tax your plan incurs across MMF interest, T-bill discount and bond coupons — and what stays exempt.",
    render: () => <TaxSummary embedded />,
  },
];

export default function ReviewArea() {
  return (
    <TabbedArea
      title="Review"
      subtitle="Audit the plan's health: concentration, reconciliation, income and tax."
      tabs={tabs}
      defaultTab="manager"
    />
  );
}
