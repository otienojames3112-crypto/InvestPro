-- Expansion Part 7.1 — per-figure data source model & verification state.
-- Additive, non-destructive. Adds a JSON per-figure provenance map and a
-- row-level summary verification state to opportunities.

ALTER TABLE `opportunities`
  ADD COLUMN `fieldProvenance` JSON NULL;

ALTER TABLE `opportunities`
  ADD COLUMN `verificationState` VARCHAR(24) NOT NULL DEFAULT 'scraped_unverified';
