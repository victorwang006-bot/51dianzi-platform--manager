import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  ZhijieAccessInput,
  ZhijieAuditRow,
  ZhijieStaffAccess,
} from "@shared/zhijieBusiness";

export interface ZhijieAdminAccount {
  id: number;
  name: string;
  status: string;
  platformRole: string;
}

export interface ZhijieAccessStore {
  getAccessForAdmin(adminUserId: number): Promise<ZhijieStaffAccess | null>;
  listStaff(): Promise<ZhijieStaffAccess[]>;
  listAdminAccounts(): Promise<ZhijieAdminAccount[]>;
  getAdminAccount(adminUserId: number): Promise<ZhijieAdminAccount | null>;
  isSchemaReady(): Promise<boolean>;
  grant(
    input: ZhijieAccessInput,
    actorAdminId: number,
    verifiedSourceUserId: number
  ): Promise<"created" | "updated" | "conflict">;
  listAudits(limit: number): Promise<ZhijieAuditRow[]>;
}

type AccessRow = RowDataPacket & {
  adminUserId: number;
  sourceMemberId: number;
  sourceUserId: number;
  role: ZhijieStaffAccess["role"];
  teamIds: unknown;
  grants: unknown;
  status: ZhijieStaffAccess["status"];
  revision: number;
  displayName?: string | null;
};

function parseJson<T>(value: unknown): T | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function decodeAccess(row: AccessRow): ZhijieStaffAccess | null {
  const teamIds = parseJson<number[]>(row.teamIds);
  const grants = parseJson<ZhijieStaffAccess["grants"]>(row.grants);
  if (!Array.isArray(teamIds) || !grants || typeof grants !== "object")
    return null;
  if (
    !Number.isInteger(row.adminUserId) ||
    !Number.isInteger(row.sourceMemberId) ||
    !Number.isInteger(row.sourceUserId)
  )
    return null;
  if (
    row.role !== "employee" &&
    row.role !== "team_manager" &&
    row.role !== "department_manager"
  )
    return null;
  if (row.status !== "active" && row.status !== "disabled") return null;
  if (!Number.isInteger(row.revision) || row.revision < 1) return null;
  return {
    adminUserId: row.adminUserId,
    sourceMemberId: row.sourceMemberId,
    sourceUserId: row.sourceUserId,
    role: row.role,
    teamIds,
    grants,
    status: row.status,
    revision: row.revision,
    ...(typeof row.displayName === "string" && row.displayName.trim()
      ? { displayName: row.displayName }
      : {}),
  };
}

function asPublicAccount(row: RowDataPacket): ZhijieAdminAccount {
  return {
    id: Number(row.id),
    name: String(row.name || "后台账号"),
    status: String(row.status),
    platformRole: String(row.platformRole),
  };
}

function cleanReason(reason: string): string {
  return reason.trim().slice(0, 255);
}

/**
 * Dedicated storage for the two Zhijie access tables.  It intentionally does
 * not use the legacy business database and never touches client/order tables.
 */
