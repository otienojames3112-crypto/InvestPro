CREATE TABLE `deposit_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`bucket` enum('mmf','tbill','ifb','fxd') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`depositDate` date NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deposit_entries_id` PRIMARY KEY(`id`)
);
