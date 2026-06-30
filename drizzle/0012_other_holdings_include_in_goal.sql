-- Net-worth basis (pasted Part 3/4): tag whether an "other" asset is actively
-- assigned to THIS goal plan. Full Net Worth always counts every holding; the
-- Goal-Plan Assets basis counts core instruments + only the other assets the
-- user tags here. Default TRUE so existing rows keep counting as before.
ALTER TABLE `other_holdings` ADD COLUMN `includeInGoal` boolean NOT NULL DEFAULT true;
