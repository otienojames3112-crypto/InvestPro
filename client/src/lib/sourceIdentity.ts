import {
  resolveApprovalFigureLabel,
  type CatalogueKey,
  type MarketAssetSubtype,
} from "@shared/catalogueFieldContracts";

export type SourceIdentityKind =
  | "official"
  | "issuer"
  | "regulator"
  | "exchange"
  | "manual"
  | "internal"
  | "unknown";

export type SourceIdentity = {
  kind: SourceIdentityKind;
  badge: "Official" | "Issuer" | "Regulator" | "Exchange" | "Manual/pasted" | "Internal/not a source" | "Unknown";
  displayName: string;
  trusted: boolean;
  readiness: "Reusable pattern" | "Audit only";
  helperText: string | null;
};

type SourceIdentityInput = {
  label: string | null;
  url: string | null;
  appHostname?: string | null;
};

const INTERNAL_APP_PATH = /^\/(?:research|ai-intake|api|dashboard|catalogue|portfolio)(?:\/|$)/i;
const MANUAL_SOURCE = /\b(?:pasted|manual|manually entered|qa|test(?:ing)?|not (?:a )?live(?: source)?)\b/i;
const REGULATOR_SOURCE =
  /\b(?:central bank|regulator|regulatory|revenue authority|retirement benefits authority|capital markets authority|sasra|cbk|kra|rba)\b/i;
const EXCHANGE_SOURCE = /\b(?:stock exchange|securities exchange|nairobi securities exchange|nasdaq|nyse)\b/i;
const ISSUER_SOURCE =
  /\b(?:issuer|fund manager|asset management|investment management|commercial bank|microfinance bank|bank|sacco|fund provider)\b/i;
const OFFICIAL_SOURCE = /\b(?:official|government|ministry|national treasury|treasury)\b/i;

function parsedUrl(url: string | null): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function cleanHostname(url: URL | null): string | null {
  return url?.hostname.replace(/^www\./i, "") || null;
}

function isInternalSourceUrl(url: string | null, appHostname?: string | null): boolean {
  if (!url) return false;
  if (/^\/(?!\/)/.test(url)) return true;
  const parsed = parsedUrl(url);
  if (!parsed) return false;
  const hostname = cleanHostname(parsed)?.toLowerCase() ?? "";
  const currentHost = appHostname?.replace(/^www\./i, "").toLowerCase();
  if (currentHost && hostname === currentHost) return true;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.includes("investpro")) return true;
  return hostname.endsWith(".onrender.com") && INTERNAL_APP_PATH.test(parsed.pathname);
}

function identity(
  kind: SourceIdentityKind,
  badge: SourceIdentity["badge"],
  displayName: string,
  helperText: string | null = null,
): SourceIdentity {
  const trusted = kind === "official" || kind === "issuer" || kind === "regulator" || kind === "exchange";
  return {
    kind,
    badge,
    displayName,
    trusted,
    readiness: trusted ? "Reusable pattern" : "Audit only",
    helperText,
  };
}

export function classifySourceIdentity({ label, url, appHostname }: SourceIdentityInput): SourceIdentity {
  const originalLabel = label?.trim() || null;
  const parsed = parsedUrl(url);
  const hostname = cleanHostname(parsed);
  const evidence = `${originalLabel ?? ""} ${hostname ?? ""}`.trim();

  if (isInternalSourceUrl(url, appHostname)) {
    return identity(
      "internal",
      "Internal/not a source",
      "Internal InvestPro page",
      "This is an app page, not an external source for future AI refreshes.",
    );
  }
  if (MANUAL_SOURCE.test(evidence)) {
    return identity("manual", "Manual/pasted", "Manual / pasted source");
  }
  if (REGULATOR_SOURCE.test(evidence)) {
    return identity("regulator", "Regulator", originalLabel ?? hostname ?? "Regulatory source");
  }
  if (EXCHANGE_SOURCE.test(evidence)) {
    return identity("exchange", "Exchange", originalLabel ?? hostname ?? "Exchange source");
  }
  if (ISSUER_SOURCE.test(evidence)) {
    return identity("issuer", "Issuer", originalLabel ?? hostname ?? "Issuer source");
  }
  if (parsed?.hostname.toLowerCase().endsWith(".go.ke") || OFFICIAL_SOURCE.test(evidence)) {
    return identity("official", "Official", originalLabel ?? hostname ?? "Official source");
  }
  return identity("unknown", "Unknown", originalLabel ?? hostname ?? "Unidentified source");
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  whtRate: "WHT rate",
  sourceAsOfDate: "Source as-of date",
  minimumMonthlyContribution: "Minimum monthly contribution",
  distributionYield: "Distribution yield",
  netAssetValue: "Net asset value / NAV",
  nav: "Net asset value / NAV",
  earlyWithdrawal: "Early withdrawal rule",
  earlyWithdrawalPenalty: "Early withdrawal rule",
  earlyWithdrawalRule: "Early withdrawal rule",
  productName: "Product name",
};

const MARKET_ASSET_SUBTYPES: MarketAssetSubtype[] = ["equity", "reit", "offshore_fund", "sacco"];
const ACRONYMS: Record<string, string> = {
  wht: "WHT",
  cbk: "CBK",
  nav: "NAV",
  reit: "REIT",
  sacco: "SACCO",
  fx: "FX",
};

function fallbackFieldLabel(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());
  if (words.length === 0) return key;
  if (!Object.values(ACRONYMS).includes(words[0])) {
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  }
  return words.join(" ");
}

export function sourceLibraryFieldLabel(catalogue: CatalogueKey, key: string): string {
  const override = FIELD_LABEL_OVERRIDES[key];
  if (override) return override;

  if (catalogue === "market_asset") {
    for (const subtype of MARKET_ASSET_SUBTYPES) {
      const label = resolveApprovalFigureLabel(catalogue, subtype, key);
      if (label !== key) return label;
    }
  } else {
    const label = resolveApprovalFigureLabel(catalogue, undefined, key);
    if (label !== key) return label;
  }
  return fallbackFieldLabel(key);
}
