CREATE TABLE `admin_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`username` varchar(64) NOT NULL,
	`displayName` varchar(128),
	`email` varchar(320),
	`phone` varchar(20),
	`adminRole` enum('super_admin','operation','merchant_mgr','customer_svc','risk_control','finance','auditor') NOT NULL DEFAULT 'operation',
	`status` enum('active','disabled','locked') NOT NULL DEFAULT 'active',
	`mfaEnabled` boolean DEFAULT false,
	`lastLoginAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertType` enum('stuck_order','refund_abnormal','license_expiry','settlement_failed','risk_merchant','system_error') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
	`title` varchar(256) NOT NULL,
	`content` text,
	`relatedType` varchar(64),
	`relatedId` varchar(64),
	`status` enum('open','acknowledged','resolved','ignored') NOT NULL DEFAULT 'open',
	`assignedTo` int,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`notificationSent` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operatorId` int,
	`operatorName` varchar(64),
	`operatorRole` varchar(32),
	`action` varchar(128) NOT NULL,
	`module` varchar(64),
	`targetType` varchar(64),
	`targetId` varchar(64),
	`beforeValue` json,
	`afterValue` json,
	`ipAddress` varchar(64),
	`userAgent` text,
	`result` enum('success','failed','blocked') DEFAULT 'success',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`parentId` int,
	`level` int DEFAULT 1,
	`sortOrder` int DEFAULT 0,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`merchantId` int NOT NULL,
	`changeType` enum('inbound','outbound','lock','unlock','adjust','return') NOT NULL,
	`changeQty` bigint NOT NULL,
	`beforeQty` bigint NOT NULL,
	`afterQty` bigint NOT NULL,
	`relatedOrderNo` varchar(64),
	`note` text,
	`operatorId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantNo` varchar(32) NOT NULL,
	`companyName` varchar(256) NOT NULL,
	`contactName` varchar(64),
	`contactPhone` varchar(20),
	`contactEmail` varchar(320),
	`businessLicense` varchar(64),
	`licenseExpiry` timestamp,
	`status` enum('draft','pending','supplement','approved','suspended','terminated') NOT NULL DEFAULT 'pending',
	`agreementStatus` enum('unsigned','signed','expired') NOT NULL DEFAULT 'unsigned',
	`settlementAccount` varchar(64),
	`settlementBank` varchar(128),
	`settlementAccountName` varchar(128),
	`commissionRate` decimal(5,4) DEFAULT '0.0300',
	`reviewNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `merchants_id` PRIMARY KEY(`id`),
	CONSTRAINT `merchants_merchantNo_unique` UNIQUE(`merchantNo`)
);
--> statement-breakpoint
CREATE TABLE `order_status_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`orderNo` varchar(64),
	`fromStatus` varchar(32),
	`toStatus` varchar(32) NOT NULL,
	`operatorId` int,
	`operatorName` varchar(64),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_status_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderNo` varchar(64) NOT NULL,
	`buyerUserId` int,
	`buyerName` varchar(128),
	`merchantId` int NOT NULL,
	`productId` int NOT NULL,
	`productName` varchar(256),
	`qty` bigint NOT NULL,
	`unitPrice` decimal(12,4) NOT NULL,
	`totalAmount` decimal(14,4) NOT NULL,
	`platformFee` decimal(12,4) DEFAULT '0.0000',
	`merchantAmount` decimal(12,4),
	`status` enum('pending_payment','paid','processing','shipped','completed','cancelled','refunding','refunded','abnormal') NOT NULL DEFAULT 'pending_payment',
	`abnormalTag` varchar(64),
	`cancelReason` text,
	`note` text,
	`paidAt` timestamp,
	`shippedAt` timestamp,
	`completedAt` timestamp,
	`cancelledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_orderNo_unique` UNIQUE(`orderNo`)
);
--> statement-breakpoint
CREATE TABLE `payment_flows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`flowNo` varchar(64) NOT NULL,
	`orderId` int,
	`orderNo` varchar(64),
	`merchantId` int,
	`flowType` enum('payment','refund','platform_fee','settlement','adjustment') NOT NULL,
	`amount` decimal(14,4) NOT NULL,
	`currency` varchar(8) DEFAULT 'CNY',
	`channel` varchar(32),
	`channelFlowNo` varchar(128),
	`status` enum('pending','success','failed','cancelled') NOT NULL DEFAULT 'pending',
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_flows_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_flows_flowNo_unique` UNIQUE(`flowNo`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productNo` varchar(32) NOT NULL,
	`merchantId` int NOT NULL,
	`categoryId` int,
	`name` varchar(256) NOT NULL,
	`brand` varchar(64),
	`model` varchar(128),
	`packageType` varchar(64),
	`spec` text,
	`price` decimal(12,4),
	`stockQty` bigint DEFAULT 0,
	`lockedQty` bigint DEFAULT 0,
	`unit` varchar(16) DEFAULT '片',
	`grade` enum('A','B','C','unknown') DEFAULT 'A',
	`status` enum('draft','pending_review','active','inactive','banned') NOT NULL DEFAULT 'pending_review',
	`banReason` text,
	`reviewNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_productNo_unique` UNIQUE(`productNo`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`refundNo` varchar(64) NOT NULL,
	`orderId` int NOT NULL,
	`orderNo` varchar(64),
	`merchantId` int,
	`applicantUserId` int,
	`refundAmount` decimal(12,4) NOT NULL,
	`refundReason` text,
	`evidenceUrls` json,
	`status` enum('pending','reviewing','approved','rejected','executing','completed','failed') NOT NULL DEFAULT 'pending',
	`reviewNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`executedAt` timestamp,
	`failReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`),
	CONSTRAINT `refunds_refundNo_unique` UNIQUE(`refundNo`)
);
--> statement-breakpoint
CREATE TABLE `risk_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetType` enum('order','merchant','refund') NOT NULL,
	`targetId` varchar(64) NOT NULL,
	`riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'low',
	`riskSummary` text,
	`suggestions` text,
	`rawData` json,
	`analyzedBy` varchar(32) DEFAULT 'llm',
	`status` enum('pending','reviewed','actioned','dismissed') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `risk_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_bills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`billNo` varchar(64) NOT NULL,
	`merchantId` int NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`totalOrderAmount` decimal(14,4) DEFAULT '0.0000',
	`platformFeeTotal` decimal(12,4) DEFAULT '0.0000',
	`refundTotal` decimal(12,4) DEFAULT '0.0000',
	`settlementAmount` decimal(14,4) NOT NULL,
	`status` enum('draft','confirmed','paying','paid','failed') NOT NULL DEFAULT 'draft',
	`paidAt` timestamp,
	`failReason` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settlement_bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `settlement_bills_billNo_unique` UNIQUE(`billNo`)
);
