CREATE TABLE `rate_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`effectiveDate` date NOT NULL,
	`mmfYield` decimal(8,4) NOT NULL,
	`tbill91Rate` decimal(8,4) NOT NULL,
	`tbill182Rate` decimal(8,4) NOT NULL,
	`tbill364Rate` decimal(8,4) NOT NULL,
	`ifbCouponRate` decimal(8,4) NOT NULL,
	`fxdCouponRate` decimal(8,4) NOT NULL,
	`withholdingTax` decimal(8,4) NOT NULL,
	`changeNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rate_history_id` PRIMARY KEY(`id`)
);
