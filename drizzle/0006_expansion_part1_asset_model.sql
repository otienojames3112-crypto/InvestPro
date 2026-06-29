-- Expansion Brief Part 1: generic asset abstraction (additive & nullable).
-- Applied to the live DB via webdev_execute_sql; recorded here for history.
-- All columns are NULLABLE so existing rows are unaffected; assetClass is then
-- backfilled from the existing securityType so behavior is identical to before.

ALTER TABLE `securities`
  ADD COLUMN `assetClass` enum('cash_mmf','bank_deposit','gov_discount','gov_coupon','equity','reit','offshore_fund','alt'),
  ADD COLUMN `unitPrice` decimal(18,6),
  ADD COLUMN `units` decimal(18,6),
  ADD COLUMN `dividendYieldPct` decimal(8,4),
  ADD COLUMN `distributionYieldPct` decimal(8,4),
  ADD COLUMN `currency` varchar(8),
  ADD COLUMN `fxRateToKes` decimal(18,6),
  ADD COLUMN `dataSource` varchar(200),
  ADD COLUMN `dataAsOf` timestamp NULL,
  ADD COLUMN `expectedReturnPct` decimal(8,4),
  ADD COLUMN `volatilityPct` decimal(8,4);
--> statement-breakpoint
-- Backfill: T-bill / zero-coupon -> gov_discount; FXD / IFB / floating -> gov_coupon.
UPDATE `securities`
  SET `assetClass` = CASE
    WHEN `securityType` IN ('tbill_91','tbill_182','tbill_364','zero_coupon') THEN 'gov_discount'
    ELSE 'gov_coupon'
  END
  WHERE `assetClass` IS NULL;
