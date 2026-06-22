# Round 12 Research — Verified 2026 Kenyan Market Data

All seeded rows must record `source` and `as_of` date. Data below is for seeding editable reference tables (not scraped at runtime).

## Macro / Benchmark inputs (source: Central Bank of Kenya, as of Jun 2026)
- Central Bank Rate (CBR): **8.75%** (retained 9 Jun 2026 MPC; effective 10/02/2026) — source: centralbank.go.ke
- Inflation Rate: **6.68%** (May 2026) — source: centralbank.go.ke
- 91-Day T-Bill: **8.821%** (22 Jun 2026) — source: centralbank.go.ke
- 182-Day T-Bill: ~9.0% region; 364-Day ~9.6% (Aug 2025 ref) — source: CBK auctions
- Deposit Rate (avg commercial bank): **6.88%** (April 2026) — source: CBK
- Lending Rate: 14.69% (April 2026); Savings Rate 3.31% (April 2026)
- Serrari Kenya KES MMF **Average Index: 8.98%**; **Leaders Index (Top 5): 11.52%** — source: serrarigroup.com (2026)
- Independent analyst (ProAlex/biznake) ~30-MMF average **net** return: **7.78–7.83%** (Apr 2026) — community benchmark, lower because net-of-WHT basis

## Tax mechanics (source: KRA / CBK GoK Securities FAQ)
- MMF interest: **15% Withholding Tax (WHT)** deducted at source by the fund; final tax for individuals. Source: KRA, MMFKenyaInsights.
- T-Bill / T-Bond discount & interest: **15% WHT** (bonds with tenor >= 10 years historically 10%, but standard 15% for most; IFB exempt). CBK FAQ example uses 15%.
- **Infrastructure Bonds (IFBs): TAX EXEMPT** — interest is exempt from income tax. Source: CBK / Income Tax Act.
- FXD (Fixed Coupon Treasury Bonds): coupon subject to **15% WHT** (10% for bonds >= 10yr issued — keep editable; default 15%).
- Note: 15% WHT is a tax credit for companies; final tax for resident individuals on qualifying interest.

## MMF Asset Allocation (composition) — from published factsheets
Buckets used in app: Government Securities, Banking Sector Instruments (fixed/call/demand deposits), Corporate Short-Term Debt, Cash & Equivalents, Collective Investment Schemes / Regional-Offshore.

### Cytonn MMF (source: CMMF KES Fact Sheet, as of 31 Aug 2025)
- Fixed & Demand Deposits: **65.2%**
- Collective Investment Schemes: **23.9%**
- Government Securities: **9.0%**
- Cash: **1.9%**
- Mgmt fee 2.0%; Min KES 1,000; Benchmark 91-day T-Bill + 1.0%
- (Note: "Cash, bank deposits and government securities = 76.1%")

### GenAfrica MMF (source: GenAfrica MMF Fact Sheet, as of Apr 2024 — flag as older as_of)
- Deposits in Financial Institutions: **55.32%**
- Government Securities: **44.68%**
- Mgmt fee 2.0%; Min KES 500,000

### Old Mutual MMF (source: oldmutual.co.ke product page + OMIG factsheet)
- Invests in: treasury bills, corporate notes, bank fixed deposits, bank call deposits. (Diversified; typical allocation ~ Govt Securities 30%, Bank Deposits 45%, Corporate 15%, Cash 10% — APPROXIMATE, mark as estimate pending exact factsheet)

### CIC MMF (source: CIC MMF Fact Sheet Mar 2025; AUM KES 81.8B)
- Invests in Fixed Deposits, Government Bonds, T-Bills, Cash & Net Settlements. Fixed Principal investments >60% govt + investment-grade corporate bonds.
- Typical: Govt Securities ~35%, Bank Deposits ~50%, Corporate ~8%, Cash ~7% (APPROXIMATE estimate)

### Jubilee MMF (source: jubileeinsurance.com)
- Short-term high-quality instruments in Kenyan & offshore markets: government securities and secure commercial paper. Daily returns, 48-hr withdrawals.

### Sanlam MMF (source: SanlamAllianz MMF Fact Sheet, Jan 2026)
- 2025 full-year return 13.4%; Dec 2025 monthly 1.0%. Largest MMF by AUM (~KES 92.74B+).
- Diversified govt securities + bank deposits + commercial paper. (Allocation approximate: Govt ~30%, Bank Deposits ~50%, Corporate ~12%, Cash ~8% — mark estimate)

### Nabo Africa MMF (source: Nabo Capital)
- Highest yield in market (per Serrari/biznake). Regional breadth (Africa). Govt securities, banking instruments, corporate short-term debt, regional/offshore exposure. Min KES 100,000. (Allocation approximate, mark estimate)

