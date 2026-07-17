ALTER TABLE `merchants` ADD `licenseImageUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `merchants` ADD `registeredCapital` varchar(64);--> statement-breakpoint
ALTER TABLE `merchants` ADD `registeredAddress` varchar(512);--> statement-breakpoint
ALTER TABLE `merchants` ADD `businessScope` text;--> statement-breakpoint
ALTER TABLE `merchants` ADD `establishedDate` timestamp;--> statement-breakpoint
ALTER TABLE `merchants` ADD `legalPersonName` varchar(64);--> statement-breakpoint
ALTER TABLE `merchants` ADD `legalPersonIdNo` varchar(32);--> statement-breakpoint
ALTER TABLE `merchants` ADD `legalPersonPhone` varchar(20);