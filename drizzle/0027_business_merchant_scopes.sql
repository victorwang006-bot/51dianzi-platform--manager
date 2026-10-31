CREATE TABLE `admin_business_merchant_scopes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `adminUserId` int NOT NULL,
  `merchantId` int NOT NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'revoked',
  `scopeVersion` int unsigned NOT NULL DEFAULT 1,
  `modulePermissions` json NOT NULL,
  `createdByAdminUserId` int NOT NULL,
  `updatedByAdminUserId` int NOT NULL,
  `revokedByAdminUserId` int,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `admin_business_merchant_scopes_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_business_merchant_scopes_admin_merchant_unique` UNIQUE(`adminUserId`,`merchantId`),
  CONSTRAINT `admin_business_merchant_scopes_active_modules_check`
    CHECK ((`status` = 'active' AND JSON_LENGTH(`modulePermissions`) > 0) OR (`status` = 'revoked'))
);
--> statement-breakpoint
CREATE INDEX `admin_business_merchant_scopes_admin_status_idx`
  ON `admin_business_merchant_scopes` (`adminUserId`,`status`,`updatedAt`);
--> statement-breakpoint
CREATE INDEX `admin_business_merchant_scopes_merchant_status_idx`
  ON `admin_business_merchant_scopes` (`merchantId`,`status`);
--> statement-breakpoint
CREATE TABLE `admin_business_merchant_scope_audits` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `scopeId` int NOT NULL,
  `adminUserId` int NOT NULL,
  `merchantId` int NOT NULL,
  `action` enum('granted','updated','revoked','unchanged') NOT NULL,
  `expectedVersion` int unsigned NOT NULL,
  `resultingVersion` int unsigned NOT NULL,
  `beforeModulePermissions` json,
  `afterModulePermissions` json,
  `requestId` varchar(64) NOT NULL,
  `operatorAdminUserId` int NOT NULL,
  `operatorName` varchar(128) NOT NULL,
  `operatorRole` varchar(64) NOT NULL,
  `ipAddress` varchar(64),
  `userAgent` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `admin_business_merchant_scope_audits_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_business_merchant_scope_audits_request_unique` UNIQUE(`requestId`)
);
--> statement-breakpoint
CREATE INDEX `admin_business_merchant_scope_audits_admin_created_idx`
  ON `admin_business_merchant_scope_audits` (`adminUserId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `admin_business_merchant_scope_audits_merchant_created_idx`
  ON `admin_business_merchant_scope_audits` (`merchantId`,`createdAt`);
