/**
 * Round 102 — Instrument Profile Preview Card.
 *
 * Renders the `_extendedFields` JSON from a research finding as a grouped,
 * catalogue-type-aware card. Fields are organised into semantic groups (identity,
 * rates, dates, amounts, composition) so the manager can scan the profile at a
 * glance instead of reading a flat key-value list.
 *
 * Missing-field quality: fields with the `missing_from_source` sentinel are shown
 * with a clear amber "Missing" badge — never blank, never null, never "undefined".
 */

import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  MISSING_FROM_SOURCE,
  isMissingFromSource,
  type InstrumentProfile,
  type CbkSecurityProfile,
  type MmfProfile,
  type BankInstrumentProfile,
  type MarketAssetProfile,
} from "@shared/instrumentProfile";

// ─── Field display helpers ──────────────────────────────────────────────────

function displayValue(v: unknown): string | null {
  if (v === undefined || v === null) return null; // not applicable — hide
  if (isMissingFromSource(v)) return null; // handled separately
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    // Format numbers with commas for large values, keep decimals for rates
    if (Math.abs(v) >= 1000 && Number.isInteger(v)) return v.toLocaleString();
    return String(v);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    // For arrays of objects (like cleanPriceTable), show count
    if (typeof v[0] === "object") return `${v.length} entries`;
    return v.join(", ");
  }
  if (typeof v === "object" && v !== null) {
    // Fund composition or similar nested objects
    const entries = Object.entries(v).filter(([, val]) => val != null && val !== 0);
    if (entries.length === 0) return null;
    return entries.map(([k, val]) => `${k}: ${val}%`).join(", ");
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

type FieldDef = { key: string; label: string };
type FieldGroup = { title: string; fields: FieldDef[] };

// ─── Per-catalogue field groups ─────────────────────────────────────────────

const CBK_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { key: "securityType", label: "Security Type" },
      { key: "issueNumber", label: "Issue Number" },
      { key: "isin", label: "ISIN" },
      { key: "tenorLabel", label: "Tenor" },
      { key: "tenorMonths", label: "Tenor (months)" },
      { key: "tenorDays", label: "Tenor (days)" },
      { key: "purpose", label: "Purpose" },
    ],
  },
  {
    title: "Rates & Pricing",
    fields: [
      { key: "couponRate", label: "Coupon Rate (%)" },
      { key: "yieldRate", label: "Yield / Discount (%)" },
      { key: "cleanPrice", label: "Clean Price" },
      { key: "accruedInterestPer100", label: "Accrued Interest /100" },
      { key: "dirtyPrice", label: "Dirty Price" },
      { key: "withholdingTaxRate", label: "WHT Rate (%)" },
      { key: "taxExempt", label: "Tax Exempt" },
    ],
  },
  {
    title: "Key Dates",
    fields: [
      { key: "maturityDate", label: "Maturity" },
      { key: "salePeriodStart", label: "Sale Start" },
      { key: "salePeriodEnd", label: "Sale End" },
      { key: "bidSubmissionDeadline", label: "Bid Deadline" },
      { key: "auctionDate", label: "Auction" },
      { key: "settlementDate", label: "Settlement" },
    ],
  },
  {
    title: "Amounts & Rules",
    fields: [
      { key: "amountOnOffer", label: "Amount on Offer" },
      { key: "nonCompetitiveMin", label: "Non-Competitive Min" },
      { key: "nonCompetitiveMax", label: "Non-Competitive Max" },
      { key: "competitiveMin", label: "Competitive Min" },
      { key: "secondaryTradingLotSize", label: "Secondary Lot Size" },
      { key: "rediscountingRule", label: "Rediscounting" },
      { key: "pledgeAllowed", label: "Pledge Allowed" },
      { key: "reopeningAllowed", label: "Reopening" },
      { key: "liquidityEligibility", label: "Liquidity Eligibility" },
    ],
  },
];

const MMF_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { key: "fundName", label: "Fund Name" },
      { key: "fundManager", label: "Fund Manager" },
    ],
  },
  {
    title: "Rates & Fees",
    fields: [
      { key: "grossYield", label: "Gross Yield (%)" },
      { key: "effectiveAnnualRate", label: "Effective Annual Rate (%)" },
      { key: "managementFee", label: "Management Fee (%)" },
      { key: "whtRate", label: "WHT Rate (%)" },
    ],
  },
  {
    title: "Terms",
    fields: [
      { key: "minimumInvestment", label: "Minimum Investment" },
      { key: "aum", label: "AUM (KES M)" },
      { key: "dayCountBasis", label: "Day Count Basis" },
      { key: "creditingFrequency", label: "Crediting Frequency" },
      { key: "withdrawalNoticePeriod", label: "Withdrawal Notice" },
      { key: "factsheetDate", label: "Factsheet Date" },
    ],
  },
  {
    title: "Composition",
    fields: [{ key: "fundComposition", label: "Fund Composition" }],
  },
];

