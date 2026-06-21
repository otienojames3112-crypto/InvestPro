ALTER TABLE `rate_settings` MODIFY COLUMN `fxdCouponRate` decimal(8,4) NOT NULL DEFAULT '12.3500';--> statement-breakpoint
ALTER TABLE `rate_settings` ADD `cbkSourceUrl` text DEFAULT ('https://www.centralbank.go.ke/bills-bonds/treasury-bills/') NOT NULL;--> statement-breakpoint
ALTER TABLE `rate_settings` ADD `sanlamSourceUrl` text DEFAULT ('https://www.sanlamallianz.co.ke/products/savings-and-investments/money-market-fund/') NOT NULL;--> statement-breakpoint
ALTER TABLE `rate_settings` ADD `ratesLastUpdatedAt` timestamp;