import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { MySqlTransactionConfig } from "drizzle-orm/mysql-core";
import {
  ADMIN_NEW_INFORMATION_ACTIVATED_AT,
  ADMIN_NEW_INFORMATION_GENERATION,
  newInformationFactsInputSchema,
  type NewInformationFact,
  type NewInformationFactsResult,
} from "../../../../shared/adminNewInformationFacts";
import {
  inboundProcurementIdentity,
  resolveInboundProcurementAccess,
  inboundProcurementWhere,
  type InboundProcurementAccess,
  type InboundProcurementExecutor,
} from "../inboundProcurementAccess";

export type InboundNewInformationFactsContext = Parameters<typeof inboundProcurementIdentity>[0];
export interface InboundNewInformationFactsDatabase extends InboundProcurementExecutor {
  transaction<T>(
    read: (tx: InboundProcurementExecutor) => Promise<T>,
    config: MySqlTransactionConfig,
  ): Promise<T>;
}
/** Dependencies are server composition only; no identity/permission callback is accepted in input. */
export type InboundNewInformationFactsDependencies = {
  getDb: () => Promise<InboundNewInformationFactsDatabase | null | undefined>;
  inboundProcurementIdentity?: typeof inboundProcurementIdentity;
  resolveInboundProcurementAccess?: typeof resolveInboundProcurementAccess;
  inboundProcurementWhere?: typeof inboundProcurementWhere;
};
export const INBOUND_NEW_INFORMATION_READ_CONFIG: MySqlTransactionConfig = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
};
// RR establishes one stable view at the first SELECT. Do not combine two START
// characteristics: the installed Drizzle joins them without MySQL's required comma.
const activation = Date.parse(ADMIN_NEW_INFORMATION_ACTIVATED_AT);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const positiveId = (value: unknown): number | null => {
  const number = typeof value === "number" ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
function refId(ref: string): number | null {
  const match = /^inbound:([1-9]\d*)$/.exec(ref);
  return match ? positiveId(match[1]) : null;
}
/** mysql2 from the ORIGINAL getDb decodes dates with its explicit +08:00 setting.
 * A timezone-less SQL string uses that same established storage convention, not the host clock. */
function occurredAt(value: unknown): string {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
    date = new Date(`${value.replace(" ", "T")}+08:00`);
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    date = new Date(value);
  } else throw new Error("Invalid stored inbound creation time");
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid stored inbound creation time");
  return date.toISOString();
}
function authorizationVersion(access: InboundProcurementAccess): string {
  return digest([
    ADMIN_NEW_INFORMATION_GENERATION, access.enterpriseId, access.ownerUserId,
    access.actorUserId, access.adminAccountId, access.bindingVersion,
    access.actorAdminUserId, access.scope, access.teamId, access.staffTeamId, access.canReadLegacy,
    access.staffRoster.map(peer => [peer.userId, peer.adminUserId, peer.staffTeamId, peer.bindingVersion, peer.role])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  ]);
}
function factRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error("Invalid inbound facts SQL response");
  return value[0];
}

/** Bind as inventoryInboundProcedure.input(newInformationFactsInputSchema).query(...).
 * Scan has NO cursor/LIMIT/window: delayed commits and same-second records are re-observed.
 * Lookup uses exactly the same original SQL authorization predicate intersected with real PKs.
 * The outer BFF MUST retain its original current-admin/merchant/binding authorization fence. */
export function createInboundNewInformationFactsReader(deps: InboundNewInformationFactsDependencies) {
  const identityOf = deps.inboundProcurementIdentity ?? inboundProcurementIdentity;
  const resolveAccess = deps.resolveInboundProcurementAccess ?? resolveInboundProcurementAccess;
  const where = deps.inboundProcurementWhere ?? inboundProcurementWhere;
  return async (
    ctx: InboundNewInformationFactsContext,
    input: unknown = {},
  ): Promise<NewInformationFactsResult> => {
    const parsed = newInformationFactsInputSchema.parse(input);
    const identity = identityOf(ctx);
    // This feature stores read state for native admin accounts, not front-office cookies.
    if (ctx.staffDelegation?.kind !== "business_bff" || !positiveId(identity.adminAccountId)
      || !positiveId(identity.bindingVersion)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "采购入库新信息须使用当前受信后台员工身份" });
    }
    const db = await deps.getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "采购入库新信息暂不可读取" });
    try {
      return await db.transaction(async tx => {
        const access = await resolveAccess(tx, identity);
        const version = authorizationVersion(access);
        const ids = parsed.refs === undefined ? undefined
          : Array.from(new Set(parsed.refs.map(refId).filter((id): id is number => id !== null)));
        const refCondition = ids === undefined ? sql`` : ids.length
          ? sql` AND io.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})` : sql` AND FALSE`;
        const result = await tx.execute(sql`
          SELECT io.id, io.createdAt, ipo.recordedByAdminUserId
          FROM inbound_orders io
          INNER JOIN inbound_procurement_owners ipo
            ON ipo.inboundOrderId = io.id AND ipo.enterpriseId = ${access.enterpriseId}
              AND ipo.ownerUserId = io.userId
          WHERE ${where(access)} AND io.status <> 'cancelled'${refCondition}
          ORDER BY io.createdAt ASC, io.id ASC
        `);
        const items: NewInformationFact[] = [];
        const uniqueIds = new Set<number>();
        for (const row of factRows(result)) {
          const id = positiveId(row.id);
          if (!id || uniqueIds.has(id)) throw new Error("Invalid or duplicate inbound fact primary key");
          uniqueIds.add(id);
          const time = occurredAt(row.createdAt);
          // Ownership records are written atomically by the original creator, not the buyer.
          const creator = positiveId(row.recordedByAdminUserId);
          items.push({
            id: `inbound:${id}`,
            version: `created:${time}`,
            occurredAt: time,
            historical: Date.parse(time) < activation,
            ...(creator ? { actorKey: `admin:${creator}` } : {}),
          });
        }
        // The original helper reads native roster through its existing SELECT-only admin lease.
        // Reuse it for a final fail-closed recheck; never widen/copy its permission algorithm.
        const currentAccess = await resolveAccess(tx, identity);
        if (authorizationVersion(currentAccess) !== version) {
          throw new TRPCError({ code: "FORBIDDEN", message: "采购入库员工或团队授权已变化，请重新获取" });
        }
        const scope = {
          identity: `inbound:enterprise:${access.enterpriseId}:owner:${access.ownerUserId}:staff:${access.actorUserId}:admin:${access.actorAdminUserId}`,
          version: `inbound:${version}`,
          actorKey: `admin:${access.actorAdminUserId}`,
        };
        return { available: true, scope, items, snapshot: `inbound:${digest([scope, items])}` };
      }, INBOUND_NEW_INFORMATION_READ_CONFIG);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "采购入库新信息暂不可读取", cause: error });
    }
  };
}
