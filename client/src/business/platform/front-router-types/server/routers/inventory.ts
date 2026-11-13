import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { formatBeijingDateTime } from "../../../shared/beijingTime";
import { NOTE_MAX_LENGTH, detectForbiddenContent } from "../../../shared/contentModeration";
import { inquiryQuantityText } from "../../../shared/inquiryQuantity";
import { INVENTORY_BULK_ACTION_LIMIT } from "../../../shared/inventoryBulk";
import {
  MAX_INVENTORY_LADDER_TIERS,
  MAX_INVENTORY_QUANTITY,
} from "../../../shared/inventoryAvailability";
import {
  INVENTORY_LIST_DEFAULT_PAGE_SIZE,
  INVENTORY_LIST_MAX_PAGE_SIZE,
} from "../../../shared/inventorySafetyLimits";
import {
  INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
  INVENTORY_UPLOAD_NOTE_MAX_LENGTH,
  INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH,
} from "../../../shared/inventoryUploadLimits";
import { INVENTORY_LEAD_TIME_REQUIRED_MESSAGE } from "../../../shared/inventoryLeadTime";
import {
  SPOT_VERIFICATION_VALID_DAYS,
} from "../../../shared/spotInventoryVerification";
import {
  COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
  containsCompetitorDisplayName,
} from "../../../shared/competitorDisplayPolicy";
import {
  createCrmAnyPermissionProcedure,
  createCrmPermissionProcedure,
  router,
} from "../_core/trpc";
import {
  adminDbAvailable,
  dictGetSpecs,
  dictGetSpecsExactBatch,
  type DictSpecsResult,
} from "../adminDb";
import * as db from "../db";
import {
  enterpriseMemberPermissions,
  enterpriseMembers,
  inventories,
  inventoryAssignmentLogs,
  inventoryInquiries,
  messages,
  users,
} from "../../drizzle/schema";
import { storageDelete, storagePut } from "../storage";
const inventoryReadProcedure = createCrmAnyPermissionProcedure([
  "inventory.manage",
  "inventory.publish",
]);
const inventoryManageProcedure = createCrmPermissionProcedure("inventory.manage");
const inventoryPublishProcedure = createCrmPermissionProcedure("inventory.publish");
const inventoryAssignmentProcedure = createCrmPermissionProcedure("enterprise.members.manage");

type InventoryPermissionScope = {
  isOwner: boolean;
  member: { inventoryDataScope: "own" | "enterprise" };
};

/** 普通员工只可操作自己负责的库存；管理员和全公司范围成员不加负责人过滤。 */
function inventoryOwnerFilter(scope: InventoryPermissionScope, actorUserId: number) {
  return scope.isOwner || scope.member.inventoryDataScope === "enterprise"
    ? undefined
    : actorUserId;
}

import {
  HOURLY_LIMIT as LABEL_OCR_HOURLY_LIMIT,
  MaterialLabelOcrError,
  checkMaterialLabelOcrHealth,
  isMaterialLabelOcrAvailable,
  labelOcrRateLimited,
  recognizeMaterialLabel,
  refundLabelOcrQuota,
} from "../services/materialLabelOcr";
import {
  prepareSpotStockVerification,
  confirmSpotStockVerification,
} from "../services/spotVerificationCandidates";
import {
  INVENTORY_TEXT_MAX_LENGTH,
  InventoryTextRecognitionError,
  inventoryTextRecognitionRateLimited,
  recognizeInventoryText,
} from "../services/inventoryTextRecognition";
import {
  assertInventoryPublishJobAccess,
  cancelInventoryPublishJob,
  createInventoryPublishJob,
  getInventoryPublishJob,
  listInventoryPublishErrors,
  listInventoryPublishJobs,
  pauseInventoryPublishJob,
  resumeInventoryPublishJob,
  retryFailedInventoryPublishJob,
} from "../services/inventoryPublishJobs";

const ladderTierSchema = z.object({
  minQty: z.number().int().positive("阶梯数量须为正整数"),
  price: z.number().positive("阶梯单价须大于0"),
});

export const MAX_INVENTORY_PHOTOS = 5;
export const MAX_INVENTORY_PHOTO_BYTES = 5 * 1024 * 1024;
export const inventoryBulkIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "请至少选择1条库存")
  .max(INVENTORY_BULK_ACTION_LIMIT, `每次最多操作${INVENTORY_BULK_ACTION_LIMIT}条库存`)
  .refine(ids => new Set(ids).size === ids.length, "库存ID不能重复");

export type LabelMaterialMatch = {
  recognizedPartNumber: string;
  matchedPartNumber: string;
  strippedBusinessPrefix: boolean;
  brand: string;
  category: string;
  package: string;
};

/**
 * 标签常把仓库/客户物料代码放在真正厂商型号之前，例如
 * `841-S912ZVC12F0MLF`。先保留OCR完整串，再逐层移除“恰好三位数字+连字符”
 * 的前置业务码。只接受长度至少8且同时含字母和数字的后半段，避免把 1N4148、
 * 2N7000 或厂商型号自身的数字前缀误删。
 */
export function buildLabelPartNumberCandidates(raw: string): string[] {
  const compact = raw.trim().replace(/\s+/g, "");
  if (!compact) return [];
  const candidates = [compact];
  let current = compact;
  for (let depth = 0; depth < 2; depth += 1) {
    const match = current.match(/^\d{3}[-_](.+)$/);
    if (!match) break;
    const next = match[1].trim();
    if (
      next.length < 8 ||
      !/[A-Za-z]/.test(next) ||
      !/\d/.test(next)
    ) break;
    candidates.push(next);
    current = next;
  }
  return Array.from(new Set(candidates));
}

export function selectMatchedLabelPartNumber(
  matchedCandidate: string,
  dictionaryPartNumber: string,
  exactMatched: boolean,
): string {
  // 精确命中时采用字典标准写法；仅命中基础型号前缀时保留OCR完整订购型号，
  // 避免 STM32F103C8T6 被截短为 STM32F103C8。
  return exactMatched ? dictionaryPartNumber : matchedCandidate;
}

