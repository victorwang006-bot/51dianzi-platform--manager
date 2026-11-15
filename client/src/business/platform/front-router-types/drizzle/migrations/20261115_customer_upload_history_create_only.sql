-- ADDITIVE ONLY. Execute only after parent verifies procurement handoff and native baseline.
-- No old inventory / CRM / procurement table DDL or DML. Files and versions are append-only in the service.
CREATE TABLE IF NOT EXISTS customer_upload_histories (
 history_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 enterprise_id BIGINT UNSIGNED NOT NULL, data_owner_user_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
 mode VARCHAR(16) NOT NULL, state VARCHAR(32) NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 uploaded_by_user_id BIGINT UNSIGNED NOT NULL, uploaded_by_admin_account_id BIGINT UNSIGNED NULL,
 original_file_id CHAR(36) COLLATE utf8mb4_bin NOT NULL, latest_version_id CHAR(36) COLLATE utf8mb4_bin NULL, latest_version_no INT UNSIGNED NOT NULL DEFAULT 0,
 last_reason VARCHAR(1000) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (history_id), KEY customer_history_scope_cursor (enterprise_id,data_owner_user_id,uploaded_by_user_id,created_at,history_id),
 KEY customer_history_customer_state (enterprise_id,data_owner_user_id,customer_id,state,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS customer_upload_files (
 file_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 enterprise_id BIGINT UNSIGNED NOT NULL, data_owner_user_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL, history_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 kind VARCHAR(16) NOT NULL, locator VARCHAR(128) COLLATE utf8mb4_bin NOT NULL, file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(128) NOT NULL,
 byte_size INT UNSIGNED NOT NULL, sha256 CHAR(64) COLLATE utf8mb4_bin NOT NULL, original_manifest JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (file_id), KEY customer_file_exact_tuple (enterprise_id,data_owner_user_id,customer_id,history_id,file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS customer_upload_versions (
 version_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 enterprise_id BIGINT UNSIGNED NOT NULL, data_owner_user_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL, history_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 version_no INT UNSIGNED NOT NULL, parent_version_id CHAR(36) COLLATE utf8mb4_bin NULL,
 normalized_file_id CHAR(36) COLLATE utf8mb4_bin NOT NULL, issues_file_id CHAR(36) COLLATE utf8mb4_bin NULL,
 rows_data JSON NOT NULL, issues_data JSON NOT NULL, uploaded_by_user_id BIGINT UNSIGNED NOT NULL, uploaded_by_admin_account_id BIGINT UNSIGNED NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (version_id), UNIQUE KEY customer_version_append_unique (history_id,version_no), KEY customer_version_exact_tuple (enterprise_id,data_owner_user_id,customer_id,history_id,version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS customer_upload_confirmations (
 confirmation_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 enterprise_id BIGINT UNSIGNED NOT NULL, data_owner_user_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL, history_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL, batch_request_id CHAR(36) COLLATE utf8mb4_bin NOT NULL, frozen_data JSON NOT NULL, receipts_data JSON NOT NULL,
 remaining_material_count INT UNSIGNED NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (confirmation_id), UNIQUE KEY customer_confirmation_one_history (history_id), UNIQUE KEY customer_confirmation_batch_unique (enterprise_id,actor_user_id,batch_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS customer_upload_requests (
 enterprise_id BIGINT UNSIGNED NOT NULL, data_owner_user_id BIGINT UNSIGNED NOT NULL, actor_user_id BIGINT UNSIGNED NOT NULL,
 request_id CHAR(36) COLLATE utf8mb4_bin NOT NULL, operation VARCHAR(64) NOT NULL, history_id CHAR(36) COLLATE utf8mb4_bin NOT NULL,
 payload_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL, result_data JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (enterprise_id,actor_user_id,request_id), KEY customer_request_history_audit (enterprise_id,data_owner_user_id,history_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
