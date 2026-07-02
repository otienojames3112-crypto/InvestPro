import { Scale, Landmark, Building2, LineChart, Compass } from "lucide-react";
import type { AreaTab } from "@/components/TabbedArea";
import MmfFunds from "./MmfFunds";
import BankInstruments from "./BankInstruments";
import CbkSecuritiesReference from "./CbkSecuritiesReference";
import MarketAssetsReference from "./MarketAssetsReference";
import Explore from "./Explore";

/**
 * The four published reference catalogues, nested under the single
 * "reference-catalogues" top-level Research tab (selected via `?cat=`).
 *
 * These live in their own module (not in ResearchArea.tsx) so that the
 * navigation id-integrity test, which statically scans each area file for
 * `id: "..."` literals, only sees the THREE top-level Research tab ids and does
 * not mistake these nested catalogue ids for top-level `?tab=` ids.
 */
export const CATALOGUE_TABS: AreaTab[] = [
  {
    id: "mmf-market",
    label: "MMF Market",
    icon: Scale,
    hint: "The money-market fund market: compare yields, fees and effective annual rate side by side, and choose which fund your plan runs on. Reference data — the accounts you actually hold live under Holdings → MMF.",
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
    id: "all-approved",
    label: "All Approved Instruments",
    icon: Compass,
    hint: "A neutral, read-only screener across every approved row in all four catalogues at once — search, filter, and optionally turn on a transparent Plan-fit score. Published facts only; unapproved AI findings never appear here, and it never picks anything for you.",
    render: () => <Explore embedded />,
  },
];
