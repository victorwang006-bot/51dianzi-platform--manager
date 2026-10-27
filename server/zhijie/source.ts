import mysql, { type RowDataPacket } from "mysql2/promise";
import {
  ZHIJIE_ENTERPRISE_ID,
  type ZhijieSourceMember,
  type ZhijieTeam,
} from "@shared/zhijieBusiness";

export interface ZhijieSourceEnterprise {
  id: number;
  companyName: string;
  superAdminUserId: number | null;
}

export interface ZhijieSourceSnapshot {
  enterprise: ZhijieSourceEnterprise;
  members: ZhijieSourceMember[];
  teams: ZhijieTeam[];
}

export interface ZhijieSourceAdapter {
  loadSnapshot(): Promise<ZhijieSourceSnapshot>;
}

type Row = RowDataPacket & Record<string, unknown>;

function requiredPositiveInt(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0)
    throw new Error(`invalid source ${field}`);
  return number;
}

function asOptionalPositiveInt(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function sourceDatabaseName(): string {
  const name = process.env.PLATFORM_DB_NAME || "dianzi51";
  // Identifiers cannot be placeholders.  This rejects injection before the one
  // fixed qualified-table SQL string is constructed.
  if (!/^[A-Za-z0-9_]+$/.test(name))
    throw new Error("invalid PLATFORM_DB_NAME");
  return name;
}

function sourceUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("missing database configuration");
  const url = new URL(raw);
  url.pathname = `/${sourceDatabaseName()}`;
  return url.toString();
}

/**
 * Read-only bridge to the legacy organization tables.  Every query names a
 * fixed table, has a fixed enterprise ID (=1), and is SELECT-only.  This class
 * deliberately has no generic query method and no write API.
 */
export class MysqlZhijieSourceAdapter implements ZhijieSourceAdapter {
  async loadSnapshot(): Promise<ZhijieSourceSnapshot> {
    const database = sourceDatabaseName();
    const qualified = (table: string) => `\`${database}\`.\`${table}\``;
    const connection = await mysql.createConnection({
      uri: sourceUrl(),
      multipleStatements: false,
    });
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.query("SET TRANSACTION READ ONLY");
      await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
      const [enterpriseRows] = await connection.execute<Row[]>(
        `SELECT id, companyName, superAdminUserId
           FROM ${qualified("enterprises")}
          WHERE id = ${ZHIJIE_ENTERPRISE_ID}
          LIMIT 1`
      );
      const enterpriseRow = enterpriseRows[0];
      if (!enterpriseRow) throw new Error("source enterprise missing");
      const enterprise: ZhijieSourceEnterprise = {
        id: requiredPositiveInt(enterpriseRow.id, "enterprise id"),
        companyName:
          typeof enterpriseRow.companyName === "string"
            ? enterpriseRow.companyName
            : "",
        superAdminUserId: asOptionalPositiveInt(enterpriseRow.superAdminUserId),
      };
      if (enterprise.id !== ZHIJIE_ENTERPRISE_ID)
        throw new Error("unexpected source enterprise");

      const [memberRows] = await connection.execute<Row[]>(
        `SELECT m.id, m.userId, m.role, m.status,
                COALESCE(NULLIF(u.name, ''), NULLIF(u.username, ''), CONCAT('用户#', m.userId)) AS displayName
           FROM ${qualified("enterprise_members")} AS m
      LEFT JOIN ${qualified("users")} AS u ON u.id = m.userId
          WHERE m.enterpriseId = ${ZHIJIE_ENTERPRISE_ID}`
      );
      const [teamRows] = await connection.execute<Row[]>(
        `SELECT id, name, leaderUserId, status
           FROM ${qualified("enterprise_teams")}
          WHERE enterpriseId = ${ZHIJIE_ENTERPRISE_ID}`
      );
      const [membershipRows] = await connection.execute<Row[]>(
        `SELECT tm.userId, tm.teamId
           FROM ${qualified("enterprise_team_members")} AS tm
     INNER JOIN ${qualified("enterprise_members")} AS m
             ON m.userId = tm.userId AND m.enterpriseId = ${ZHIJIE_ENTERPRISE_ID}
          WHERE tm.enterpriseId = ${ZHIJIE_ENTERPRISE_ID}`
      );
      const [permissionRows] = await connection.execute<Row[]>(
        `SELECT p.enterpriseMemberId, p.permissionKey
           FROM ${qualified("enterprise_member_permissions")} AS p
     INNER JOIN ${qualified("enterprise_members")} AS m
             ON m.id = p.enterpriseMemberId AND m.enterpriseId = ${ZHIJIE_ENTERPRISE_ID}`
      );

      const teams: ZhijieTeam[] = teamRows.map(row => ({
        id: requiredPositiveInt(row.id, "team id"),
        name: typeof row.name === "string" ? row.name : "",
        leaderUserId: requiredPositiveInt(row.leaderUserId, "team leader"),
        status: row.status === "active" ? "active" : "archived",
      }));
      const knownTeamIds = new Set(teams.map(team => team.id));
      const teamsByUser = new Map<number, number[]>();
      for (const row of membershipRows) {
        const userId = asOptionalPositiveInt(row.userId);
        const teamId = asOptionalPositiveInt(row.teamId);
        if (!userId || !teamId || !knownTeamIds.has(teamId)) continue;
        const current = teamsByUser.get(userId) ?? [];
        if (!current.includes(teamId)) current.push(teamId);
        teamsByUser.set(userId, current);
      }
      const permissionsByMember = new Map<number, string[]>();
      for (const row of permissionRows) {
        const memberId = asOptionalPositiveInt(row.enterpriseMemberId);
        const permission =
          typeof row.permissionKey === "string" ? row.permissionKey : "";
        if (!memberId || !permission) continue;
        const current = permissionsByMember.get(memberId) ?? [];
        if (!current.includes(permission)) current.push(permission);
        permissionsByMember.set(memberId, current);
      }
      const members: ZhijieSourceMember[] = memberRows.map(row => {
        const memberId = requiredPositiveInt(row.id, "member id");
        const userId = requiredPositiveInt(row.userId, "member user id");
        const memberTeams = teamsByUser.get(userId) ?? [];
        // Legacy membership has no explicit primary marker.  A primary team is
        // usable only when it is unambiguous, avoiding arbitrary widening.
        const activeMemberTeams = memberTeams.filter(id =>
          teams.some(team => team.id === id && team.status === "active")
        );
        const sourceTeamId =
          activeMemberTeams.length === 1 ? activeMemberTeams[0] : null;
        return {
          memberId,
          userId,
          name:
            typeof row.displayName === "string"
              ? row.displayName
              : `用户#${userId}`,
          status: row.status === "active" ? "active" : "suspended",
          teamId: sourceTeamId,
          sourcePermissions: permissionsByMember.get(memberId) ?? [],
          isOwner: enterprise.superAdminUserId === userId,
        };
      });
      await connection.commit();
      return { enterprise, members, teams };
    } finally {
      await connection.rollback().catch(() => undefined);
      await connection.end().catch(() => undefined);
    }
  }
}
