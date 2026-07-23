ALTER TABLE `materials` ADD `datasheetFileKey` varchar(512);--> statement-breakpoint
ALTER TABLE `materials` ADD `datasheetFileName` varchar(256);--> statement-breakpoint
ALTER TABLE `materials` ADD `datasheetFileSize` int;--> statement-breakpoint
ALTER TABLE `materials` ADD `coverImageUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `materials` ADD `images` json;