-- Round 81 — Research pipeline governance layer.
-- Two ADDITIVE global tables (not user/portfolio scoped). Non-destructive:
--   * research_updates — the pending-change queue between intake and the live
--     reference catalogues (mmf_funds / bank_instruments / opportunities).
--   * source_registry  — maintainer-curated data sources + review cadence for the
--     daily Research Desk digest.
-- Neither table has a score/rank/priority column by design.

CREATE TABLE IF NOT EXISTS `research_updates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `target` ENUM('mmf','bank','opportunity') NOT NULL,
  `targetRef` VARCHAR(64),
  `changeKind` ENUM('create','edit') NOT NULL DEFAULT 'create',
  `name` VARCHAR(200) NOT NULL,
  `assetClass` VARCHAR(32) NOT NULL,
  `issuer` VARCHAR(200),
  `currency` VARCHAR(8) NOT NULL DEFAULT 'KES',
  `figures` JSON,
  `source` VARCHAR(300) NOT NULL,
  `sourceUrl` VARCHAR(500),
  `asOf` BIGINT,
  `origin` ENUM('ai','manual','scrape') NOT NULL DEFAULT 'manual',
  `aiModel` VARCHAR(64),
  `sourceKey` VARCHAR(64),
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewNote` TEXT,
  `reviewedBy` VARCHAR(200),
  `reviewedAt` BIGINT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `source_registry` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(64) NOT NULL UNIQUE,
  `label` VARCHAR(200) NOT NULL,
  `feeds` ENUM('mmf','bank','opportunity','mixed') NOT NULL DEFAULT 'mixed',
  `url` VARCHAR(500),
  `cadenceDays` INT NOT NULL DEFAULT 30,
  `lastReviewedAt` BIGINT,
  `lastReviewedBy` VARCHAR(200),
  `notes` TEXT,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
