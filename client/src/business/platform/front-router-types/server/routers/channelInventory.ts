import { createChannelInventoryManagementService } from "../services/channelInventoryManagement";
import { createChannelFactoryPublicationService } from "../services/channelFactoryPublication";
import { publishFactoryMaterialInputSchema, previewFactoryMaterialReceptionInputSchema } from "../../../shared/channelFactoryPublication";
import * as managementSchemas from "../../../shared/channelInventoryManagement";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { businessIndustryCodeSchema } from "../../../shared/businessIndustry";
import { createCustomerUploadBatchSchema, channelMaterialCreateFields, customerSupplySummarySchema, customerSupplyContextSchema, createCustomerMaterialSchema } from "../../../shared/customerSupply";
import { createCustomerSupplyService } from "../services/customerSupply";
import { getDb } from "../db";
import { createChannelInventoryCollaborationService } from "../services/channelInventoryCollaboration";
import { createChannelInventorySourceService, SOURCE_FORBIDDEN_MESSAGE } from "../services/channelInventorySource";
import { teamMaterialSourceSchema } from "../../../shared/channelInventorySource";
import { teamMaterialForEditSchema, teamMaterialUpdateSchema, collaborationNotesListSchema, collaborationNotesAddSchema, collaborationNotesEditSchema } from "../../../shared/channelInventoryCollaboration";
import { createChannelTeamInventoryService } from "../services/channelTeamInventory";
import { createChannelInventoryExportService } from "../services/channelInventoryExport";
import { protectedProcedure, router } from "../_core/trpc";
import { requireCrmEnterpriseAccess } from "../services/enterpriseAccess";
import { requireActiveEnterpriseScope, requireEnterprisePermission } from "../services/enterprisePermissions";
import { officialInventoryGrantForDelegation, officialInventoryGrantForRequest, officialInventoryErpEntitled } from "../services/internalBusinessOfficialGrant";
import {
  CHANNEL_INVENTORY_TYPES,
  ChannelInventoryError,
  createChannelInventoryService,
  type ChannelInventoryScope,
  type ChannelInventoryType,
  type RegisterTeamRecord,
} from "../services/channelInventory";
import {
  ChannelNotesError,
  createChannelNotesService,
} from "../services/channelInventoryNotes";

const channelTypes = z.enum(CHANNEL_INVENTORY_TYPES);
const positiveInt = z.number().int().safe().positive();
const expectedContextSchema = {
  expectedEnterpriseId: positiveInt.optional(),
  expectedActorUserId: positiveInt.optional(),
};
const nullableOptional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const pageSchema = z.number().int().safe().min(1).max(1_000_000).default(1);
const pageSizeSchema = z.number().int().safe().min(1).max(100).default(20);
const priceSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/, "价格格式无效");

const channelCreateFields = {
  industryCode: businessIndustryCodeSchema,
  name: z.string().trim().min(1, "请输入渠道名称").max(128),
  type: channelTypes,
  contactName: z.string().trim().max(64).nullable().optional().transform(value => value ?? null),
  phone: z.string().trim().max(32).nullable().optional().transform(value => value ?? null),
  wechat: z.string().trim().max(64).nullable().optional().transform(value => value ?? null),
  qq: z.string().trim().max(32).nullable().optional().transform(value => value ?? null),
  notes: z.string().max(2_000).nullable().optional().transform(value => value ?? null),
  active: z.boolean().default(true),
};
const channelUpdateFields = {
  industryCode: businessIndustryCodeSchema.optional(),
  name: z.string().trim().min(1, "请输入渠道名称").max(128).optional(),
  type: channelTypes.optional(),
  contactName: nullableOptional(z.string().trim().max(64)),
  phone: nullableOptional(z.string().trim().max(32)),
  wechat: nullableOptional(z.string().trim().max(64)),
  qq: nullableOptional(z.string().trim().max(32)),
  notes: nullableOptional(z.string().max(2_000)),
};
const materialCreateFields = {
  channelId: positiveInt,
  uploadBatchId: positiveInt.optional(),
  ...channelMaterialCreateFields,
};
const materialUpdateFields = {
  channelId: positiveInt.optional(),
  partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().min(1, "请输入型号").max(128)).optional(),
  brand: z.string().trim().min(1, "请输入品牌").max(64).optional(),
  qty: z.number().int().safe().min(0).max(2_147_483_647).nullable().optional(),
  dateCode: nullableOptional(z.string().trim().max(32)),
  price: nullableOptional(priceSchema),
  currency: z.literal("CNY").optional(),
  taxIncluded: z.boolean().nullable().optional(),
  leadTime: nullableOptional(z.string().trim().max(64)),
  note: nullableOptional(z.string().max(2_000)),
};
const channelUpdateKeys = Object.keys(channelUpdateFields) as (keyof typeof channelUpdateFields)[];
const materialUpdateKeys = Object.keys(materialUpdateFields) as (keyof typeof materialUpdateFields)[];

