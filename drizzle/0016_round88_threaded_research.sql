-- Round 88 — Ask AI upgraded to a threaded manager research assistant.
-- Additive migration, hand-authored (project convention: drizzle journal is
-- intentionally behind; later migrations are hand-authored + applied directly
-- via webdev_execute_sql). This file is the durable record of what was applied.

-- Enquiry conversations: group an opening question + follow-ups.
CREATE TABLE IF NOT EXISTS `research_threads` (
  `id` int AUTO_INCREMENT NOT NULL,
  `portfolioId` int,
  `createdByOpenId` varchar(200) NOT NULL,
  `createdByName` varchar(200),
  `title` varchar(300) NOT NULL,
  `scope` enum('mmf','bank','cbk','market_asset','macro','any') NOT NULL DEFAULT 'any',
  `archived` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `research_threads_id` PRIMARY KEY(`id`)
);

-- Ordered transcript turns of a thread (user question / assistant answer).
CREATE TABLE IF NOT EXISTS `research_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `thread_id` int NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `source_kind` enum('url','text','pdf','image'),
  `source_ref` varchar(700),
  `source_label` varchar(300),
  `task_id` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `research_messages_id` PRIMARY KEY(`id`)
);

CREATE INDEX `research_messages_thread_idx` ON `research_messages` (`thread_id`, `id`);

-- research_tasks: link a task to its thread (null = legacy one-shot).
ALTER TABLE `research_tasks` ADD COLUMN `thread_id` int;

-- research_findings: thread linkage + versioning (supersedes chain + correction audit).
ALTER TABLE `research_findings` ADD COLUMN `thread_id` int;
ALTER TABLE `research_findings` ADD COLUMN `superseded_by_id` int;
ALTER TABLE `research_findings` ADD COLUMN `supersedes_id` int;
ALTER TABLE `research_findings` ADD COLUMN `corrected_by` varchar(200);
ALTER TABLE `research_findings` ADD COLUMN `corrected_at` bigint;
ALTER TABLE `research_findings` ADD COLUMN `correction_reason` text;
ALTER TABLE `research_findings` MODIFY COLUMN `status` enum('new','drafted','dismissed','superseded') NOT NULL DEFAULT 'new';
