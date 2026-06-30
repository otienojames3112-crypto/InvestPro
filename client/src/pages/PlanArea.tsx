import { Target, Layers, BarChart3, BookOpen } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import Settings from "./Settings";
import AllocationPlan from "./AllocationPlan";
import Scenarios from "./Scenarios";
import Ledger from "./Ledger";

/**
 * Plan — the consolidated planning area.
 *
 * Brings together the four surfaces a user touches when deciding *what the plan
 * is*: the goal & contribution basics, the risk-tier allocation glide, the
 * what-if scenarios, and the month-by-month ledger the committed plan produces.
 * Each tab reuses its existing page verbatim (rendered embedded), so there is
 * no duplicated logic and no new source of money truth.
 */
const tabs: AreaTab[] = [
  {
    id: "goal",
    label: "Goal & Plan",
    icon: Target,
    hint: "Your target amount, time horizon, start date and contribution schedule — the inputs everything else is built from.",
    render: () => <Settings embedded />,
  },
  {
    id: "allocation",
    label: "Allocation",
    icon: Layers,
    hint: "How your money is spread across asset types as the goal approaches — and your chance of reaching the target. Commit a tier to lock it into the plan.",
    render: () => <AllocationPlan embedded />,
  },
  {
    id: "scenarios",
    label: "Scenarios",
    icon: BarChart3,
    hint: "Try what-if changes (save more, more time, different rates) and see how the finish line moves — without changing your real plan.",
    render: () => <Scenarios embedded />,
  },
  {
    id: "ledger",
    label: "Ledger",
    icon: BookOpen,
    hint: "The month-by-month plan the engine executes: contributions in, interest earned, sweeps into securities, and your running balance.",
    render: () => <Ledger embedded />,
  },
];

export default function PlanArea() {
  return (
    <TabbedArea
      title="Plan"
      subtitle="Set the goal, choose how it's invested, test what-ifs, and read the month-by-month plan."
      tabs={tabs}
      defaultTab="goal"
    />
  );
}
