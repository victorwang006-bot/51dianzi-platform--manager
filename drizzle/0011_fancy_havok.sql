CREATE TABLE `message_threads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadNo` varchar(32) NOT NULL,
	`subject` varchar(256),
	`contactName` varchar(128),
	`contactPhone` varchar(32),
	`contactEmail` varchar(320),
	`portalUserId` varchar(64),
	`merchantId` int,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`adminUnreadCount` int NOT NULL DEFAULT 0,
	`portalUnreadCount` int NOT NULL DEFAULT 0,
	`lastMessagePreview` varchar(256),
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_threads_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_threads_threadNo_unique` UNIQUE(`threadNo`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` int NOT NULL,
	`senderType` enum('portal','admin') NOT NULL,
	`senderAdminId` int,
	`senderName` varchar(128),
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
