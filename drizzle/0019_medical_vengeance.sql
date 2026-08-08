ALTER TABLE `messages` ADD `clientMessageId` varchar(64);--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_client_message_unique` UNIQUE(`clientMessageId`);--> statement-breakpoint
CREATE INDEX `messages_thread_created_idx` ON `messages` (`threadId`,`createdAt`);