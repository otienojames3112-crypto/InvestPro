# Part 5 TODO — Role-aware layout & safety polish

- [x] Map Dashboard header, "Record a Deposit · Live" CTA + openDrawer, and the Test/Live mode source
- [x] Map the two earnings cards (Est. Annual Tax forward-12mo vs Est. Interest Earned accrued-to-date)
- [x] Map the MMF rate input field + engine fee handling (confirm no double fee deduction)
- [x] Build compact INVESTOR STRIP at top: balance · projected≈ + range · % above inflation · next action
- [x] Build MANAGER BAND: exceptions (cap breaches, stale rates, maturities <90d, behind-pace) + net/real yield + posture
- [x] Wrap existing deep analytics in a "Show details" progressive-disclosure toggle
- [x] Align the two earnings cards' time bases (Interest card adds forward-12mo net line) — line-item #8
- [x] Test/Live deposit safety — sandbox mode opens a deliberate Test→Live confirm dialog — line-item #14
- [x] Label MMF rate input "published EAR — net of fee" + help + guard; confirmed engine not deducting fee on top — strategic #H
- [x] Write/extend vitest (server/dashboardPart5.test.ts)
- [x] Full suite + tsc green (758 passing, tsc clean)
- [x] Visual verification (collapsed top + expanded analytics + MMF form)
- [ ] Checkpoint + deliver
