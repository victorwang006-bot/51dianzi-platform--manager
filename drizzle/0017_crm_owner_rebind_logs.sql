CREATE TABLE `crm_owner_rebind_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` varchar(128) NOT NULL,
	`merchantId` int NOT NULL,
	`expectedOwnerPortalUserId` varchar(64) NOT NULL,
	`nextOwnerPortalUserId` varchar(64) NOT NULL,
	`reason` text NOT NULL,
	`operatorId` int,
	`operatorName` varchar(64),
	`operatorRole` varchar(32),
	`ipAddress` varchar(64),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `crm_owner_rebind_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_owner_rebind_logs_requestId_unique` UNIQUE(`requestId`)
);
--> statement-breakpoint
CREATE INDEX `crm_owner_rebind_logs_merchant_idx` ON `crm_owner_rebind_logs` (`merchantId`);
