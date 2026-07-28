ALTER TABLE `merchants` ADD `crmStatus` enum('none','pending','enabled','disabled') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `merchants` ADD `crmAppliedAt` timestamp;--> statement-breakpoint
ALTER TABLE `merchants` ADD `crmEnabledAt` timestamp;--> statement-breakpoint
ALTER TABLE `merchants` ADD `crmNote` text;--> statement-breakpoint
ALTER TABLE `message_threads` ADD `threadType` enum('general','inquiry','service','crm_apply') DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `message_threads` ADD `companyProfile` json;