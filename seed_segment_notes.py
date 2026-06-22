#!/usr/bin/env python3
"""Generate UPDATE statements that fill per-segment detail notes + real-estate / other
percentages for all 27 MMF composition rows. Output a single .sql file to review then apply.

Design rules (educational, not advice):
- Pure CMA-regulated MMFs are legally restricted to short-term, high-quality, liquid
  instruments. They CANNOT hold direct real estate. So realEstate = 0 for all, with a
  note explaining why (and pointing to the fund manager's separate property/CIS products
  where relevant, e.g. Cytonn, Old Mutual, Britam, ICEA).
- Bank deposit note carries an indicative deposit-rate band (call ~6-9%, fixed ~9-12%).
- Corporate debt note describes commercial paper / corporate notes + indicative spread.
- Offshore/regional note only meaningful where offshore% > 0.
"""
import json

rows = json.load(open('/home/ubuntu/kes5m-tracker/comp_dump.json'))

def esc(s: str) -> str:
    return s.replace("'", "''")

# Manager-specific real-estate / sister-product context (educational pointer only).
property_managers = {
    'Cytonn': "Cytonn's MMF holds 0% direct property — CMA rules forbid it. Cytonn Investments separately runs real-estate and high-yield products outside this fund; do not confuse the two.",
    'Old Mutual': "0% direct property in the MMF. Old Mutual offers separate property and balanced funds; the MMF stays in cash-like instruments only.",
    'Britam': "0% direct property in the MMF. Britam Asset Managers runs separate property and balanced funds; this MMF is liquid instruments only.",
    'ICEA': "0% direct property in the MMF. ICEA Lion has separate property/equity funds; the MMF holds only short-term debt and deposits.",
    'CIC': "0% direct property in the MMF. CIC Asset Management runs a separate property fund; this MMF is cash-like only.",
    'Sanlam': "0% direct property — a money market fund cannot legally hold real estate. SanlamAllianz runs separate balanced/property-linked products.",
}

def real_estate_note(company):
    return property_managers.get(company,
        "0% direct real estate. A CMA-regulated money market fund cannot legally hold property — it is restricted to short-term, high-quality, liquid instruments. Use the Other Assets page to track any property you own directly.")

lines = []
for r in rows:
    fid = r['id']
    company = r['company']
    gov, bank, corp, cash, off = r['gov'], r['bank'], r['corp'], r['cash'], r['offshore']

    # Bank deposit note + indicative rate band
    if bank >= 55:
        bank_note = (f"~{bank:.0f}% in bank deposits — the fund's main engine. A mix of negotiated "
                     f"fixed deposits (indicative ~9–12% p.a.) and call deposits (~6–9% p.a.) with tier-1 "
                     f"and tier-2 Kenyan banks. Large balances let the fund negotiate above retail rates.")
    elif bank > 0:
        bank_note = (f"~{bank:.0f}% in bank deposits — negotiated fixed deposits (~9–12% p.a.) and call "
                     f"deposits (~6–9% p.a.) with Kenyan banks, used for yield and liquidity.")
    else:
        bank_note = "Negligible bank-deposit allocation in the latest snapshot."

    # Corporate debt note
    if corp >= 15:
        corp_note = (f"~{corp:.0f}% in corporate short-term debt — commercial paper and corporate notes "
                     f"from listed/large Kenyan issuers, typically priced at a 1–3% spread over T-bills "
                     f"(indicative ~11–14% p.a.). Higher reward, higher credit risk than government paper.")
    elif corp > 0:
        corp_note = (f"~{corp:.0f}% in corporate short-term debt — selective commercial paper / corporate "
                     f"notes at a modest spread over T-bills (indicative ~11–13% p.a.).")
    else:
        corp_note = "No corporate debt in the latest snapshot — the fund stays in government paper and bank deposits."

    # Cash note
    if cash > 0:
        cash_note = (f"~{cash:.0f}% in cash & near-cash for daily redemptions — current/settlement accounts "
                     f"and overnight placements (indicative ~3–6% p.a.). This is the liquidity buffer that "
                     f"lets you withdraw quickly.")
    else:
        cash_note = "Minimal standalone cash; liquidity is met through maturing deposits and T-bills."

    # Offshore note
    if off > 0:
        off_note = (f"~{off:.0f}% in regional / offshore or collective investment schemes — diversification "
                    f"beyond Kenya (East-Africa paper or units in other CIS). Adds breadth but introduces "
                    f"currency and cross-border considerations.")
    else:
        off_note = "No offshore / regional exposure — a purely domestic Kenyan-shilling portfolio."

    re_note = real_estate_note(company)
    other_note = "No other asset classes beyond those listed."

    sql = (
        f"UPDATE mmf_composition SET "
        f"realEstate=0.00, otherAssets=0.00, "
        f"bankNote='{esc(bank_note)}', "
        f"corporateNote='{esc(corp_note)}', "
        f"cashNote='{esc(cash_note)}', "
        f"offshoreNote='{esc(off_note)}', "
        f"realEstateNote='{esc(re_note)}', "
        f"otherNote='{esc(other_note)}' "
        f"WHERE id={fid};"
    )
    lines.append(sql)

open('/home/ubuntu/kes5m-tracker/segment_notes.sql', 'w').write("\n".join(lines) + "\n")
print(f"Generated {len(lines)} UPDATE statements -> segment_notes.sql")
print("\n--- sample (Nabo, fund 6) ---")
print([l for l in lines if l.endswith('id=6;')][0][:600])
