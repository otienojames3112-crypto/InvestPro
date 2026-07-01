import { PiggyBank, Landmark, Building2, Boxes, Wallet } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import HoldingsOverview from "./HoldingsOverview";
import MmfFunds from "./MmfFunds";
import Securities from "./Securities";
import BankInstruments from "./BankInstruments";
import OtherAssets from "./OtherAssets";

/**
 * Holdings — everything you actually own, grouped by where it sits: money market
 * funds, government securities, bank deposits, and everything else.
 *
 * Each tab reuses its existing page verbatim (rendered embedded). No money math
 * is duplicated; valuation still comes from the shared current-value helpers.
 */
const tabs: AreaTab[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Wallet,
    hint: "Your full net worth at a glance — goal-plan assets, excluded assets, and every pocket with a quick link to its detail.",
    render: () => <HoldingsOverview />,
  },
  {
    id: "mmf",
    label: "MMF",
    icon: PiggyBank,
    hint: "Money market funds — your liquid, interest-earning base. Compare funds and pick the one this plan uses.",
    render: () => <MmfFunds embedded />,
  },
  {
    id: "gov",
    label: "Government",
    icon: Landmark,
    hint: "Treasury bills and bonds (T-Bills, IFB, FXD) bought through CBK DhowCSD — your held-to-maturity government paper.",
    render: () => <Securities embedded />,
  },
  {
    id: "bank",
    label: "Bank",
    icon: Building2,
    hint: "Money held at commercial banks — call, fixed, goal/target, ordinary and tiered savings deposits.",
    render: () => <BankInstruments embedded />,
  },
  {
    id: "other",
    label: "Other",
    icon: Boxes,
    hint: "Anything outside the core plan — shares, property, offshore funds, SACCO and more — tracked at your own assumed returns.",
    render: () => <OtherAssets embedded />,
  },
];

export default function HoldingsArea() {
  return (
    <TabbedArea
      title="Holdings"
      subtitle="Everything you own, grouped by where it sits — money market, government, bank, and other assets."
      tabs={tabs}
      defaultTab="overview"
    />
  );
}
