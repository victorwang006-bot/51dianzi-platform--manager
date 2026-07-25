ALTER TABLE `merchants` ADD `agreementFileUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `merchants` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `merchants` ADD `source` varchar(32) DEFAULT 'admin';