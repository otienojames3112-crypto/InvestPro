/**
 * Expansion Brief — Part 2: reference seed for the Opportunity Catalog.
 *
 * These are NEUTRAL, SOURCED, TIMESTAMPED facts pulled from public sources. They
 * are stored verbatim — no ranking, no "best/top," no quality score — and every
 * row is flagged `unverified: true` because the figures are gathered from public
 * pages and may be delayed or inaccurate. The catalog presents the universe; the
 * user narrows it.
 *
 * Source notes (captured at seed time, shown inline in the UI):
 *  - NSE equity closes: live.mystocks.co.ke / african-markets.com (late Jun 2026).
 *  - Safaricom final dividend KES 1.15 announced 07-May-2026 (NSE).
 *  - ILAM Fahari I-REIT trailing return: african-markets.com (FAHR).
 *  - SanlamAllianz MMF daily yield 8.45% as of 24-Jun-2026 (manager site).
 *  - CBK securities: indicative CBK auction/secondary levels.
 *  - Offshore funds: indicative published figures; FX/jurisdiction caveats apply.
 */
import type { InsertOpportunity } from "../drizzle/schema";

/** A fixed as-of date for the seed batch (UTC noon to avoid TZ edge cases). */
const ASOF = new Date("2026-06-26T12:00:00Z");

