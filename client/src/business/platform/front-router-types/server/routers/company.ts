import { normalizeBankAccountNumber } from "../../../shared/bankAccountNumber";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { dataViewProcedure, previewOrQuotaProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { isOssConfigured, ossPut, storageGetAccessUrl, storagePut, storagePutPrivate, storageDelete as enterprisePhotoStorageDelete } from "../storage";
import {
  decodeAndValidateSensitiveDocument,
  MAX_SENSITIVE_DOCUMENT_BASE64_CHARS,
  sensitiveDocumentExtension,
  SENSITIVE_DOCUMENT_MIME_TYPES,
  type SensitiveDocumentMimeType,
} from "../services/sensitiveDocument";
import { canAccessCompanySensitiveDocuments } from "../services/companySensitiveDocumentAccess";
import {
  getBusinessLicenseOcrErrorMeta,
  isPdfLicenseOcrAvailable,
  isPdfMimeType,
  recognizeBusinessLicense,
  type BusinessLicenseExtractResult,
} from "../services/businessLicenseOcr";
import {
  getBankAccountLicenseOcrErrorMeta,
  isPdfBankLicenseOcrAvailable,
  recognizeBankAccountLicense,
  type BankAccountLicenseExtractResult,
} from "../services/bankAccountLicenseOcr";
import { PdfConvertError } from "../services/pdfToImage";
import { bankLicenseMissingForApplication } from "../bankLicenseRequirement";
import {
  getAdminCrmAccess,
  listAdminSalesStaff,
  submitAdminCrmApplication,
} from "../services/customerService";
import { reconcileCrmAccessForUser } from "../services/crmAccessSync";
import {
  claimEnterpriseForCrmApplication,
  linkCompanyToEnterprise,
  resolveCrmTargetForUser,
} from "../services/enterpriseAccess";
import {
  assertMainlandApplicationLicense,
  DUPLICATE_ENTERPRISE_OPENING_MESSAGE,
  preflightEnterpriseApplication,
} from "../services/enterpriseApplicationPreflight";
import {
  COMPANY_PHOTO_LIMIT,
  createManagedCompanyPhoto,
  enterprisePhotoUploadWithCleanup,
  deleteManagedCompanyPhoto,
  findExactPublicCompany,
  getPublicCompanyInventory,
  getPublicCompanyProfile,
  getPublicCompanySummary,
  listFeaturedSuppliers,
  listManagedCompanyPhotos,
  setManagedCompanyAvatar,
  setManagedCompanyHomeCover,
  suggestPublicCompanies,
} from "../services/companyPublicProfile";
import { projectPublicHomeSupplierLists } from "../services/homeSuppliersPublicProjection";
import {
  clearCompanySearchHistory,
  getCompanySearchHistory,
  getPopularCompanySearches,
  recordCompanySearchEvent,
} from "../services/companySearchHistory";
import {
  addCompanyDailyLike,
  getCompanyLikeSummary,
} from "../services/companyDailyLike";
import { notifyCompanyLikeAdministrators } from "../services/companyLikeNotifications";
import { issueMaterialExposureToken, materialExposureAudience } from "../services/searchHeat";
import { trustedClientIp } from "../trustedClientIp";
import {
  ENTERPRISE_SERVICE_AGREEMENT_HASH,
  ENTERPRISE_SERVICE_AGREEMENT_NAME,
  ENTERPRISE_SERVICE_AGREEMENT_VERSION,
} from "../../../shared/enterpriseServiceAgreementContent";
import { isValidCompanyEstablishedAt } from "../../../shared/companyEstablishedAt";
import { hkRegistrationDataSchema } from "../../../shared/hongKongRegistration";
import { getHongKongDraft, hongKongCapabilities, submitHongKongApplication, uploadHongKongDocument } from "../services/hongKongCompanyRegistration";
import { getAdminHkCrmAccess } from "../services/customerService";

export type LicenseExtractResult = BusinessLicenseExtractResult;
export type BankLicenseExtractResult = BankAccountLicenseExtractResult;

const companyPhotoMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const companyPhotoCategorySchema = z.enum(["storefront", "office", "warehouse", "production", "team", "other"]);
const companyAvatarDisplayModeSchema = z.enum(["logo", "photo"]);
const MAX_COMPANY_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_COMPANY_PHOTO_THUMBNAIL_BYTES = 1024 * 1024;
const sensitiveDocumentMimeSchema = z.enum(SENSITIVE_DOCUMENT_MIME_TYPES);
const PRIVATE_DOCUMENT_URL_TTL_SECONDS = 15 * 60;

type PublicCompanyProfile = NonNullable<Awaited<ReturnType<typeof getPublicCompanyProfile>>>;
type PublicCompanySummary = NonNullable<Awaited<ReturnType<typeof getPublicCompanySummary>>>;
type PublicCompanySuggestion = Awaited<ReturnType<typeof suggestPublicCompanies>>[number];
type PublicCompanyInventory = NonNullable<Awaited<ReturnType<typeof getPublicCompanyInventory>>>;

/**
 * 未登录访问公司页时只保留企业识别和“有货”的粗粒度信号。
 * 联系方式、工商登记字段、精确上架数和更新时间不能作为匿名商情下发。
 */
export function projectAnonymousCompanyProfile(profile: PublicCompanyProfile) {
  const { contact: _contact, licenseInfo: _licenseInfo, business, basicInfo, photos, ...publicProfile } = profile;
  const { companyType: _companyType, companyRole: _companyRole, ...publicBasicInfo } = basicInfo;
  const { listingCount: _listingCount, latestPublishedAt: _latestPublishedAt, ...publicBusiness } = business;
  return {
    ...publicProfile,
    basicInfo: publicBasicInfo,
    business: { ...publicBusiness, availability: "有货" as const },
    photos: photos.map(({ name: _name, caption: _caption, ...safeImage }) => safeImage),
  };
}

/** 悬浮速览同样不能成为匿名获取企业注册地址或精确型号数的旁路。 */
export function projectAnonymousCompanySummary(summary: PublicCompanySummary) {
  const {
    contact: _contact,
    companyType: _companyType,
    listingCount: _listingCount,
    mainCategories: _mainCategories,
    establishedAt: _establishedAt,
    registeredAddress: _registeredAddress,
    ...publicSummary
  } = summary;
  return { ...publicSummary, availability: "有货" as const };
}

/** 公司联想只证明企业有在售物料，不返回可被批量汇总的精确 listingCount。 */
export function projectAnonymousCompanySuggestion(suggestion: PublicCompanySuggestion) {
  const { listingCount: _listingCount, ...publicSuggestion } = suggestion;
  return { ...publicSuggestion, availability: "有货" as const };
}

/** 公司物料页的游客清单仅允许型号、品牌和粗略有货状态。 */
export function projectAnonymousCompanyInventory(result: PublicCompanyInventory) {
  const seen = new Set<string>();
  return {
    availability: "有货" as const,
    items: result.items.flatMap(item => {
      const key = `${item.partNumber.normalize("NFKC").toUpperCase()}\u0000${item.brand.normalize("NFKC").toUpperCase()}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ partNumber: item.partNumber, brand: item.brand, availability: "有货" as const }];
    }),
  };
}

async function privateDocumentAccessUrl(
  objectKey: string | null | undefined,
  legacyUrl: string | null | undefined,
): Promise<string | null> {
  // Legacy rows retain their historical URL until a deliberate migration can re-home the object.
  // New rows have no public URL and only receive a short-lived URL after this owner-authorized call.
  if (objectKey) return storageGetAccessUrl(objectKey, PRIVATE_DOCUMENT_URL_TTL_SECONDS);
  return legacyUrl ?? null;
}

function companyPhotoExtension(mimeType: z.infer<typeof companyPhotoMimeSchema>) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

function companyPhotoMatchesMime(data: Buffer, mimeType: z.infer<typeof companyPhotoMimeSchema>) {
  if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
}

export const companyProfileInput = z.object({
  companyName: z.string().min(2, "请输入企业名称").max(128),
  creditCode: z
    .string()
    .regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/, "请输入18位统一社会信用代码"),
  companyType: z.string().trim().min(1, "企业类型为必填项").max(128),
  legalPerson: z.string().trim().min(1, "法定代表人为必填项").max(64),
  companyRole: z.string().trim().max(64).nullable().optional(),
  bankAccountName: z.string().trim().min(1, "账户名称为必填项").max(128),
  bankAccountNumber: z.string().transform(normalizeBankAccountNumber).pipe(z.string().min(1, "账户号码为必填项").max(64)),
  bankName: z.string().trim().min(1, "开户行为必填项").max(128),
  regAddress: z.string().trim().min(1, "注册地址为必填项").max(255),
  establishedAt: z.union([
    z.string().refine(isValidCompanyEstablishedAt, "请输入营业执照上的有效成立时间"),
    z.null(),
  ]).optional(),
  salesOwner: z.string().max(64).optional(),
  /** 销售负责人工号；优先依工号匹配，避免重名员工歧义 */
  salesOwnerCode: z.string().max(64).optional().nullable(),
  agreementAccepted: z.boolean().refine(Boolean, "请先阅读并同意《51电子网开通企业服务协议》"),
  agreementVersion: z.literal(ENTERPRISE_SERVICE_AGREEMENT_VERSION),
  agreementHash: z.literal(ENTERPRISE_SERVICE_AGREEMENT_HASH),
});

async function recordEnterpriseAgreementAcceptance(
  ctx: {
    user: { id: number };
    req: Parameters<typeof trustedClientIp>[0] & { headers: Record<string, unknown> };
  },
  input: z.infer<typeof companyProfileInput>,
) {
  const userAgentHeader = ctx.req.headers["user-agent"];
  await db.recordEnterpriseServiceAgreementAcceptance({
    userId: ctx.user.id,
    companyNameSnapshot: input.companyName,
    creditCodeSnapshot: input.creditCode,
    agreementName: ENTERPRISE_SERVICE_AGREEMENT_NAME,
    agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
    agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
    acceptedAt: new Date(),
    ip: trustedClientIp(ctx.req),
    userAgent: String(
      Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader || "",
    ).slice(0, 512) || null,
  });
}

/**
 * 校验并规范化销售负责人：只接受后台启用人员。
 *
 * 不能直接信任前端传值：自由文本会让后台拿到无法匹配的姓名，
 * 审核人无法判定归属；请求后台列表失败时必须阻断保存，
 * 否则会把未校验的姓名写进企业资料。
 */
async function normalizeSalesOwner<T extends z.infer<typeof companyProfileInput>>(
  input: T,
): Promise<T> {
  const requestedCode = input.salesOwnerCode?.trim().toLowerCase() || null;
  const requestedName = input.salesOwner?.trim() || null;
  if (!requestedCode && !requestedName) {
    // 销售负责人是选填项，两者均空时清空而不报错
    return { ...input, salesOwner: undefined, salesOwnerCode: null };
  }
  let staff;
  try {
    staff = await listAdminSalesStaff();
  } catch (error) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "销售负责人列表暂时不可用，请稍后重试",
      cause: error,
    });
  }
  const matched = requestedCode
    ? staff.find(item => item.staffCode === requestedCode)
    : staff.find(
        item => item.displayName.toLowerCase() === requestedName?.toLowerCase(),
      );
  if (!matched) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请选择有效的销售负责人" });
  }
  return { ...input, salesOwner: matched.displayName, salesOwnerCode: matched.staffCode };
}

function toLocalCompanyInput(input: z.infer<typeof companyProfileInput>) {
  return {
    companyName: input.companyName,
    creditCode: input.creditCode,
    companyType: input.companyType,
    legalPerson: input.legalPerson,
    companyRole: input.companyRole?.trim() || null,
    bankAccountName: input.bankAccountName,
    bankAccountNumber: input.bankAccountNumber,
    bankName: input.bankName,
    regAddress: input.regAddress,
    establishedAt: input.establishedAt || null,
    salesOwner: input.salesOwner || null,
    salesOwnerCode: input.salesOwnerCode || null,
  };
}

/**
 * A historical owner can have more than one linked company row. Only resolve the enterprise
 * selector for a genuinely empty linked row, preserving ordinary personal-draft behavior and
 * active-member permission semantics.
 */
async function applicationCompanyForUser(userId: number) {
  const direct = await db.getCompanyByUserId(userId);
  const isEmptyEnterpriseLinkedRow = Boolean(
    direct?.enterpriseId
    && !direct.creditCode?.trim()
    && !direct.registrationIdentifier?.trim()
    && !direct.companyName?.trim(),
  );
  if (!isEmptyEnterpriseLinkedRow) return direct;
  const target = await resolveCrmTargetForUser(userId);
  return target.enterprise && target.member?.status === "active" && target.company
    ? target.company
    : direct;
}

function isDuplicateEnterpriseOpeningResponse(result: { code?: string } | null | undefined) {
  return result?.code === "CRM_ALREADY_ENABLED" || result?.code === "CRM_DUPLICATE_OPENING";
}

/** 调用阿里云官方 OCR 识别营业执照，导出供契约与真实凭证测试。 */
export async function extractLicenseInfo(
  dataUrl: string,
  mimeType = "image/png",
): Promise<LicenseExtractResult> {
  return recognizeBusinessLicense(dataUrl, mimeType);
}

/** 调用阿里云官方 OCR 识别银行资料，导出供契约与真实凭证测试。 */
export async function extractBankLicenseInfo(
  dataUrl: string,
  mimeType = "image/png",
): Promise<BankLicenseExtractResult> {
  return recognizeBankAccountLicense(dataUrl, mimeType);
}

export const companyRouter = router({
  hkCapabilities: protectedProcedure.query(() => hongKongCapabilities()),
  hkDraft: protectedProcedure.query(({ ctx }) => getHongKongDraft(ctx.user.id)),
  uploadHkDocument: protectedProcedure.input(z.object({
    kind: z.enum(["BR", "CI", "BANK"]),
    fileName: z.string().trim().min(1).max(255),
    base64: z.string().min(1).max(MAX_SENSITIVE_DOCUMENT_BASE64_CHARS),
    mimeType: sensitiveDocumentMimeSchema,
  })).mutation(({ ctx, input }) => uploadHongKongDocument(ctx.user.id, input)),
  submitHkApplication: protectedProcedure.input(z.object({
    registrationData: hkRegistrationDataSchema,
    documents: z.object({ BR: z.string().uuid(), CI: z.string().uuid().optional(), BANK: z.string().uuid() }),
    agreementAccepted: z.literal(true),
    agreementVersion: z.literal(ENTERPRISE_SERVICE_AGREEMENT_VERSION),
    agreementHash: z.literal(ENTERPRISE_SERVICE_AGREEMENT_HASH),
  })).mutation(({ ctx, input }) => submitHongKongApplication(ctx.user, input, {
    ip: trustedClientIp(ctx.req), userAgent: String(ctx.req.headers["user-agent"] || "").slice(0, 512) || null,
  })),

  searchHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(10) }))
    .query(({ ctx, input }) => getCompanySearchHistory(ctx.user.id, input.limit)),

  recordSearchHistory: protectedProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => ({
      ok: await recordCompanySearchEvent(ctx.user.id, input.supplierId),
    })),

  clearSearchHistory: protectedProcedure.mutation(async ({ ctx }) => {
    await clearCompanySearchHistory(ctx.user.id);
    return { ok: true as const };
  }),

  popularSearches: dataViewProcedure
    .input(z.object({ limit: z.number().int().min(1).max(12).default(8) }))
    .query(({ input }) => getPopularCompanySearches(input.limit)),

  /** 首页“搜公司”：完整名称唯一匹配后只返回企业主页所需的供应商 ID。 */
  findExactByName: dataViewProcedure
    .input(z.object({ companyName: z.string().trim().min(2, "请输入完整公司名称").max(128) }))
    .query(async ({ input }) => findExactPublicCompany(input.companyName)),

  /** 输入两个字后返回最多 8 家可公开认证企业，点击候选直接进入企业主页。 */
  suggestByName: previewOrQuotaProcedure
    .input(z.object({
      keyword: z.string().trim().min(2).max(64),
      limit: z.number().int().min(1).max(8).default(8),
    }))
    .query(async ({ ctx, input }) => {
      const suggestions = await suggestPublicCompanies(input.keyword, input.limit);
      // Keep the existing authenticated response contract.  The cast is intentional:
      // runtime anonymous responses are the narrower safe projection above.
      return ctx.user
        ? suggestions
        : suggestions.map(projectAnonymousCompanySuggestion) as unknown as typeof suggestions;
    }),

  /**
   * 企业公开主页的唯一资料出口。
   *
   * supplierId 是搜索结果中的供应商主账号 ID。服务层只返回已审核、已认证、已开通 ERP
   * 且注册资料合格的企业，不要求存在库存；物料列表仍按发布/展示状态过滤。
   */
  publicProfile: previewOrQuotaProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      return ctx.user
        ? profile
        : projectAnonymousCompanyProfile(profile) as unknown as typeof profile;
    }),

  /** 搜索结果稳定悬停后才请求；联系方式仅对登录用户返回，绝不携带证照。 */
  publicSummary: previewOrQuotaProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const summary = await getPublicCompanySummary(input.supplierId, Boolean(ctx.user));
      if (!summary) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      return ctx.user
        ? summary
        : projectAnonymousCompanySummary(summary) as unknown as typeof summary;
    }),

  /** 公司主页点赞状态：总数公开，登录用户额外返回今天是否已点赞。 */
  publicLikeSummary: publicProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      return getCompanyLikeSummary({
        supplierId: input.supplierId,
        userId: ctx.user?.id,
      });
    }),

  /** 同一登录账号对同一公司按北京时间自然日每天最多点赞一次。 */
  likeToday: protectedProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      const result = await addCompanyDailyLike({
        supplierId: input.supplierId,
        userId: ctx.user.id,
      });
      if (result.inserted && result.likeId) {
        await notifyCompanyLikeAdministrators({
          likeId: result.likeId,
          likerUserId: ctx.user.id,
          likedSupplierId: input.supplierId,
          likedAt: result.likedAt,
        });
      }
      const { likeId: _likeId, likedAt: _likedAt, ...publicResult } = result;
      return publicResult;
    }),

  /** 企业公开主页：只分页展示允许公司页公开的已发布物料；仅精确搜索可见库存不返回。 */
  publicInventory: previewOrQuotaProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
      keyword: z.string().trim().max(64).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const result = await getPublicCompanyInventory(ctx.user ? input : { ...input, page: 1, pageSize: 10 });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      const visibleResult = ctx.user
        ? result
        : projectAnonymousCompanyInventory(result) as unknown as typeof result;
      return {
        ...visibleResult,
        exposureToken: ctx.user
          ? issueMaterialExposureToken(
              visibleResult.items.map(item => item.partNumber),
              "company_inventory",
              materialExposureAudience(ctx.req, ctx.user.id),
            )
          : null,
      };
    }),

  /**
   * 首页供应商双展示位：优质商家与入驻商家各自独立限额，
   * 服务层只返回当前具备公开展示资格的公司，不含联系人等敏感字段。
   */
  featuredSuppliers: dataViewProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => {
      const lists = await listFeaturedSuppliers(input?.limit ?? 20);
      return projectPublicHomeSupplierLists(lists);
    }),
  /** ERP 企业信息页：查询本企业公司信息墙，包含尚未公开的状态字段。 */
  profilePhotos: protectedProcedure.query(async ({ ctx }) => {
    const result = await listManagedCompanyPhotos(ctx.user.id);
    if (!result) {
      throw new TRPCError({ code: "FORBIDDEN", message: "仅已认证企业可管理公司信息墙" });
    }
    return { ...result, limit: COMPANY_PHOTO_LIMIT };
  }),

  /** ERP 企业信息页：从本企业照片中设置搜索展示图，或传 null 取消展示。 */
  setProfileAvatar: protectedProcedure
    .input(z.object({
      photoId: z.number().int().positive().nullable(),
      displayMode: companyAvatarDisplayModeSchema.default("logo"),
      crop: z.object({
        zoom: z.number().min(1).max(2),
        offsetX: z.number().int().min(-100).max(100),
        offsetY: z.number().int().min(-100).max(100),
      }).default({ zoom: 1, offsetX: 0, offsetY: 0 }),
    }))
    .mutation(async ({ ctx, input }) => {
      const selected = await setManagedCompanyAvatar(
        ctx.user.id,
        input.photoId,
        input.displayMode,
        input.crop,
      );
      if (selected === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅已认证企业可管理公司头像" });
      }
      if (selected === false) {
        throw new TRPCError({ code: "NOT_FOUND", message: "照片不存在、未通过审核或不属于当前企业" });
      }
      return {
        success: true as const,
        avatarPhotoId: selected.avatarPhotoId,
        avatarDisplayMode: selected.avatarDisplayMode,
        avatarCrop: selected.avatarCrop,
      };
    }),

  /** ERP 企业信息页：从本企业已审核照片中设置首页公司展示主图。 */
  setProfileHomeCover: protectedProcedure
    .input(z.object({
      photoId: z.number().int().positive().nullable(),
      displayMode: companyAvatarDisplayModeSchema.default("photo"),
      crop: z.object({
        zoom: z.number().min(1).max(2),
        offsetX: z.number().int().min(-100).max(100),
        offsetY: z.number().int().min(-100).max(100),
      }).default({ zoom: 1, offsetX: 0, offsetY: 0 }),
    }))
    .mutation(async ({ ctx, input }) => {
      const selected = await setManagedCompanyHomeCover(
        ctx.user.id,
        input.photoId,
        input.displayMode,
        input.crop,
      );
      if (selected === null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅已认证企业可管理公司展示主图" });
      }
      if (selected === false) {
        throw new TRPCError({ code: "NOT_FOUND", message: "照片不存在、未通过审核或不属于当前企业" });
      }
      return {
        success: true as const,
        homeCoverPhotoId: selected.homeCoverPhotoId,
        homeCoverDisplayMode: selected.homeCoverDisplayMode,
        homeCoverCrop: selected.homeCoverCrop,
      };
    }),

  /** ERP 企业信息页：上传公司照片，图片经格式与归属校验后才写入信息墙。 */
  uploadProfilePhoto: protectedProcedure
    .input(z.object({
      fileName: z.string().trim().min(1).max(255),
      base64: z.string().min(1),
      thumbnailBase64: z.string().min(1),
      mimeType: companyPhotoMimeSchema,
      category: companyPhotoCategorySchema.default("other"),
      caption: z.string().trim().max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const managed = await listManagedCompanyPhotos(ctx.user.id);
      if (!managed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅已认证企业可上传公司照片" });
      }
      if (managed.photos.length >= COMPANY_PHOTO_LIMIT) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `公司信息墙最多上传 ${COMPANY_PHOTO_LIMIT} 张照片` });
      }
      const buffer = Buffer.from(input.base64, "base64");
      if (!buffer.length || buffer.length > MAX_COMPANY_PHOTO_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "单张公司照片不能超过 8MB" });
      }
      if (!companyPhotoMatchesMime(buffer, input.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "图片内容与文件格式不一致" });
      }
      const thumbnailBuffer = Buffer.from(input.thumbnailBase64, "base64");
      if (!thumbnailBuffer.length || thumbnailBuffer.length > MAX_COMPANY_PHOTO_THUMBNAIL_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "图片缩略图生成失败，请重新选择图片" });
      }
      if (!companyPhotoMatchesMime(thumbnailBuffer, "image/webp")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "图片缩略图格式无效，请重新选择图片" });
      }
      const extension = companyPhotoExtension(input.mimeType);
      const nonce = `${Date.now()}-${randomUUID()}`;
      const objectKey = `company-wall/${managed.companyId}/${nonce}.${extension}`;
      const thumbnailObjectKey = `company-wall/${managed.companyId}/thumbs/${nonce}.webp`;
      const put = isOssConfigured() ? ossPut : storagePut;
      return enterprisePhotoUploadWithCleanup([
        () => put(objectKey, buffer, input.mimeType),
        () => put(thumbnailObjectKey, thumbnailBuffer, "image/webp"),
      ], async (originalStored, thumbnailStored) => {
        const created = await createManagedCompanyPhoto({
          userId: ctx.user.id,
          objectKey: originalStored.key,
          url: originalStored.url,
          thumbnailObjectKey: thumbnailStored.key,
          thumbnailUrl: thumbnailStored.url,
          name: input.fileName,
          mimeType: input.mimeType,
          category: input.category,
          caption: input.caption?.trim() || null,
        });
        if (!created) {
          throw new TRPCError({ code: "FORBIDDEN", message: "企业认证状态已发生变化，请刷新后重试" });
        }
        return { success: true as const, id: created.id, url: originalStored.url, thumbnailUrl: thumbnailStored.url };
      }, enterprisePhotoStorageDelete);
    }),

  /** ERP 企业信息页：仅可软删除本企业照片，避免越权及误删审计数据。 */
  deleteProfilePhoto: protectedProcedure
    .input(z.object({ photoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await deleteManagedCompanyPhoto(ctx.user.id, input.photoId);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "照片不存在或不属于当前企业" });
      }
      return { success: true as const };
    }),

  /** 动态销售负责人下拉；只返回后台启用人员，不在前端硬编码员工姓名。 */
  salesStaff: protectedProcedure.query(async () => listAdminSalesStaff()),

  /** 当前账号是否已接受当前版本企业服务协议；协议升级后会自动要求重新确认。 */
  enterpriseAgreementStatus: protectedProcedure.query(async ({ ctx }) => ({
    accepted: await db.hasEnterpriseServiceAgreementAcceptance(
      ctx.user.id,
      ENTERPRISE_SERVICE_AGREEMENT_VERSION,
      ENTERPRISE_SERVICE_AGREEMENT_HASH,
    ),
    agreementName: ENTERPRISE_SERVICE_AGREEMENT_NAME,
    agreementVersion: ENTERPRISE_SERVICE_AGREEMENT_VERSION,
    agreementHash: ENTERPRISE_SERVICE_AGREEMENT_HASH,
  })),

  /** 获取当前用户企业信息 */
  get: protectedProcedure.query(async ({ ctx }) => {
    await reconcileCrmAccessForUser(ctx.user);
    const target = await resolveCrmTargetForUser(ctx.user.id);
    const company = target.company;
    if (!company) return null;
    // An enterprise-linked account must still be an active member before it can
    // receive any company response or a signed document URL. Keep the legacy
    // unclaimed-HK rejection: an HK company cannot be read through its former
    // personal-company path by a non-administrator.
    if (ctx.user.role !== "admin" && target.enterprise && target.member?.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有有效企业成员权限" });
    }
    if (ctx.user.role !== "admin" && company.registrationRegion === "HK" && !target.enterprise) {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有有效企业成员权限" });
    }
    // 有待审核草稿时，表单展示草稿内容（用户最近一次提交的内容）；生效字段维持原信息
    let draft: db.CompanyDraft | null = null;
    if (company.pendingDraft) {
      try {
        draft = JSON.parse(company.pendingDraft) as db.CompanyDraft;
      } catch {
        draft = null;
      }
    }
    const {
      licenseObjectKey,
      bankLicenseObjectKey,
      registrationData,
      licenseUrl: legacyLicenseUrl,
      bankLicenseUrl: legacyBankLicenseUrl,
      ...safeCompany
    } = company;
    // Enterprise members may manage ordinary company data, but identity/banking evidence is
    // visible only to the evidence owner or a platform administrator.
    const canAccessSensitiveDocuments = canAccessCompanySensitiveDocuments({
      actorUserId: ctx.user.id,
      actorRole: ctx.user.role,
      registrationRegion: company.registrationRegion,
      companyOwnerUserId: company.userId,
      enterpriseSuperAdminUserId: target.enterprise?.superAdminUserId,
    });
    const [licenseAccessUrl, bankLicenseAccessUrl] = canAccessSensitiveDocuments
      ? await Promise.all([
          privateDocumentAccessUrl(licenseObjectKey, legacyLicenseUrl),
          privateDocumentAccessUrl(bankLicenseObjectKey, legacyBankLicenseUrl),
        ])
      : [null, null];
    if (company.registrationRegion === "HK") {
      return { ...safeCompany, pendingDraft: null, draft: canAccessSensitiveDocuments ? draft : null,
        registrationData: canAccessSensitiveDocuments ? registrationData : null, licenseAccessUrl, bankLicenseAccessUrl,
        registrationIdentifier: canAccessSensitiveDocuments ? company.registrationIdentifier : null,
        registrationSubmissionId: canAccessSensitiveDocuments ? company.registrationSubmissionId : null,
        registrationPayloadHash: canAccessSensitiveDocuments ? company.registrationPayloadHash : null,
        creditCode: canAccessSensitiveDocuments ? company.creditCode : null,
        legalPerson: canAccessSensitiveDocuments ? company.legalPerson : null,
        bankInfo: canAccessSensitiveDocuments ? company.bankInfo : null,
        bankAccountName: canAccessSensitiveDocuments ? company.bankAccountName : null,
        bankAccountNumber: canAccessSensitiveDocuments ? company.bankAccountNumber : null,
        bankName: canAccessSensitiveDocuments ? company.bankName : null,
        licenseFileName: canAccessSensitiveDocuments ? company.licenseFileName : null,
        bankLicenseFileName: canAccessSensitiveDocuments ? company.bankLicenseFileName : null };
    }
    return { ...safeCompany, pendingDraft: canAccessSensitiveDocuments ? company.pendingDraft : null,
      registrationData: null, draft: canAccessSensitiveDocuments ? draft : null, licenseAccessUrl, bankLicenseAccessUrl,
      registrationIdentifier: canAccessSensitiveDocuments ? company.registrationIdentifier : null,
      registrationSubmissionId: canAccessSensitiveDocuments ? company.registrationSubmissionId : null,
      registrationPayloadHash: canAccessSensitiveDocuments ? company.registrationPayloadHash : null,
      creditCode: canAccessSensitiveDocuments ? company.creditCode : null,
      legalPerson: canAccessSensitiveDocuments ? company.legalPerson : null,
      bankInfo: canAccessSensitiveDocuments ? company.bankInfo : null,
      bankAccountName: canAccessSensitiveDocuments ? company.bankAccountName : null,
      bankAccountNumber: canAccessSensitiveDocuments ? company.bankAccountNumber : null,
      bankName: canAccessSensitiveDocuments ? company.bankName : null,
      licenseFileName: canAccessSensitiveDocuments ? company.licenseFileName : null,
      bankLicenseFileName: canAccessSensitiveDocuments ? company.bankLicenseFileName : null };
  }),

  /**
   * 保存企业资料：提交后进入人工审核（reviewStatus=pending），
   * 审核通过前不开通 CRM 权限；修改资料再次提交同样重新进入待审核，
   * 审核期间已开通的 crmAccess 保持不变（不回收）。
   * 已通过审核的企业修改资料：原信息维持生效，新内容存为待审核草稿，审核通过后才替换。
   */
  save: protectedProcedure
    .input(companyProfileInput)
    .mutation(async ({ ctx, input: rawInput }) => {
      const saved = await applicationCompanyForUser(ctx.user.id);
      if (saved?.registrationRegion === "HK") throw new TRPCError({ code: "CONFLICT", message: "香港企业资料请通过香港申请表提交，不可变更注册地区" });
      if (bankLicenseMissingForApplication(saved, ctx.user.crmAccess)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先上传银行资料（开户许可证或基本存款账户信息表）" });
      }
      assertMainlandApplicationLicense({ company: saved, requestedCreditCode: rawInput.creditCode });
      await preflightEnterpriseApplication({
        userId: ctx.user.id,
        companyName: rawInput.companyName,
        creditCode: rawInput.creditCode,
        privateLicenseObjectKey: saved?.licenseObjectKey,
        purpose: "review-update",
      });
      const input = await normalizeSalesOwner(rawInput);
      await recordEnterpriseAgreementAcceptance(ctx, input);
      let adminResult;
      try {
        adminResult = await submitAdminCrmApplication({
          company: {
            companyName: input.companyName,
            creditCode: input.creditCode,
            companyType: input.companyType,
            legalPerson: input.legalPerson,
            companyRole: input.companyRole ?? "",
            regAddress: input.regAddress,
            bankAccountName: input.bankAccountName,
            bankAccountNumber: input.bankAccountNumber,
            bankName: input.bankName,
            salesOwner: input.salesOwner,
            // 工号必须一并同步，否则后台归属为空，销售看不到名下客户。
            salesOwnerCode: input.salesOwnerCode,
            // 跨系统只传稳定对象键；后台在授权查看时实时签发短时 URL，禁止持久化临时 URL。
            licenseObjectKey: saved?.licenseObjectKey,
            licenseUrl: saved?.licenseObjectKey ? null : saved?.licenseUrl,
            agreementAccepted: true,
            agreementVersion: input.agreementVersion,
            agreementHash: input.agreementHash,
          },
          user: {
            id: ctx.user.id,
            name: ctx.user.name,
            phone: (ctx.user as any).phone ?? null,
            email: (ctx.user as any).email ?? null,
          },
        });
      } catch (error) {
        console.error("[company.save] 后台提交失败", {
          userId: ctx.user.id,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: error instanceof Error && error.message
            ? error.message
            : "提交失败：暂时连不上审核系统，请稍后重试；若反复失败请联系平台客服。",
          cause: error,
        });
      }
      const company = await db.submitCompanyForReview(ctx.user.id, toLocalCompanyInput(input));
      return { success: true, company, crm: adminResult } as const;
    }),

  /**
   * 商城 CRM 开通申请：后台审核系统先接受并绑定商城账号，成功后才写本地展示缓存。
   * 后台失败时必须显式返回错误，禁止出现前台提示成功但后台没有记录的伪成功。
   */
  submitCrmApplication: protectedProcedure
    .input(companyProfileInput)
    .mutation(async ({ ctx, input: rawInput }) => {
      const saved = await applicationCompanyForUser(ctx.user.id);
      if (saved?.registrationRegion === "HK") throw new TRPCError({ code: "CONFLICT", message: "香港企业资料请通过香港申请表提交，不可变更注册地区" });
      if (bankLicenseMissingForApplication(saved, ctx.user.crmAccess)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请先上传银行资料（开户许可证或基本存款账户信息表）" });
      }
      assertMainlandApplicationLicense({ company: saved, requestedCreditCode: rawInput.creditCode });
      await preflightEnterpriseApplication({
        userId: ctx.user.id,
        companyName: rawInput.companyName,
        creditCode: rawInput.creditCode,
        privateLicenseObjectKey: saved?.licenseObjectKey,
        purpose: "opening",
      });
      const input = await normalizeSalesOwner(rawInput);
      await recordEnterpriseAgreementAcceptance(ctx, input);
      let adminResult;
      try {
        adminResult = await submitAdminCrmApplication({
          company: {
            companyName: input.companyName,
            creditCode: input.creditCode,
            companyType: input.companyType,
            legalPerson: input.legalPerson,
            companyRole: input.companyRole ?? "",
            regAddress: input.regAddress,
            bankAccountName: input.bankAccountName,
            bankAccountNumber: input.bankAccountNumber,
            bankName: input.bankName,
            salesOwner: input.salesOwner,
            // 工号必须一并同步，否则后台归属为空，销售看不到名下客户。
            salesOwnerCode: input.salesOwnerCode,
            // 跨系统只传稳定对象键；后台在授权查看时实时签发短时 URL，禁止持久化临时 URL。
            licenseObjectKey: saved?.licenseObjectKey,
            licenseUrl: saved?.licenseObjectKey ? null : saved?.licenseUrl,
            agreementAccepted: true,
            agreementVersion: input.agreementVersion,
            agreementHash: input.agreementHash,
          },
          user: {
            id: ctx.user.id,
            name: ctx.user.name,
            phone: (ctx.user as any).phone ?? null,
            email: (ctx.user as any).email ?? null,
          },
        });
      } catch (error) {
        console.error("[company.submitCrmApplication] 后台提交失败", {
          userId: ctx.user.id,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          // error.message 已由 describeAdminError 翻译为「哪个字段错、去哪改」的中文，
          // 直接透传给用户；仅在拿不到诊断时才用兜底文案（兼容超时、断网等非校验类故障）。
          message: error instanceof Error && error.message
            ? error.message
            : "提交失败：暂时连不上审核系统，请稍后重试；若反复失败请联系平台客服。",
          cause: error,
        });
      }
      if (isDuplicateEnterpriseOpeningResponse(adminResult)) {
        throw new TRPCError({ code: "CONFLICT", message: DUPLICATE_ENTERPRISE_OPENING_MESSAGE });
      }
      const claim = await claimEnterpriseForCrmApplication({
        userId: ctx.user.id,
        creditCode: input.creditCode,
        companyName: input.companyName,
      });
      const company = await db.submitCompanyForReview(ctx.user.id, toLocalCompanyInput(input));
      await linkCompanyToEnterprise(ctx.user.id, claim.enterprise.id);
      return {
        success: true,
        company: { ...company, enterpriseId: claim.enterprise.id },
        enterprise: claim.enterprise,
        crm: adminResult,
      } as const;
    }),

  /** 查询后台 CRM 权限并同步本地兼容缓存；只有后台明确允许才可放行。 */
  crmStatus: protectedProcedure.query(async ({ ctx }) => {
    const target = await resolveCrmTargetForUser(ctx.user.id);
    const company = target.company;
    if (target.member?.status === "suspended") {
      await db.setCrmAccess(ctx.user.id, false);
      return {
        allowed: false,
        code: "CRM_ENTERPRISE_MEMBER_SUSPENDED",
        crmStatus: "disabled" as const,
        message: "企业成员身份已暂停",
        source: "enterprise-member" as const,
      };
    }
    if (company?.registrationRegion === "HK") {
      try {
        const status = await getAdminHkCrmAccess({ registrationIdentifier: company.registrationIdentifier || "", portalUserId: target.portalOwnerUserId });
        await db.applyAdminCrmAccess(ctx.user.id, status);
        return { ...status, source: "admin" as const };
      } catch {
        return { allowed: false, code: "CRM_STATUS_UNAVAILABLE", crmStatus: "unavailable" as const,
          message: "ERP审核状态暂时无法刷新，请稍后重试", source: "unavailable" as const };
      }
    }
    if (!company?.creditCode) {
      await db.setCrmAccess(ctx.user.id, false);
      return {
        allowed: false,
        code: "CRM_COMPANY_REQUIRED",
        crmStatus: "none" as const,
        message: "请先提交企业开通申请",
        source: "company-required" as const,
      };
    }
    try {
      const status = await getAdminCrmAccess({
        creditCode: company.creditCode,
        portalUserId: target.portalOwnerUserId,
      });
      await db.applyAdminCrmAccess(ctx.user.id, status);
      return { ...status, source: "admin" as const };
    } catch (error) {
      console.error("[company.crmStatus] 后台查询失败", {
        userId: ctx.user.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        allowed: false,
        code: "CRM_STATUS_UNAVAILABLE",
        crmStatus: "unavailable" as const,
        message: "ERP 审核状态暂时无法刷新，请稍后重试",
        source: "unavailable" as const,
      };
    }
  }),

  /** 上传营业执照至私有 OSS；MIME、魔数/结构和大小均在服务端验证。 */
  uploadLicense: protectedProcedure
    .input(z.object({
      fileName: z.string().trim().min(1).max(255),
      /** Canonical base64, without a data: prefix. */
      base64: z.string().min(1).max(MAX_SENSITIVE_DOCUMENT_BASE64_CHARS),
      mimeType: sensitiveDocumentMimeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const target = await resolveCrmTargetForUser(ctx.user.id);
      if (target.enterprise?.registrationRegion === "HK" || target.company?.registrationRegion === "HK") {
        throw new TRPCError({ code: "CONFLICT", message: "香港企业证件请通过香港申请表上传" });
      }
      let buffer: Buffer;
      try {
        buffer = await decodeAndValidateSensitiveDocument(input.base64, input.mimeType);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "营业执照文件无效",
          cause: error,
        });
      }
      const extension = sensitiveDocumentExtension(input.mimeType);
      const stored = await storagePutPrivate(
        `licenses/user-${ctx.user.id}-${Date.now()}-${randomUUID()}.${extension}`,
        buffer,
        input.mimeType,
      );
      await db.upsertCompany(ctx.user.id, {
        licenseObjectKey: stored.key,
        licenseUrl: null,
        licenseFileName: input.fileName,
      });

      /* OCR receives the same validated/normalized bytes stored privately, never raw client base64. */
      const ocrSource = `data:${input.mimeType};base64,${buffer.toString("base64")}`;
      const isPdf = isPdfMimeType(input.mimeType);
      let extracted: LicenseExtractResult | null = null;
      let ocrSkippedReason: "pdf_unavailable" | null = null;
      if (isPdf && !(await isPdfLicenseOcrAvailable())) {
        ocrSkippedReason = "pdf_unavailable";
        console.warn("[uploadLicense] PDF 转换组件不可用，降级为手工填写");
      } else {
        try {
          extracted = await extractLicenseInfo(ocrSource, input.mimeType);
        } catch (err) {
          const convertReason = err instanceof PdfConvertError ? err.reason : null;
          console.warn(
            `[uploadLicense] 识别失败（不影响上传，格式=${input.mimeType}${convertReason ? `，PDF转换=${convertReason}` : ""}）`,
            convertReason
              ? { pdfConvert: convertReason, message: (err as Error).message }
              : getBusinessLicenseOcrErrorMeta(err),
          );
        }
      }
      return { success: true, extracted, ocrSkippedReason } as const;
    }),

  /** 上传银行资料至私有 OSS；格式白名单与二进制结构校验和营业执照完全一致。 */
  uploadBankLicense: protectedProcedure
    .input(z.object({
      fileName: z.string().trim().min(1).max(255),
      base64: z.string().min(1).max(MAX_SENSITIVE_DOCUMENT_BASE64_CHARS),
      mimeType: sensitiveDocumentMimeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const target = await resolveCrmTargetForUser(ctx.user.id);
      if (target.enterprise?.registrationRegion === "HK" || target.company?.registrationRegion === "HK") {
        throw new TRPCError({ code: "CONFLICT", message: "香港企业证件请通过香港申请表上传" });
      }
      let buffer: Buffer;
      try {
        buffer = await decodeAndValidateSensitiveDocument(input.base64, input.mimeType);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "银行资料文件无效",
          cause: error,
        });
      }
      const extension = sensitiveDocumentExtension(input.mimeType);
      const stored = await storagePutPrivate(
        `bank-licenses/user-${ctx.user.id}-${Date.now()}-${randomUUID()}.${extension}`,
        buffer,
        input.mimeType,
      );
      await db.upsertCompany(ctx.user.id, {
        bankLicenseObjectKey: stored.key,
        bankLicenseUrl: null,
        bankLicenseFileName: input.fileName,
      });

      const ocrSource = `data:${input.mimeType};base64,${buffer.toString("base64")}`;
      const isPdf = isPdfMimeType(input.mimeType);
      let extracted: BankLicenseExtractResult | null = null;
      let ocrSkippedReason: "pdf_unavailable" | null = null;
      if (isPdf && !(await isPdfBankLicenseOcrAvailable())) {
        ocrSkippedReason = "pdf_unavailable";
        console.warn("[uploadBankLicense] PDF 转换组件不可用，降级为手工填写");
      } else {
        try {
          extracted = await extractBankLicenseInfo(ocrSource, input.mimeType);
        } catch (err) {
          const convertReason = err instanceof PdfConvertError ? err.reason : null;
          console.warn(
            `[uploadBankLicense] 识别失败（不影响上传，格式=${input.mimeType}${convertReason ? `，PDF转换=${convertReason}` : ""}）`,
            convertReason
              ? { pdfConvert: convertReason, message: (err as Error).message }
              : getBankAccountLicenseOcrErrorMeta(err),
          );
        }
      }
      return { success: true, extracted, ocrSkippedReason } as const;
    }),
});
