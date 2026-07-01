import { Compass, Scale, Landmark, Sparkles, ClipboardCheck, GitCompareArrows, Building2, LineChart } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import Explore from "./Explore";
import MmfFunds from "./MmfFunds";
import BankInstruments from "./BankInstruments";
import CbkSecuritiesReference from "./CbkSecuritiesReference";
import MarketAssetsReference from "./MarketAssetsReference";
import AiIntake from "./AiIntake";
import AiReview from "./AiReview";
import SourceConflicts from "./SourceConflicts";

/**
 * Research — the consolidated "find and import opportunities" area.
 *
 * Groups the surfaces a user uses to discover instruments (explore, compare
 * MMFs, browse bank products) and to bring outside data in (AI import, AI
 * review, and the source-conflict resolver). Each tab reuses its existing page
 * verbatim (rendered embedded), so there is no duplicated logic.
 */
const tabs: AreaTab[] = [
  {
    id: "explore",
    label: "Explore",
    icon: Compass,
    hint: "Browse and filter investment opportunities across all asset types. A screener — it never picks anything for you.",
    render: () => <Explore embedded />,
  },
  {
    id: "mmf-market",
    label: "MMF Market",
    icon: Scale,
    hint: "The money-market fund market: compare yields, fees and effective annual rate side by side, and choose which fund your plan runs on. This is reference data — the accounts you actually hold live under Holdings → MMF.",
    render: () => <MmfFunds embedded />,
  },
  {
    id: "bank-catalogue",
    label: "Bank Product Catalogue",
    icon: Landmark,
    hint: "A reference catalogue of Kenyan bank deposit products — call, fixed, goal/target, ordinary and tiered savings: rates, minimum amounts and tenors. Reference only; deposits you actually hold live under Holdings → Bank.",
    render: () => <BankInstruments embedded />,
  },
  {
    id: "cbk-securities",
    label: "CBK Securities Reference",
    icon: Building2,
    hint: "Government of Kenya Treasury bills and bonds sourced from CBK auction data — tenors, coupons and indicative yields. Reference only; securities you actually hold live under Holdings → Government.",
    render: () => <CbkSecuritiesReference embedded />,
  },
  {
    id: "market-assets",
    label: "Market Assets Reference",
    icon: LineChart,
    hint: "Listed equities, REITs and offshore funds sourced from public market data — prices, yields and trailing returns. Reference only; assets you actually hold live under Holdings → Other.",
    render: () => <MarketAssetsReference embedded />,
  },
  {
    id: "ai-import",
    label: "AI Import",
    icon: Sparkles,
    hint: "Paste a statement or document and let the assistant extract holdings and figures for you to review before anything is saved.",
    render: () => <AiIntake embedded />,
  },
  {
    id: "ai-review",
    label: "AI Review",
    icon: ClipboardCheck,
    hint: "Check, edit and approve what the assistant extracted before it becomes part of your portfolio.",
    render: () => <AiReview embedded />,
  },
  {
    id: "source-conflicts",
    label: "Source Conflicts",
    icon: GitCompareArrows,
    hint: "When two sources disagree on a figure (a rate or balance), resolve which one your plan should trust.",
    render: () => <SourceConflicts embedded />,
  },
];

export default function ResearchArea() {
  return (
    <TabbedArea
      title="Research"
      subtitle="Discover instruments, compare options, and import outside data — then decide for yourself."
      tabs={tabs}
      defaultTab="explore"
    />
  );
}
