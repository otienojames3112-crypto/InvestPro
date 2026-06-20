CREATE TABLE `account_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`accountType` enum('mmf','dhowcsd') NOT NULL,
	`isOpened` boolean NOT NULL DEFAULT false,
	`accountNumber` varchar(100),
	`accountName` varchar(200),
	`dateOpened` date,
	`phoneNumber` varchar(20),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `account_status_id` PRIMARY KEY(`id`)
);
