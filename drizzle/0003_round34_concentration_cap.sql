-- Round 34: editable per-issuer concentration cap (%). Default 25.00.
ALTER TABLE `portfolios` ADD COLUMN `concentrationCapPct` decimal(5,2) NOT NULL DEFAULT '25.00';