async function matchRecognizedLabelPartNumber(
  recognizedPartNumber: string,
): Promise<LabelMaterialMatch | null> {
  if (!adminDbAvailable()) return null;
  const candidates = buildLabelPartNumberCandidates(recognizedPartNumber);
  if (!candidates.length) return null;

  const exact = await dictGetSpecsExactBatch(candidates);
  let matchedCandidate = candidates.find(candidate => exact[candidate]);
  const exactMatched = Boolean(matchedCandidate);
  let specs: DictSpecsResult = matchedCandidate ? exact[matchedCandidate] : null;

  // 保留既有“完整订购型号→基础型号最长前缀”能力，但只对已经去掉业务码的
  // 最终候选执行一次，避免先为必然不命中的 841-... 做昂贵前缀扫描。
  if (!specs) {
    matchedCandidate = candidates[candidates.length - 1];
    specs = await dictGetSpecs(matchedCandidate);
  }
  if (!specs || !matchedCandidate) return null;

  return {
    recognizedPartNumber,
    matchedPartNumber: selectMatchedLabelPartNumber(
      matchedCandidate,
      specs.partNumber,
      exactMatched,
    ),
    strippedBusinessPrefix: matchedCandidate !== candidates[0],
    brand: specs.brand,
    category: specs.category,
    package: specs.package,
  };
}

const photoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const inventoryPhotoSchema = z.object({
  key: z.string().min(1).max(512),
  /**
   * 照片可访问地址。存储后端为 OSS 时是桶内绝对地址（https://...aliyuncs.com/{key}），
   * 为 Forge/S3 时是 /manus-storage/{key} 代理路径。两种形态均合法，
   * 归属与一致性由 assertOwnedPhotos 严格校验，此处不再限定前缀。
   */
  url: z.string().min(1).max(768),
  name: z.string().min(1).max(255),
  mimeType: photoMimeSchema,
  size: z.number().int().positive().max(MAX_INVENTORY_PHOTO_BYTES),
});

export const inventoryInputSchema = z
  .object({
  partNumber: z.string().min(1, "请输入型号").max(128),
  brand: z.string().min(1, "请输入品牌").max(64),
  // 分类不再必填；填写时仍允许自由输入并限制长度。空值写入空字符串以兼容现有 NOT NULL 列。
  category: z.string().trim().max(32, "分类最多 32 个字符").optional(),
  pkg: z.string().trim().max(32, "封装最多 32 个字符").optional(),
  dateCode: z.string().trim().max(32, "生产周期最多 32 个字符").optional(),
  /** 现货上架量；0 表示无现货，不等同于订货数量。 */
  qtyOnSale: z.number().int("上架数量须为整数").min(0, "上架数量不能小于0").max(MAX_INVENTORY_QUANTITY, "上架数量不能超过2147483647"),
  /** 实际现货库存；不得小于当前现货上架量。 */
  qtyStock: z.number().int("库存数量须为整数").min(0, "库存数量不能小于0").max(MAX_INVENTORY_QUANTITY, "库存数量不能超过2147483647"),
  /** 独立订货供应；null 是历史未知，0 是已确认没有订货供应。 */
  qtyOrder: z.number().int("订货数量须为整数").min(0, "订货数量不能小于0").max(MAX_INVENTORY_QUANTITY, "订货数量不能超过2147483647").nullable().optional(),
  /** 展示单价：选填。不填则前台展示“价格面议”，仅显示聊一聊入口 */
  priceEx: z.number().positive("单价须大于0").optional(),
  /** true=含税价可直接交易；false=未税价，仅允许聊一聊询价 */
  taxIncluded: z.boolean().default(true),
  invoice: z.boolean().default(true),
  ladderPrices: z.array(ladderTierSchema).max(MAX_INVENTORY_LADDER_TIERS, `阶梯价最多${MAX_INVENTORY_LADDER_TIERS}档`).optional(),
  moq: z.number().int().positive().optional(),
  spq: z.number().int().positive().optional(),
  leadTime: z
    .string({ error: INVENTORY_LEAD_TIME_REQUIRED_MESSAGE })
    .trim()
    .min(1, INVENTORY_LEAD_TIME_REQUIRED_MESSAGE)
    .max(
      INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH,
      `货期最多${INVENTORY_UPLOAD_LEAD_TIME_MAX_LENGTH}个字符`,
    ),
  warehouseAddress: z.string().max(255).optional(),
  rohs: z.boolean().default(true),
  /*
   * 备注说明会在前台商品卡片与详情页公开展示，因此有两重约束：
   *
   * 1) 字数上限 NOTE_MAX_LENGTH(50)：生产实测 4954 条备注最长 40 字、
   *    平均 13.7 字，50 字可覆盖全部存量数据——不会出现「商户只想改个价格，
   *    却因旧备注超长而无法保存」的情况。
   *
   * 2) 违禁词校验：备注一旦发布即构成对外宣传，极限词违反《广告法》第九条
   *    （罚则 20 万元起）。放在 zod 层的好处是 create/update 共用同一份
   *    schema，不会出现「新建拦住了、编辑却漏过」的缺口。
   *
   * 用 superRefine 而非 refine：需要把命中的具体违规词回传给商户，
   * 只返回布尔值就只能给出「内容不合规」这种无法据以修改的提示。
   */
  note: z
    .string()
    .max(NOTE_MAX_LENGTH, `备注说明最多 ${NOTE_MAX_LENGTH} 个字`)
    .optional()
    .superRefine((value, ctx) => {
      const verdict = detectForbiddenContent(value);
      if (!verdict.ok) {
        ctx.addIssue({ code: "custom", message: verdict.message });
      }
    }),
  photos: z.array(inventoryPhotoSchema).max(MAX_INVENTORY_PHOTOS, "库存照片最多5张").optional(),
  })
  .superRefine((value, ctx) => {
    for (const field of ["brand", "category"] as const) {
      if (containsCompetitorDisplayName(value[field])) {
        ctx.addIssue({
          code: "custom",
          message: COMPETITOR_DISPLAY_VALIDATION_MESSAGE,
          path: [field],
        });
      }
    }
  })
  .refine(
    v =>
      v.taxIncluded ||
      (typeof v.priceEx === "number" && v.priceEx > 0) ||
      Boolean(v.ladderPrices?.some(tier => Number(tier.price) > 0)),
    {
      message: "选择未税价时请填写单价或阶梯价",
      path: ["priceEx"],
    },
  )
  .refine(v => v.qtyStock >= v.qtyOnSale, {
    message: "实际库存数量须大于等于上架数量",
    path: ["qtyStock"],
  });

