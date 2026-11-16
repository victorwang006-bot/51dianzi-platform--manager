import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, isNotNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { inventories, enterpriseMembers, mallInventoryPublications as publications, mallInventoryRequests as requests } from "../../drizzle/schema";
import { mallInventoryListSchema, mallInventoryMutationSchema, mallInventoryRequestIdSchema } from "../../../shared/mallInventory";
import { canonicalOfficialInventoryJson } from "../../../shared/internalBusinessOfficialInventory";
import { canPublishInventoryAvailability, MAX_INVENTORY_LADDER_TIERS } from "../../../shared/inventoryAvailability";
import { hasInventoryLeadTime } from "../../../shared/inventoryLeadTime";
import { crmProcedure, router } from "../_core/trpc";
import { clearInventorySearchCountCache, getDb, publishDraftInventoryWithGuard } from "../db";
import { requireActiveEnterpriseScope } from "../services/enterprisePermissions";
import { getInternalBusinessContext } from "../services/internalBusinessAccess";
import { officialInventoryGrantForRequest, officialInventoryTargetForRequest } from "../services/internalBusinessOfficialGrant";
import { mallEligibility, mallIdentitySql, mallPublicPolicy } from "../services/mallInventoryIdentity";
import { mallInventoryContentProofSql, mallInventoryFingerprint } from "../services/mallInventoryFingerprint";
import { assertEditableInventoryAvailability, assertOwnedPhotos, buildRow, inventoryInputSchema } from "./inventory";

function conflict(message = "商品、权限或企业上下文已变化，请刷新后重试"): never { throw new TRPCError({ code: "CONFLICT", message }); }
const mutationSchema = mallInventoryMutationSchema.extend({ expectedAuthorizationVersion: z.string().min(8).max(160) });
/** Validate real tier order without sorting or inventing thresholds/prices. */
export function mallInventoryLadderValid(value: unknown): boolean {
  let ladder = value;
  if (typeof ladder === "string") { try { ladder = JSON.parse(ladder); } catch { return false; } }
  if (ladder == null) return true;
  if (!Array.isArray(ladder) || ladder.length > MAX_INVENTORY_LADDER_TIERS) return false;
  let previous = 0;
  for (const tier of ladder) {
    if (!tier || typeof tier !== "object") return false;
    const quantity = Number(tier.minQty ?? tier.qty), price = Number(tier.price);
    if (!Number.isSafeInteger(quantity) || quantity <= previous || !Number.isFinite(price) || price <= 0) return false;
    previous = quantity;
  }
  return true;
}
const saveMutationSchema = mutationSchema.extend({ data: inventoryInputSchema.refine(data => mallInventoryLadderValid(data.ladderPrices), "阶梯数量须严格递增且不重复，单价须有效") });
const mutationResultSchema = z.object({ success: z.boolean(), inventoryId: z.number().int().positive(), version: z.number().int().nonnegative(), status: z.enum(["draft", "published", "offshelf"]), message: z.string().nullable().optional(), idempotent: z.boolean() });
const procedure = (method: string) => crmProcedure.use(async ({ ctx, next }) => {
  const grant = officialInventoryGrantForRequest(ctx.staffDelegation, `mallInventory.${method}`);
  if (!grant) throw new TRPCError({ code: "FORBIDDEN", message: "缺少商城对应独立官方权限" });
  const scope = await requireActiveEnterpriseScope(ctx.user.id);
  if (ctx.staffDelegation?.enterpriseId !== scope.enterprise.id || scope.dataOwnerUserId !== ctx.effectiveUserId) conflict();
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "数据库不可用" });
  return next({ ctx: { ...ctx, mallScope: scope, mallGrant: grant, mallDb: db } });
});
/** Reuse existing live staff/account, selected binding, ERP, team/module and server auth-version checks.
 * Remote official flags/bindingVersion are a signed 30-second lease, not a live BFF revocation protocol. */
