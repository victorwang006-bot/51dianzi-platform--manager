CREATE TABLE `admin_business_staff_bindings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `adminUserId` int NOT NULL,
  `frontUserId` int,
  `status` enum('active','revoked') NOT NULL DEFAULT 'revoked',
  `bindingVersion` int unsigned NOT NULL DEFAULT 1,
  `createdByAdminUserId` int NOT NULL,
  `updatedByAdminUserId` int NOT NULL,
  `revokedByAdminUserId` int,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `admin_business_staff_bindings_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_business_staff_bindings_admin_user_unique` UNIQUE(`adminUserId`),
  CONSTRAINT `admin_business_staff_bindings_front_user_unique` UNIQUE(`frontUserId`),
  CONSTRAINT `admin_business_staff_bindings_active_front_user_check`
    CHECK ((`status` = 'active' AND `frontUserId` IS NOT NULL) OR (`status` = 'revoked' AND `frontUserId` IS NULL))
);
--> statement-breakpoint
CREATE INDEX `admin_business_staff_bindings_status_updated_idx`
  ON `admin_business_staff_bindings` (`status`,`updatedAt`);
--> statement-breakpoint
CREATE TABLE `admin_business_staff_binding_audits` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `bindingId` int NOT NULL,
  `adminUserId` int NOT NULL,
  `frontUserId` int,
  `action` enum('bound','rebound','revoked','unchanged') NOT NULL,
  `expectedVersion` int unsigned NOT NULL,
  `resultingVersion` int unsigned NOT NULL,
  `requestId` varchar(64) NOT NULL,
  `operatorAdminUserId` int NOT NULL,
  `operatorName` varchar(128) NOT NULL,
  `operatorRole` varchar(64) NOT NULL,
  `ipAddress` varchar(64),
  `userAgent` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `admin_business_staff_binding_audits_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_business_staff_binding_audits_request_unique` UNIQUE(`requestId`)
);
--> statement-breakpoint
CREATE INDEX `admin_business_staff_binding_audits_admin_created_idx`
  ON `admin_business_staff_binding_audits` (`adminUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `admin_business_staff_binding_audits_front_created_idx`
  ON `admin_business_staff_binding_audits` (`frontUserId`,`createdAt`);
