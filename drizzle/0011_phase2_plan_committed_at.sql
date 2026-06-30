-- Phase 2 (commit contract): record when the user last committed the plan
-- (allocation tier + policy + contribution schedule) so the ledger/projection
-- execute it. Additive + nullable; null = never committed (draft/suggestion).
-- Applied via webdev_execute_sql on 2026-06-30 (matches schema.ts).
ALTER TABLE `portfolios` ADD COLUMN `planCommittedAt` bigint;
