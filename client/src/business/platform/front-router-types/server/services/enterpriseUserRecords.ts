import { desc, eq, inArray } from "drizzle-orm";
import {
  crmOwnerTransferLogs,
  enterpriseMemberInvitations,
  enterprisePermissionAuditLogs,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { requireEnterprisePermissionManager } from "./enterprisePermissions";

export const ENTERPRISE_USER_RECORD_EVENT_TYPES = [
  "all",
  "invite_created",
  "invite_resent",
  "invite_revoked",
  "invite_accepted",
  "invite_rejected",
  "permissions_updated",
  "member_suspended",
  "member_activated",
  "member_removed",
  "member_left",
  "owner_transferred",
] as const;

export type EnterpriseUserRecordEventType = (typeof ENTERPRISE_USER_RECORD_EVENT_TYPES)[number];
export type EnterpriseUserRecordTimeRange = "all" | "7d" | "30d";

type UserSnapshot = {
  id: number;
  displayName: string;
  phone: string;
  searchablePhone: string;
};

type UserRecord = {
  id: string;
  source: "permission_audit" | "owner_transfer";
  eventType: Exclude<EnterpriseUserRecordEventType, "all">;
  target: UserSnapshot;
  actor: UserSnapshot | null;
  occurredAt: Date;
  result: string;
  beforePermissions: string[] | null;
  afterPermissions: string[] | null;
  invitation: { id: number; status: string } | null;
  note: string | null;
};

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "未绑定";
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function displayName(row: { id: number; name: string | null; username: string | null }) {
  return String(row.name || row.username || `用户${row.id}`);
}

function dateMatchesRange(occurredAt: Date, timeRange: EnterpriseUserRecordTimeRange) {
  if (timeRange === "all") return true;
  const days = timeRange === "7d" ? 7 : 30;
  return occurredAt.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * 企业用户记录只读取不可变审计表和负责人转让账本；邀请表仅补充当前状态，
 * 不会为了展示而修改或清理任何审计历史。
 */
export async function listEnterpriseUserRecords(input: {
  actorUserId: number;
  keyword?: string;
  eventType: EnterpriseUserRecordEventType;
  timeRange: EnterpriseUserRecordTimeRange;
}) {
  const actorScope = await requireEnterprisePermissionManager(input.actorUserId);
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const [permissionAudits, ownerTransfers] = await Promise.all([
    db
      .select({
        id: enterprisePermissionAuditLogs.id,
        actorUserId: enterprisePermissionAuditLogs.actorUserId,
        targetUserId: enterprisePermissionAuditLogs.targetUserId,
        invitationId: enterprisePermissionAuditLogs.invitationId,
        action: enterprisePermissionAuditLogs.action,
        beforePermissions: enterprisePermissionAuditLogs.beforePermissions,
        afterPermissions: enterprisePermissionAuditLogs.afterPermissions,
        result: enterprisePermissionAuditLogs.result,
        note: enterprisePermissionAuditLogs.note,
        createdAt: enterprisePermissionAuditLogs.createdAt,
      })
      .from(enterprisePermissionAuditLogs)
      .where(eq(enterprisePermissionAuditLogs.enterpriseId, actorScope.enterprise.id))
      .orderBy(desc(enterprisePermissionAuditLogs.createdAt)),
    db
      .select({
        id: crmOwnerTransferLogs.id,
        previousSuperAdminUserId: crmOwnerTransferLogs.previousSuperAdminUserId,
        nextSuperAdminUserId: crmOwnerTransferLogs.nextSuperAdminUserId,
        initiatedByUserId: crmOwnerTransferLogs.initiatedByUserId,
        reason: crmOwnerTransferLogs.reason,
        createdAt: crmOwnerTransferLogs.createdAt,
      })
      .from(crmOwnerTransferLogs)
      .where(eq(crmOwnerTransferLogs.enterpriseId, actorScope.enterprise.id))
      .orderBy(desc(crmOwnerTransferLogs.createdAt)),
  ]);

  const userIds = Array.from(new Set([
    ...permissionAudits.flatMap(row => [row.targetUserId, ...(row.actorUserId ? [row.actorUserId] : [])]),
    ...ownerTransfers.flatMap(row => [
      row.previousSuperAdminUserId,
      row.nextSuperAdminUserId,
      row.initiatedByUserId,
    ]),
  ]));
  const invitationIds = Array.from(new Set(
    permissionAudits.flatMap(row => row.invitationId ? [row.invitationId] : []),
  ));
  const [userRows, invitationRows] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name, username: users.username, phone: users.phone })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    invitationIds.length
      ? db
          .select({ id: enterpriseMemberInvitations.id, status: enterpriseMemberInvitations.status })
          .from(enterpriseMemberInvitations)
          .where(inArray(enterpriseMemberInvitations.id, invitationIds))
      : Promise.resolve([]),
  ]);

  const usersById = new Map<number, UserSnapshot>(userRows.map(row => [row.id, {
    id: row.id,
    displayName: displayName(row),
    phone: maskPhone(row.phone),
    searchablePhone: row.phone || "",
  }]));
  const invitationsById = new Map(invitationRows.map(row => [row.id, row]));
  const unknownUser = (userId: number): UserSnapshot => ({
    id: userId,
    displayName: `用户${userId}`,
    phone: "未绑定",
    searchablePhone: "",
  });

  const records: UserRecord[] = [
    ...permissionAudits.map(row => ({
      id: `audit:${row.id}`,
      source: "permission_audit" as const,
      eventType: row.action,
      target: usersById.get(row.targetUserId) ?? unknownUser(row.targetUserId),
      actor: row.actorUserId
        ? (usersById.get(row.actorUserId) ?? unknownUser(row.actorUserId))
        : null,
      occurredAt: row.createdAt,
      result: row.result,
      beforePermissions: row.beforePermissions ?? null,
      afterPermissions: row.afterPermissions ?? null,
      invitation: row.invitationId
        ? { id: row.invitationId, status: invitationsById.get(row.invitationId)?.status ?? "unknown" }
        : null,
      note: row.note,
    })),
    ...ownerTransfers.map(row => ({
      id: `owner-transfer:${row.id}`,
      source: "owner_transfer" as const,
      eventType: "owner_transferred" as const,
      // 记录接收人，避免用“旧所有者”掩盖实际获得企业控制权的账号。
      target: usersById.get(row.nextSuperAdminUserId) ?? unknownUser(row.nextSuperAdminUserId),
      actor: usersById.get(row.initiatedByUserId) ?? unknownUser(row.initiatedByUserId),
      occurredAt: row.createdAt,
      result: "success",
      beforePermissions: null,
      afterPermissions: null,
      invitation: null,
      note: `企业所有者由 ${usersById.get(row.previousSuperAdminUserId)?.displayName ?? `用户${row.previousSuperAdminUserId}`} 转让：${row.reason}`,
    })),
  ];

  const keyword = input.keyword?.trim().toLowerCase() ?? "";
  return records
    .filter(record => input.eventType === "all" || record.eventType === input.eventType)
    .filter(record => dateMatchesRange(record.occurredAt, input.timeRange))
    .filter(record => {
      if (!keyword) return true;
      return [
        record.target.displayName,
        record.target.phone,
        record.target.searchablePhone,
        record.actor?.displayName ?? "",
        record.actor?.phone ?? "",
        record.actor?.searchablePhone ?? "",
        String(record.target.id),
        String(record.actor?.id ?? ""),
      ].some(value => value.toLowerCase().includes(keyword));
    })
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .map(({ target, actor, ...record }) => ({
      ...record,
      target: { id: target.id, displayName: target.displayName, phone: target.phone },
      actor: actor ? { id: actor.id, displayName: actor.displayName, phone: actor.phone } : null,
    }));
}

export const ENTERPRISE_USER_RECORD_EVENT_LABELS: Record<Exclude<EnterpriseUserRecordEventType, "all">, string> = {
  invite_created: "发送邀请",
  invite_resent: "重新发送邀请",
  invite_revoked: "撤销邀请",
  invite_accepted: "接受邀请",
  invite_rejected: "拒绝邀请",
  permissions_updated: "变更权限/业务范围",
  member_suspended: "暂停成员",
  member_activated: "恢复成员",
  member_removed: "移出企业",
  member_left: "主动退出企业",
  owner_transferred: "转让企业所有者",
};
