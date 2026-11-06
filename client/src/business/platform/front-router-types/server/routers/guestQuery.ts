import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { clientIp } from "../antiScrape";
import { dataViewProcedure, router } from "../_core/trpc";
import { materialThumbnailUrls } from "../adminDb";
import { searchPublishedInventories, type RankedInventoryRow } from "../db";
import { resolveMarketPackagingGroup } from "../../../shared/marketPackaging";
import { approvedUploadedMaterialFilenameModel, approvedUploadedMaterialImageItemMap, searchApprovedUploadedMaterials } from "../services/approvedUploadedMaterialCatalog";
import { getMarketDetail } from "../services/marketRecommendation";
import { searchApprovedVisualOnly } from "../services/searchApprovedVisualOnly";
import { agencyBrandsForSuppliers } from "../services/agencyCertification";
import {
  approvedMaterialGeneratedImageItemMap,
} from "../services/materialGeneratedImages";
import type { UnifiedReferencePrice } from "../services/unifiedReferencePrice";
import {
  guestQueryHash,
  MysqlGuestQueryRepository,
  type GuestQueryRepository,
} from "../services/guestQueryRepository";
import {
  issueGuestQueryGrantToken,
  issueGuestQueryIdentity,
  readGuestQueryIdentity,
  verifyGuestQueryGrantToken,
} from "../services/guestQueryTokens";
import { resolveUnifiedReferencePrice } from "./market";

const guestOnlyProcedure = dataViewProcedure.use(async ({ ctx, next }) => {
  if (ctx.user) throw new TRPCError({ code: "FORBIDDEN", message: "登录用户请使用正常查询接口" });
  return next();
});

const text = z.string().trim().min(1).max(128).refine(value => !/[\\%_]/.test(value), "查询条件不能包含通配符");
// A filename-style complete model may use '_' (e.g. ...ADJ_NOPB).
// Only exact aliases in the approved file are accepted, and converted to their
// verified full model before scope binding/search: '_' never reaches stock LIKE.
const model = z.string().trim().min(2, "请输入至少两个字符").max(128).refine(
  value => !/[\\%]/.test(value) && (!value.includes("_") || approvedUploadedMaterialFilenameModel(value) !== null),
  "查询条件不能包含通配符",
).transform(value => value.includes("_") ? approvedUploadedMaterialFilenameModel(value)! : value);
const filter = text.max(64).optional();
const sort = z.enum(["default", "priceAsc", "priceDesc", "stockAsc", "stockDesc", "lead"]).optional();

