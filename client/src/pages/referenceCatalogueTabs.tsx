import { Scale, Landmark, Building2, LineChart, Compass } from "lucide-react";
import type { AreaTab } from "@/components/TabbedArea";
import MmfFunds from "./MmfFunds";
import BankInstruments from "./BankInstruments";
import CbkSecuritiesReference from "./CbkSecuritiesReference";
import MarketAssetsReference from "./MarketAssetsReference";
import AllApprovedInstruments from "./AllApprovedInstruments";

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
    id: "all-approved",
    label: "All Approved Instruments",
    icon: Compass,
    hint: "Master index of every approved catalogue row, with its family, headline fact, source, as-of date, and status.",
    render: () => <AllApprovedInstruments embedded />,
  },
  {
    id: "mmf-market",
    label: "MMF Market",
    icon: Scale,
    hint: "Approved MMF reference facts, including yields, fees, minimums, sources, and as-of dates. Holdings are recorded separately.",
    render: () => <MmfFunds embedded />,
  },
  {
    id: "bank-catalogue",
    label: "Bank Product Catalogue",
    icon: Landmark,
    hint: "Approved bank product reference facts, including rates, minimum amounts, tenors, sources, and as-of dates. Holdings are recorded separately.",
    render: () => <BankInstruments embedded />,
  },
  {
    id: "cbk-securities",
    label: "CBK Securities Reference",
    icon: Building2,
    hint: "Approved CBK securities reference facts, including tenors, coupons, yields, sources, and as-of dates. Holdings are recorded separately.",
    render: () => <CbkSecuritiesReference embedded />,
  },
  {
    id: "market-assets",
    label: "Market Assets Reference",
    icon: LineChart,
    hint: "Approved Equity, REIT, Offshore fund, and SACCO reference facts with their sources and as-of dates. Holdings are recorded separately.",
    render: () => <MarketAssetsReference embedded />,
  },
];
