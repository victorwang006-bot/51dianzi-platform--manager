import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { businessFailureOf } from "../../../shared/businessFailure";
import { businessIndustryCodeSchema } from "../../../shared/businessIndustry";
import { createCustomerUploadBatchSchema, type CreateCustomerUploadBatchInput, createCustomerMaterialSchema, customerSupplyContextSchema, customerSupplySummarySchema, type CreateCustomerMaterialInput, type CustomerSupplyContextInput, type CustomerSupplySummaryInput } from "../../../shared/customerSupply";
import { ChannelInventoryError, createChannelInventoryService, resolveChannelInventoryAuthority, trustedCustomerCreationContext, type ChannelInventoryType, type ChannelInventoryScope, type ChannelInventoryServiceDependencies, type SqlExecutor, type SqlResultRow, type SqlDatabase } from "./channelInventory";
import { crmCustomerPolicyWhere, resolveCrmCustomerPolicy, assertCrmCustomerPolicy } from "./crmCustomers";
import { currentReadExecutor, readCustomerPrimaryContact, resolveCustomerSupplyReadPolicy, customerSupplyCompletion as completion, linkedCompanyReadGate } from "./customerSupplyCompany";
import { resolveTeamInventoryVisibility, TEAM_MATERIAL_FROM, teamInventoryAll } from "./channelTeamInventoryAccess";
import { teamMaterialSourceEligibility } from "./channelInventorySource";
import { createChannelInventoryManagementService } from "./channelInventoryManagement";
const rows = (r: unknown): SqlResultRow[] => Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) as SqlResultRow[] : [];
const fail = (code: ConstructorParameters<typeof ChannelInventoryError>[0], message: string): never => { throw new ChannelInventoryError(code, message); };
function expected(scope: ChannelInventoryScope, input: { expectedEnterpriseId: number; expectedActorUserId: number }) {
  if (input.expectedEnterpriseId !== scope.enterpriseId || input.expectedActorUserId !== scope.actorUserId) fail("FORBIDDEN", "企业或账号上下文不匹配，请刷新后重试");
}
async function customer(tx: SqlExecutor, scope: ChannelInventoryScope, id: number): Promise<SqlResultRow> {
  const policy = await resolveCustomerSupplyReadPolicy(tx, scope);
  const found = rows(await tx.execute(sql`SELECT sc.id, sc.name, sc.industryCode, sc.version, sc.archivedAt
    FROM crm_customers sc
    WHERE sc.id = ${id} AND ${crmCustomerPolicyWhere(scope, policy, "sc")} LIMIT 1 FOR UPDATE`))[0];
  if (!found) fail("NOT_FOUND", "客户不存在或无权访问");
  return { ...found, ...await readCustomerPrimaryContact(tx, scope, id) };
}
async function binding(tx: SqlExecutor, scope: ChannelInventoryScope, customerId: number) {
  return rows(await tx.execute(sql`SELECT channelId FROM crm_customer_supply_channels WHERE enterpriseId = ${scope.enterpriseId}
    AND dataOwnerUserId = ${scope.dataOwnerUserId} AND customerId = ${customerId}
    AND inventoryResponsibleUserId = ${scope.actorUserId} LIMIT 1 FOR UPDATE`))[0] ?? null;
}
/** Preserve original own-write and creation-team boundaries, including on retries. */
async function writeFence(tx: SqlExecutor, scope: ChannelInventoryScope, channelId?: number) {
  await resolveChannelInventoryAuthority(currentReadExecutor(tx), scope, "channels", true, true);
  await resolveChannelInventoryAuthority(currentReadExecutor(tx), scope, "stocks", true, true);
  const members = rows(await tx.execute(sql`SELECT tm.id, tm.teamId FROM enterprise_team_members tm
    INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
    WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId} AND tm.teamRole IN ('leader', 'member') FOR UPDATE`));
  if (members.length !== 1) fail("PRECONDITION_FAILED", "请先加入当前唯一有效业务团队，再上传供应库存");
  if (channelId !== undefined) {
    const found = rows(await tx.execute(sql`SELECT c.id, c.active, c.channel_type AS type, a.teamId, a.currentOwnerUserId, a.revision
      FROM channel_inventory_channels c LEFT JOIN enterprise_team_record_assignments a
        ON a.enterpriseId = c.enterprise_id AND a.recordType = 'channel' AND a.recordId = c.id
      WHERE c.id = ${channelId} AND c.enterprise_id = ${scope.enterpriseId} AND c.data_owner_user_id = ${scope.dataOwnerUserId}
        AND c.responsible_user_id = ${scope.actorUserId} LIMIT 1 FOR UPDATE`))[0];
    if (!found) fail("NOT_FOUND", "渠道不存在或无权访问");
    if (!(found.active === 1 || found.active === true || found.active === "1")) fail("PRECONDITION_FAILED", "渠道已停用，不能上传供应库存");
    if (Number(found.currentOwnerUserId) !== scope.actorUserId || Number(found.teamId) !== Number(members[0].teamId) || Number(found.revision) < 1) fail("PRECONDITION_FAILED", "渠道团队归属已变化，请刷新并选择当前团队渠道");
    return found;
  }
  return null;
}
export function createCustomerSupplyService(deps: ChannelInventoryServiceDependencies) {
  async function database(): Promise<SqlDatabase> { const db = await deps.getDb(); if (!db) return fail("SERVICE_UNAVAILABLE", "客户供应库存结构尚未就绪"); return db; }
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) {
      if (error instanceof ChannelInventoryError || error instanceof TRPCError) throw error;
      return fail("SERVICE_UNAVAILABLE", "客户供应库存操作未确认成功，请保留请求号并刷新重试");
    }
  }
  async function context(tx: SqlExecutor, scope: ChannelInventoryScope, input: CustomerSupplyContextInput) {
    let visibility: Awaited<ReturnType<typeof resolveTeamInventoryVisibility>> | null = null;
    try { visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true }); }
    catch (error) { if (businessFailureOf(error) || !((error instanceof ChannelInventoryError || error instanceof TRPCError) && error.code === "FORBIDDEN")) throw error; }
    const c = await customer(tx, scope, input.customerId);
    const link = await binding(tx, scope, input.customerId);
    let disabledReason = completion(c);
    let channel: { id: number; name: string; type: string; industryCode: string | null; active: boolean; revision: number } | null = null;
    if (link) {
      // CRM visibility and stock write NEVER infer original source-read eligibility.
      const raw = visibility ? rows(await tx.execute(sql`SELECT c.id, c.channel_type AS type, c.active, c.revision ${TEAM_MATERIAL_FROM}
        WHERE ${teamInventoryAll([...visibility.predicates, sql`c.id = ${Number(link.channelId)}`, sql`c.responsible_user_id = ${scope.actorUserId}`,
          teamMaterialSourceEligibility(scope, true), await linkedCompanyReadGate(tx, scope)])} LIMIT 1 FOR UPDATE`))[0] : null;
      if (raw) channel = { id: Number(raw.id), name: String(c.name), type: String(raw.type), industryCode: c.industryCode == null ? null : String(c.industryCode), active: raw.active === 1 || raw.active === true || raw.active === "1", revision: Number(raw.revision) };
      else disabledReason ??= "暂无权限读取关联库存来源，请联系有权人员确认";
    }
    try {
      await assertCrmCustomerPolicy(currentReadExecutor(tx), scope, input.customerId,
        await resolveCrmCustomerPolicy(currentReadExecutor(tx), scope, true), true);
      await writeFence(tx, scope, link ? Number(link.channelId) : undefined);
    }
    catch (error) {
      if (!businessFailureOf(error) && (error instanceof ChannelInventoryError || error instanceof TRPCError) && ["FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED"].includes(error.code)) disabledReason ??= error.message;
      else throw error;
    }
    return { customer: { id: Number(c.id), name: String(c.name), industryCode: c.industryCode == null ? null : String(c.industryCode), version: Number(c.version), contactName: c.contactName == null ? null : String(c.contactName), phone: c.phone == null ? null : String(c.phone), archivedAt: c.archivedAt as Date | string | null }, channel, canUpload: disabledReason === null, disabledReason };
  }
  async function source(tx: SqlExecutor, scope: ChannelInventoryScope, c: SqlResultRow, input: CreateCustomerMaterialInput | CreateCustomerUploadBatchInput) {
    // Locked version equality is the customer CAS; no customer DML, contact copy
    // writeback or unrelated version bump is permitted by this upload workflow.
    let link = await binding(tx, scope, input.customerId);
    // This adapter joins the TRUE outer transaction, never a nested commit.
    const adapter: SqlDatabase = { execute: q => tx.execute(q), transaction: fn => fn(tx) };
    const inventory = createChannelInventoryService({ getDb: async () => adapter, registerTeamRecord: deps.registerTeamRecord });
    if (!link) {
      const sourceProfile = input.sourceProfile;
      if (!sourceProfile) return fail("PRECONDITION_FAILED", "首次上传请明确确认渠道类型，或选择已有渠道");
      let channelId = sourceProfile.existingChannelId;
      if (channelId !== undefined) {
        const chosen = await writeFence(tx, scope, channelId);
        if (chosen?.type !== sourceProfile.type) fail("CONFLICT", "所选渠道类型已变化，请刷新确认");
        const occupied = rows(await tx.execute(sql`SELECT customerId FROM crm_customer_supply_channels
          WHERE enterpriseId = ${scope.enterpriseId} AND dataOwnerUserId = ${scope.dataOwnerUserId} AND channelId = ${channelId} LIMIT 1 FOR UPDATE`))[0];
        if (occupied) fail("CONFLICT", "所选渠道已关联客户，不能重复绑定");
      } else {
        channelId = (await inventory.createChannel(scope, { name: String(c.name), industryCode: businessIndustryCodeSchema.parse(c.industryCode), type: sourceProfile.type,
          contactName: null, phone: null, wechat: null, qq: null, notes: null, active: true, requestId: input.requestId })).item.id;
      }
      await tx.execute(sql`INSERT INTO crm_customer_supply_channels
        (enterpriseId, dataOwnerUserId, customerId, inventoryResponsibleUserId, channelId, customerVersionAtBind, firstRequestId, schemaVersion)
        VALUES (${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${input.customerId}, ${scope.actorUserId}, ${channelId}, ${input.expectedCustomerVersion}, ${input.requestId}, 1)`);
      link = { channelId };
    }
    const channelId = Number(link.channelId);
    if (input.sourceProfile?.existingChannelId !== undefined && input.sourceProfile.existingChannelId !== channelId) fail("CONFLICT", "客户已有供应渠道，不能改绑其他渠道");
    const boundChannel = await writeFence(tx, scope, channelId);
    if ("expectedChannelRevision" in input && input.expectedChannelRevision !== undefined && Number(boundChannel!.revision) !== input.expectedChannelRevision)
      fail("CONFLICT", "客户供应渠道版本已变化，请刷新确认");
    const sourceType = String(boundChannel!.type) as ChannelInventoryType;
    if (input.sourceProfile && input.sourceProfile.type !== sourceType) fail("CONFLICT", "客户关联渠道类型不匹配，请刷新确认");
    return { channelId, inventory, sourceType, adapter };
  }
  return {
    async createCustomerUploadBatch(scope: ChannelInventoryScope, raw: CreateCustomerUploadBatchInput) {
      const input = createCustomerUploadBatchSchema.parse(raw); expected(scope, input);
      return guarded(async () => (await database()).transaction(async transaction => {
        const tx = currentReadExecutor(transaction);
        await writeFence(tx, scope);
        const c = await customer(tx, scope, input.customerId);
        await assertCrmCustomerPolicy(currentReadExecutor(tx), scope, input.customerId,
          await resolveCrmCustomerPolicy(currentReadExecutor(tx), scope, true), true);
        if (Number(c.version) !== input.expectedCustomerVersion) fail("CONFLICT", "客户档案已变化，请刷新后重试");
        const reason = completion(c); if (reason) fail("PRECONDITION_FAILED", reason);
        const priorLink = await binding(tx, scope, input.customerId);
        if (input.expectedChannelId !== undefined && Number(priorLink?.channelId) !== input.expectedChannelId)
          fail("CONFLICT", "客户供应渠道已变化，请刷新确认");
        const { channelId, adapter } = await source(tx, scope, c, input);
        // Existing batch request persistence supplies replay/hash/membership/receipt fences.
        // Both source creation and batch creation join this true outer transaction.
        const batch = await createChannelInventoryManagementService({ getDb: async () => adapter }).createUploadBatch(scope,
          { expectedEnterpriseId: input.expectedEnterpriseId, expectedActorUserId: input.expectedActorUserId,
            channelId, fileName: input.fileName, totalRows: input.totalRows, requestId: input.requestId });
        return { ...batch, channelId, customerId: input.customerId };
      }));
    },
    async customerSupplyContext(scope: ChannelInventoryScope, raw: CustomerSupplyContextInput) {
      const input = customerSupplyContextSchema.parse(raw); expected(scope, input);
      return guarded(async () => (await database()).transaction(tx => context(tx, scope, input)));
    },
    async customerSupplySummary(scope: ChannelInventoryScope, raw: CustomerSupplySummaryInput) {
      const input = customerSupplySummarySchema.parse(raw); expected(scope, input);
      return guarded(async () => (await database()).transaction(async tx => {
        const items: { customerId: number; channelId: number | null; materialCount: number; canUpload: boolean; canViewStock: boolean; disabledReason: string | null }[] = [];
        // Resolve membership / data-owner first, then CRM policy. A stocks read deny
        // only disables inventory, never leaks channel IDs/counts or hidden customers.
        let visibility: Awaited<ReturnType<typeof resolveTeamInventoryVisibility>> | null = null;
        try { visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true }); }
        catch (error) { if (businessFailureOf(error) || !((error instanceof ChannelInventoryError || error instanceof TRPCError) && error.code === "FORBIDDEN")) throw error; }
        await resolveCustomerSupplyReadPolicy(tx, scope);
        for (const customerId of Array.from(new Set(input.customerIds))) {
          let result;
          try { result = await context(tx, scope, { ...input, customerId }); }
          catch (error) { if ((error instanceof ChannelInventoryError || error instanceof TRPCError) && error.code === "NOT_FOUND") continue; throw error; }
          const channelId = result.channel?.id ?? null;
          const materialCount = channelId && visibility ? Number(rows(await tx.execute(sql`SELECT COUNT(*) AS total ${TEAM_MATERIAL_FROM}
            WHERE ${teamInventoryAll([...visibility.predicates, sql`c.id = ${channelId}`, teamMaterialSourceEligibility(scope, true)])} FOR UPDATE`))[0]?.total ?? 0) : 0;
          items.push({ customerId, channelId: materialCount > 0 ? channelId : null, materialCount, canUpload: result.canUpload, canViewStock: materialCount > 0, disabledReason: result.disabledReason });
        }
        return { items, canWrite: items.some(item => item.canUpload) };
      }));
    },
    async createCustomerMaterial(scope: ChannelInventoryScope, raw: CreateCustomerMaterialInput) {
      const input = createCustomerMaterialSchema.parse(raw); expected(scope, input);
      return guarded(async () => (await database()).transaction(async transaction => {
        const tx = currentReadExecutor(transaction);
        // Keep enterprise/member/module/team lock order ahead of customer business rows.
        await writeFence(tx, scope);
        const c = await customer(tx, scope, input.customerId);
        await assertCrmCustomerPolicy(currentReadExecutor(tx), scope, input.customerId,
          await resolveCrmCustomerPolicy(currentReadExecutor(tx), scope, true), true);
        if (Number(c.version) !== input.expectedCustomerVersion) fail("CONFLICT", "客户档案已变化，请刷新后重试");
        const reason = completion(c); if (reason) fail("PRECONDITION_FAILED", reason);
        const { channelId, inventory, sourceType } = await source(tx, scope, c, input);
        const { partNumber, brand, qty, dateCode, price, currency, taxIncluded, leadTime, note, requestId, uploadBatchId } = input;
        const receipt = await inventory.createMaterial(scope, { channelId, partNumber, brand, qty, dateCode, price, currency, taxIncluded, leadTime, note, requestId, ...(uploadBatchId === undefined ? {} : { uploadBatchId }) },
          trustedCustomerCreationContext({ customerId: input.customerId, expectedCustomerVersion: input.expectedCustomerVersion, sourceType }));
        return { ...receipt, channelId, customerId: input.customerId };
      }));
    },
  };
}
