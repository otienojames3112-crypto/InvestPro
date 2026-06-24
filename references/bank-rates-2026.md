# Kenyan Bank Deposit/Savings Rate Research — verified June 2026

Used to calibrate the Bank Instruments reference table (R28.6). All rows in the app
are flagged **indicative & negotiable** with a per-row source + as-of date.

## Macro anchors (official)
- **CBK Central Bank Rate (CBR): 8.75%** — held at the June 9, 2026 MPC meeting (2nd straight hold). Source: tradingeconomics.com/kenya/interest-rate; CBK MPC.
- **CBK publishes** monthly weighted-average commercial-bank **Deposit Rate** and **Savings Rate** at centralbank.go.ke/statistics/interest-rates (the authoritative aggregate).
- CBK March 2026 ranking (via tradingroom.co.ke, citing CBK):
  - Average commercial-bank deposit rate has fallen ~2pp y/y.
  - Top savers: **ABC Bank 11.23%**, **Middle East Bank 9.35%**, **Kingdom Bank 8.99%** (deposit rate).
  - Cheapest lenders: Citibank 10.80%, Stanbic 11.75%, Standard Chartered 11.87% (lending).

## Bank product pages (official, board/counter rates)
- **Standard Chartered — Fixed Deposit (LCY counter rates), as of page June 2026** (sc.com/ke/deposits/fixed):
  - 100K–1,999,999: Call 1.00% | 1mo 1.15% | 3mo 1.25% | 6mo 1.35% | 9mo 1.50% | 12mo 2.00%
  - Rates rise with balance band; 100M+ tops at 12mo 5.00%.
  - Tenures 3/6/9/12 mo; interest at maturity; early withdrawal forfeits interest.
- **Standard Chartered — Safari Savings (effective rates)** (sc.com/ke/saving-accounts/safari):
  - 0–1,999,999.99: **0.50% p.a.**; 2M–5M: 0.75%; rises to 4.25% at 50M+.
  - Interest calculated daily, paid quarterly; 1 free withdrawal/month.
- **Co-operative Bank — Fixed Deposit** (co-opbank.co.ke/investing/fixed-deposit-account):
  - 1–12 months; **min KES 50,000**; "competitive rate" (negotiated, not published); early uplift forfeits interest unless sanctioned; FDR in KES/USD/GBP/ZAR.
- **Equity Bank — Call/Fixed Deposit** (equitygroupholdings.com .../callfixed-deposit-account):
  - **Min KES 50,000**; min period 1 month; **rate is negotiated**; premature withdrawal allowed; borrow up to 80–90% of deposit as collateral.

## Modeling decision
- Where a bank **publishes** board rates (Standard Chartered), use those exact figures with the SC source URL + as-of 2026-06.
- Where banks **negotiate** (Equity, Co-op, KCB, NCBA, I&M, DTB, Family, Stanbic, Absa), keep indicative ranges anchored to the CBK average deposit-rate band and tier-one norms (FD 8–12% for sizeable 12-mo balances; ordinary savings 4–7%; call 4.5–5%), flagged Negotiable with source = bank domain + CBK aggregate, as-of 2026-06.
- Add a visible note on the page: "Board/counter rates shown where published (e.g. Standard Chartered); elsewhere indicative — tier-one banks routinely negotiate fixed deposits well above board rates. Confirm with your relationship manager. Authoritative aggregate: CBK weighted-average deposit rate."