type AuthoritativeChannelContext = {
  user: { id: number };
  staffDelegation?: import("../_core/context").StaffDelegation;
  enterprisePermissionScope: {
    enterprise: { id: number };
    dataOwnerUserId: number;
    isOwner: boolean;
    member: { inventoryDataScope: "own" | "enterprise" };
    permissionKeys: readonly string[];
  };
};

type ContextAssertionInput = {
  expectedEnterpriseId?: number;
  expectedActorUserId?: number;
};

function scopeFromContext(ctx: AuthoritativeChannelContext): ChannelInventoryScope {
  const permissionScope = ctx.enterprisePermissionScope;
  return {
    enterpriseId: permissionScope.enterprise.id,
    dataOwnerUserId: permissionScope.dataOwnerUserId,
    actorUserId: ctx.user.id,
    ...(ctx.staffDelegation ? { officialActor: { adminAccountId: ctx.staffDelegation.adminAccountId, bindingVersion: ctx.staffDelegation.bindingVersion, requestId: ctx.staffDelegation.requestId, inventoryPermissions: officialInventoryGrantForDelegation(ctx.staffDelegation) } } : {}),
    isOwner: permissionScope.isOwner,
    inventoryDataScope: permissionScope.member.inventoryDataScope,
    permissionSnapshot: permissionScope.isOwner || permissionScope.permissionKeys.includes("inventory.manage"),
  };
}

function assertExpectedContext(ctx: AuthoritativeChannelContext, input: ContextAssertionInput): void {
  if (input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== ctx.enterprisePermissionScope.enterprise.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业上下文不匹配，请刷新后重试" });
  }
  if (input.expectedActorUserId !== undefined && input.expectedActorUserId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不匹配，请重新登录" });
  }
}

function asTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ChannelInventoryError || error instanceof ChannelNotesError) {
    throw new TRPCError({ code: error.code, message: error.message, cause: error });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "渠道库存服务暂不可用，请稍后重试" });
}

/**
 * Parent integration must register this result as `channelInventory` in the root
 * AppRouter. `registerTeamRecord` must come from the real team-business runtime;
 * using a no-op would break creator/current-owner and shared-note scope rules.
 */