/**
 * 新增专用校验：在通用规则上额外要求生产周期必填。
 *
 * **为什么只卡新增、不卡编辑**：
 * 生产库存 6166 条中有 5032 条批号为空（其中 4914 条在售）。
 * 若编辑时也强制必填，这些商家只是想改个价格就会被拦下，
 * 等于突然给存量用户设障。因此只对新数据提高要求，
 * 存量数据保持可正常维护。
 */
export const inventoryCreateSchema = inventoryInputSchema.superRefine((value, ctx) => {
  const hasSpotAvailability = value.qtyOnSale > 0;
  const hasOrderAvailability = value.qtyOrder != null && value.qtyOrder > 0;
  if (!hasSpotAvailability && !hasOrderAvailability) {
    ctx.addIssue({
      code: "custom",
      message: "请填写大于0的上架数量或订货数量",
      path: ["qtyOnSale"],
    });
  }
  if (!hasSpotAvailability && hasOrderAvailability && value.leadTime !== "订货") {
    ctx.addIssue({
      code: "custom",
      message: "纯订货库存的货期必须为“订货”",
      path: ["leadTime"],
    });
  }
  if (!value.dateCode?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "请输入生产周期（Date Code）",
      path: ["dateCode"],
    });
  }
  if ((value.warehouseAddress?.trim().length ?? 0) > INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH) {
    ctx.addIssue({
      code: "custom",
      message: `仓库地址最多${INVENTORY_UPLOAD_WAREHOUSE_MAX_LENGTH}个字符`,
      path: ["warehouseAddress"],
    });
  }
  if ((value.note?.trim().length ?? 0) > INVENTORY_UPLOAD_NOTE_MAX_LENGTH) {
    ctx.addIssue({
      code: "custom",
      message: `物料备注最多${INVENTORY_UPLOAD_NOTE_MAX_LENGTH}个字符`,
      path: ["note"],
    });
  }
});

/**
 * 历史价格镜像。
 *
 * 平台不自动换算税率，priceIncl 与商家录入的 priceEx 保持同值以兼容存量读取；
 * 含税或未税口径统一由 taxIncluded 字段判断。
 */
export function calcPriceIncl(priceEx: number): string {
  return priceEx.toFixed(4);
}

function buildRow(input: z.infer<typeof inventoryInputSchema>) {
  const hasPrice = typeof input.priceEx === "number" && input.priceEx > 0;
  return {
    partNumber: input.partNumber.normalize("NFKC").trim(),
    brand: input.brand.trim(),
    category: input.category?.trim() || "",
    pkg: input.pkg || null,
    dateCode: input.dateCode || null,
    qtyOnSale: input.qtyOnSale,
    qtyStock: input.qtyStock,
    // 旧客户端不认识 qtyOrder，省略时绝不可把既有订货数量覆盖成 NULL。
    ...(input.qtyOrder !== undefined ? { qtyOrder: input.qtyOrder } : {}),
    priceEx: hasPrice ? input.priceEx!.toFixed(4) : null,
    priceIncl: hasPrice ? calcPriceIncl(input.priceEx!) : null,
    taxIncluded: input.taxIncluded,
    invoice: input.invoice,
    ladderPrices: input.ladderPrices?.length ? input.ladderPrices : null,
    moq: input.moq ?? null,
    spq: input.spq ?? null,
    leadTime: input.leadTime?.trim() || null,
    warehouseAddress: input.warehouseAddress?.trim() || null,
    rohs: input.rohs,
    note: input.note || null,
    photos: input.photos?.length ? input.photos : null,
  };
}

/**
 * 编辑允许历史零数量/未知订货条目原样维护，但不允许把普通现货清零后
 * 假装成订货。新建与重新上架一律要求明确的正数量，由发布守卫复查。
 */
function assertEditableInventoryAvailability(
  current: { qtyOnSale: number; qtyOrder: number | null; leadTime: string | null },
  input: z.infer<typeof inventoryInputSchema>,
) {
  const nextQtyOrder = input.qtyOrder === undefined ? current.qtyOrder : input.qtyOrder;
  const hasSpotAvailability = input.qtyOnSale > 0;
  const hasOrderAvailability = nextQtyOrder != null && nextQtyOrder > 0;
  const preservesLegacyOrder =
    current.qtyOnSale === 0
    && (current.qtyOrder == null || current.qtyOrder === 0)
    && current.leadTime?.trim() === "订货"
    && input.qtyOnSale === 0
    && (nextQtyOrder == null || nextQtyOrder === 0)
    && input.leadTime === "订货";

  if (!hasSpotAvailability && !hasOrderAvailability && !preservesLegacyOrder) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请填写大于0的上架数量或订货数量",
    });
  }
  if (!hasSpotAvailability && hasOrderAvailability && input.leadTime !== "订货") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "纯订货库存的货期必须为“订货”",
    });
  }
}

function photoMatchesMime(data: Buffer, mimeType: z.infer<typeof photoMimeSchema>) {
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function decodeInventoryPhotoBase64(
  base64: string,
  mimeType: z.infer<typeof photoMimeSchema>,
) {
  const encoded = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片内容无效" });
  }
  const data = Buffer.from(encoded, "base64");
  if (data.length === 0 || data.length > MAX_INVENTORY_PHOTO_BYTES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "单张图片不能超过 5MB" });
  }
  if (!photoMatchesMime(data, mimeType)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片格式与文件内容不一致" });
  }
  return data;
}

/**
 * 校验照片引用的归属与一致性，防止商户保存他人对象或注入外部链接。
 *
 * key 必须落在本商户的 inventory-photos/{userId}/ 前缀下；
 * url 必须与 key 对应——OSS 后端为以 /{key} 结尾的 https 绝对地址，
 * Forge 后端为 /manus-storage/{key}。不得只校 key 而放任 url。
 */
