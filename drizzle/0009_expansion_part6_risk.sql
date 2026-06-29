-- Expansion Brief Part 6 — risk assumptions & risk tolerance.
-- All additive & nullable: existing rows are unaffected, no data loss.

ALTER TABLE `other_holdings`
  ADD COLUMN `expectedReturnPct` decimal(8,4) NULL,
  ADD COLUMN `volatilityPct` decimal(8,4) NULL,
  ADD COLUMN `correlationGroup` varchar(24) NULL,
  ADD COLUMN `riskSource` varchar(200) NULL,
  ADD COLUMN `riskAsOf` timestamp NULL;

ALTER TABLE `portfolios`
  ADD COLUMN `riskTolerance` varchar(24) NULL;
