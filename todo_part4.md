# Part 4 TODO — Reframe the risk section

- [x] Map current "Risk limits" panel markup + breach/banner logic in Dashboard.tsx
- [x] Identify self-correcting / acknowledged breach state and where red is applied
- [x] Build PRIMARY risk panel: rate/reinvestment, contribution shortfall, liquidity-timing
- [x] Reuse decisionSurface data (range/shock, backloading, liquidity cushion) for the three primary risks
- [x] Demote concentration (issuer/type) to a SECONDARY note, scoped as duration/liquidity proxy (not credit)
- [x] Amber (not red) styling for self-correcting or acknowledged breaches; red reserved for action-needed
- [x] Shared severity helper so color matches the message everywhere
- [x] Write/extend vitest for the severity + risk-classification helpers (18 new tests)
- [x] Full suite (751) + tsc green
- [x] Visual verification
- [x] Checkpoint + deliver
