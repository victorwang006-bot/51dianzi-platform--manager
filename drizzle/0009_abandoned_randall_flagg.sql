CREATE TABLE `password_reset_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminUserId` int NOT NULL,
	`channel` enum('sms','email') NOT NULL,
	`target` varchar(320) NOT NULL,
	`codeHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_codes_id` PRIMARY KEY(`id`)
);
