# Current Kenyan Rates — 2026 (Round 17 research)

All figures manually editable in-app thereafter. Record `source` + `asOfDate` on every seeded row.

## CBK / Government securities (source: Central Bank of Kenya, centralbank.go.ke; CBK Weekly Bulletin 19 Jun 2026)
| Metric | Value | As of |
|---|---|---|
| Central Bank Rate (CBR) | 8.75% | 10/02/2026 |
| 91-day T-bill | 8.821% | 22/06/2026 |
| 182-day T-bill | 8.778% | 22/06/2026 |
| 364-day T-bill | 8.975% | 22/06/2026 |
| Inflation (May 2026) | 6.68% | May 2026 |
| Commercial lending rate | 14.69% | Apr 2026 |
| Deposit rate (avg) | 6.88% | Apr 2026 |
| Savings rate (avg) | 3.31% | Apr 2026 |

## Bonds (source: NSE Daily Bond Price List, Jun 2026)
- IFB (infrastructure bonds): coupon ~12.5% — **tax-exempt**.
- FXD (fixed-rate treasury bonds): liquid issues carry coupons ~12.0%–12.87% (e.g. 12.30, 12.44, 12.65, 12.756, 12.87).
  - **Standardize app default on FXD gross coupon 12.35%**, engine applies 15% WHT. Resolves the old "10.5%" ambiguity.

## MMF Effective Annual Rates (KES) — sources: Zurit Consulting 18 Jun 2026; Money254 "Top 15 MMFs May 2026"; Cytonn Report
| Fund | EAR / net return | As of |
|---|---|---|
| Nabo Africa MMF | 13.20% (gross EAR) / ~10.47% after tax | 18 Jun 2026 |
| Cytonn MMF | 12.00–12.76% gross / ~10.85% after tax | 18 Jun 2026 |
| Etica MMF | 10.79% | 18 Jun 2026 |
| Market top-15 net returns | ~8.9%–9.7% | May 2026 |

Note: "EAR" quoted by aggregators is typically the gross effective annual yield before the 15% WHT; the app treats fund EAR as gross and applies WHT in-engine (consistent with primary-MMF treatment).

## Commercial bank call / fixed deposit rates (2026, indicative; negotiable)
Average deposit rate 6.88% (CBK Apr 2026). Tiered/negotiated fixed deposits at large banks (Equity, KCB, Co-op, Stanbic, NCBA, Absa) commonly range ~7%–10% p.a. depending on amount/tenor; call deposits lower (~5%–7%). 15% WHT applies to bank interest. These are manually editable per holding with as-of dates (no scraping).
