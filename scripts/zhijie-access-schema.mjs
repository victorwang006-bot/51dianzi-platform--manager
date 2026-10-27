export const ZHIJIE_ACCESS_TABLE = "zhijie_staff_access";
export const ZHIJIE_AUDIT_TABLE = "zhijie_access_audits";

export const ACCESS_COLUMNS = {
  id: { type: "int", nullable: "NO" },
  adminUserId: { type: "int", nullable: "NO" },
  sourceMemberId: { type: "int", nullable: "NO" },
  sourceUserId: { type: "int", nullable: "NO" },
  role: { type: "varchar", nullable: "NO" },
  teamIds: { type: "json", nullable: "NO" },
  grants: { type: "json", nullable: "NO" },
  status: { type: "varchar", nullable: "NO" },
  revision: { type: "int", nullable: "NO" },
  createdAt: { type: "timestamp", nullable: "NO" },
  updatedAt: { type: "timestamp", nullable: "NO" },
};

export const AUDIT_COLUMNS = {
  id: { type: "bigint", nullable: "NO" },
  actorAdminId: { type: "int", nullable: "NO" },
  targetAdminId: { type: "int", nullable: "NO" },
  action: { type: "varchar", nullable: "NO" },
  reason: { type: "varchar", nullable: "NO" },
  createdAt: { type: "timestamp", nullable: "NO" },
};

export const ACCESS_INDEXES = {
  PRIMARY: { columns: "id", unique: 0 },
  zhijie_staff_access_admin_unique: { columns: "adminUserId", unique: 0 },
  zhijie_staff_access_source_member_unique: { columns: "sourceMemberId", unique: 0 },
  zhijie_staff_access_source_user_idx: { columns: "sourceUserId", unique: 1 },
};

export const AUDIT_INDEXES = {
  PRIMARY: { columns: "id", unique: 0 },
  zhijie_access_audits_actor_created_idx: { columns: "actorAdminId,createdAt", unique: 1 },
  zhijie_access_audits_target_created_idx: { columns: "targetAdminId,createdAt", unique: 1 },
};

export const CREATE_ACCESS_TABLE = `
  CREATE TABLE \`${ZHIJIE_ACCESS_TABLE}\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`adminUserId\` int NOT NULL,
    \`sourceMemberId\` int NOT NULL,
    \`sourceUserId\` int NOT NULL,
    \`role\` varchar(32) NOT NULL,
    \`teamIds\` json NOT NULL,
    \`grants\` json NOT NULL,
    \`status\` varchar(16) NOT NULL,
    \`revision\` int NOT NULL DEFAULT 1,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`zhijie_staff_access_admin_unique\` (\`adminUserId\`),
    UNIQUE KEY \`zhijie_staff_access_source_member_unique\` (\`sourceMemberId\`),
    KEY \`zhijie_staff_access_source_user_idx\` (\`sourceUserId\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

export const CREATE_AUDIT_TABLE = `
  CREATE TABLE \`${ZHIJIE_AUDIT_TABLE}\` (
    \`id\` bigint NOT NULL AUTO_INCREMENT,
    \`actorAdminId\` int NOT NULL,
    \`targetAdminId\` int NOT NULL,
    \`action\` varchar(32) NOT NULL,
    \`reason\` varchar(255) NOT NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`zhijie_access_audits_actor_created_idx\` (\`actorAdminId\`, \`createdAt\`),
    KEY \`zhijie_access_audits_target_created_idx\` (\`targetAdminId\`, \`createdAt\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