function assertOwnedPhotos(
  photos: z.infer<typeof inventoryPhotoSchema>[] | undefined,
  userId: number,
) {
  const prefix = `inventory-photos/${userId}/`;
  for (const photo of photos ?? []) {
    const proxyUrlMatched = photo.url === `/manus-storage/${photo.key}`;
    const ossUrlMatched =
      photo.url.startsWith("https://") && photo.url.endsWith(`/${photo.key}`);
    if (!photo.key.startsWith(prefix) || (!proxyUrlMatched && !ossUrlMatched)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "库存照片引用无效" });
    }
  }
}

export const inventoryRouter = router({
  /**
   * 旧页面兼容入口：只返回首100条，绝不恢复全量查询。
   * 保留到历史浏览器标签页自然淘汰，所有新页面必须使用 listPaged。
   */
  list: inventoryReadProcedure
    .input(
      z.object({
        status: z.enum(["draft", "published", "offshelf"]).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const result = await db.listInventories(
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        { status: input?.status, page: 1, pageSize: INVENTORY_LIST_MAX_PAGE_SIZE },
        ownerUserId,
      );
      return result.items;
    }),

  /** 新页面使用的服务端筛选与分页列表。 */
  listPaged: inventoryReadProcedure
    .input(
      z.object({
        status: z.enum(["draft", "published", "offshelf"]).optional(),
        partNumber: z.string().trim().max(128).optional(),
        brand: z.string().trim().max(64).optional(),
        category: z.string().trim().max(32).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(INVENTORY_LIST_MAX_PAGE_SIZE)
          .default(INVENTORY_LIST_DEFAULT_PAGE_SIZE),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      return db.listInventories(
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        input ?? {},
        ownerUserId,
      );
    }),

  /** 当前供应商已发布库存的一键刷新状态与下一次可操作时间 */
  refreshStatus: inventoryManageProcedure.query(async ({ ctx }) => {
    const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
    return db.getInventoryRefreshStatus(
      ctx.effectiveUserId!,
      ctx.enterprisePermissionScope.enterprise.id,
      ownerUserId,
    );
  }),

  /** 一键确认全部已发布库存仍有效；每个商户 24 小时最多成功刷新一次 */
  refreshPublished: inventoryManageProcedure.mutation(async ({ ctx }) => {
    const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
    const result = await db.refreshPublishedInventories(
      ctx.effectiveUserId!,
      ctx.enterprisePermissionScope.enterprise.id,
      ownerUserId,
    );
    if (result.reason === "empty") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "暂无已发布库存可刷新" });
    }
    if (result.reason === "cooldown") {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: result.nextAllowedAt
          ? `库存每24小时可刷新一次，下次可刷新时间：${formatBeijingDateTime(result.nextAllowedAt)}`
          : "库存每24小时可刷新一次，请稍后再试",
      });
    }
    return { success: true as const, ...result };
  }),

  /** 单条详情：仅所属供应商可读取 */
  get: inventoryReadProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const item = await db.getInventoryById(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "库存条目不存在" });
      return item;
    }),

  /** 上传库存实拍照片，返回可保存到库存记录的对象引用 */
  uploadPhoto: inventoryPublishProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        mimeType: photoMimeSchema,
        base64: z.string().min(1).max(Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = decodeInventoryPhotoBase64(input.base64, input.mimeType);
      const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1];
      const safeStem = input.fileName
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "inventory-photo";
      const relKey = `inventory-photos/${ctx.effectiveUserId!}/${Date.now()}-${randomUUID()}-${safeStem}.${extension}`;
      const stored = await storagePut(relKey, data, input.mimeType);
      return {
        ...stored,
        name: input.fileName,
        mimeType: input.mimeType,
        size: data.length,
      };
    }),

  /**
   * 识别服务可用性（供前端决定是否展示拍标签入口）。
   *
   * 先查再展示，避开「用户拍完才被告知不可用」的白费功夫。
   */
  labelOcrAvailability: inventoryPublishProcedure.query(async () => ({
    ...await checkMaterialLabelOcrHealth(),
    hourlyLimit: LABEL_OCR_HOURLY_LIMIT,
  })),

  /**
   * 拍标签识别料号。
   *
   * 返回的是**建议值**而非直接入库数据：
   * 实测料号准确率很高，但品牌/批号存在语义差异
   *（标签印 STMicroelectronics 而库内填 ST；
   * 标签印追溯码 GK251UVY 而业务要年份格式 22+），
   * 必须由用户逐字段确认后回填。
   */
  recognizeLabel: inventoryPublishProcedure
    .input(
      z.object({
        // 与 uploadPhoto 同口径：base64 长度约为原始字节的 1.4 倍
        base64: z.string().min(1).max(Math.ceil(4 * 1024 * 1024 * 1.4) + 128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isMaterialLabelOcrAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "标签识别服务尚未开启，请手工填写",
        });
      }
      const userId = ctx.effectiveUserId!;
      if (labelOcrRateLimited(userId)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `标签识别过于频繁，每小时上限 ${LABEL_OCR_HOURLY_LIMIT} 次，请稍后再试`,
        });
      }
      try {
        const ocr = await recognizeMaterialLabel(input.base64);
        const recognizedPartNumber = ocr.partNumber?.suggested?.trim() || "";
        let materialMatch: LabelMaterialMatch | null = null;
        if (recognizedPartNumber) {
          try {
            materialMatch = await matchRecognizedLabelPartNumber(recognizedPartNumber);
          } catch (error) {
            // 字典短时不可达不应让已经成功的OCR失败，客户端仍可保留料号手工修改。
            console.error("[inventory.recognizeLabel] material match failed:", error);
          }
        }
        return { ...ocr, materialMatch };
      } catch (error) {
        /*
         * 识别失败不应扣用户额度：
         * 失败往往因图片过大或上游抖动，错不在用户，
         * 若照扣会让人重试几次就用完额度、彻底用不了。
         */
        refundLabelOcrQuota(userId);
        if (error instanceof MaterialLabelOcrError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /** 当前权限范围内可做现货核验的在售库存及最近核验状态。 */
  spotVerificationList: inventoryReadProcedure.query(async ({ ctx }) => {
    const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
    const items = await db.listSpotVerificationInventories(
      ctx.effectiveUserId!,
      ctx.enterprisePermissionScope.enterprise.id,
      ownerUserId,
    );
    return {
      validDays: SPOT_VERIFICATION_VALID_DAYS,
      items: items.map(item => ({
        ...item,
        refreshedAt: item.refreshedAt ? formatBeijingDateTime(item.refreshedAt) : null,
        spotVerifiedAt: item.spotVerifiedAt ? formatBeijingDateTime(item.spotVerifiedAt) : null,
        spotVerificationExpiresAt: item.spotVerificationExpiresAt
          ? formatBeijingDateTime(item.spotVerificationExpiresAt)
          : null,
      })),
    };
  }),

  /** New mini-program: the server prepares eligible candidates before any selection. */
  prepareSpotStockVerification: inventoryReadProcedure.input(z.object({
    mimeType: photoMimeSchema,
    base64: z.string().min(1).max(Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128),
    requestId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  })).mutation(async ({ ctx, input }) => {
    const image = decodeInventoryPhotoBase64(input.base64, input.mimeType);
    return prepareSpotStockVerification({
      dataOwnerUserId: ctx.effectiveUserId!,
      enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
      verifiedByUserId: ctx.user.id,
      ownerUserId: inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id),
    }, input, image);
  }),

  /** No OCR or client-provided match score: confirm only a server-issued candidate. */
  confirmSpotStockVerification: inventoryReadProcedure.input(z.object({
    token: z.string().min(40).max(8192),
    inventoryId: z.number().int().positive(),
    mimeType: photoMimeSchema,
    base64: z.string().min(1).max(Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128),
  })).mutation(async ({ ctx, input }) => confirmSpotStockVerification({
    dataOwnerUserId: ctx.effectiveUserId!,
    enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
    verifiedByUserId: ctx.user.id,
    ownerUserId: inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id),
  }, input, decodeInventoryPhotoBase64(input.base64, input.mimeType))),

  /**
   * 一键拍现货：AI读取标签料号并自动匹配当前账号的在售库存。
   *
   * 不要求先选库存或书写验证码；匹配不唯一时直接拒绝，不猜测。
   */
  verifySpotStock: inventoryReadProcedure
    .input(
      z.object({
        mimeType: photoMimeSchema,
        base64: z.string().min(1).max(Math.ceil(MAX_INVENTORY_PHOTO_BYTES * 1.4) + 128),
        requestId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isMaterialLabelOcrAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "现货核验暂不可用，请稍后再试",
        });
      }
      const image = decodeInventoryPhotoBase64(input.base64, input.mimeType);
      const result = await prepareSpotStockVerification({
        dataOwnerUserId: ctx.effectiveUserId!,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        verifiedByUserId: ctx.user.id,
        ownerUserId: inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id),
      }, input, image);
      if ("selectionRequired" in result && result.selectionRequired) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请更新小程序后选择核验库存" });
      }
      return result;
    }),

  /**
   * 将微信、邮件或库存文字识别为单条库存建议值。
   * 只返回建议，不写库、不覆盖已填字段，也不会自动发布。
   */
  recognizeText: inventoryPublishProcedure
    .input(
      z.object({
        text: z
          .string()
          .trim()
          .min(2, "请粘贴需要识别的库存信息")
          .max(INVENTORY_TEXT_MAX_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (inventoryTextRecognitionRateLimited(ctx.user.id)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "库存文字识别使用过于频繁，请稍后再试",
        });
      }
      try {
        return await recognizeInventoryText(input.text);
      } catch (error) {
        if (error instanceof InventoryTextRecognitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        console.error(
          "[inventory.recognizeText] 识别失败:",
          error instanceof Error ? error.message : String(error),
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "库存文字识别失败，请稍后重试或手工填写",
        });
      }
    }),

  /** 新增（单条录入）：saveAs = draft 存草稿 / published 直接发布 */
  create: inventoryPublishProcedure
    .input(
      z.object({
        data: inventoryCreateSchema,
        saveAs: z.enum(["draft", "published"]).default("draft"),
        requestId: z.string().trim().min(8).max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOwnedPhotos(input.data.photos, ctx.effectiveUserId!);
      const enterpriseId = ctx.enterprisePermissionScope.enterprise.id;
      const record = {
        ...buildRow(input.data),
        userId: ctx.effectiveUserId!,
        enterpriseId,
        ownerUserId: ctx.user.id,
        createdByUserId: ctx.user.id,
        updatedByUserId: ctx.user.id,
        ownerAssignedAt: new Date(),
        ownershipVersion: 1,
        status: input.saveAs,
        publishedAt: input.saveAs === "published" ? new Date() : null,
      } as const;
      if (input.saveAs === "draft") {
        await db.createInventory(record);
        return { success: true } as const;
      }
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      return db.createDraftThenPublishInventory(record, {
        requestId: input.requestId ?? randomUUID(),
        actorUserId: ctx.user.id,
        ownerUserId,
      });
    }),

  /**
   * 编辑库存。草稿（draft）、已下架（offshelf）与在售（published）均可编辑，但路径不同：
   *
   * - **draft**：直接更新，不涉及在售约束与刷新
   * - **published**：走 updatePublishedInventory，需重复料号校验，
   *   并计一次刷新（更新 refreshedAt）
   *
   * 不能合并为单一路径：在售条目若被改成已在售的其他料号，
   * 会绕过「同一供应商不得重复在售」的约束，必须单独校验。
   *
   * 历史行为：此前只允许 draft，改已发布库存必须先下架，
   * 而下架期间该条从搜索结果消失，等于为改一个价格牺牲曝光。
   */
  update: inventoryReadProcedure
    .input(z.object({ id: z.number().int(), data: inventoryInputSchema }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const existing = await db.getInventoryById(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "库存条目不存在" });
      if (
        existing.status !== "draft"
        && existing.status !== "offshelf"
        && existing.status !== "published"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅草稿、已下架与在售库存可以编辑",
        });
      }
      const permissionScope = ctx.enterprisePermissionScope;
      if (
        !permissionScope.isOwner
        && existing.status === "draft"
        && !permissionScope.permissionKeys.includes("inventory.publish")
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您没有发布库存权限" });
      }
      if (
        !permissionScope.isOwner
        && existing.status !== "draft"
        && !permissionScope.permissionKeys.includes("inventory.manage")
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您没有维护库存权限" });
      }
      assertOwnedPhotos(input.data.photos, ctx.effectiveUserId!);
      assertEditableInventoryAvailability(existing, input.data);
      // 用户编辑保存后清除"平台下架"标记（视为已按下架原因整改）
      const row = {
        ...buildRow(input.data),
        updatedByUserId: ctx.user.id,
        offshelfBy: null,
        offshelfReason: null,
      };

      if (existing.status === "published") {
        const outcome = await db.updatePublishedInventory(
          input.id,
          ctx.effectiveUserId!,
          ctx.enterprisePermissionScope.enterprise.id,
          row,
          input.data.partNumber,
          ownerUserId,
        );
        if (!outcome.success) {
          throw new TRPCError({
            code: outcome.reason === "duplicate" ? "CONFLICT" : "BAD_REQUEST",
            message: outcome.message ?? "重新发布失败",
          });
        }
        return {
          success: true,
          republished: true,
          refreshedAt: outcome.refreshedAt,
        } as const;
      }

      await db.updateInventory(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        row,
        ownerUserId,
      );
      return { success: true, republished: false, refreshedAt: null } as const;
    }),

  /** 单条发布/重新上架：同一供应商已有相同标准化料号在售时保留原状态并返回失败。 */
  publish: inventoryPublishProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      return db.publishDraftInventoryWithGuard(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        undefined,
        ownerUserId,
        ctx.user.id,
      );
    }),

  /** 一键发布全部草稿：只创建持久化任务，正式发布由独立worker分批完成。 */
  publishAll: inventoryPublishProcedure
    .input(z.object({
      requestId: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createInventoryPublishJob({
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          dataOwnerUserId: ctx.effectiveUserId!,
          createdByUserId: ctx.user.id,
          scopeOwnerUserId: inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id),
          clientRequestId: input.requestId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "一键发布任务创建失败";
        if (message === "库存服务正在更新，请稍后重试") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }
        if (/暂无待发布库存|最多同时上线[0-9,]+条库存/.test(message)) {
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
        if (/已有一键发布任务/.test(message)) {
          throw new TRPCError({ code: "CONFLICT", message });
        }
        console.error("[inventory.publishAll] create job failed", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "一键发布服务暂时不可用，请稍后重试" });
      }
    }),

  listPublishJobs: inventoryPublishProcedure
    .input(z.object({ limit: z.number().int().min(1).max(30).default(10) }).optional())
    .query(({ ctx, input }) => listInventoryPublishJobs({
      enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
      viewerUserId: ctx.user.id,
      canAccessEnterpriseJobs:
        ctx.enterprisePermissionScope.isOwner
        || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      limit: input?.limit ?? 10,
    })),

  getPublishJob: inventoryPublishProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const access = {
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      };
      await assertInventoryPublishJobAccess(access);
      return getInventoryPublishJob(input.jobId, access.enterpriseId);
    }),

  listPublishJobErrors: inventoryPublishProcedure
    .input(z.object({
      jobId: z.string().uuid(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const access = {
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      };
      await assertInventoryPublishJobAccess(access);
      return listInventoryPublishErrors(input.jobId, access.enterpriseId, input.limit);
    }),

  pausePublishJob: inventoryPublishProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertInventoryPublishJobAccess({
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      });
      return pauseInventoryPublishJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
    }),

  resumePublishJob: inventoryPublishProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertInventoryPublishJobAccess({
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      });
      return resumeInventoryPublishJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
    }),

  retryPublishJob: inventoryPublishProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertInventoryPublishJobAccess({
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      });
      return retryFailedInventoryPublishJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
    }),

  cancelPublishJob: inventoryPublishProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertInventoryPublishJobAccess({
        jobId: input.jobId,
        enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
        viewerUserId: ctx.user.id,
        canAccessEnterpriseJobs:
          ctx.enterprisePermissionScope.isOwner
          || ctx.enterprisePermissionScope.member.inventoryDataScope === "enterprise",
      });
      return cancelInventoryPublishJob(input.jobId, ctx.enterprisePermissionScope.enterprise.id);
    }),

  /** 已发布库存可切换为“公司页展示”或“仅完整型号搜索可见”。 */
  setCompanyCatalogVisibility: inventoryManageProcedure
    .input(z.object({
      id: z.number().int().positive(),
      visible: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const updated = await db.setInventoryCompanyCatalogVisibility(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        input.visible,
        ctx.user.id,
        ownerUserId,
      );
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "库存不存在、无权操作或已不是发布状态",
        });
      }
      return { success: true as const, visible: input.visible };
    }),

  /** 将权限范围内全部已发布库存统一设为“全部可见”或“仅搜索可见”。 */
  setAllCompanyCatalogVisibility: inventoryManageProcedure
    .input(z.object({ visible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const updatedCount = await db.setAllInventoryCompanyCatalogVisibility(
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        input.visible,
        ctx.user.id,
        ownerUserId,
      );
      return { success: true as const, visible: input.visible, updatedCount };
    }),

  /** 当前页批量修改公司目录展示范围：最多50条，逐条返回失败原因。 */
  bulkSetCompanyCatalogVisibility: inventoryManageProcedure
    .input(z.object({ ids: inventoryBulkIdsSchema, visible: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const outcomes = await db.bulkSetInventoryCompanyCatalogVisibility(
        input.ids,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        input.visible,
        ctx.user.id,
        ownerUserId,
      );
      const failures = outcomes.filter(outcome => !outcome.success);
      return {
        success: true as const,
        visible: input.visible,
        successCount: outcomes.length - failures.length,
        failedCount: failures.length,
        failures,
      };
    }),

  /** 下架：条目进入「已下架列表」，可编辑后重新上架。 */
  offshelf: inventoryManageProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const updated = await db.offshelfInventory(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ctx.user.id,
        ownerUserId,
      );
      if (!updated) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "库存已不是在售状态，请刷新后重试" });
      }
      return { success: true } as const;
    }),

  /** 当前页批量下架：最多50条，逐条返回失败原因。 */
  bulkOffshelf: inventoryManageProcedure
    .input(z.object({ ids: inventoryBulkIdsSchema }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const outcomes = await db.bulkOffshelfInventories(
        input.ids,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      const failures = outcomes.filter(outcome => !outcome.success);
      return {
        success: true,
        successCount: outcomes.length - failures.length,
        failedCount: failures.length,
        failures,
      } as const;
    }),

  /** 全部下架：作用于当前权限范围内全部已发布库存，不受页面和50条上限影响。 */
  offshelfAllPublished: inventoryManageProcedure
    .mutation(async ({ ctx }) => {
      const requestId = randomUUID();
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const updatedCount = await db.offshelfAllPublishedInventories(
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ctx.user.id,
        ownerUserId,
      );
      console.info("[inventory-offshelf-all]", JSON.stringify({
        requestId,
        supplierUserId: ctx.effectiveUserId!,
        actorUserId: ctx.user.id,
        scope: ownerUserId ? "own" : "enterprise",
        updatedCount,
        occurredAt: new Date().toISOString(),
      }));
      return { success: true as const, updatedCount, requestId };
    }),

  /** 删除单条库存（兼容“我的库存”页面） */
  remove: inventoryManageProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      await db.deleteInventory(
        input.id,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      return { success: true } as const;
    }),

  /** 当前页批量永久删除：最多50条，逐条返回失败原因。 */
  bulkRemove: inventoryManageProcedure
    .input(z.object({ ids: inventoryBulkIdsSchema }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const outcomes = await db.bulkDeleteInventories(
        input.ids,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      const failures = outcomes.filter(outcome => !outcome.success);
      return {
        success: true,
        successCount: outcomes.length - failures.length,
        failedCount: failures.length,
        failures,
      } as const;
    }),

  /** 删除选中的待发布草稿；非本人或非草稿记录会被安全忽略。 */
  removeManyDrafts: inventoryPublishProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
      const deletedCount = await db.deleteDraftInventories(
        input.ids,
        ctx.effectiveUserId!,
        ctx.enterprisePermissionScope.enterprise.id,
        ownerUserId,
      );
      return { success: true, deletedCount } as const;
    }),

  /** 一键清空当前供应商全部待发布草稿。 */
  clearDrafts: inventoryPublishProcedure.mutation(async ({ ctx }) => {
    const ownerUserId = inventoryOwnerFilter(ctx.enterprisePermissionScope, ctx.user.id);
    const deletedCount = await db.deleteAllDraftInventories(
      ctx.effectiveUserId!,
      ctx.enterprisePermissionScope.enterprise.id,
      ownerUserId,
    );
    return { success: true, deletedCount } as const;
  }),

  /** 当前企业可承担库存与询价的有效成员。 */
  assignmentOptions: inventoryReadProcedure.query(async ({ ctx }) => {
    const database = await db.getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
    const enterpriseId = ctx.enterprisePermissionScope.enterprise.id;
    const rows = await database
      .select({
        memberId: enterpriseMembers.id,
        userId: enterpriseMembers.userId,
        role: enterpriseMembers.role,
        inventoryDataScope: enterpriseMembers.inventoryDataScope,
        name: users.name,
        username: users.username,
      })
      .from(enterpriseMembers)
      .innerJoin(users, eq(enterpriseMembers.userId, users.id))
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, enterpriseId),
          eq(enterpriseMembers.status, "active"),
        ),
      );
    const permissions = rows.length
      ? await database
          .select({
            memberId: enterpriseMemberPermissions.enterpriseMemberId,
            permissionKey: enterpriseMemberPermissions.permissionKey,
          })
          .from(enterpriseMemberPermissions)
          .where(inArray(enterpriseMemberPermissions.enterpriseMemberId, rows.map(row => row.memberId)))
      : [];
    const allowedMemberIds = new Set(
      permissions
        .filter(row => row.permissionKey === "inventory.manage" || row.permissionKey === "inventory.publish")
        .map(row => row.memberId),
    );
    return rows
      .filter(row => row.role === "super_admin" || allowedMemberIds.has(row.memberId))
      .map(row => ({
        userId: row.userId,
        name: String(row.name || row.username || `员工${row.userId}`),
        role: row.role,
        inventoryDataScope: row.inventoryDataScope,
      }));
  }),

  /** 企业管理员批量转交库存负责人；未结询价给新负责人发摘要，旧私聊历史不复制。 */
  reassign: inventoryAssignmentProcedure
    .input(
      z.object({
        ids: inventoryBulkIdsSchema,
        nextOwnerUserId: z.number().int().positive(),
        reason: z.string().trim().min(1).max(255).default("管理员分配库存"),
        expectedVersions: z.record(z.string(), z.number().int().positive()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
      const scope = ctx.enterprisePermissionScope;
      const batchId = `inventory-assign-${randomUUID()}`;

      return database.transaction(async tx => {
        const lockedEnterprise = await tx.execute(sql`
          SELECT id FROM enterprises
           WHERE id = ${scope.enterprise.id}
           LIMIT 1
           FOR UPDATE
        `);
        const lockedEnterpriseRows = (
          lockedEnterprise as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (!lockedEnterpriseRows[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
        }
        const target = (
          await tx
            .select({
              id: enterpriseMembers.id,
              userId: enterpriseMembers.userId,
              role: enterpriseMembers.role,
            })
            .from(enterpriseMembers)
            .where(
              and(
                eq(enterpriseMembers.enterpriseId, scope.enterprise.id),
                eq(enterpriseMembers.userId, input.nextOwnerUserId),
                eq(enterpriseMembers.status, "active"),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (!target) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人不是当前企业的有效成员" });
        }
        if (target.role !== "super_admin") {
          const targetPermissions = await tx
            .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
            .from(enterpriseMemberPermissions)
            .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
          if (
            !targetPermissions.some(
              row => row.permissionKey === "inventory.manage" || row.permissionKey === "inventory.publish",
            )
          ) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有库存模块权限" });
          }
        }

        const lockedRows = await tx
          .select({
            id: inventories.id,
            partNumber: inventories.partNumber,
            ownerUserId: inventories.ownerUserId,
            ownershipVersion: inventories.ownershipVersion,
          })
          .from(inventories)
          .where(
            and(
              eq(inventories.userId, ctx.effectiveUserId!),
              eq(inventories.enterpriseId, scope.enterprise.id),
              inArray(inventories.id, input.ids),
            ),
          )
          .orderBy(asc(inventories.id))
          .for("update");
        if (lockedRows.length !== input.ids.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "部分库存不存在或不属于当前企业" });
        }
        for (const row of lockedRows) {
          const expected = input.expectedVersions?.[String(row.id)];
          if (expected && expected !== row.ownershipVersion) {
            throw new TRPCError({ code: "CONFLICT", message: "库存负责人已变化，请刷新后重试" });
          }
        }
        const activeInquiryCandidates = await tx
          .select({ id: inventoryInquiries.id, conversationId: inventoryInquiries.conversationId })
          .from(inventoryInquiries)
          .where(
            and(
              eq(inventoryInquiries.enterpriseId, scope.enterprise.id),
              inArray(inventoryInquiries.inventoryId, input.ids),
              inArray(inventoryInquiries.status, ["open", "replied"]),
              ne(inventoryInquiries.assigneeUserId, input.nextOwnerUserId),
            ),
          );
        const previousConversationIds = Array.from(
          new Set(activeInquiryCandidates.map(row => row.conversationId)),
        ).sort((a, b) => a - b);
        if (previousConversationIds.length > 0) {
          await tx.execute(sql`
            SELECT id FROM conversations
             WHERE id IN (${sql.join(previousConversationIds.map(id => sql`${id}`), sql`, `)})
             ORDER BY id ASC
             FOR UPDATE
          `);
        }
        const activeInquiries = activeInquiryCandidates.length > 0
          ? await tx
              .select()
              .from(inventoryInquiries)
              .where(
                and(
                  inArray(inventoryInquiries.id, activeInquiryCandidates.map(row => row.id)),
                  eq(inventoryInquiries.enterpriseId, scope.enterprise.id),
                  inArray(inventoryInquiries.inventoryId, input.ids),
                  inArray(inventoryInquiries.status, ["open", "replied"]),
                  ne(inventoryInquiries.assigneeUserId, input.nextOwnerUserId),
                ),
              )
              .orderBy(asc(inventoryInquiries.id))
              .for("update")
          : [];

        await tx
          .update(inventories)
          .set({
            ownerUserId: input.nextOwnerUserId,
            updatedByUserId: ctx.user.id,
            ownerAssignedAt: new Date(),
            ownershipVersion: sql`${inventories.ownershipVersion} + 1`,
          })
          .where(inArray(inventories.id, input.ids));
        await tx.insert(inventoryAssignmentLogs).values(
          lockedRows.map(row => ({
            inventoryId: row.id,
            enterpriseId: scope.enterprise.id,
            previousOwnerUserId: row.ownerUserId,
            nextOwnerUserId: input.nextOwnerUserId,
            actorUserId: ctx.user.id,
            reason: input.reason,
            batchId,
          })),
        );

        const inventoryById = new Map(lockedRows.map(row => [row.id, row]));
        let transferredInquiryCount = 0;
        for (const inquiry of activeInquiries) {
          if (inquiry.inventoryId == null) continue; // Factory sources are never ordinary inventory IDs.
          const inventory = inventoryById.get(inquiry.inventoryId);
          if (!inventory) continue;
          const buyerUserId = Number(inquiry.buyerUserId);
          const nextOwnerUserId = Number(input.nextOwnerUserId);
          if (buyerUserId === nextOwnerUserId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "接替人是该库存未结询价的采购方，不能转交" });
          }
          const user1Id = Math.min(buyerUserId, nextOwnerUserId);
          const user2Id = Math.max(buyerUserId, nextOwnerUserId);
          const conversationRows = await tx.execute(sql`
            SELECT id, user1Id, user2Id
              FROM conversations
             WHERE user1Id = ${user1Id} AND user2Id = ${user2Id}
             ORDER BY id ASC LIMIT 1 FOR UPDATE
          `);
          let conversationId = Number(
            (conversationRows as unknown as [Array<{ id: number }>, unknown])[0][0]?.id ?? 0,
          );
          if (!conversationId) {
            await tx.execute(sql`
              INSERT INTO conversations (user1Id, user2Id, lastMessagePreview)
              VALUES (${user1Id}, ${user2Id}, '')
            `);
            const insertedConversation = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
            conversationId = Number(
              (insertedConversation as unknown as [Array<{ id: number }>, unknown])[0][0]?.id ?? 0,
            );
          }
          if (!conversationId) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价转交会话创建失败" });
          }
          await tx.execute(sql`
            INSERT INTO conversation_user_settings (conversationId, userId)
            VALUES (${conversationId}, ${buyerUserId}), (${conversationId}, ${nextOwnerUserId})
            ON DUPLICATE KEY UPDATE deleted = 0
          `);

          const content = JSON.stringify({
            kind: "member_handoff",
            partNumber: inventory.partNumber,
            quantity: inquiryQuantityText(inquiry.requestedQty),
            inventoryId: inventory.id,
            sourceInquiryId: inquiry.id,
            requestId: batchId,
          });
          const transferClientMessageId = `inq-xfer-${inquiry.id}-${nextOwnerUserId}-${inventory.ownershipVersion + 1}`.slice(0, 64);
          const insertedMessage = await tx.insert(messages).values({
            conversationId,
            senderId: buyerUserId,
            clientMessageId: transferClientMessageId,
            msgType: "handoff_notice",
            content,
          });
          const messageId = Number(
            (insertedMessage as unknown as [{ insertId: number }])[0]?.insertId ?? 0,
          );
          const preview = `[询价转交] ${inventory.partNumber}`.slice(0, 200);
          await tx.execute(sql`
            UPDATE conversations
               SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
             WHERE id = ${conversationId}
          `);
          await tx.execute(sql`
            UPDATE conversation_user_settings
               SET deleted = 0,
                   unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
             WHERE conversationId = ${conversationId} AND userId = ${nextOwnerUserId}
          `);
          await tx
            .update(inventoryInquiries)
            .set({
              assigneeUserId: nextOwnerUserId,
              conversationId,
              messageId,
              transferredFromUserId: inquiry.assigneeUserId,
              lastActivityAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(inventoryInquiries.id, inquiry.id));
          transferredInquiryCount += 1;
        }

        return {
          success: true as const,
          reassignedCount: lockedRows.length,
          transferredInquiryCount,
          batchId,
        };
      });
    }),
});
