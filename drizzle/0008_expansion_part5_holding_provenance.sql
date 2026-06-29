-- Expansion Brief Part 5: structured mark-to-model + provenance on other_holdings.
-- Applied to the live DB via webdev_execute_sql; recorded here for history.
-- All columns are NULLABLE & ADDITIVE so existing rows are unaffected. Price-driven
-- holdings can now be RE-DERIVED as units x unitPrice x fxRateToKes (never trusted
-- from a stale currentValue), the precise behavior class is preserved, offshore can
-- be shown in both currencies, and every figure carries source + as-of provenance.

ALTER TABLE `other_holdings`
  ADD COLUMN `behaviorClass` varchar(24),
  ADD COLUMN `units` decimal(18,6),
  ADD COLUMN `unitPrice` decimal(18,6),
  ADD COLUMN `currency` varchar(8),
  ADD COLUMN `fxRateToKes` decimal(18,6),
  ADD COLUMN `incomeRatePct` decimal(8,4),
  ADD COLUMN `dataSource` varchar(200),
  ADD COLUMN `dataAsOf` timestamp NULL;