export const OPPORTUNITY_SEED: InsertOpportunity[] = [
  // ── Equities (price-driven) ────────────────────────────────────────────────
  {
    ref: "NSE:SCOM",
    name: "Safaricom PLC",
    assetClass: "equity",
    issuer: "Safaricom PLC",
    currency: "KES",
    market: "NSE",
    lastPrice: "18.50",
    trailingReturnPct: "12.4000",
    yieldPct: "6.2000",
    yieldKind: "dividend yield (indicative)",
    liquidity: "daily",
    factNote: "Final dividend of KES 1.15 announced 07-May-2026; books closure 04-Aug-2026.",
    dataSource: "NSE / mystocks.co.ke daily close",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
  {
    ref: "NSE:KCB",
    name: "KCB Group PLC",
    assetClass: "equity",
    issuer: "KCB Group PLC",
    currency: "KES",
    market: "NSE",
    lastPrice: "76.0000",
    trailingReturnPct: "31.0000",
    yieldPct: "5.2000",
    yieldKind: "dividend yield (indicative)",
    liquidity: "daily",
    factNote: "52-week range 44.00–80.25 per african-markets.com.",
    dataSource: "mystocks.co.ke realtime quote (26-Jun-2026)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
  {
    ref: "NSE:EQTY",
    name: "Equity Group Holdings PLC",
    assetClass: "equity",
    issuer: "Equity Group Holdings PLC",
    currency: "KES",
    market: "NSE",
    lastPrice: "52.0000",
    trailingReturnPct: "24.0000",
    yieldPct: "8.1000",
    yieldKind: "dividend yield (indicative)",
    liquidity: "daily",
    dataSource: "NSE daily market report (02-Jun-2026)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },

  // ── REIT (price-driven) ──────────────────────────────────────────────────
  {
    ref: "NSE:FAHR",
    name: "ILAM Fahari I-REIT",
    assetClass: "reit",
    issuer: "ICEA Lion Asset Management",
    currency: "KES",
    market: "NSE",
    lastPrice: "11.0000",
    trailingReturnPct: "-5.6500",
    yieldPct: "6.4000",
    yieldKind: "distribution yield (indicative)",
    liquidity: "daily",
    factNote: "Distribution of KES 0.70/unit declared for FY2023; 1Y total return -5.65%.",
    dataSource: "african-markets.com (FAHR)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },

  // ── Money-market funds (cash_mmf) ──────────────────────────────────────────
  {
    ref: "MMF:SANLAM-MMF",
    name: "SanlamAllianz Money Market Fund",
    assetClass: "cash_mmf",
    issuer: "Sanlam Allianz Investments",
    currency: "KES",
    market: "Unit trust",
    yieldPct: "8.4500",
    yieldKind: "daily effective annual yield (gross)",
    expenseRatioPct: "1.2000",
    liquidity: "daily",
    factNote: "Daily yield published on the manager fact sheet; gross of 15% WHT.",
    dataSource: "Sanlam Allianz Investments site (24-Jun-2026)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
  {
    ref: "MMF:CIC-MMF",
    name: "CIC Money Market Fund",
    assetClass: "cash_mmf",
    issuer: "CIC Asset Management",
    currency: "KES",
    market: "Unit trust",
    yieldPct: "8.2000",
    yieldKind: "effective annual yield (gross)",
    expenseRatioPct: "1.5000",
    liquidity: "daily",
    factNote: "Largest MMF by market share per industry data.",
    dataSource: "Industry MMF yield round-up (Apr 2026)",
    dataAsOf: new Date("2026-04-28T12:00:00Z"),
    unverified: true,
    active: true,
  },

  // ── Government coupon paper (gov_coupon) ────────────────────────────────────
  {
    ref: "CBK:IFB1-2026",
    name: "Infrastructure Bond IFB1/2026/15",
    assetClass: "gov_coupon",
    issuer: "Central Bank of Kenya",
    currency: "KES",
    market: "CBK",
    yieldPct: "13.5000",
    yieldKind: "coupon (tax-exempt)",
    tenorYears: "15.00",
    maturityDate: new Date("2041-03-01T12:00:00Z"),
    liquidity: "term",
    factNote: "Infrastructure bond; coupon is tax-exempt for qualifying holders.",
    dataSource: "CBK auction results (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
  {
    ref: "CBK:FXD-2026-10Y",
    name: "Treasury Bond FXD1/2026/10",
    assetClass: "gov_coupon",
    issuer: "Central Bank of Kenya",
    currency: "KES",
    market: "CBK",
    yieldPct: "14.2000",
    yieldKind: "coupon",
    tenorYears: "10.00",
    maturityDate: new Date("2036-06-01T12:00:00Z"),
    liquidity: "term",
    dataSource: "CBK secondary market (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },

  // ── Government discount paper (gov_discount) ────────────────────────────────
  {
    ref: "CBK:TBILL-364",
    name: "364-Day Treasury Bill",
    assetClass: "gov_discount",
    issuer: "Central Bank of Kenya",
    currency: "KES",
    market: "CBK",
    yieldPct: "11.9000",
    yieldKind: "discount yield",
    tenorYears: "1.00",
    liquidity: "term",
    dataSource: "CBK weekly T-bill auction (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },

  // ── Offshore funds (price-driven, FX-exposed) ──────────────────────────────
  {
    ref: "OFF:VWRA",
    name: "Vanguard FTSE All-World UCITS ETF (USD)",
    assetClass: "offshore_fund",
    issuer: "Vanguard",
    currency: "USD",
    market: "Offshore (LSE)",
    lastPrice: "142.5000",
    trailingReturnPct: "11.2000",
    expenseRatioPct: "0.2200",
    liquidity: "daily",
    factNote: "USD-denominated; KES returns depend on the USD/KES rate (FX risk).",
    dataSource: "Public ETF fact sheet (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
  {
    ref: "OFF:SPY-MMF-USD",
    name: "USD Money Market Fund (offshore)",
    assetClass: "offshore_fund",
    issuer: "Offshore manager",
    currency: "USD",
    market: "Offshore",
    yieldPct: "4.6000",
    yieldKind: "7-day yield (indicative)",
    expenseRatioPct: "0.1500",
    liquidity: "daily",
    factNote: "USD-denominated; subject to FX and treaty/jurisdiction tax treatment.",
    dataSource: "Public fund fact sheet (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },

  // ── Bank product (bank_deposit) ─────────────────────────────────────────────
  {
    ref: "BANK:FD-12M",
    name: "12-Month Fixed Deposit (representative)",
    assetClass: "bank_deposit",
    issuer: "Tier-1 commercial bank",
    currency: "KES",
    market: "Bank",
    yieldPct: "10.0000",
    yieldKind: "fixed deposit rate (gross)",
    tenorYears: "1.00",
    liquidity: "term",
    factNote: "Representative tier-1 rate; KDIC-insured up to the statutory limit.",
    dataSource: "Bank published deposit rates (indicative)",
    dataAsOf: ASOF,
    unverified: true,
    active: true,
  },
];