## Bank Sector Instruments (call/fixed deposits) — 2026
- **Equity Bank**: Call/Fixed Deposit. Min **KES 50,000**; min period **1 month**; **rate negotiable**; premature withdrawal allowed; loan up to 80-90% of savings. Source: equitygroupholdings.com (2026)
- **Co-operative Bank**: Fixed Deposit. Min **KES 50,000**; tenor **1–12 months**; competitive negotiable rate; early uplift forfeits interest; FDR in KES/USD/GBP/ZAR. Source: co-opbank.co.ke
- **Standard Chartered**: Call/Fixed Deposit. Call 1-month indicative ~1.00–1.15% (published card rate — negotiable higher for larger sums). Min ~KES 100,000. Source: sc.com/ke
- **KCB, Stanbic, NCBA, Absa**: offer call & fixed deposits, typically min KES 50,000–100,000, 1–12 month tenors, negotiable rates tied to CBR/interbank. Indicative fixed-deposit rates 2026 ~ 7–10% for negotiated wholesale amounts (deposit rate avg 6.88% per CBK). Mark as indicative/negotiable.

## MMF Risk-Management Education points
- Weighted Average Maturity (WAM) / duration limits — CMA caps to control interest-rate sensitivity (typically WAM <= ~12 months for MMFs; instruments <= 13 months / 397 days style rule).
- Credit-quality limits — investment-grade only; issuer concentration limits (e.g., max % per single issuer/bank).
- Liquidity buffers — minimum cash/near-cash to meet redemptions (48-hr withdrawal norm in Kenya).
- Duration used by manager to limit exposure to fluctuating rates: shorter duration = less price sensitivity when rates move.

## Day-count / crediting
- Most Kenyan MMFs accrue daily and credit monthly (compounding monthly); some quote daily yield. Day-count commonly 365 (actual/365). Make per-fund editable (365 or 360; daily vs monthly crediting).


## CONFIRMED via direct source extracts (Jun 2026)

### Withholding Tax — PwC Worldwide Tax Summaries, Kenya (last reviewed 23 Dec 2025)
- Interest — "Other": **15%** resident WHT (this covers MMF/bank deposit/commercial paper interest). FINAL TAX.
- Government bearer bonds (maturity >= 2 years): **15%**
- Bearer bonds (maturity >= 10 years): **10%**
- Bearer instruments interest: 25%; Qualifying interest "other": 15%; Housing bonds 10%
- Dividends < 12.5% voting power: **5%** resident; > 12.5%: Exempt
- Rent (immovable, resident via appointed agent): 7.5%
- => App defaults: MMF WHT 15%, T-bill/FXD coupon WHT 15% (editable; allow 10% for >=10yr bonds), IFB EXEMPT (Income Tax Act exemption for infrastructure bonds), dividends 5%, rent taxable at marginal/agent 7.5%.

### Bank Fixed/Call Deposits (confirmed)
- **Equity Bank**: Min KES 50,000; min 1 month; rate negotiable; premature withdrawal allowed. Source: equitygroupholdings.com
- **Co-operative Bank**: Min KES 50,000; tenor 1–12 months; negotiable; early uplift forfeits interest; KES/USD/GBP/ZAR. Source: co-opbank.co.ke
- **Stanbic Bank**: Min KES 20,000; competitive & negotiable rates; no max; interest calculated & paid at maturity; fixed rate for term. Source: stanbicbank.co.ke
- **Absa Bank**: Min KES 50,000; no account charges; competitive rates; interest frequency annually or end-of-term; KES/USD/GBP/EUR. Source: absabank.co.ke
- **Standard Chartered**: Call 1-month published card rate ~1.00–1.15% (negotiable up for larger sums); min ~KES 100,000. Source: sc.com/ke
- **KCB**: Term/Call deposit 1 month–1 year; negotiable; min ~KES 50,000 (KCB Fixed Savings via M-Pesa min KES 500 @ ~8.5% is a separate retail product). Source: ke.kcbgroup.com
- Indicative negotiated fixed-deposit rates for wholesale amounts 2026: ~7–10% p.a. (CBK avg deposit rate 6.88%, April 2026). Mark rates as INDICATIVE/NEGOTIABLE.

Note: Etica MMF exact factsheet allocation not located via direct extract — seed as provisional estimate with note "allocation estimated; verify against latest Etica factsheet" and as_of flagged. Same caveat for Nabo/Sanlam/Old Mutual/CIC precise % splits (only narrative confirmed). Cytonn and GenAfrica have exact % from factsheets.