export class MysqlZhijieAccessStore implements ZhijieAccessStore {
  private pool: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) throw new Error("missing database configuration");
    this.pool = mysql.createPool({
      uri: databaseUrl,
      connectionLimit: 4,
      multipleStatements: false,
    });
  }

  async getAccessForAdmin(
    adminUserId: number
  ): Promise<ZhijieStaffAccess | null> {
    const [rows] = await this.pool.execute<AccessRow[]>(
      `SELECT sa.adminUserId, sa.sourceMemberId, sa.sourceUserId, sa.role, sa.teamIds, sa.grants, sa.status, sa.revision,
              COALESCE(NULLIF(au.displayName, ''), au.username) AS displayName
         FROM zhijie_staff_access AS sa
    LEFT JOIN admin_users AS au ON au.id = sa.adminUserId
        WHERE sa.adminUserId = ? LIMIT 1`,
      [adminUserId]
    );
    return rows[0] ? decodeAccess(rows[0]) : null;
  }

  async listStaff(): Promise<ZhijieStaffAccess[]> {
    const [rows] = await this.pool.query<AccessRow[]>(
      `SELECT sa.adminUserId, sa.sourceMemberId, sa.sourceUserId, sa.role, sa.teamIds, sa.grants, sa.status, sa.revision,
              COALESCE(NULLIF(au.displayName, ''), au.username) AS displayName
         FROM zhijie_staff_access AS sa
    LEFT JOIN admin_users AS au ON au.id = sa.adminUserId
        ORDER BY sa.adminUserId ASC`
    );
    // A malformed persisted row must not acquire access by being half-decoded.
    return rows
      .map(decodeAccess)
      .filter((row): row is ZhijieStaffAccess => row !== null);
  }

  async listAdminAccounts(): Promise<ZhijieAdminAccount[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, COALESCE(NULLIF(displayName, ''), username) AS name, status, adminRole AS platformRole
         FROM admin_users ORDER BY id ASC`
    );
    return rows.map(asPublicAccount);
  }

  async getAdminAccount(
    adminUserId: number
  ): Promise<ZhijieAdminAccount | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, COALESCE(NULLIF(displayName, ''), username) AS name, status, adminRole AS platformRole
         FROM admin_users WHERE id = ? LIMIT 1`,
      [adminUserId]
    );
    return rows[0] ? asPublicAccount(rows[0]) : null;
  }

  async isSchemaReady(): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('zhijie_staff_access', 'zhijie_access_audits')`
    );
    return new Set(rows.map(row => String(row.tableName))).size === 2;
  }

  async grant(
    input: ZhijieAccessInput,
    actorAdminId: number,
    verifiedSourceUserId: number
  ): Promise<"created" | "updated" | "conflict"> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute<AccessRow[]>(
        `SELECT adminUserId, sourceMemberId, sourceUserId, role, teamIds, grants, status, revision
           FROM zhijie_staff_access WHERE adminUserId = ? FOR UPDATE`,
        [input.adminUserId]
      );
      const existing = existingRows[0] ? decodeAccess(existingRows[0]) : null;
      if (existingRows[0] && !existing) {
        await connection.rollback();
        return "conflict";
      }
      if (existing && existing.revision !== input.expectedRevision) {
        await connection.rollback();
        return "conflict";
      }
      if (!existing && input.expectedRevision !== 0) {
        await connection.rollback();
        return "conflict";
      }
      // Lock the source binding as well.  The unique index remains the final
      // authority under races, and duplicate-key errors become a clean 409.
      const [sourceRows] = await connection.execute<RowDataPacket[]>(
        `SELECT adminUserId FROM zhijie_staff_access WHERE sourceMemberId = ? FOR UPDATE`,
        [input.sourceMemberId]
      );
      if (
        sourceRows[0] &&
        Number(sourceRows[0].adminUserId) !== input.adminUserId
      ) {
        await connection.rollback();
        return "conflict";
      }
      const serializedTeams = JSON.stringify(input.teamIds);
      const serializedGrants = JSON.stringify(input.grants);
      let action: "created" | "updated";
      if (existing) {
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE zhijie_staff_access
              SET sourceMemberId = ?, sourceUserId = ?, role = ?, teamIds = ?, grants = ?, status = ?, revision = revision + 1
            WHERE adminUserId = ? AND revision = ?`,
          [
            input.sourceMemberId,
            verifiedSourceUserId,
            input.role,
            serializedTeams,
            serializedGrants,
            input.status,
            input.adminUserId,
            input.expectedRevision,
          ]
        );
        if (result.affectedRows !== 1) {
          await connection.rollback();
          return "conflict";
        }
        action = "updated";
      } else {
        if (
          !Number.isInteger(verifiedSourceUserId) ||
          verifiedSourceUserId <= 0
        ) {
          await connection.rollback();
          return "conflict";
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO zhijie_staff_access
           (adminUserId, sourceMemberId, sourceUserId, role, teamIds, grants, status, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            input.adminUserId,
            input.sourceMemberId,
            verifiedSourceUserId,
            input.role,
            serializedTeams,
            serializedGrants,
            input.status,
          ]
        );
        action = "created";
      }
      await this.insertAudit(
        connection,
        actorAdminId,
        input.adminUserId,
        action,
        cleanReason(input.reason)
      );
      await connection.commit();
      return action;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      // ER_DUP_ENTRY is intentionally normalized; callers must never receive SQL details.
      if ((error as { code?: string }).code === "ER_DUP_ENTRY")
        return "conflict";
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertAudit(
    connection: PoolConnection,
    actorAdminId: number,
    targetAdminId: number,
    action: string,
    reason: string
  ) {
    await connection.execute(
      `INSERT INTO zhijie_access_audits (actorAdminId, targetAdminId, action, reason)
       VALUES (?, ?, ?, ?)`,
      [actorAdminId, targetAdminId, action, reason]
    );
  }

  async listAudits(limit: number): Promise<ZhijieAuditRow[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    // mysql2's binary protocol binds JS numbers as DOUBLE. MySQL 8 can reject
    // that type for LIMIT; query() safely formats this bounded numeric value.
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, actorAdminId, targetAdminId, action, reason, createdAt
         FROM zhijie_access_audits
        ORDER BY id DESC LIMIT ?`,
      [safeLimit]
    );
    return rows.map(row => ({
      id: Number(row.id),
      actorAdminId: Number(row.actorAdminId),
      targetAdminId: Number(row.targetAdminId),
      action: String(row.action),
      reason: String(row.reason),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }
}