async function currentBusinessContext(ctx: any, action: string) {
  const method = `mallInventory.${action}`;
  const grant = officialInventoryGrantForRequest(ctx.staffDelegation, method);
  const target = officialInventoryTargetForRequest(ctx.staffDelegation, method);
  if (!grant || !target) return null;
  return getInternalBusinessContext({ creditCode: target.creditCode, registrationIdentifier: target.registrationIdentifier, expectedOwnerUserId: target.expectedOwnerUserId }, {
    staffUserId: target.staffUserId, adminAccountId: target.adminAccountId, bindingVersion: target.bindingVersion, officialInventoryPermissions: grant,
  });
}
async function currentAuthority(ctx: any, action: string, expectedOfficialVersion: string, expectedBusinessVersion: string, alsoRequireWrite = false) {
  const method = `mallInventory.${action}`;
  const grant = officialInventoryGrantForRequest(ctx.staffDelegation, method);
  if (!grant || grant.authorizationVersion !== expectedOfficialVersion) return false;
  const current = await currentBusinessContext(ctx, action);
  const requirement = action === "publish" || action === "offshelf" ? "publish" : "write";
  return current != null && current.enterpriseId === ctx.mallScope.enterprise.id && current.dataOwnerUserId === ctx.mallScope.dataOwnerUserId
    && current.authorizationVersion === expectedBusinessVersion && current.officialInventoryPermissions?.read === true
    && current.officialInventoryPermissions[requirement] === true
    && (!alsoRequireWrite || current.officialInventoryPermissions.write === true)
    && Boolean(officialInventoryGrantForRequest(ctx.staffDelegation, method));
}
function sameMember(member: any, ctx: any, input: z.infer<typeof mutationSchema>) {
  return member?.status === "active" && member.permissionVersion === input.expectedPermissionVersion
    && member.role === ctx.mallScope.member.role && member.inventoryDataScope === ctx.mallScope.member.inventoryDataScope;
}
/** Real-row final checks, not form-only validation. No-price/untaxed inquiry remains publishable. */
export function mallInventoryPublishableRow(inventory: any) {
  if (!inventory || !hasInventoryLeadTime(inventory.leadTime) || !canPublishInventoryAvailability(inventory)) return false;
  if (![inventory.qtyOnSale, inventory.qtyStock].every(n => Number.isSafeInteger(n) && n >= 0) || inventory.qtyStock < inventory.qtyOnSale) return false;
  if (inventory.qtyOrder != null && (!Number.isSafeInteger(inventory.qtyOrder) || inventory.qtyOrder < 0)) return false;
  if ([inventory.moq, inventory.spq].some(n => n != null && (!Number.isSafeInteger(n) || n < 1))) return false;
  if ([inventory.priceEx, inventory.priceIncl].some(n => n != null && (!Number.isFinite(Number(n)) || Number(n) < 0))) return false;
  return mallInventoryLadderValid(inventory.ladderPrices);
}
/** One persisted pending publish is never replayed: inspect requestStatus instead. */
function mutate<TAction extends "link" | "save" | "publish" | "offshelf">(action: TAction) {
  const inputSchema = (action === "save" ? saveMutationSchema : mutationSchema) as TAction extends "save" ? typeof saveMutationSchema : typeof mutationSchema;
  return procedure(action).input(inputSchema)
    .mutation(async ({ ctx, input }) => {
      const eligibility = await mallEligibility(ctx.mallDb, ctx.mallScope.enterprise.id);
      if (!eligibility.eligible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: eligibility.message });
      const needsWrite = action === "publish" && input.expectedVersion === 0;
      const fingerprint = createHash("sha256").update(canonicalOfficialInventoryJson({ action, ...input, expectedInventoryUpdatedAt: input.expectedInventoryUpdatedAt.toISOString() })).digest("hex");
      const requestCondition = and(eq(requests.enterpriseId, ctx.mallScope.enterprise.id), eq(requests.actorUserId, ctx.user.id), eq(requests.requestId, input.requestId));
      const initial = await ctx.mallDb.transaction(async tx => {
        // Lock the exact unique actor/tenant/request key first. A prior committed or
        // in-flight request must never be called "not executed" by a later attempt.
        const replay = (await tx.select().from(requests).where(requestCondition).limit(1).for("update"))[0];
        const rejectFreshBeforeWrite = () => conflict("本次商城操作未执行：商品、权限或企业上下文已变化，请刷新后重试");
        const reject = replay ? () => conflict() : rejectFreshBeforeWrite;
        if (ctx.mallGrant.authorizationVersion !== input.expectedAuthorizationVersion || ctx.staffDelegation?.requestId !== input.requestId) reject();
        if (!await currentAuthority(ctx, action, input.expectedAuthorizationVersion, input.expectedBusinessAuthorizationVersion, needsWrite)) reject();
        const member = (await tx.select().from(enterpriseMembers).where(eq(enterpriseMembers.id, ctx.mallScope.member.id)).limit(1).for("update"))[0];
        if (!sameMember(member, ctx, input) || !officialInventoryGrantForRequest(ctx.staffDelegation, `mallInventory.${action}`)) reject();
        if (replay) {
          if (replay.fingerprint !== fingerprint) conflict("请求号已用于不同商城操作");
          if (replay.state !== "completed") conflict("原发布请求结果尚未确定，请查询requestStatus，不能重复执行");
          return { replay: replay.result!, version: 0, inventoryFingerprint: input.expectedInventoryFingerprint.toLowerCase() };
        }
        const own = !ctx.mallScope.isOwner && ctx.mallScope.member.inventoryDataScope === "own" ? eq(inventories.ownerUserId, ctx.user.id) : undefined;
        const inventory = (await tx.select().from(inventories).where(and(eq(inventories.id, input.inventoryId), eq(inventories.enterpriseId, ctx.mallScope.enterprise.id), eq(inventories.userId, ctx.mallScope.dataOwnerUserId), own, mallIdentitySql())).limit(1).for("update"))[0];
        if (!inventory) throw new TRPCError({ code: "NOT_FOUND", message: "当前范围没有该真实自营库存" });
        const confirmedFingerprint = mallInventoryFingerprint(inventory);
        if (inventory.updatedAt.getTime() !== input.expectedInventoryUpdatedAt.getTime() || inventory.ownershipVersion !== input.expectedOwnershipVersion || confirmedFingerprint !== input.expectedInventoryFingerprint.toLowerCase()) rejectFreshBeforeWrite();
        const publication = (await tx.select().from(publications).where(eq(publications.inventoryId, input.inventoryId)).limit(1).for("update"))[0];
        if ((publication?.version ?? 0) !== input.expectedVersion || publication && (publication.enterpriseId !== ctx.mallScope.enterprise.id || publication.dataOwnerUserId !== ctx.mallScope.dataOwnerUserId)) rejectFreshBeforeWrite();
        if (action !== "link" && action !== "publish" && !publication) conflict("请先选择真实库存");
        if (action === "publish" && !publication && ctx.mallGrant.write !== true) throw new TRPCError({ code: "FORBIDDEN", message: "新增商城引用仍需独立编辑权限" });
        if (action === "link" && publication) conflict("该库存已关联，请刷新");
        if (action !== "offshelf" && inventory.status === "published") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先显式下架已发布库存，再保存或发布商城物料" });
        if (action === "publish" && !mallInventoryPublishableRow(inventory)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "真实库存数量、报价或包装规则无效，请修正后重新确认" });
        const version = (publication?.version ?? 0) + 1;
        await tx.insert(requests).values({ enterpriseId: ctx.mallScope.enterprise.id, actorUserId: ctx.user.id, requestId: input.requestId, fingerprint, inventoryId: input.inventoryId });
        if (action === "link" || !publication) await tx.insert(publications).values({ inventoryId: inventory.id, enterpriseId: ctx.mallScope.enterprise.id, dataOwnerUserId: inventory.userId, updatedByUserId: ctx.user.id, version, status: "draft", confirmedContentProof: null });
        else await tx.update(publications).set({ version, status: action === "offshelf" ? "offshelf" : "draft", confirmedContentProof: null, publishedAt: null, updatedByUserId: ctx.user.id }).where(eq(publications.inventoryId, input.inventoryId));
        if (action === "save" && "data" in input) {
          const data = inventoryInputSchema.parse(input.data);
          assertEditableInventoryAvailability(inventory, data);
          assertOwnedPhotos(data.photos, ctx.mallScope.dataOwnerUserId);
          await tx.update(inventories).set({ ...buildRow(data), updatedByUserId: ctx.user.id }).where(eq(inventories.id, inventory.id));
        }
        if (action === "offshelf") await tx.update(inventories).set({ status: "offshelf", publishedAt: null, offshelfBy: "user", offshelfReason: null, updatedByUserId: ctx.user.id }).where(eq(inventories.id, inventory.id));
        if (action !== "publish") {
          const result = { success: true, inventoryId: input.inventoryId, version, status: action === "offshelf" ? "offshelf" : "draft" };
          await tx.update(requests).set({ state: "completed", result }).where(requestCondition);
          return { replay: result, version, inventoryFingerprint: confirmedFingerprint };
        }
        return { replay: null, version, inventoryFingerprint: confirmedFingerprint };
      }, { isolationLevel: "repeatable read" });
      clearInventorySearchCountCache();
      if (initial.replay) return mutationResultSchema.parse({ ...initial.replay, idempotent: initial.version === 0 });
      // Exact lease is rechecked immediately before invoking the original quota/model/availability guard.
      const authorityBeforeGuard = await currentAuthority(ctx, action, input.expectedAuthorizationVersion, input.expectedBusinessAuthorizationVersion, needsWrite).catch(() => false);
      const ownerUserId = !ctx.mallScope.isOwner && ctx.mallScope.member.inventoryDataScope === "own" ? ctx.user.id : undefined;
      const outcome = authorityBeforeGuard ? await publishDraftInventoryWithGuard(input.inventoryId, ctx.mallScope.dataOwnerUserId, ctx.mallScope.enterprise.id, undefined, ownerUserId, ctx.user.id) : { success: false, message: "商城发布授权已失效" };
      return ctx.mallDb.transaction(async tx => {
        const member = (await tx.select().from(enterpriseMembers).where(eq(enterpriseMembers.id, ctx.mallScope.member.id)).limit(1).for("update"))[0];
        const inventory = (await tx.select().from(inventories).where(and(eq(inventories.id, input.inventoryId), eq(inventories.enterpriseId, ctx.mallScope.enterprise.id), eq(inventories.userId, ctx.mallScope.dataOwnerUserId), mallIdentitySql(), ownerUserId ? eq(inventories.ownerUserId, ownerUserId) : undefined)).limit(1).for("update"))[0];
        const publication = (await tx.select().from(publications).where(eq(publications.inventoryId, input.inventoryId)).limit(1).for("update"))[0];
        const authorityAtFinalGate = await currentAuthority(ctx, action, input.expectedAuthorizationVersion, input.expectedBusinessAuthorizationVersion, needsWrite).catch(() => false);
        const accepted = outcome.success && authorityAtFinalGate && Boolean(officialInventoryGrantForRequest(ctx.staffDelegation, "mallInventory.publish")) && sameMember(member, ctx, input)
          && inventory?.status === "published" && inventory.ownershipVersion === input.expectedOwnershipVersion
          && mallInventoryFingerprint(inventory) === initial.inventoryFingerprint && mallInventoryPublishableRow(inventory)
          && publication?.version === initial.version && publication.enterpriseId === ctx.mallScope.enterprise.id && publication.dataOwnerUserId === ctx.mallScope.dataOwnerUserId;
        if (accepted) await tx.update(publications).set({ status: "published", publishedAt: new Date(), confirmedContentProof: sql`(SELECT ${mallInventoryContentProofSql()} FROM ${inventories} WHERE ${inventories.id} = ${input.inventoryId})` }).where(eq(publications.inventoryId, input.inventoryId));
        const result = { success: Boolean(accepted), inventoryId: input.inventoryId, version: publication?.version ?? initial.version, status: accepted ? "published" : publication?.status ?? "draft", message: accepted ? null : outcome.message ?? "发布期间内容或授权已变化，商城保持未上架" };
        await tx.update(requests).set({ state: "completed", result }).where(requestCondition);
        clearInventorySearchCountCache();
        return mutationResultSchema.parse({ ...result, idempotent: false });
      });
    });
}
export const mallInventoryRouter = router({
  status: procedure("status").query(async ({ ctx }) => {
    const current = await currentBusinessContext(ctx, "status");
    if (!current || current.enterpriseId !== ctx.mallScope.enterprise.id || current.dataOwnerUserId !== ctx.mallScope.dataOwnerUserId || current.officialInventoryPermissions?.read !== true) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前商城企业业务权限已变化，请重新核验" });
    }
    return { eligibility: await mallEligibility(ctx.mallDb, ctx.mallScope.enterprise.id),
      permissions: { view: ctx.mallGrant.read === true && current.officialInventoryPermissions.read === true,
        write: ctx.mallGrant.write === true && current.officialInventoryPermissions.write === true,
        publish: ctx.mallGrant.publish === true && current.officialInventoryPermissions.publish === true },
      context: { enterpriseId: ctx.mallScope.enterprise.id, permissionVersion: ctx.mallScope.member.permissionVersion,
        authorizationVersion: ctx.mallGrant.authorizationVersion, businessAuthorizationVersion: current.authorizationVersion } };
  }),
  list: procedure("list").input(mallInventoryListSchema).query(async ({ ctx, input }) => {
    const eligibility = await mallEligibility(ctx.mallDb, ctx.mallScope.enterprise.id);
    if (!eligibility.eligible) return { items: [], total: 0, page: input.page, pageSize: input.pageSize, eligibility };
    const policy = await mallPublicPolicy(ctx.mallDb);
    const own = !ctx.mallScope.isOwner && ctx.mallScope.member.inventoryDataScope === "own" ? eq(inventories.ownerUserId, ctx.user.id) : undefined;
    const visibility = input.visibility === "unlinked" ? isNull(publications.inventoryId) : input.visibility === "linked" ? and(isNotNull(publications.inventoryId), eq(publications.enterpriseId, ctx.mallScope.enterprise.id), eq(publications.dataOwnerUserId, ctx.mallScope.dataOwnerUserId)) : undefined;
    const where = and(mallIdentitySql(), eq(inventories.enterpriseId, ctx.mallScope.enterprise.id), own, visibility, input.inventoryId ? eq(inventories.id, input.inventoryId) : undefined, input.status ? eq(publications.status, input.status) : undefined, input.partNumber ? like(inventories.partNumber, `%${input.partNumber}%`) : undefined, input.brand ? like(inventories.brand, `%${input.brand}%`) : undefined);
    const rows = await ctx.mallDb.select({ inventory: inventories, publication: publications, isSelfOperated: policy.self }).from(inventories).leftJoin(publications, eq(publications.inventoryId, inventories.id)).where(where).orderBy(desc(inventories.updatedAt), desc(inventories.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
    const counts = await ctx.mallDb.select({ count: sql<number>`COUNT(*)` }).from(inventories).leftJoin(publications, eq(publications.inventoryId, inventories.id)).where(where);
    return { items: rows.map(({ inventory, publication, isSelfOperated }) => ({ ...inventory, inventoryId: inventory.id, linked: Boolean(publication), publicationVersion: publication?.version ?? 0, publicationStatus: publication?.status ?? null, inventoryUpdatedAt: inventory.updatedAt, inventoryFingerprint: mallInventoryFingerprint(inventory), isSelfOperated: Boolean(isSelfOperated) })), total: Number(counts[0]?.count ?? 0), page: input.page, pageSize: input.pageSize, eligibility };
  }),
  link: mutate("link"), save: mutate("save"), publish: mutate("publish"), offshelf: mutate("offshelf"),
  requestStatus: procedure("requestStatus").input(z.object({ requestId: mallInventoryRequestIdSchema })).query(async ({ ctx, input }) => {
    const eligibility = await mallEligibility(ctx.mallDb, ctx.mallScope.enterprise.id);
    if (eligibility.code === "SCHEMA_NOT_READY") return { state: "unavailable", result: null };
    const request = (await ctx.mallDb.select({ state: requests.state, result: requests.result }).from(requests).where(and(eq(requests.enterpriseId, ctx.mallScope.enterprise.id), eq(requests.actorUserId, ctx.user.id), eq(requests.requestId, input.requestId))).limit(1))[0];
    return request ?? { state: "not_found", result: null };
  }),
});