const BANK_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { key: "bankName", label: "Bank" },
      { key: "productName", label: "Product" },
      { key: "productType", label: "Type" },
    ],
  },
  {
    title: "Rates",
    fields: [
      { key: "indicativeRate", label: "Indicative Rate (%)" },
      { key: "confirmedRate", label: "Confirmed Rate (%)" },
      { key: "rateType", label: "Rate Type" },
      { key: "negotiable", label: "Negotiable" },
      { key: "whtRate", label: "WHT Rate (%)" },
    ],
  },
  {
    title: "Terms",
    fields: [
      { key: "minimumAmount", label: "Minimum Amount" },
      { key: "tenor", label: "Tenor" },
      { key: "noticePeriod", label: "Notice Period" },
      { key: "payoutFrequency", label: "Payout Frequency" },
      { key: "compoundingFrequency", label: "Compounding" },
      { key: "earlyWithdrawalPenalty", label: "Early Withdrawal Penalty (%)" },
      { key: "liquidityClass", label: "Liquidity Class" },
    ],
  },
];

const MARKET_ASSET_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { key: "assetType", label: "Asset Type" },
      { key: "ticker", label: "Ticker" },
      { key: "exchange", label: "Exchange" },
    ],
  },
  {
    title: "Pricing & Returns",
    fields: [
      { key: "marketPrice", label: "Market Price" },
      { key: "nav", label: "NAV" },
      { key: "dividendYield", label: "Dividend Yield (%)" },
      { key: "distributionYield", label: "Distribution Yield (%)" },
      { key: "trailingReturn", label: "Trailing 12m Return (%)" },
      { key: "fee", label: "Expense Ratio (%)" },
    ],
  },
  {
    title: "Risk & Liquidity",
    fields: [
      { key: "fxRisk", label: "FX Risk" },
      { key: "liquidity", label: "Liquidity" },
    ],
  },
];

function groupsForCatalogue(cat: string): FieldGroup[] {
  switch (cat) {
    case "cbk":
      return CBK_GROUPS;
    case "mmf":
      return MMF_GROUPS;
    case "bank":
      return BANK_GROUPS;
    case "market_asset":
      return MARKET_ASSET_GROUPS;
    default:
      return [];
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  /** The raw `_extendedFields` value from a finding's extractedFields. */
  extendedFieldsRaw: unknown;
  /** Missing fields list from the finding. */
  missingFields?: string[] | null;
}

/**
 * Parse the _extendedFields JSON (may be a string or an object) into a typed profile.
 */
function parseProfile(raw: unknown): InstrumentProfile | null {
  if (!raw) return null;
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return null;
    if (!("catalogueType" in obj)) return null;
    return obj as InstrumentProfile;
  } catch {
    return null;
  }
}

export function InstrumentProfilePreview({ extendedFieldsRaw, missingFields }: Props) {
  const profile = parseProfile(extendedFieldsRaw);
  if (!profile) return null;

  const groups = groupsForCatalogue(profile.catalogueType);
  if (groups.length === 0) return null;

  const missingSet = new Set(missingFields ?? []);
  const profileRecord = profile as unknown as Record<string, unknown>;

  // Only render groups that have at least one populated or missing field
  const visibleGroups = groups
    .map((g) => {
      const visibleFields = g.fields.filter((f) => {
        const v = profileRecord[f.key];
        return v !== undefined; // show if present (including missing_from_source)
      });
      return { ...g, fields: visibleFields };
    })
    .filter((g) => g.fields.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/40 bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Instrument Profile Preview
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {visibleGroups.map((group) => (
          <div key={group.title} className="px-3 py-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {group.title}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
              {group.fields.map((f) => {
                const raw = profileRecord[f.key];
                const isMissing = isMissingFromSource(raw) || missingSet.has(f.key);
                const display = isMissing ? null : displayValue(raw);

                return (
                  <div key={f.key} className="min-w-0">
                    <span className="text-[11px] text-muted-foreground">{f.label}</span>
                    <div className="text-sm truncate">
                      {isMissing ? (
                        <Badge
                          variant="outline"
                          className="font-normal text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 px-1.5 py-0"
                        >
                          <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                          Missing
                        </Badge>
                      ) : display ? (
                        <span className="font-medium tabular-nums">{display}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
