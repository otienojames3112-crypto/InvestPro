CREATE TABLE `contribution_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`monthNumber` int NOT NULL,
	`overrideAmount` decimal(10,2) NOT NULL,
	`lumpSum` decimal(10,2) NOT NULL DEFAULT '0.00',
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contribution_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`monthNumber` int NOT NULL,
	`entryDate` date NOT NULL,
	`contribution` decimal(10,2) NOT NULL DEFAULT '0.00',
	`cbkCashIn` decimal(10,2) NOT NULL DEFAULT '0.00',
	`mmfToDhow` decimal(10,2) NOT NULL DEFAULT '0.00',
	`mainAction` text,
	`mmfEndBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`tbillEndBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`ifbEndBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`fxdEndBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`totalEndBalance` decimal(14,2) NOT NULL DEFAULT '0.00',
	`isActual` boolean NOT NULL DEFAULT false,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ledger_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mmfYield` decimal(8,4) NOT NULL DEFAULT '8.7800',
	`tbill91Rate` decimal(8,4) NOT NULL DEFAULT '8.8206',
	`tbill182Rate` decimal(8,4) NOT NULL DEFAULT '8.7782',
	`tbill364Rate` decimal(8,4) NOT NULL DEFAULT '8.9746',
	`ifbCouponRate` decimal(8,4) NOT NULL DEFAULT '12.5000',
	`fxdCouponRate` decimal(8,4) NOT NULL DEFAULT '10.5000',
	`withholdingTax` decimal(8,4) NOT NULL DEFAULT '15.0000',
	`startDate` date NOT NULL DEFAULT '2026-07-01',
	`targetAmount` decimal(14,2) NOT NULL DEFAULT '5000000.00',
	`startingContribution` decimal(10,2) NOT NULL DEFAULT '2500.00',
	`stepUpAmount` decimal(10,2) NOT NULL DEFAULT '3000.00',
	`stepUpMonths` int NOT NULL DEFAULT 6,
	`safetyFloor` decimal(10,2) NOT NULL DEFAULT '50000.00',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rate_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `securities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`securityType` enum('tbill_91','tbill_182','tbill_364','ifb','fxd') NOT NULL,
	`faceValue` decimal(14,2) NOT NULL,
	`issueDate` date NOT NULL,
	`maturityDate` date NOT NULL,
	`couponRate` decimal(8,4) NOT NULL DEFAULT '0.0000',
	`isTaxExempt` boolean NOT NULL DEFAULT false,
	`isMatured` boolean NOT NULL DEFAULT false,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `securities_id` PRIMARY KEY(`id`)
);