const scopeInput = z.object({
  keyword: model,
  brand: filter,
  pkg: filter,
  category: filter,
});
const guestScopeInput = scopeInput.extend({
  module: z.enum(["search", "market"]).default("search"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(15),
  sort: sort.default("default"),
});
const beginInput = guestScopeInput.extend({
  actionId: z.string().trim().min(8).max(64),
});

export type GuestQueryDependencies = {
  repository?: GuestQueryRepository;
  search?: typeof searchPublishedInventories;
  visualOnly?: typeof searchApprovedVisualOnly;
  marketDetail?: typeof getMarketDetail;
  referencePrice?: typeof resolveUnifiedReferencePrice;
  thumbnails?: typeof materialThumbnailUrls;
  agencyBrands?: typeof agencyBrandsForSuppliers;
  generatedThumbnails?: typeof approvedMaterialGeneratedImageItemMap;
};

function normalizeFilter(value: string | undefined) {
  const normalized = value?.normalize("NFKC").trim().toUpperCase();
  return normalized && normalized !== "ALL" ? normalized : "";
}

/** Only the reviewed ST group maps different orderable packages to one scope. */
export function guestQueryScope(input: z.infer<typeof guestScopeInput>): string {
  const keyword = input.keyword.normalize("NFKC").trim().toUpperCase();
  const group = resolveMarketPackagingGroup(keyword);
  const module = input.module;
  // Market detail does not paginate or sort. Keep this canonical so its grant
  // is bound to the market module while search grants remain page-specific.
  const marketDefaults = module === "market";
  return JSON.stringify({
    v: 2,
    module,
    keyword: group?.basePartNumber ?? keyword,
    brand: normalizeFilter(input.brand),
    pkg: normalizeFilter(input.pkg),
    category: normalizeFilter(input.category),
    page: marketDefaults ? 1 : input.page,
    pageSize: marketDefaults ? 15 : input.pageSize,
    sort: marketDefaults ? "default" : input.sort,
  });
}

type GuestSearchItem = Pick<RankedInventoryRow,
  | "id" | "partNumber" | "brand" | "category" | "pkg" | "prodYear" | "dateCode"
  | "qtyOnSale" | "qtyOrder" | "priceEx" | "taxIncluded" | "ladderPrices" | "moq"
  | "source" | "grade" | "leadTime" | "photos" | "publishedAt" | "refreshedAt"
  | "spotVerifiedAt" | "supplierId" | "supplierName" | "supplierAvatarUrl"
  | "supplierAvatarDisplayMode" | "supplierAvatarCropZoom" | "supplierAvatarCropX"
  | "supplierAvatarCropY" | "supplierCertified" | "merchantSinceAt" | "publicReviewCount"
  | "completedTradeCount" | "merchantTenureDays"
> & {
  // Existing cards expect the field, but a note can contain a phone/QQ and is
  // therefore deliberately always unavailable to an unauthenticated visitor.
  note: null;
  thumbnailUrl: string | null;
  uploadedMaterialImageUrl: string | null;
  agencyBrands: string[];
};

function publicSearchItem(
  item: RankedInventoryRow,
  thumbnailUrl: string | null,
  agencyBrands: string[],
  uploadedMaterialImageUrl: string | null,
): GuestSearchItem {
  // This is deliberately a construction whitelist rather than an omission list:
  // note/contact fields and ranking internals must never be added by accident.
  return {
    id: item.id,
    partNumber: item.partNumber,
    brand: item.brand,
    category: item.category,
    pkg: item.pkg,
    prodYear: item.prodYear,
    dateCode: item.dateCode,
    qtyOnSale: item.qtyOnSale,
    qtyOrder: item.qtyOrder,
    priceEx: item.priceEx,
    taxIncluded: item.taxIncluded,
    ladderPrices: item.ladderPrices,
    moq: item.moq,
    source: item.source,
    grade: item.grade,
    leadTime: item.leadTime,
    note: null,
    photos: item.photos?.map(photo => ({ key: "", url: photo.url, name: "商品图片", mimeType: "", size: 0 })) ?? null,
    thumbnailUrl,
    uploadedMaterialImageUrl,
    publishedAt: item.publishedAt,
    refreshedAt: item.refreshedAt,
    spotVerifiedAt: item.spotVerifiedAt,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    supplierAvatarUrl: item.supplierAvatarUrl,
    supplierAvatarDisplayMode: item.supplierAvatarDisplayMode,
    supplierAvatarCropZoom: item.supplierAvatarCropZoom,
    supplierAvatarCropX: item.supplierAvatarCropX,
    supplierAvatarCropY: item.supplierAvatarCropY,
    supplierCertified: item.supplierCertified,
    merchantSinceAt: item.merchantSinceAt,
    publicReviewCount: item.publicReviewCount,
    completedTradeCount: item.completedTradeCount,
    merchantTenureDays: item.merchantTenureDays,
    agencyBrands,
  };
}

function publicReferencePrice(value: Awaited<ReturnType<typeof resolveUnifiedReferencePrice>>) {
  const project = (price: UnifiedReferencePrice) => price.ok
    ? {
        ok: true as const,
        partNumber: price.partNumber,
        queriedPartNumber: price.queriedPartNumber,
        brand: price.brand,
        category: price.category,
        package: price.package,
        low: price.low,
        high: price.high,
        unit: price.unit,
        display: price.display,
        source: price.source,
        sourceLabel: price.sourceLabel,
        matchedBy: price.matchedBy,
        quantityThreshold: price.quantityThreshold,
        inventoryMinPrice: price.inventoryMinPrice,
        inventoryOfferCount: price.inventoryOfferCount,
        databaseBasePrice: price.databaseBasePrice,
        databaseLow: price.databaseLow,
        databaseHigh: price.databaseHigh,
      }
    : {
        ok: false as const,
        reason: price.reason,
        queriedPartNumber: price.queriedPartNumber,
        inventoryOfferCount: price.inventoryOfferCount,
      };
  return {
    ...project(value),
    packagingGroup: value.packagingGroup,
    packagingPrices: value.packagingPrices.map(row => ({
      partNumber: row.partNumber,
      packaging: row.packaging,
      referencePrice: project(row.referencePrice),
    })),
    exposureToken: null,
  };
}

type MarketDetailResult = Awaited<ReturnType<typeof getMarketDetail>>;
type MarketHistoryPoint = MarketDetailResult["history"][number];
type MarketQuote = MarketDetailResult["supplierQuotes"][number];

function publicMarketDetail(detail: MarketDetailResult) {
  const historyPoint = (row: MarketHistoryPoint) => ({
    partNumber: row.partNumber,
    brand: row.brand,
    category: row.category,
    pkg: row.pkg,
    snapshotDate: row.snapshotDate,
    avgPrice: row.avgPrice,
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    inventoryQty: row.inventoryQty,
    avgLeadDays: row.avgLeadDays,
    supplierCount: row.supplierCount,
  });
  const quote = (row: MarketQuote) => ({
    quoteKey: row.quoteKey,
    packaging: row.packaging,
    quoteKind: row.quoteKind,
    inventoryId: row.inventoryId,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    inventoryLocation: row.inventoryLocation,
    inventoryLocationSource: row.inventoryLocationSource,
    partNumber: row.partNumber,
    brand: row.brand,
    category: row.category,
    pkg: row.pkg,
    dateCode: row.dateCode,
    prodYear: row.prodYear,
    qtyOnSale: row.qtyOnSale,
    quoteQuantity: row.quoteQuantity,
    quotePrice: row.quotePrice,
    taxIncluded: row.taxIncluded,
    taxStatus: row.taxStatus,
    leadTime: row.leadTime,
    source: row.source,
    grade: row.grade,
    invoice: row.invoice,
    rohs: row.rohs,
    updatedAt: row.updatedAt,
    priceSource: row.priceSource,
    matchedTierMinQty: row.matchedTierMinQty,
  });
  return {
    packagingGroup: detail.packagingGroup,
    latest: detail.latest ? historyPoint(detail.latest) : null,
    history: detail.history.map(historyPoint),
    historyByPackaging: detail.historyByPackaging.map(row => ({
      partNumber: row.partNumber,
      packaging: row.packaging,
      history: row.history.map(historyPoint),
      latest: row.latest ? historyPoint(row.latest) : null,
    })),
    supplierQuotes: detail.supplierQuotes.map(quote),
    exposureToken: null,
  };
}

function matchesMarketScope(
  row: Pick<MarketHistoryPoint, "brand" | "category" | "pkg">,
  filters: Pick<z.infer<typeof scopeInput>, "brand" | "pkg" | "category">,
) {
  return (!filters.brand || normalizeFilter(row.brand) === normalizeFilter(filters.brand))
    && (!filters.category || normalizeFilter(row.category) === normalizeFilter(filters.category))
    && (!filters.pkg || normalizeFilter(row.pkg ?? undefined) === normalizeFilter(filters.pkg));
}

function filterMarketDetail(
  detail: MarketDetailResult,
  filters: Pick<z.infer<typeof scopeInput>, "brand" | "pkg" | "category">,
): MarketDetailResult {
  if (!filters.brand && !filters.pkg && !filters.category) return detail;
  const historyByPackaging = detail.historyByPackaging.map(row => {
    const history = row.history.filter(point => matchesMarketScope(point, filters));
    return { ...row, history, latest: history.at(-1) ?? null };
  });
  const history = detail.history.filter(point => matchesMarketScope(point, filters));
  return {
    ...detail,
    latest: history.at(-1) ?? null,
    history,
    historyByPackaging,
    supplierQuotes: detail.supplierQuotes.filter(row => matchesMarketScope(row, filters)),
  };
}

function referenceMatchesScope(
  reference: Awaited<ReturnType<typeof resolveUnifiedReferencePrice>>,
  filters: Pick<z.infer<typeof scopeInput>, "brand" | "pkg" | "category">,
) {
  if (!reference.ok) return false;
  return (!filters.brand || normalizeFilter(reference.brand) === normalizeFilter(filters.brand))
    && (!filters.category || normalizeFilter(reference.category) === normalizeFilter(filters.category))
    && (!filters.pkg || normalizeFilter(reference.package) === normalizeFilter(filters.pkg));
}

function denied(message: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "SERVICE_UNAVAILABLE" | "BAD_REQUEST" = "FORBIDDEN"): never {
  throw new TRPCError({ code, message });
}

function unavailableReference(keyword: string) {
  return {
    ok: false as const,
    reason: "no_reliable_data" as const,
    queriedPartNumber: keyword.normalize("NFKC").trim().toUpperCase(),
    inventoryOfferCount: 0,
    packagingGroup: null,
    packagingPrices: [],
    exposureToken: null,
  };
}

export function createGuestQueryRouter(deps: GuestQueryDependencies = {}) {
  const repository = deps.repository ?? new MysqlGuestQueryRepository();
  const search = deps.search ?? searchPublishedInventories;
  const visualOnly = deps.visualOnly ?? searchApprovedVisualOnly;
  const marketDetail = deps.marketDetail ?? getMarketDetail;
  const referencePrice = deps.referencePrice ?? resolveUnifiedReferencePrice;
  const thumbnails = deps.thumbnails ?? materialThumbnailUrls;
  const agencyBrands = deps.agencyBrands ?? agencyBrandsForSuppliers;
  const generatedThumbnails = deps.generatedThumbnails ?? approvedMaterialGeneratedImageItemMap;

  const grantToken = (grant: { grantId: string; identityHash: string; scopeHash: string; expiresAt: Date }) =>
    issueGuestQueryGrantToken({
      grantId: grant.grantId,
      identityHash: grant.identityHash,
      scopeHash: grant.scopeHash,
      exp: grant.expiresAt.getTime(),
    });

  async function authorize(
    ctx: { req: Parameters<typeof readGuestQueryIdentity>[0] },
    token: string,
    scopeHash: string,
    purpose: "primary" | "reference",
  ) {
    const identity = readGuestQueryIdentity(ctx.req);
    const signed = verifyGuestQueryGrantToken(token);
    if (!identity || !signed) denied("游客查询授权无效或已过期", "UNAUTHORIZED");
    const identityHash = guestQueryHash(`identity:${identity}`);
    if (signed.identityHash !== identityHash || signed.scopeHash !== scopeHash) denied("查询授权与当前型号或筛选范围不一致");
    try {
      const grant = await repository.readActiveGrant({
        grantId: signed.grantId,
        identityHash,
        scopeHash,
      });
      if (!grant || grant.expiresAt.getTime() !== signed.exp) denied("游客查询授权无效或已过期", "UNAUTHORIZED");
      if (!await repository.consumeGrant({
        grantId: signed.grantId,
        identityHash,
        scopeHash,
        purpose,
      })) denied("游客查询授权无效或已过期", "UNAUTHORIZED");
      return grant;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      denied("查询服务暂不可用，请登录后继续查询", "SERVICE_UNAVAILABLE");
    }
  }

  return router({
    begin: guestOnlyProcedure.input(beginInput).mutation(async ({ ctx, input }) => {
      let identity = readGuestQueryIdentity(ctx.req);
      try {
        if (!identity) identity = issueGuestQueryIdentity(ctx.req, ctx.res);
      } catch {
        denied("查询服务暂不可用，请登录后继续查询", "SERVICE_UNAVAILABLE");
      }
      const scopeHash = guestQueryHash(guestQueryScope(input));
      const identityHash = guestQueryHash(`identity:${identity!}`);
      let reservation: Awaited<ReturnType<GuestQueryRepository["reserve"]>>;
      try {
        reservation = await repository.reserve({
          identityHash,
          scopeHash,
          actionHash: guestQueryHash(`action:${input.actionId}`),
          ipHash: guestQueryHash(`ip:${clientIp(ctx.req)}`),
        });
      } catch {
        denied("查询服务暂不可用，请登录后继续查询", "SERVICE_UNAVAILABLE");
      }
      if (reservation!.kind === "active") return { token: grantToken(reservation!.grant), found: true, expiresAt: reservation!.grant.expiresAt.getTime() };
      if (reservation!.kind === "exhausted") denied("游客查询次数已用完，请登录后继续查询", "UNAUTHORIZED");
      if (reservation!.kind === "identity_rate_limited") denied("查询请求过于频繁，请登录后继续查询", "UNAUTHORIZED");
      if (reservation!.kind === "action_scope_conflict") denied("动作标识不能用于不同查询范围", "BAD_REQUEST");
      const pending = reservation!.grant;
      try {
        // Charge before any business lookup. A duplicate action may race this
        // commit after losing its first network response; exactly one commit
        // succeeds and the other restores the active grant below.
        const grant = await repository.commit({ grantId: pending.grantId, identityHash })
          ?? await repository.readActiveGrant({
            grantId: pending.grantId,
            identityHash,
            scopeHash: pending.scopeHash,
          });
        if (!grant) denied("查询服务暂不可用，请登录后继续查询", "SERVICE_UNAVAILABLE");
        return { token: grantToken(grant), found: true, expiresAt: grant.expiresAt.getTime() };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[guestQuery.begin] ledger commit failed", error);
        denied("查询服务暂不可用，请登录后继续查询", "SERVICE_UNAVAILABLE");
      }
    }),

    search: guestOnlyProcedure
      .input(scopeInput.extend({
        token: z.string().min(16).max(2048),
        sort: sort.default("default"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(15),
      }))
      .query(async ({ ctx, input }) => {
        const { token, ...scope } = input;
        await authorize(ctx, token, guestQueryHash(guestQueryScope({ ...scope, module: "search" })), "primary");
        const result = await search(scope);
        const uploadedImageMap = approvedUploadedMaterialImageItemMap(result.items);
        const thumbnailMap = thumbnails(result.items.map(item => item.partNumber));
        const [agencyBrandMap, generatedThumbnailMap, visualOnlyMaterial] = await Promise.all([
          agencyBrands(result.items.map(item => item.supplierId)),
          generatedThumbnails(
            result.items
              .filter(item => !thumbnailMap[item.partNumber]),
          ),
          result.total === 0
            ? visualOnly({ ...scope, page: input.page ?? 1, total: result.total })
            : Promise.resolve(null),
        ]);
        return {
          total: result.total,
          items: result.items.map(item => publicSearchItem(
            item,
            thumbnailMap[item.partNumber]
              ?? generatedThumbnailMap.get(item)?.url
              ?? null,
            agencyBrandMap.get(item.supplierId) ?? [],
            uploadedImageMap.get(item) ?? null,
          )),
          visualOnlyMaterial,
          // authorize() above remains mandatory; these records are not stock rows.
          uploadedMaterials: searchApprovedUploadedMaterials(scope),
          exposureToken: null,
        };
      }),

    market: guestOnlyProcedure
      .input(scopeInput.extend({
        token: z.string().min(16).max(2048),
        purpose: z.literal("reference").optional(),
        sort: sort.default("default"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(15),
      }))
      .query(async ({ ctx, input }) => {
        const { token, purpose, keyword, page, pageSize, sort: requestedSort, ...filters } = input;
        if (purpose === "reference") {
          // A search-page reference is a deliberately narrow auxiliary read. It
          // accepts the corresponding search grant and consumes its auxiliary slot.
          await authorize(ctx, token, guestQueryHash(guestQueryScope({
            keyword,
            ...filters,
            module: "search",
            page,
            pageSize,
            sort: requestedSort,
          })), "reference");
          const reference = await referencePrice(keyword);
          const safeReference = referenceMatchesScope(reference, filters)
            ? publicReferencePrice(reference)
            : unavailableReference(keyword);
          return {
            detail: {
              packagingGroup: null,
              latest: null,
              history: [],
              historyByPackaging: [],
              supplierQuotes: [],
              exposureToken: null,
            },
            referencePrice: safeReference,
          };
        }
        await authorize(ctx, token, guestQueryHash(guestQueryScope({
          keyword,
          ...filters,
          module: "market",
          page,
          pageSize,
          sort: requestedSort,
        })), "primary");
        const [rawDetail, reference] = await Promise.all([marketDetail(keyword), referencePrice(keyword)]);
        const detail = filterMarketDetail(rawDetail, filters);
        // The reference resolver has no filter arguments, so never send a
        // cross-brand/package/category result merely because its token is valid.
        const safeReference = referenceMatchesScope(reference, filters)
          ? publicReferencePrice(reference)
          : unavailableReference(keyword);
        return { detail: publicMarketDetail(detail), referencePrice: safeReference };
      }),
  });
}

export const guestQueryRouter = createGuestQueryRouter();
