import { ArrowDownCircle, ArrowUpCircle, CalendarClock, GitCompareArrows } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import Deposits from "./Deposits";
import Withdrawals from "./Withdrawals";
import Contributions from "./Contributions";
import Reconciliation from "./Reconciliation";

/**
 * Cashflows — every movement of money in or out, plus the schedule that drives
 * the plan and the check that compares what actually happened against it.
 *
 * Each tab reuses its existing page verbatim (rendered embedded), so there is no
 * duplicated logic. "Actual vs Planned" maps to the existing Reconciliation
 * surface, which already diffs recorded actuals against the planned seed.
 */
const tabs: AreaTab[] = [
  {
    id: "record-in",
    label: "Record In",
    icon: ArrowDownCircle,
    hint: "Log every real deposit into the exact account it landed in. This is what turns the plan into your live actuals.",
    render: () => <Deposits embedded />,
  },
  {
    id: "withdraw",
    label: "Withdraw",
    icon: ArrowUpCircle,
    hint: "Record money you take out, so your balances and tax stay accurate.",
    render: () => <Withdrawals embedded />,
  },
  {
    id: "scheduled",
    label: "Scheduled",
    icon: CalendarClock,
    hint: "Your planned monthly contribution and any step-up — the recurring inflow the projection assumes. Override any month here.",
    render: () => <Contributions embedded />,
  },
  {
    id: "actual-vs-planned",
    label: "Actual vs Planned",
    icon: GitCompareArrows,
    hint: "Compares what you've actually recorded against what the plan expected by now — so you can see if you're ahead, behind, or on track.",
    render: () => <Reconciliation embedded />,
  },
];

export default function CashflowsArea() {
  return (
    <TabbedArea
      title="Cashflows"
      subtitle="Money in, money out, your contribution schedule, and how reality compares to the plan."
      tabs={tabs}
      defaultTab="record-in"
    />
  );
}