export function createChannelInventoryRouter(registerTeamRecord: RegisterTeamRecord) {
  function inventoryProcedure(management: boolean) {
    return protectedProcedure.use(async ({ ctx, next, path }) => {
      // Caller path may be root-prefixed or a local createCaller path. Namespace
      // is fixed by this router, never selected from browser input.
      const method = `channelInventory.${path.split(".").at(-1)}`;
      const proof = officialInventoryGrantForRequest(ctx.staffDelegation, method);
      if (ctx.staffDelegation && !proof) throw new TRPCError({ code: "FORBIDDEN", message: "渠道库存受信动作授权无效" });
      if (ctx.staffDelegation && !officialInventoryErpEntitled(method, proof, "inventory.manage")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "未获渠道库存对应官方管理资格" });
      }
      const crm = await requireCrmEnterpriseAccess({ user: ctx.user });
      const permissionScope = ctx.staffDelegation
        ? await requireActiveEnterpriseScope(ctx.user.id)
        : await requireEnterprisePermission(ctx.user.id, "inventory.manage");
      if (permissionScope.dataOwnerUserId !== crm.dataOwnerUserId) throw new TRPCError({ code: "CONFLICT", message: "企业数据归属已变化，请重新登录" });
      // Preserve each native middleware's existing effective-user projection.
      return next({ ctx: { ...ctx, ...(management ? { effectiveUserId: crm.dataOwnerUserId, enterprisePermission: "inventory.manage" as const } : {}), enterprisePermissionScope: permissionScope } });
    });
  }
  const procedure = inventoryProcedure(true);
  const readProcedure = inventoryProcedure(false);
  const publishProcedure = protectedProcedure.use(async ({ ctx, next, path }) => {
    const proof = officialInventoryGrantForRequest(ctx.staffDelegation, `channelInventory.${path.split(".").at(-1)}`);
    if (proof?.read !== true || proof.publish !== true) throw new TRPCError({ code: "FORBIDDEN", message: "未获明确的官方库存发布权限" });
    const crm = await requireCrmEnterpriseAccess({ user: ctx.user });
    const permissionScope = await requireActiveEnterpriseScope(ctx.user.id);
    if (permissionScope.dataOwnerUserId !== crm.dataOwnerUserId) throw new TRPCError({ code: "CONFLICT", message: "企业数据归属已变化，请重新登录" });
    return next({ ctx: { ...ctx, enterprisePermissionScope: permissionScope } });
  });
  const service = createChannelInventoryService({ getDb, registerTeamRecord });
  const notes = createChannelNotesService({ getDb });
  const team = createChannelTeamInventoryService({ getDb });
  const exporter = createChannelInventoryExportService({ getDb });
  const collaboration = createChannelInventoryCollaborationService({ getDb });
  const source = createChannelInventorySourceService({ getDb });
  const management = createChannelInventoryManagementService({ getDb });
  const supply = createCustomerSupplyService({ getDb, registerTeamRecord });
  const publication = createChannelFactoryPublicationService({ getDb });

  return router({
    previewFactoryMaterialReception: publishProcedure.input(previewFactoryMaterialReceptionInputSchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await publication.previewFactoryMaterialReception(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    publishFactoryMaterial: publishProcedure.input(publishFactoryMaterialInputSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await publication.publishFactoryMaterial(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    deleteMaterials: procedure.input(managementSchemas.deleteMaterialsSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.deleteMaterials(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    listDeletedMaterials: readProcedure.input(managementSchemas.listDeletedMaterialsSchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.listDeletedMaterials(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    restoreMaterial: procedure.input(managementSchemas.restoreMaterialSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.restoreMaterial(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    createUploadBatch: procedure.input(managementSchemas.createUploadBatchSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.createUploadBatch(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    listUploadBatches: readProcedure.input(managementSchemas.listUploadBatchesSchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.listUploadBatches(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    updateUploadBatch: procedure.input(managementSchemas.updateUploadBatchSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.updateUploadBatch(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    previewDeleteUploadBatch: procedure.input(managementSchemas.previewDeleteUploadBatchSchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.previewDeleteUploadBatch(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    deleteUploadBatch: procedure.input(managementSchemas.deleteUploadBatchSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await management.deleteUploadBatch(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    customerSupplySummary: readProcedure.input(customerSupplySummarySchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await supply.customerSupplySummary(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    customerSupplyContext: readProcedure.input(customerSupplyContextSchema).query(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await supply.customerSupplyContext(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    createCustomerUploadBatch: procedure.input(createCustomerUploadBatchSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await supply.createCustomerUploadBatch(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    createCustomerMaterial: procedure.input(createCustomerMaterialSchema).mutation(async ({ ctx, input }) => {
      try { assertExpectedContext(ctx, input); return await supply.createCustomerMaterial(scopeFromContext(ctx), input); }
      catch (error) { return asTrpcError(error); }
    }),
    getTeamMaterialSource: readProcedure.input(teamMaterialSourceSchema).query(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await source.getTeamMaterialSource(scopeFromContext(ctx), input);
      } catch (error) {
        if (error instanceof TRPCError && error.code === "FORBIDDEN") throw new TRPCError({ code: "FORBIDDEN", message: SOURCE_FORBIDDEN_MESSAGE, cause: error });
        return asTrpcError(error);
      }
    }),
    getTeamMaterialForEdit: procedure.input(teamMaterialForEditSchema).query(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await collaboration.getTeamMaterialForEdit(scopeFromContext(ctx), input);
      } catch (error) { return asTrpcError(error); }
    }),
    updateTeamMaterial: procedure.input(teamMaterialUpdateSchema).mutation(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await collaboration.updateTeamMaterial(scopeFromContext(ctx), input);
      } catch (error) { return asTrpcError(error); }
    }),
    collaborationNotesList: readProcedure.input(collaborationNotesListSchema).query(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await collaboration.collaborationNotesList(scopeFromContext(ctx), input);
      } catch (error) { return asTrpcError(error); }
    }),
    collaborationNotesAdd: readProcedure.input(collaborationNotesAddSchema).mutation(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await collaboration.collaborationNotesAdd(scopeFromContext(ctx), input);
      } catch (error) { return asTrpcError(error); }
    }),
    collaborationNotesEdit: readProcedure.input(collaborationNotesEditSchema).mutation(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await collaboration.collaborationNotesEdit(scopeFromContext(ctx), input);
      } catch (error) { return asTrpcError(error); }
    }),
    exportChannelMaterials: procedure
      .input(z.object({ channelId: positiveInt, expectedEnterpriseId: positiveInt, expectedActorUserId: positiveInt }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await exporter.exportChannelMaterials(scopeFromContext(ctx), input);
        } catch (error) { return asTrpcError(error); }
      }),
    listTeamMaterials: readProcedure
      .input(z.object({ ...expectedContextSchema, channelId: positiveInt.optional(), uploadBatchId: positiveInt.optional(), industryCode: z.union([businessIndustryCodeSchema, z.literal("unset")]).optional(), partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().max(128)).optional(), brand: z.string().trim().max(64).optional(), page: pageSchema, pageSize: pageSizeSchema, sortBy: z.enum(["qty", "dateCode"]).optional(), sortDirection: z.enum(["asc", "desc"]).optional() }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await team.listTeamMaterials(scopeFromContext(ctx), input);
        } catch (error) { return asTrpcError(error); }
      }),
    listTeamSourceOptions: readProcedure
      .input(z.object({ ...expectedContextSchema }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await team.listTeamSourceOptions(scopeFromContext(ctx), input);
        } catch (error) { return asTrpcError(error); }
      }),
    listChannels: readProcedure
      .input(z.object({ ...expectedContextSchema, name: z.string().trim().max(128).optional(), type: channelTypes.optional(), active: z.boolean().optional(), page: pageSchema, pageSize: pageSizeSchema }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await service.listChannels(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    getChannel: readProcedure.input(z.object({ ...expectedContextSchema, id: positiveInt }).strict()).query(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await service.getChannel(scopeFromContext(ctx), input.id);
      } catch (error) {
        return asTrpcError(error);
      }
    }),
    createChannel: procedure
      .input(z.object({ ...expectedContextSchema, ...channelCreateFields, requestId: z.string().uuid("请求号无效") }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          const { expectedEnterpriseId: _enterprise, expectedActorUserId: _actor, ...data } = input;
          return await service.createChannel(scopeFromContext(ctx), data);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    updateChannel: procedure
      .input(z.object({ ...expectedContextSchema, id: positiveInt, expectedRevision: positiveInt, ...channelUpdateFields }).strict().refine(input => channelUpdateKeys.some(key => input[key] !== undefined), { message: "请至少提供一个要更新的渠道字段" }))
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          const { expectedEnterpriseId: _enterprise, expectedActorUserId: _actor, ...data } = input;
          return await service.updateChannel(scopeFromContext(ctx), data);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    setChannelActive: procedure
      .input(z.object({ ...expectedContextSchema, id: positiveInt, active: z.boolean(), expectedRevision: positiveInt }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          const { expectedEnterpriseId: _enterprise, expectedActorUserId: _actor, ...data } = input;
          return await service.setChannelActive(scopeFromContext(ctx), data);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    listMaterials: procedure
      .input(z.object({ ...expectedContextSchema, channelId: positiveInt.optional(), partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().max(128)).optional(), brand: z.string().trim().max(64).optional(), page: pageSchema, pageSize: pageSizeSchema }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await service.listMaterials(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    getMaterial: procedure.input(z.object({ ...expectedContextSchema, id: positiveInt }).strict()).query(async ({ ctx, input }) => {
      try {
        assertExpectedContext(ctx, input);
        return await service.getMaterial(scopeFromContext(ctx), input.id);
      } catch (error) {
        return asTrpcError(error);
      }
    }),
    createMaterial: procedure
      .input(z.object({ ...expectedContextSchema, ...materialCreateFields, requestId: z.string().uuid("请求号无效") }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          const { expectedEnterpriseId: _enterprise, expectedActorUserId: _actor, ...data } = input;
          return await service.createMaterial(scopeFromContext(ctx), data);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    updateMaterial: procedure
      .input(z.object({ ...expectedContextSchema, id: positiveInt, expectedRevision: positiveInt, ...materialUpdateFields }).strict().refine(input => materialUpdateKeys.some(key => input[key] !== undefined), { message: "请至少提供一个要更新的库存字段" }))
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          const { expectedEnterpriseId: _enterprise, expectedActorUserId: _actor, ...data } = input;
          return await service.updateMaterial(scopeFromContext(ctx), data);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    listSharedMaterials: procedure
      .input(z.object({ ...expectedContextSchema, partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().max(128, "料号不能超过 128 个字符")).optional(), brand: z.string().trim().max(64, "品牌不能超过 64 个字符").optional(), page: pageSchema, pageSize: pageSizeSchema.default(20) }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await notes.listSharedMaterials(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    setMaterialShare: procedure
      .input(z.object({ materialId: positiveInt, enabled: z.boolean(), expectedRevision: positiveInt, requestId: z.string().uuid("请求号无效") }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          return await notes.setMaterialShare(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    notesList: procedure
      .input(z.object({ ...expectedContextSchema, materialId: positiveInt, page: pageSchema, pageSize: pageSizeSchema.default(50) }).strict())
      .query(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await notes.notesList(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    notesAdd: procedure
      .input(z.object({ ...expectedContextSchema, materialId: positiveInt, content: z.string().transform(value => value.trim()).pipe(z.string().min(1, "请输入备注内容").max(2_000, "备注内容不能超过 2000 个字符")), requestId: z.string().uuid("请求号无效") }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await notes.notesAdd(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
    notesEdit: procedure
      .input(z.object({ ...expectedContextSchema, noteId: positiveInt, content: z.string().transform(value => value.trim()).pipe(z.string().min(1, "请输入备注内容").max(2_000, "备注内容不能超过 2000 个字符")), expectedRevision: positiveInt, requestId: z.string().uuid("请求号无效") }).strict())
      .mutation(async ({ ctx, input }) => {
        try {
          assertExpectedContext(ctx, input);
          return await notes.notesEdit(scopeFromContext(ctx), input);
        } catch (error) {
          return asTrpcError(error);
        }
      }),
  });
}

export type ChannelInventoryRouter = ReturnType<typeof createChannelInventoryRouter>;
export type { ChannelInventoryType };
