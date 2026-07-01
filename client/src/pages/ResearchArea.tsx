import { Compass, Scale, Landmark, Building2, LineChart, Inbox } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import Explore from "./Explore";
import MmfFunds from "./MmfFunds";
import BankInstruments from "./BankInstruments";
import CbkSecuritiesReference from "./CbkSecuritiesReference";
import MarketAssetsReference from "./MarketAssetsReference";
import ResearchDesk from "./ResearchDesk";

/**
 * Research — the consolidated "find, reference and govern" area.
 *
 * The first five tabs are read-only reference surfaces (a screener + four
 * catalogues). The final tab, the Research Desk, is the single governed
 * workbench where raw intake (AI import, AI figure review, source-conflict
 * resolution) and the pending-update review queue live: nothing an AI or a
 * source proposes reaches a live catalogue until a maintainer approves it here.
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
    id: "research-desk",
    label: "Research Desk",
    icon: Inbox,
    hint: "The governed workbench between raw data and the live catalogues: import documents, review what an AI or a source proposed, resolve conflicts, and approve changes. Every promotion is an explicit, auditable decision.",
    render: () => <ResearchDesk embedded />,
  },
];

export default function ResearchArea() {
  return (
    <TabbedArea
      title="Research"
      subtitle="Reference the market, import outside data, and govern what reaches your catalogues — then decide for yourself."
      tabs={tabs}
      defaultTab="explore"
    />
  );
}
