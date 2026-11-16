-- Independent empty native-admin mall tables. No ALTER, INSERT, data copy or automatic grants.
CREATE TABLE IF NOT EXISTS `official_mall_materials` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `publicId` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `teamId` INT NULL,
  `ownerAdminUserId` INT NOT NULL,
  `createdByAdminUserId` INT NOT NULL,
  `updatedByAdminUserId` INT NOT NULL,
  `publishedByAdminUserId` INT NULL,
  `partNumber` VARCHAR(128) NOT NULL, `brand` VARCHAR(128) NOT NULL,
  `pkg` VARCHAR(128) NOT NULL DEFAULT '', `dateCode` VARCHAR(64) NOT NULL DEFAULT '',
  `qtyOnSale` INT NULL, `qtyStock` INT NULL, `qtyOrder` INT NULL,
  `leadTime` VARCHAR(128) NOT NULL DEFAULT '',
  `priceEx` VARCHAR(32) NULL, `taxIncluded` BOOLEAN NULL,
  `moq` INT NULL, `spq` INT NULL, `ladderPrices` JSON NOT NULL, `note` TEXT NOT NULL,
  `status` ENUM('draft','published','offshelf') NOT NULL DEFAULT 'draft',
  `revision` INT NOT NULL DEFAULT 1,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `publishedAt` TIMESTAMP NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `om_material_public_id_uq` (`publicId`),
  KEY `om_material_scope_status_idx` (`teamId`,`status`,`id`),
  KEY `om_material_duplicate_idx` (`teamId`,`partNumber`,`brand`,`pkg`,`dateCode`),
  CONSTRAINT `om_material_qty_check` CHECK ((`qtyOnSale` IS NULL OR `qtyOnSale` >= 0) AND (`qtyStock` IS NULL OR `qtyStock` >= 0) AND (`qtyOrder` IS NULL OR `qtyOrder` >= 0) AND (`qtyOnSale` IS NULL OR `qtyStock` IS NULL OR `qtyOnSale` <= `qtyStock`)),
  CONSTRAINT `om_material_pack_check` CHECK ((`moq` IS NULL OR `moq` > 0) AND (`spq` IS NULL OR `spq` > 0) AND `revision` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `official_mall_publications` (
  `materialId` INT NOT NULL,
  `publicId` VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT NOT NULL, `partNumber` VARCHAR(128) NOT NULL, `brand` VARCHAR(128) NOT NULL,
  `snapshot` JSON NOT NULL, `publishedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`materialId`), UNIQUE KEY `om_publication_public_id_uq` (`publicId`),
  KEY `om_publication_search_idx` (`partNumber`,`brand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `official_mall_requests` (
  `id` INT NOT NULL AUTO_INCREMENT, `actorAdminUserId` INT NOT NULL,
  `requestId` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `action` VARCHAR(32) NOT NULL, `payloadHash` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` ENUM('pending','completed') NOT NULL,
  `result` JSON NULL, `before` JSON NULL, `after` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, `completedAt` TIMESTAMP NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `om_request_actor_uuid_uq` (`actorAdminUserId`,`requestId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
