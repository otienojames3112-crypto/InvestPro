export const HOW_TO_READ_CATALOGUE_LABEL = "How to read this catalogue";

const SHARED_BOUNDARY = [
  "Reference Catalogues contain approved reference facts only.",
  "Holdings are recorded separately and are the source for actual owned investments.",
  "Research Desk findings remain drafts until a manager approves them.",
  "Source Library is source memory, and Conflict Review handles source disagreements.",
  "Approved reference data does not change holdings or portfolio calculations by itself.",
  "This explanation is educational and reference-only, not investment advice.",
].join("\n");

export function catalogueReadGuide(title: string, fieldGuide: string, pageSnapshot: string): string {
  return [
    `Catalogue guide: ${title}`,
    "",
    "Purpose:",
    SHARED_BOUNDARY,
    "",
    "How to read the fields:",
    fieldGuide.trim(),
    "",
    "Source and freshness:",
    "Read the source as-of date as the date the cited source says the facts applied. Missing values mean the source or approved record did not state that field. Stale values should be rechecked against a newer source before relying on them.",
    "",
    "Current page snapshot:",
    pageSnapshot.trim(),
  ].join("\n");
}

export const MMF_CATALOGUE_FIELD_GUIDE = [
  "- Fund name identifies the CMA-regulated money market fund.",
  "- EAR is the effective annual rate shown for the fund.",
  "- Daily yield is the short-period yield when the source provides it.",
  "- Gross yield, net yield, WHT, and management fee show the rate layers before and after deductions.",
  "- Minimum investment is the smallest recorded starting amount.",
  "- Withdrawal period describes access timing where the source states it.",
  "- AUM is assets under management where available.",
  "- Source, as-of date, and freshness show where the facts came from and how recently they were updated.",
  "- MMF accounts and balances are recorded separately in Holdings.",
].join("\n");

export const BANK_CATALOGUE_FIELD_GUIDE = [
  "- Bank and product name identify the institution and deposit or savings product.",
  "- Product type separates fixed deposits, call deposits, ordinary savings, target savings, and tiered savings.",
  "- Indicative rate is the published or source-stated rate, before any account-specific negotiation.",
  "- Tenor, lock-in, and notice period describe when funds are accessible.",
  "- Minimum deposit is the recorded starting balance requirement.",
  "- WHT, fees, charges, early withdrawal rule, and access speed explain deductions and liquidity terms.",
  "- Source, as-of date, and freshness show where the facts came from and how recently they were updated.",
  "- Actual deposits and balances are recorded separately in Holdings.",
].join("\n");

export const CBK_CATALOGUE_FIELD_GUIDE = [
  "- Security type separates Treasury bills, Treasury bonds, IFBs, FXDs, and other Government of Kenya securities.",
  "- Tenor, auction date, value date, maturity date, and issue number describe the security timeline.",
  "- Yield or rate is the auction or source-stated return figure for the security type.",
  "- Coupon is the stated coupon rate for coupon-bearing securities.",
  "- Tax treatment, WHT, and tax-exempt status explain the tax handling shown for the row.",
  "- Minimum investment is the smallest recorded participation amount.",
  "- Source, as-of date, and freshness show where the facts came from and how recently they were updated.",
  "- Purchases are recorded separately under Holdings -> Government.",
].join("\n");

export const MARKET_ASSETS_CATALOGUE_FIELD_GUIDE = [
  "- Equity rows use company name, ticker, exchange, price, dividend yield, recent dividend, sector, liquidity, and risk level.",
  "- REIT rows use unit price, distribution yield, NAV, occupancy, recent distribution, liquidity, and risk level.",
  "- Offshore fund rows use currency, trailing return, fees, withdrawal period, FX risk, and risk level.",
  "- SACCO rows use dividend or interest rate, share capital, monthly contribution, membership requirement, withdrawal terms, fees, liquidity, and risk or protection notes.",
  "- Source, as-of date, and freshness show where the facts came from and how recently they were updated.",
  "- Market-asset holdings are recorded separately under Holdings -> Other.",
].join("\n");

export const ALL_APPROVED_CATALOGUE_FIELD_GUIDE = [
  "- All Approved Instruments is the master index across the approved reference catalogues.",
  "- Catalogue family shows whether a row belongs to MMF, Bank, CBK, or Market Assets.",
  "- Subtype and category-specific tabs contain the full field set for each row.",
  "- Headline fact is the row's own main reference fact, such as a rate, yield, price, or return figure.",
  "- Source and as-of date show the provenance and date of the cited facts.",
  "- Status and freshness show whether a row is active, archived, stale, or needs source review.",
  "- Open record takes the user to the detailed category catalogue row.",
  "- This index lists approved reference facts; it does not rank or compare incompatible families.",
].join("\n");
