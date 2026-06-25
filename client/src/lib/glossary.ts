/**
 * Single source of truth for the plain-language glossary used across the app.
 *
 * The same definitions power the Getting Started "Terms glossary" list AND the
 * inline hover tooltips on the Dashboard and Tax Summary pages (R41.2), so the
 * wording never drifts between where a term is defined and where it is used.
 *
 * Each entry has a stable `id` (used by the <GlossaryTerm> component to look up
 * a definition) plus the human `term` label and its `def`.
 */
export interface GlossaryEntry {
  id: string;
  term: string;
  def: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { id: "ear", term: "EAR (Effective Annual Rate)", def: "The true annualised yield once compounding is included. MMFs quote a net EAR after the manager's fee; the tracker applies 15% withholding tax on top." },
  { id: "wht", term: "WHT (Withholding Tax)", def: "Tax deducted at source before you receive interest. In Kenya it is 15% on MMF, T-bill and FXD income. IFB (infrastructure bond) interest is tax-exempt." },
  { id: "tbill", term: "T-Bill", def: "A short-term government security sold at a discount over 91, 182 or 364 days. You earn the difference between the discounted price and the face value at maturity." },
  { id: "ifb", term: "IFB (Infrastructure Bond)", def: "A long-dated government bond funding infrastructure. Its coupon is tax-exempt, making its net yield higher than a comparable taxable bond." },
  { id: "fxd", term: "FXD (Fixed-Coupon Treasury Bond)", def: "A government bond paying a fixed semi-annual coupon (around 12.35% gross). The 15% WHT is deducted before the coupon reaches you." },
  { id: "call-deposit", term: "Call deposit", def: "A liquid bank deposit that earns interest while remaining accessible on short notice (no fixed maturity). Rates are usually negotiable for larger balances and sit between an ordinary savings account and a fixed deposit." },
  { id: "fixed-deposit", term: "Fixed deposit", def: "A bank deposit locked for a set term at an agreed rate; principal plus interest is paid back at maturity. Breaking it early usually forfeits some interest (an early-break penalty)." },
  { id: "ordinary-savings", term: "Ordinary / regular savings", def: "An everyday bank savings account that is fully liquid and pays a modest, variable rate. Easy to access but typically the lowest yield of the bank options." },
  { id: "target-savings", term: "Target / goal savings", def: "A savings account tied to a goal and a target date. It usually pays more than ordinary savings, but withdrawing before the target date may forfeit some interest." },
  { id: "tiered-savings", term: "Tiered / high-yield savings", def: "A liquid savings account whose interest rate rises as your balance crosses set tiers, so larger balances earn a higher rate while staying accessible." },
  { id: "early-break", term: "Early-break penalty", def: "Interest you forfeit if you withdraw a term deposit (fixed or goal savings) before its maturity date. It is the cost of breaking the lock early, so term deposits should hold money you will not need until maturity." },
  { id: "concentration", term: "Issuer concentration / diversification", def: "How much of your money sits with any single bank or issuer. Spreading deposits across issuers limits credit risk; this tracker caps any one bank at roughly a quarter of the portfolio. Government securities are exempt because they are sovereign-backed." },
  { id: "sovereign-risk", term: "Sovereign vs bank credit risk", def: "Government securities (T-bills, bonds) are backed by the state and carry sovereign risk; bank deposits depend on the bank staying solvent. When yields are close, the tracker prefers the government instrument for its stronger backing." },
  { id: "rollover", term: "Redeployment / rollover at maturity", def: "When a deposit or security matures, its principal and interest return to the MMF and are re-invested into the best eligible instrument that still matures before your goal date - or kept in the MMF if nothing fits. The Month Ledger shows each move in plain language." },
  { id: "yield-max", term: "Yield-maximising allocation", def: "The rule the engine uses to place each tranche of cash: keep the safety floor liquid, then choose the eligible instrument with the highest net-of-tax yield that matures before your goal, applying a small preference for government backing and a per-bank concentration cap." },
  { id: "duration", term: "Duration", def: "A measure of how sensitive a bond's price is to interest-rate changes. Longer duration means larger price swings when rates move." },
  { id: "gross-yield", term: "Gross yield", def: "The headline interest rate before any tax is taken out. It looks higher than what you actually keep." },
  { id: "net-yield", term: "Net yield", def: "What you actually keep after withholding tax is deducted. Net = gross x (1 - WHT). This is the number that matters for reaching your goal." },
  { id: "day-count", term: "Day-count basis", def: "The convention for counting days in a year when calculating interest (usually Actual/365 in Kenya). It decides how a daily interest figure is derived from an annual rate." },
  { id: "daily-compounding", term: "Daily compounding", def: "Interest is added to your balance every day, so the next day's interest is calculated on a slightly larger balance. Over a year this beats simple (once-a-year) interest." },
  { id: "mmf", term: "MMF (Money Market Fund)", def: "A regulated fund that pools investors' money into safe, short-term instruments. It pays interest daily, is usually withdrawable within 1-3 days, and has no early-exit penalty." },
  { id: "savings-deposit", term: "Savings deposit", def: "An ordinary or instant-access bank account paying a variable, usually lower, interest rate. Easy to access but often the lowest yield." },
  { id: "coupon", term: "Coupon", def: "The interest payment a bond makes to you, usually twice a year, expressed as a percentage of the bond's face value." },
  { id: "maturity", term: "Maturity", def: "The date a security (T-bill, bond or fixed deposit) ends and the principal is returned to you. After maturity the cash is liquid again." },
  { id: "tenor", term: "Tenor", def: "How long a security or deposit runs from start to maturity - e.g. a 182-day T-bill has a 182-day tenor." },
  { id: "sweep", term: "Sweep", def: "Moving surplus cash out of the MMF into a higher-yielding security (such as a T-bill or bond) once you have more than your safety floor. This tracker sweeps automatically in the projection." },
  { id: "safety-floor", term: "Safety floor", def: "The minimum cash kept liquid in the MMF before any sweep. It is your working buffer so you are never forced to break a locked instrument early." },
  { id: "liquidity", term: "Liquidity", def: "How quickly an asset can be turned into spendable cash without loss. MMF and call deposits are highly liquid; fixed deposits and bonds are locked until maturity." },
  { id: "phases", term: "Phases", def: "The four stages of the plan - Foundation, Growth, De-risking and Final liquidity - that shift the mix from building up, to maximising yield, to locking in gains, to holding cash for the goal date." },
  { id: "step-up", term: "Step-up", def: "A scheduled increase in your monthly contribution (e.g. +KES 5,000 every 6 months) that accelerates progress toward the target." },
  { id: "reconciliation", term: "Reconciliation", def: "An independent cross-check that the 'today' value of your portfolio agrees across every source - sum of holdings, the projection engine, the dashboard total and the net-worth card. When they disagree, the mismatch is shown so the cause can be traced." },
  { id: "blended-yield", term: "Blended yield", def: "The single weighted-average yield across all your holdings combined, weighting each instrument by how much money sits in it." },
  { id: "tax-drag", term: "Tax drag", def: "The amount of yield you lose to withholding tax - the gap between your blended gross yield and your blended net yield. Tax-exempt IFBs reduce tax drag." },
  { id: "net-worth", term: "Net worth", def: "The total of everything you actually hold right now - primary MMF, any secondary MMFs, bank deposits, CBK securities and other assets - based on real recorded money, not projections." },
  { id: "rediscounting", term: "Rediscounting / secondary-market sale", def: "Selling a government security (T-bill or bond) before its maturity date on the secondary market rather than holding it to maturity. The price is set by current market rates, so you may receive more or less than face value. Holding to maturity is the normal path; rediscounting is the early-exit option when you need the cash sooner." },
  { id: "coupon-class", term: "Coupon class / tenor", def: "Government bonds are grouped by their maturity length (tenor). FXD and IFB bonds are issued at standard tenors (e.g. 2, 5, 10, 15, 20 years), and each tenor carries its own coupon rate. This tracker keeps a per-tenor rate so a 10-year bond and a 20-year bond can earn different coupons." },
  { id: "fxd-vs-ifb", term: "FXD vs IFB", def: "Two kinds of Treasury bond. An FXD (Fixed-Coupon Treasury Bond) pays a fixed coupon that is taxed at 15% WHT. An IFB (Infrastructure Bond) funds infrastructure and its coupon is fully tax-exempt, so an IFB usually keeps more of its yield than an FXD at the same gross rate." },
  { id: "tiered-wht", term: "Tiered WHT", def: "Withholding tax that changes with the bond's tenor. In Kenya, Treasury bond coupons are taxed at 15% for tenors under 10 years and 10% for tenors of 10 years or more. IFB coupons are exempt regardless of tenor. The tracker applies the correct tier automatically." },
  { id: "accrued-interest", term: "Accrued interest", def: "Interest that has built up on a holding since its start date but has not yet been paid out or compounded. The day-by-day ledger shows accrued interest growing each day; it becomes cash you keep when the instrument pays out or you withdraw." },
  { id: "indicative-rate", term: "Indicative vs negotiated rate", def: "An indicative rate is the bank's published guide rate for a deposit; a negotiated rate is what you actually agree, often higher for larger balances. When you record a bank deposit the tracker pre-fills the indicative rate, but you can override it with the rate you negotiated." },
  { id: "maturity-redeployment", term: "Maturity redeployment", def: "When a security or deposit matures, its principal plus interest returns to the MMF and is automatically re-invested into the best eligible instrument that still matures before your goal date (or kept liquid if nothing fits). This keeps idle cash working without manual reinvestment." },
];

/** Fast lookup of a glossary entry by its stable id. */
export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((g) => [g.id, g])
);

/** Get a definition string by id (empty string if unknown). */
export function glossaryDef(id: string): string {
  return GLOSSARY_BY_ID[id]?.def ?? "";
}
