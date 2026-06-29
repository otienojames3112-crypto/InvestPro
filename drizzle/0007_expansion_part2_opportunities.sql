-- Expansion Brief Part 2 — Opportunity Catalog reference table.
-- Reference data (global, not user/portfolio scoped). NO ranking/score/recommended
-- column by design: the tool stores neutral sourced facts; the user does all narrowing.
CREATE TABLE IF NOT EXISTS `opportunities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `ref` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(200) NOT NULL,
  `assetClass` VARCHAR(32) NOT NULL,
  `issuer` VARCHAR(200),
  `currency` VARCHAR(8) NOT NULL DEFAULT 'KES',
  `market` VARCHAR(64),
  `yieldPct` DECIMAL(7,4),
  `yieldKind` VARCHAR(48),
  `lastPrice` DECIMAL(16,4),
  `trailingReturnPct` DECIMAL(8,4),
  `tenorYears` DECIMAL(6,2),
  `maturityDate` DATE,
  `expenseRatioPct` DECIMAL(6,4),
  `liquidity` VARCHAR(32),
  `factNote` TEXT,
  `dataSource` VARCHAR(200),
  `dataAsOf` TIMESTAMP NULL,
  `unverified` BOOLEAN NOT NULL DEFAULT TRUE,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
