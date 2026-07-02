-- Round 83 — date-effective rate history + reference-row lifecycle metadata.
-- Additive migration, hand-authored (project convention: drizzle journal is
-- intentionally behind; later migrations are hand-authored + applied directly
-- via webdev_execute_sql). This file is the durable record of what was applied.

CREATE TABLE IF NOT EXISTS `mmf_rate_history` (
  `id` int AUTO_INCREMENT NOT NULL,
  `mmfFundId` int NOT NULL,
  `fundName` varchar(200) NOT NULL,
  `grossYield` decimal(8,4),
  `ear` decimal(8,4),
  `managementFee` decimal(6,4),
  `effectiveAt` bigint NOT NULL,
  `source` varchar(300),
  `sourceUrl` varchar(500),
  `researchUpdateId` int,
  `approvedBy` varchar(200),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `mmf_rate_history_id` PRIMARY KEY(`id`)
);

CREATE INDEX `mmf_rate_history_fund_idx` ON `mmf_rate_history` (`mmfFundId`, `effectiveAt`);

CREATE TABLE IF NOT EXISTS `cbk_rate_history` (
  `id` int AUTO_INCREMENT NOT NULL,
  `opportunityRef` varchar(64) NOT NULL,
  `instrumentName` varchar(200),
  `securityType` varchar(48),
  `yieldPct` decimal(7,4),
  `yieldKind` varchar(48),
  `effectiveAt` bigint NOT NULL,
  `source` varchar(300),
  `sourceUrl` varchar(500),
  `researchUpdateId` int,
  `approvedBy` varchar(200),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `cbk_rate_history_id` PRIMARY KEY(`id`)
);

CREATE INDEX `cbk_rate_history_ref_idx` ON `cbk_rate_history` (`opportunityRef`, `effectiveAt`);

CREATE TABLE IF NOT EXISTS `bank_product_rate_history` (
  `id` int AUTO_INCREMENT NOT NULL,
  `bankInstrumentId` int NOT NULL,
  `bankName` varchar(200) NOT NULL,
  `instrumentType` varchar(48),
  `indicativeRate` decimal(6,2),
  `effectiveAt` bigint NOT NULL,
  `source` varchar(300),
  `sourceUrl` varchar(500),
  `researchUpdateId` int,
  `approvedBy` varchar(200),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `bank_product_rate_history_id` PRIMARY KEY(`id`)
);

CREATE INDEX `bank_product_rate_history_inst_idx` ON `bank_product_rate_history` (`bankInstrumentId`, `effectiveAt`);

CREATE TABLE IF NOT EXISTS `reference_row_meta` (
  `id` int AUTO_INCREMENT NOT NULL,
  `catalogue` enum('mmf','bank','cbk','market_asset') NOT NULL,
  `targetRef` varchar(200) NOT NULL,
  `stale` boolean NOT NULL DEFAULT false,
  `staleReason` varchar(300),
  `staleMarkedBy` varchar(200),
  `staleMarkedAt` bigint,
  `archivedReason` varchar(300),
  `archivedBy` varchar(200),
  `archivedAt` bigint,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `reference_row_meta_id` PRIMARY KEY(`id`)
);

CREATE UNIQUE INDEX `reference_row_meta_uq` ON `reference_row_meta` (`catalogue`, `targetRef`);
