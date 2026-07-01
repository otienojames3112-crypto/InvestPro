-- Round 82 — Research as an AI-assisted manager workbench.
-- Additive migration, hand-authored (project convention: drizzle journal is
-- intentionally behind; later migrations are hand-authored + applied directly
-- via webdev_execute_sql). This file is the durable record of what was applied.
-- NOTE: already applied to the live DB.

CREATE TABLE IF NOT EXISTS `research_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `portfolioId` int,
  `createdByOpenId` varchar(200) NOT NULL,
  `createdByName` varchar(200),
  `prompt` text NOT NULL,
  `scope` enum('mmf','bank','cbk','market_asset','macro','any') NOT NULL DEFAULT 'any',
  `status` enum('running','done','error') NOT NULL DEFAULT 'running',
  `answerSummary` text,
  `aiModel` varchar(64),
  `findingCount` int NOT NULL DEFAULT 0,
  `error` varchar(400),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `completedAt` bigint,
  CONSTRAINT `research_tasks_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `research_findings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `taskId` int NOT NULL,
  `instrumentName` varchar(200) NOT NULL,
  `issuer` varchar(200),
  `assetClass` varchar(32),
  `targetCatalogue` enum('mmf','bank','cbk','market_asset','macro'),
  `currency` varchar(8),
  `extractedFields` json,
  `sourceLabel` varchar(300),
  `sourceUrl` varchar(500),
  `sourceAsOf` bigint,
  `checkedAt` bigint,
  `confidence` enum('low','medium','high') NOT NULL DEFAULT 'low',
  `missingFields` json,
  `warnings` json,
  `rawExcerpt` text,
  `status` enum('new','drafted','dismissed') NOT NULL DEFAULT 'new',
  `draftedUpdateId` int,
  `reviewedBy` varchar(200),
  `reviewedAt` bigint,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `research_findings_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `catalogue_audit_log` (
  `id` int AUTO_INCREMENT NOT NULL,
  `catalogue` enum('mmf','bank','cbk','market_asset') NOT NULL,
  `targetRef` varchar(200),
  `instrumentName` varchar(200),
  `changeKind` enum('create','edit') NOT NULL,
  `field` varchar(48),
  `oldValue` varchar(300),
  `newValue` varchar(300),
  `source` varchar(300),
  `sourceUrl` varchar(500),
  `researchUpdateId` int,
  `researchTaskId` int,
  `approvedBy` varchar(200) NOT NULL,
  `approvedAt` bigint NOT NULL,
  `note` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `catalogue_audit_log_id` PRIMARY KEY(`id`)
);

-- research_updates: link to findings, single-field edits, before-value, manager override, + conflict status
ALTER TABLE `research_updates` ADD COLUMN `finding_id` int;
ALTER TABLE `research_updates` ADD COLUMN `field` varchar(48);
ALTER TABLE `research_updates` ADD COLUMN `old_value` text;
ALTER TABLE `research_updates` ADD COLUMN `manager_value` text;
ALTER TABLE `research_updates` MODIFY COLUMN `status` enum('pending','approved','rejected','superseded','conflict') NOT NULL DEFAULT 'pending';

-- source_registry: agent category + agent clock + agent-maintained freshness
ALTER TABLE `source_registry` ADD COLUMN `category` enum('mmf','bank','cbk','market_asset','macro','mixed') NOT NULL DEFAULT 'mixed';
ALTER TABLE `source_registry` ADD COLUMN `last_checked_at` bigint;
ALTER TABLE `source_registry` ADD COLUMN `last_successful_check_at` bigint;
ALTER TABLE `source_registry` ADD COLUMN `status` enum('ok','stale','error') NOT NULL DEFAULT 'ok';
