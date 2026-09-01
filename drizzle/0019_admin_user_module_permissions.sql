CREATE TABLE `admin_user_permissions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `adminUserId` int NOT NULL,
  `permission` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `admin_user_permissions_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_user_permissions_admin_permission_unique` UNIQUE(`adminUserId`,`permission`),
  INDEX `admin_user_permissions_admin_user_idx` (`adminUserId`)
);

CREATE TABLE `admin_user_permission_audits` (
  `id` int AUTO_INCREMENT NOT NULL,
  `adminUserId` int NOT NULL,
  `operatorAdminUserId` int,
  `operatorName` varchar(128),
  `beforePermissions` json,
  `afterPermissions` json,
  `ipAddress` varchar(64),
  `userAgent` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `admin_user_permission_audits_id` PRIMARY KEY(`id`),
  INDEX `admin_user_permission_audits_admin_user_idx` (`adminUserId`),
  INDEX `admin_user_permission_audits_created_at_idx` (`createdAt`)
);
