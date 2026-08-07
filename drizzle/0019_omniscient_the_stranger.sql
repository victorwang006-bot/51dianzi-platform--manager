CREATE TABLE `external_catalog_batches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sourceFileName` varchar(255) NOT NULL,
	`sourceSha256` varchar(64) NOT NULL,
	`dataSha256` varchar(64) NOT NULL,
	`expectedRows` int unsigned NOT NULL,
	`importedRows` int unsigned NOT NULL DEFAULT 0,
	`validPriceRows` int unsigned NOT NULL DEFAULT 0,
	`uniquePartKeys` int unsigned NOT NULL DEFAULT 0,
	`status` enum('importing','ready','active','failed','archived') NOT NULL DEFAULT 'importing',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`activatedAt` timestamp,
	CONSTRAINT `external_catalog_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_catalog_batches_sourceSha256_unique` UNIQUE(`sourceSha256`)
);
--> statement-breakpoint
CREATE TABLE `external_catalog_entries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`batchId` bigint unsigned NOT NULL,
	`rowNo` int unsigned NOT NULL,
	`sourceSequenceRaw` varchar(64),
	`partNumberRaw` varchar(128) NOT NULL,
	`partNumberKey` varchar(128) NOT NULL,
	`partNumberCompactKey` varchar(128) NOT NULL,
	`priceRaw` varchar(32) NOT NULL,
	`priceValue` decimal(20,6),
	`quantityThresholdRaw` varchar(32) NOT NULL,
	`quantityThresholdValue` bigint unsigned NOT NULL,
	`productNameRaw` varchar(256),
	`brandRaw` varchar(128),
	`categoryRaw` varchar(64),
	`packageRaw` varchar(64),
	`parametersRaw` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `external_catalog_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_catalog_entries_batch_row_idx` UNIQUE(`batchId`,`rowNo`)
);
--> statement-breakpoint
CREATE TABLE `external_catalog_state` (
	`id` int unsigned NOT NULL,
	`activeBatchId` bigint unsigned,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `external_catalog_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `external_catalog_batches_status_idx` ON `external_catalog_batches` (`status`);--> statement-breakpoint
CREATE INDEX `external_catalog_entries_batch_part_idx` ON `external_catalog_entries` (`batchId`,`partNumberKey`);--> statement-breakpoint
CREATE INDEX `external_catalog_entries_batch_compact_idx` ON `external_catalog_entries` (`batchId`,`partNumberCompactKey`);