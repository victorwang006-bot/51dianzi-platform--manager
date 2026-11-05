-- Main-platform sidecars only. NO official tables, backfill, source inventory copy or identity mutation.
CREATE TABLE IF NOT EXISTS channel_material_publications (
  enterprise_id BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  data_owner_user_id BIGINT UNSIGNED NOT NULL,
  material_revision INT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  channel_revision INT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NOT NULL,
  assignment_revision INT UNSIGNED NOT NULL,
  team_id BIGINT UNSIGNED NOT NULL,
  owner_membership_id BIGINT UNSIGNED NOT NULL,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'unpublished',
  snapshot JSON NOT NULL,
  published_at DATETIME(3) NOT NULL,
  PRIMARY KEY (enterprise_id, material_id),
  UNIQUE KEY channel_publication_public_id_unique (public_id),
  KEY channel_publication_recent_idx (status, published_at, public_id),
  CONSTRAINT channel_publication_status_valid CHECK (status IN ('unpublished', 'published')),
  CONSTRAINT channel_publication_revision_valid CHECK (material_revision >= 1 AND channel_revision >= 1 AND assignment_revision >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Internal receipt/audit, never a public DTO and never a replacement of old audits.
-- Only material/revision/request and permission evidence; NO contact or stock snapshot here.
CREATE TABLE IF NOT EXISTS channel_material_publication_requests (
  enterprise_id BIGINT UNSIGNED NOT NULL,
  data_owner_user_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  actor_admin_account_id BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED NOT NULL,
  material_revision INT UNSIGNED NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authorization_version VARCHAR(160) NOT NULL,
  binding_version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (enterprise_id, data_owner_user_id, actor_user_id, request_id),
  KEY channel_publication_request_material_idx (enterprise_id, material_id, created_at),
  CONSTRAINT channel_publication_request_revision_valid CHECK (material_revision >= 1 AND binding_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
