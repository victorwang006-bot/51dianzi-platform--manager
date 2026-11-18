-- Apply ONLY in the canonical admin database (dianzi51_admin).
-- Private operational metadata; not a storefront projection and not a source SKU dedup gate.
-- Runner verifies the actual contract; IF NOT EXISTS never silently repairs a mismatched table.
CREATE TABLE IF NOT EXISTS `official_mall_source_data` (
  `materialId` INT NOT NULL,
  `unit` VARCHAR(8) NOT NULL,
  `sourcePayload` JSON NOT NULL,
  `importKey` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`materialId`),
  UNIQUE KEY `om_source_import_key_uq` (`importKey`),
  CONSTRAINT `om_source_material_fk` FOREIGN KEY (`materialId`)
    REFERENCES `official_mall_materials` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
