CREATE TABLE `material_code_aliases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`materialId` int NOT NULL,
	`aliasCode` varchar(64) NOT NULL,
	`aliasType` enum('legacy','merged','external') NOT NULL,
	`source` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `material_code_aliases_id` PRIMARY KEY(`id`),
	CONSTRAINT `material_code_aliases_aliasCode_unique` UNIQUE(`aliasCode`),
	INDEX `material_code_aliases_materialId_idx` (`materialId`)
);
--> statement-breakpoint
CREATE TABLE `material_number_sequences` (
	`sequenceKey` varchar(64) NOT NULL,
	`nextValue` bigint NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `material_number_sequences_sequenceKey` PRIMARY KEY(`sequenceKey`)
);
