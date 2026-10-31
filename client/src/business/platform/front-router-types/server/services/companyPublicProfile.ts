import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { sql as enterprisePhotoSql } from "drizzle-orm";
import {
  companies,
  companyProfilePhotos,
  conversations,
  inventories,
  userQqProfiles,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { companyCatalogVisibleCondition } from "./inventoryVisibility";
import {
  approvedHongKongChineseNameSql,
  publicCompanyNameColumns,
  projectPublicCompanyName,
  publicCompanyNameExactMatchSql,
  publicCompanyNameLikeSql,
} from "./publicCompanyName";

/** Must remain identical to shared/qqContact.ts: only launchable QQ numbers are public. */
const SEARCH_NEW_QQ_RE = /^[1-9]\d{4,11}$/;

function normalizeSearchNewQq(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const qq = value.trim();
  return SEARCH_NEW_QQ_RE.test(qq) ? qq : null;
}

export type PublicCompanyPhotoCategory =
  | "storefront"
  | "office"
  | "warehouse"
  | "production"
  | "team"
  | "other";

export const COMPANY_PHOTO_LIMIT = 9;
export type CompanyAvatarDisplayMode = "logo" | "photo";
export type CompanyAvatarCropSettings = { zoom: number; offsetX: number; offsetY: number };

/** 公司全称查询忽略用户输入中的半角、全角及换行空白，但不做简称或模糊匹配。 */
export function normalizeExactCompanyName(value: string) {
  return value.replace(/[\s\u3000]+/g, "");
}

function normalizeAvatarCrop(crop?: CompanyAvatarCropSettings): CompanyAvatarCropSettings {
  return {
    zoom: Math.min(2, Math.max(1, Number(crop?.zoom) || 1)),
    offsetX: Math.min(100, Math.max(-100, Math.round(Number(crop?.offsetX) || 0))),
    offsetY: Math.min(100, Math.max(-100, Math.round(Number(crop?.offsetY) || 0))),
  };
}

function normalizeDisplayCrop(
  displayMode: CompanyAvatarDisplayMode,
  crop?: CompanyAvatarCropSettings,
): CompanyAvatarCropSettings {
  return displayMode === "logo"
    ? { zoom: 1, offsetX: 0, offsetY: 0 }
    : normalizeAvatarCrop(crop);
}

type EnterprisePhotoManagedCompany = {
  id: number;
  reviewStatus: "pending" | "approved" | "rejected";
  certLevel: "pending" | "certified" | "premium";
  avatarPhotoId: number | null;
  avatarDisplayMode: CompanyAvatarDisplayMode;
  avatarCropZoom: number;
  avatarCropX: number;
  avatarCropY: number;
  avatarUpdatedAt: Date | null;
  homeCoverPhotoId: number | null;
  homeCoverDisplayMode: CompanyAvatarDisplayMode;
  homeCoverCropZoom: number;
  homeCoverCropX: number;
  homeCoverCropY: number;
  homeCoverUpdatedAt: Date | null;
};

type EnterprisePhotoScopeRow = {
  enterpriseId?: unknown;
  memberStatus?: unknown;
  dataOwnerUserId?: unknown;
  canonicalCompanyId?: unknown;
  canonicalCompanyUserId?: unknown;
  canonicalCompanyEnterpriseId?: unknown;
  reviewStatus?: unknown;
  certLevel?: unknown;
  avatarPhotoId?: unknown;
  avatarDisplayMode?: unknown;
  avatarCropZoom?: unknown;
  avatarCropX?: unknown;
  avatarCropY?: unknown;
  avatarUpdatedAt?: unknown;
  homeCoverPhotoId?: unknown;
  homeCoverDisplayMode?: unknown;
  homeCoverCropZoom?: unknown;
  homeCoverCropX?: unknown;
  homeCoverCropY?: unknown;
  homeCoverUpdatedAt?: unknown;
};

type EnterprisePhotoExecutor = { execute?: Function; select: Function };

type EnterprisePhotoScope =
  | { kind: "no_member" }
  | { kind: "blocked" }
  | { kind: "canonical"; company: EnterprisePhotoManagedCompany };

/**
 * A company owned by an enterprise member is always the CRM data owner's one
 * company row for that exact enterprise.  The LEFT JOIN is deliberate: absence
 * or duplication must fail closed instead of falling back to the member's old
 * personal company record.
 */
export function enterprisePhotoBuildScopeQuery(userId: number, lock = false) {
  const enterprisePhotoLockClause = lock ? enterprisePhotoSql.raw(" FOR UPDATE") : enterprisePhotoSql.raw("");
  return enterprisePhotoSql`
    SELECT
      em.enterpriseId AS enterpriseId,
      em.status AS memberStatus,
      e.crmDataOwnerUserId AS dataOwnerUserId,
      c.id AS canonicalCompanyId,
      c.userId AS canonicalCompanyUserId,
      c.enterpriseId AS canonicalCompanyEnterpriseId,
      c.reviewStatus AS reviewStatus,
      c.certLevel AS certLevel,
      c.avatarPhotoId AS avatarPhotoId,
      c.avatarDisplayMode AS avatarDisplayMode,
      c.avatarCropZoom AS avatarCropZoom,
      c.avatarCropX AS avatarCropX,
      c.avatarCropY AS avatarCropY,
      c.avatarUpdatedAt AS avatarUpdatedAt,
      c.homeCoverPhotoId AS homeCoverPhotoId,
      c.homeCoverDisplayMode AS homeCoverDisplayMode,
      c.homeCoverCropZoom AS homeCoverCropZoom,
      c.homeCoverCropX AS homeCoverCropX,
      c.homeCoverCropY AS homeCoverCropY,
      c.homeCoverUpdatedAt AS homeCoverUpdatedAt
    FROM enterprise_members AS em
    LEFT JOIN enterprises AS e ON e.id = em.enterpriseId
    LEFT JOIN companies AS c
      ON c.userId = e.crmDataOwnerUserId
      AND c.enterpriseId = e.id
    WHERE em.userId = ${userId}${enterprisePhotoLockClause}
  `;
}

function enterprisePhotoPositiveId(value: unknown): number | null {
  const enterprisePhotoId = Number(value);
  return Number.isSafeInteger(enterprisePhotoId) && enterprisePhotoId > 0 ? enterprisePhotoId : null;
}

function enterprisePhotoNullableId(value: unknown): number | null {
  return value === null ? null : enterprisePhotoPositiveId(value);
}

function enterprisePhotoInteger(value: unknown): number | null {
  const enterprisePhotoValue = Number(value);
  return Number.isSafeInteger(enterprisePhotoValue) ? enterprisePhotoValue : null;
}

/** mysql2 raw execute() can return DATETIME as an Asia/Shanghai wall-clock string. */
function enterprisePhotoDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  const enterprisePhotoValue = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
          ? `${value.replace(" ", "T")}+08:00`
          : value)
      : null;
  return enterprisePhotoValue && !Number.isNaN(enterprisePhotoValue.getTime())
    ? enterprisePhotoValue
    : undefined;
}

function enterprisePhotoRows(result: unknown): EnterprisePhotoScopeRow[] {
  const enterprisePhotoMaybeRows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  if (
    !Array.isArray(enterprisePhotoMaybeRows)
    || enterprisePhotoMaybeRows.some(row => !row || typeof row !== "object")
  ) {
    throw new Error("企业图片归属查询异常，请稍后重试");
  }
  return enterprisePhotoMaybeRows as EnterprisePhotoScopeRow[];
}

function enterprisePhotoManagedCompanyFromRow(row: EnterprisePhotoScopeRow): EnterprisePhotoManagedCompany | null {
  const enterprisePhotoId = enterprisePhotoPositiveId(row.canonicalCompanyId);
  const enterprisePhotoAvatarPhotoId = enterprisePhotoNullableId(row.avatarPhotoId);
  const enterprisePhotoHomeCoverPhotoId = enterprisePhotoNullableId(row.homeCoverPhotoId);
  const enterprisePhotoAvatarCropZoom = enterprisePhotoInteger(row.avatarCropZoom);
  const enterprisePhotoAvatarCropX = enterprisePhotoInteger(row.avatarCropX);
  const enterprisePhotoAvatarCropY = enterprisePhotoInteger(row.avatarCropY);
  const enterprisePhotoHomeCoverCropZoom = enterprisePhotoInteger(row.homeCoverCropZoom);
  const enterprisePhotoHomeCoverCropX = enterprisePhotoInteger(row.homeCoverCropX);
  const enterprisePhotoHomeCoverCropY = enterprisePhotoInteger(row.homeCoverCropY);
  const enterprisePhotoAvatarUpdatedAt = enterprisePhotoDate(row.avatarUpdatedAt);
  const enterprisePhotoHomeCoverUpdatedAt = enterprisePhotoDate(row.homeCoverUpdatedAt);
  if (
    !enterprisePhotoId
    || enterprisePhotoAvatarPhotoId === null && row.avatarPhotoId !== null
    || enterprisePhotoHomeCoverPhotoId === null && row.homeCoverPhotoId !== null
    || enterprisePhotoAvatarCropZoom === null
    || enterprisePhotoAvatarCropX === null
    || enterprisePhotoAvatarCropY === null
    || enterprisePhotoHomeCoverCropZoom === null
    || enterprisePhotoHomeCoverCropX === null
    || enterprisePhotoHomeCoverCropY === null
    || enterprisePhotoAvatarUpdatedAt === undefined
    || enterprisePhotoHomeCoverUpdatedAt === undefined
    || !["pending", "approved", "rejected"].includes(row.reviewStatus as string)
    || !["pending", "certified", "premium"].includes(row.certLevel as string)
    || (row.avatarDisplayMode !== "logo" && row.avatarDisplayMode !== "photo")
    || (row.homeCoverDisplayMode !== "logo" && row.homeCoverDisplayMode !== "photo")
  ) {
    return null;
  }
  return {
    id: enterprisePhotoId,
    reviewStatus: row.reviewStatus as EnterprisePhotoManagedCompany["reviewStatus"],
    certLevel: row.certLevel as EnterprisePhotoManagedCompany["certLevel"],
    avatarPhotoId: enterprisePhotoAvatarPhotoId,
    avatarDisplayMode: row.avatarDisplayMode,
    avatarCropZoom: enterprisePhotoAvatarCropZoom,
    avatarCropX: enterprisePhotoAvatarCropX,
    avatarCropY: enterprisePhotoAvatarCropY,
    avatarUpdatedAt: enterprisePhotoAvatarUpdatedAt,
    homeCoverPhotoId: enterprisePhotoHomeCoverPhotoId,
    homeCoverDisplayMode: row.homeCoverDisplayMode,
    homeCoverCropZoom: enterprisePhotoHomeCoverCropZoom,
    homeCoverCropX: enterprisePhotoHomeCoverCropX,
    homeCoverCropY: enterprisePhotoHomeCoverCropY,
    homeCoverUpdatedAt: enterprisePhotoHomeCoverUpdatedAt,
  };
}

function enterprisePhotoCompanyAllowed(company: EnterprisePhotoManagedCompany | null | undefined) {
  return Boolean(
    company
    && company.reviewStatus === "approved"
    && ["certified", "premium"].includes(company.certLevel),
  );
}

async function enterprisePhotoResolveScope(
  executor: EnterprisePhotoExecutor,
  userId: number,
  lock = false,
): Promise<EnterprisePhotoScope> {
  if (typeof executor.execute !== "function") throw new Error("Database not available");
  const enterprisePhotoRowsFound = enterprisePhotoRows(
    await executor.execute(enterprisePhotoBuildScopeQuery(userId, lock)),
  );
  if (enterprisePhotoRowsFound.length === 0) return { kind: "no_member" };
  if (enterprisePhotoRowsFound.length !== 1) return { kind: "blocked" };
  const enterprisePhotoRow = enterprisePhotoRowsFound[0];
  const enterprisePhotoEnterpriseId = enterprisePhotoPositiveId(enterprisePhotoRow.enterpriseId);
  const enterprisePhotoDataOwnerUserId = enterprisePhotoPositiveId(enterprisePhotoRow.dataOwnerUserId);
  if (
    enterprisePhotoRow.memberStatus !== "active"
    || !enterprisePhotoEnterpriseId
    || !enterprisePhotoDataOwnerUserId
    || enterprisePhotoPositiveId(enterprisePhotoRow.canonicalCompanyUserId) !== enterprisePhotoDataOwnerUserId
    || enterprisePhotoPositiveId(enterprisePhotoRow.canonicalCompanyEnterpriseId) !== enterprisePhotoEnterpriseId
  ) {
    return { kind: "blocked" };
  }
  const enterprisePhotoCompany = enterprisePhotoManagedCompanyFromRow(enterprisePhotoRow);
  return enterprisePhotoCompany && enterprisePhotoCompanyAllowed(enterprisePhotoCompany)
    ? { kind: "canonical", company: enterprisePhotoCompany }
    : { kind: "blocked" };
}

function enterprisePhotoCompanySelection() {
  return {
    id: companies.id,
    reviewStatus: companies.reviewStatus,
    certLevel: companies.certLevel,
    avatarPhotoId: companies.avatarPhotoId,
    avatarDisplayMode: companies.avatarDisplayMode,
    avatarCropZoom: companies.avatarCropZoom,
    avatarCropX: companies.avatarCropX,
    avatarCropY: companies.avatarCropY,
    avatarUpdatedAt: companies.avatarUpdatedAt,
    homeCoverPhotoId: companies.homeCoverPhotoId,
    homeCoverDisplayMode: companies.homeCoverDisplayMode,
    homeCoverCropZoom: companies.homeCoverCropZoom,
    homeCoverCropX: companies.homeCoverCropX,
    homeCoverCropY: companies.homeCoverCropY,
    homeCoverUpdatedAt: companies.homeCoverUpdatedAt,
  };
}

async function enterprisePhotoOwnCompanyForUser(
  executor: EnterprisePhotoExecutor,
  userId: number,
  lock = false,
): Promise<EnterprisePhotoManagedCompany | null> {
  const enterprisePhotoOwnCompanyQuery = executor
    .select(enterprisePhotoCompanySelection())
    .from(companies)
    .where(eq(companies.userId, userId))
    .limit(1);
  const [enterprisePhotoOwnCompany] = await (lock
    ? enterprisePhotoOwnCompanyQuery.for("update")
    : enterprisePhotoOwnCompanyQuery);
  return enterprisePhotoCompanyAllowed(enterprisePhotoOwnCompany)
    ? enterprisePhotoOwnCompany as EnterprisePhotoManagedCompany
    : null;
}

async function enterprisePhotoResolveManagedCompanyForUser(
  executor: EnterprisePhotoExecutor,
  userId: number,
  lock = false,
): Promise<EnterprisePhotoManagedCompany | null> {
  const enterprisePhotoScope = await enterprisePhotoResolveScope(executor, userId, lock);
  if (enterprisePhotoScope.kind === "canonical") return enterprisePhotoScope.company;
  if (enterprisePhotoScope.kind === "blocked") return null;
  return enterprisePhotoOwnCompanyForUser(executor, userId, lock);
}

async function getManagedCompanyForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const company = await enterprisePhotoResolveManagedCompanyForUser(db, userId);
  return company ? { db, company } : null;
}

async function enterprisePhotoFindOwnedPhoto(
  executor: EnterprisePhotoExecutor,
  companyId: number,
  photoId: number,
  approvedOnly: boolean,
) {
  const enterprisePhotoConditions = [
    eq(companyProfilePhotos.id, photoId),
    eq(companyProfilePhotos.companyId, companyId),
    isNull(companyProfilePhotos.deletedAt),
  ];
  if (approvedOnly) enterprisePhotoConditions.push(eq(companyProfilePhotos.status, "approved"));
  const enterprisePhotoPhotoQuery = executor
    .select({ id: companyProfilePhotos.id })
    .from(companyProfilePhotos)
    .where(and(...enterprisePhotoConditions))
    .limit(1);
  const [enterprisePhotoPhoto] = await enterprisePhotoPhotoQuery.for("update");
  return enterprisePhotoPhoto as { id: number } | undefined;
}

export async function listManagedCompanyPhotos(userId: number) {
  const managed = await getManagedCompanyForUser(userId);
  if (!managed) return null;
  const rows = await managed.db
    .select({
      id: companyProfilePhotos.id,
      url: companyProfilePhotos.url,
      thumbnailUrl: companyProfilePhotos.thumbnailUrl,
      name: companyProfilePhotos.name,
      caption: companyProfilePhotos.caption,
      category: companyProfilePhotos.category,
      status: companyProfilePhotos.status,
      sortOrder: companyProfilePhotos.sortOrder,
      createdAt: companyProfilePhotos.createdAt,
    })
    .from(companyProfilePhotos)
    .where(and(
      eq(companyProfilePhotos.companyId, managed.company.id),
      isNull(companyProfilePhotos.deletedAt),
    ))
    .orderBy(asc(companyProfilePhotos.sortOrder), asc(companyProfilePhotos.createdAt));
  return {
    companyId: managed.company.id,
    avatarPhotoId: managed.company.avatarPhotoId,
    avatarDisplayMode: managed.company.avatarDisplayMode,
    avatarCrop: {
      zoom: managed.company.avatarCropZoom / 100,
      offsetX: managed.company.avatarCropX,
      offsetY: managed.company.avatarCropY,
    },
    avatarUpdatedAt: managed.company.avatarUpdatedAt,
    avatarPhoto: rows.find(
      photo => photo.id === managed.company.avatarPhotoId && photo.status === "approved",
    ) ?? null,
    homeCoverPhotoId: managed.company.homeCoverPhotoId,
    homeCoverDisplayMode: managed.company.homeCoverDisplayMode,
    homeCoverCrop: {
      zoom: managed.company.homeCoverCropZoom / 100,
      offsetX: managed.company.homeCoverCropX,
      offsetY: managed.company.homeCoverCropY,
    },
    homeCoverUpdatedAt: managed.company.homeCoverUpdatedAt,
    homeCoverPhoto: rows.find(
      photo => photo.id === managed.company.homeCoverPhotoId && photo.status === "approved",
    ) ?? null,
    photos: rows,
  };
}

export async function createManagedCompanyPhoto(input: {
  userId: number;
  objectKey: string;
  url: string;
  thumbnailObjectKey?: string | null;
  thumbnailUrl?: string | null;
  name: string;
  mimeType: string;
  category: PublicCompanyPhotoCategory;
  caption: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const enterprisePhotoCompany = await enterprisePhotoResolveManagedCompanyForUser(tx, input.userId, true);
    if (!enterprisePhotoCompany) return null;
    const enterprisePhotoPrefix = `company-wall/${enterprisePhotoCompany.id}/`;
    if (!input.objectKey.startsWith(enterprisePhotoPrefix)) throw new Error("公司照片存储路径不合法");
    if (input.thumbnailObjectKey && !input.thumbnailObjectKey.startsWith(`${enterprisePhotoPrefix}thumbs/`)) {
      throw new Error("公司照片缩略图存储路径不合法");
    }
    // The company row is locked by the canonical scope query.  Lock all current
    // photos as well before deriving sortOrder, so concurrent uploads cannot pass 9.
    const enterprisePhotoExisting = await tx
      .select({ id: companyProfilePhotos.id })
      .from(companyProfilePhotos)
      .where(and(
        eq(companyProfilePhotos.companyId, enterprisePhotoCompany.id),
        isNull(companyProfilePhotos.deletedAt),
      ))
      .for("update");
    if (enterprisePhotoExisting.length >= COMPANY_PHOTO_LIMIT) {
      throw new Error(`公司信息墙最多上传 ${COMPANY_PHOTO_LIMIT} 张照片`);
    }
    const [enterprisePhotoInserted] = await tx.insert(companyProfilePhotos).values({
      companyId: enterprisePhotoCompany.id,
      uploaderUserId: input.userId,
      objectKey: input.objectKey,
      url: input.url,
      thumbnailObjectKey: input.thumbnailObjectKey || null,
      thumbnailUrl: input.thumbnailUrl || null,
      name: input.name,
      mimeType: input.mimeType,
      category: input.category,
      caption: input.caption,
      status: "approved",
      reviewedAt: new Date(),
      sortOrder: enterprisePhotoExisting.length,
    }).$returningId();
    return { id: enterprisePhotoInserted.id, companyId: enterprisePhotoCompany.id };
  });
}

export async function setManagedCompanyAvatar(
  userId: number,
  photoId: number | null,
  displayMode: CompanyAvatarDisplayMode = "logo",
  cropInput?: CompanyAvatarCropSettings,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const enterprisePhotoCompany = await enterprisePhotoResolveManagedCompanyForUser(tx, userId, true);
    if (!enterprisePhotoCompany) return null;
    if (photoId === null) {
      await tx
        .update(companies)
        .set({ avatarPhotoId: null, avatarUpdatedBy: userId, avatarUpdatedAt: new Date() })
        .where(eq(companies.id, enterprisePhotoCompany.id));
      return {
        companyId: enterprisePhotoCompany.id,
        avatarPhotoId: null,
        avatarDisplayMode: enterprisePhotoCompany.avatarDisplayMode,
        avatarCrop: {
          zoom: enterprisePhotoCompany.avatarCropZoom / 100,
          offsetX: enterprisePhotoCompany.avatarCropX,
          offsetY: enterprisePhotoCompany.avatarCropY,
        },
      };
    }
    const enterprisePhotoOwned = await enterprisePhotoFindOwnedPhoto(
      tx,
      enterprisePhotoCompany.id,
      photoId,
      true,
    );
    if (!enterprisePhotoOwned) return false;
    const crop = normalizeDisplayCrop(displayMode, cropInput);
    await tx
      .update(companies)
      .set({
        avatarPhotoId: enterprisePhotoOwned.id,
        avatarDisplayMode: displayMode,
        avatarCropZoom: Math.round(crop.zoom * 100),
        avatarCropX: crop.offsetX,
        avatarCropY: crop.offsetY,
        avatarUpdatedBy: userId,
        avatarUpdatedAt: new Date(),
      })
      .where(eq(companies.id, enterprisePhotoCompany.id));
    return {
      companyId: enterprisePhotoCompany.id,
      avatarPhotoId: enterprisePhotoOwned.id,
      avatarDisplayMode: displayMode,
      avatarCrop: crop,
    };
  });
}

/** 设置首页供应商卡片展示主图；与搜索展示图独立维护。 */
export async function setManagedCompanyHomeCover(
  userId: number,
  photoId: number | null,
  displayMode: CompanyAvatarDisplayMode = "photo",
  cropInput?: CompanyAvatarCropSettings,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const enterprisePhotoCompany = await enterprisePhotoResolveManagedCompanyForUser(tx, userId, true);
    if (!enterprisePhotoCompany) return null;
    if (photoId === null) {
      await tx
        .update(companies)
        .set({ homeCoverPhotoId: null, homeCoverUpdatedBy: userId, homeCoverUpdatedAt: new Date() })
        .where(eq(companies.id, enterprisePhotoCompany.id));
      return {
        companyId: enterprisePhotoCompany.id,
        homeCoverPhotoId: null,
        homeCoverDisplayMode: enterprisePhotoCompany.homeCoverDisplayMode,
        homeCoverCrop: {
          zoom: enterprisePhotoCompany.homeCoverCropZoom / 100,
          offsetX: enterprisePhotoCompany.homeCoverCropX,
          offsetY: enterprisePhotoCompany.homeCoverCropY,
        },
      };
    }
    const enterprisePhotoOwned = await enterprisePhotoFindOwnedPhoto(
      tx,
      enterprisePhotoCompany.id,
      photoId,
      true,
    );
    if (!enterprisePhotoOwned) return false;
    const crop = normalizeDisplayCrop(displayMode, cropInput);
    await tx
      .update(companies)
      .set({
        homeCoverPhotoId: enterprisePhotoOwned.id,
        homeCoverDisplayMode: displayMode,
        homeCoverCropZoom: Math.round(crop.zoom * 100),
        homeCoverCropX: crop.offsetX,
        homeCoverCropY: crop.offsetY,
        homeCoverUpdatedBy: userId,
        homeCoverUpdatedAt: new Date(),
      })
      .where(eq(companies.id, enterprisePhotoCompany.id));
    return {
      companyId: enterprisePhotoCompany.id,
      homeCoverPhotoId: enterprisePhotoOwned.id,
      homeCoverDisplayMode: displayMode,
      homeCoverCrop: crop,
    };
  });
}

export async function deleteManagedCompanyPhoto(userId: number, photoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const enterprisePhotoCompany = await enterprisePhotoResolveManagedCompanyForUser(tx, userId, true);
    if (!enterprisePhotoCompany) return false;
    const enterprisePhotoOwned = await enterprisePhotoFindOwnedPhoto(
      tx,
      enterprisePhotoCompany.id,
      photoId,
      false,
    );
    if (!enterprisePhotoOwned) return false;
    await tx
      .update(companies)
      .set({ avatarPhotoId: null, avatarUpdatedBy: userId, avatarUpdatedAt: new Date() })
      .where(and(eq(companies.id, enterprisePhotoCompany.id), eq(companies.avatarPhotoId, enterprisePhotoOwned.id)));
    await tx
      .update(companies)
      .set({ homeCoverPhotoId: null, homeCoverUpdatedBy: userId, homeCoverUpdatedAt: new Date() })
      .where(and(eq(companies.id, enterprisePhotoCompany.id), eq(companies.homeCoverPhotoId, enterprisePhotoOwned.id)));
    await tx
      .update(companyProfilePhotos)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(companyProfilePhotos.id, enterprisePhotoOwned.id),
        eq(companyProfilePhotos.companyId, enterprisePhotoCompany.id),
      ));
    return true;
  });
}

/** Preserve no public orphan objects when either upload or the scoped DB write fails. */
export async function enterprisePhotoUploadWithCleanup<T>(
  uploads: [() => Promise<{ key: string; url: string }>, () => Promise<{ key: string; url: string }>],
  create: (original: { key: string; url: string }, thumbnail: { key: string; url: string }) => Promise<T>,
  remove: (key: string) => Promise<boolean>,
): Promise<T> {
  const enterprisePhotoStored = await Promise.allSettled(uploads.map(upload => upload()));
  try {
    const enterprisePhotoOriginal = enterprisePhotoStored[0];
    const enterprisePhotoThumbnail = enterprisePhotoStored[1];
    if (enterprisePhotoOriginal.status === "rejected") throw enterprisePhotoOriginal.reason;
    if (enterprisePhotoThumbnail.status === "rejected") throw enterprisePhotoThumbnail.reason;
    return await create(enterprisePhotoOriginal.value, enterprisePhotoThumbnail.value);
  } catch (enterprisePhotoUploadError) {
    const enterprisePhotoCleanup = await Promise.allSettled(enterprisePhotoStored
      .filter((result): result is PromiseFulfilledResult<{ key: string; url: string }> => result.status === "fulfilled")
      .map(result => remove(result.value.key)));
    if (enterprisePhotoCleanup.some(result => result.status === "rejected" || !result.value)) {
      console.error("COMPANY_PHOTO_UPLOAD_CLEANUP_FAILED");
    }
    throw enterprisePhotoUploadError;
  }
}

function firstInventoryPhotoUrl(value: unknown) {
  let photos: unknown = value;
  if (typeof photos === "string") {
    try {
      photos = JSON.parse(photos);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(photos) || photos.length < 1) return null;
  const first = photos[0] as { url?: unknown } | null;
  return first && typeof first.url === "string" && first.url.trim()
    ? first.url.trim()
    : null;
}

async function canViewChatContact(input: {
  viewerUserId: number;
  contactUserId: number;
  conversationId: number;
}) {
  if (input.viewerUserId === input.contactUserId) return false;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const user1Id = Math.min(input.viewerUserId, input.contactUserId);
  const user2Id = Math.max(input.viewerUserId, input.contactUserId);
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, input.conversationId),
      eq(conversations.user1Id, user1Id),
      eq(conversations.user2Id, user2Id),
    ))
    .limit(1);
  return Boolean(conversation);
}

/**
 * 聊一聊联系人资料：仅会话双方可读。
 *
 * 页面不展示认证状态，也不返回信用代码、证照、银行或销售归属信息。
 * 手机号和微信号是用户明确允许在聊天联系人资料页公开的联系方式。
 */
export async function getChatContactProfile(input: {
  viewerUserId: number;
  contactUserId: number;
  conversationId: number;
}) {
  if (!(await canViewChatContact(input))) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [profile] = await db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      phone: users.phone,
      wechatId: users.wechatId,
      companyName: companies.companyName,
      companyType: companies.companyType,
      companyRole: companies.companyRole,
    })
    .from(users)
    .leftJoin(companies, eq(companies.userId, users.id))
    .where(eq(users.id, input.contactUserId))
    .limit(1);
  if (!profile) return null;

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(and(
      eq(inventories.userId, input.contactUserId),
      eq(inventories.status, "published"),
      companyCatalogVisibleCondition(),
    ));

  return {
    contact: {
      userId: profile.userId,
      name: profile.name?.trim() || profile.username?.trim() || "联系人",
      avatarUrl: profile.avatarUrl || null,
      jobTitle: profile.jobTitle?.trim() || null,
      phone: profile.phone?.trim() || null,
      wechatId: profile.wechatId?.trim() || null,
    },
    company: profile.companyName?.trim()
      ? {
          name: profile.companyName.trim(),
          type: profile.companyType?.trim() || null,
          role: profile.companyRole?.trim() || null,
        }
      : null,
    inventoryCount: Number(count ?? 0),
  };
}

/** 聊一聊联系人资料页：仅返回对方当前公开在售库存。 */
export async function getChatContactInventory(input: {
  viewerUserId: number;
  contactUserId: number;
  conversationId: number;
  page: number;
  pageSize: number;
  keyword?: string;
}) {
  if (!(await canViewChatContact(input))) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(30, Math.max(1, Math.floor(input.pageSize)));
  const keyword = input.keyword?.trim().slice(0, 64) || "";
  const conditions = [
    eq(inventories.userId, input.contactUserId),
    eq(inventories.status, "published"),
    companyCatalogVisibleCondition(),
  ];
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(or(
      like(inventories.partNumber, pattern),
      like(inventories.brand, pattern),
      like(inventories.category, pattern),
      like(inventories.pkg, pattern),
    )!);
  }
  const where = and(...conditions)!;
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(where);
  const items = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      package: inventories.pkg,
      dateCode: inventories.dateCode,
      productionYear: inventories.prodYear,
      quantity: inventories.qtyOnSale,
      price: inventories.priceIncl,
      taxIncluded: inventories.taxIncluded,
      moq: inventories.moq,
      leadTime: inventories.leadTime,
      invoice: inventories.invoice,
      photos: inventories.photos,
      publishedAt: inventories.publishedAt,
      refreshedAt: inventories.refreshedAt,
    })
    .from(inventories)
    .where(where)
    .orderBy(desc(inventories.refreshedAt), desc(inventories.publishedAt), desc(inventories.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalCount = Number(total ?? 0);
  return {
    page,
    pageSize,
    total: totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    keyword,
    items: items.map(item => ({
      id: item.id,
      partNumber: item.partNumber,
      brand: item.brand,
      category: item.category,
      package: item.package,
      dateCode: item.dateCode,
      productionYear: item.productionYear,
      quantity: Number(item.quantity),
      price: item.price === null ? null : Number(item.price),
      taxIncluded: item.taxIncluded,
      moq: item.moq,
      leadTime: item.leadTime,
      invoice: item.invoice,
      imageUrl: firstInventoryPhotoUrl(item.photos),
      publishedAt: item.publishedAt,
      refreshedAt: item.refreshedAt,
    })),
  };
}

/**
 * 批量筛出当前可公开访问的企业主页 supplierId。
 * 论坛等消息流调用方只需一次资格查询和一次库存查询，避免逐条消息 N+1。
 */
export type PublicCompanyProfileEligibilityInput = {
  crmAccess?: boolean | number | null;
  reviewStatus?: string | null;
  certLevel?: string | null;
  companyName?: string | null;
  creditCode?: string | null;
  legalPerson?: string | null;
  regAddress?: string | null;
  registrationRegion?: string | null;
  registrationIdentifier?: string | null;
};

const HK_PUBLIC_REGISTRATION_IDENTIFIER_RE = /^HK:\d{8}$/;

/** Mirrors the SQL gate for direct profile reads, without exposing registration identity. */
export function isPublicCompanyProfileEligible(input: PublicCompanyProfileEligibilityInput | null | undefined) {
  if (
    !input
    || !input.crmAccess
    || input.reviewStatus !== "approved"
    || !["certified", "premium"].includes(input.certLevel ?? "")
    || !input.companyName?.trim()
    || !input.regAddress?.trim()
  ) {
    return false;
  }
  if (input.registrationRegion === "CN") {
    return Boolean(input.creditCode?.trim() && input.legalPerson?.trim());
  }
  return input.registrationRegion === "HK"
    && typeof input.registrationIdentifier === "string"
    && HK_PUBLIC_REGISTRATION_IDENTIFIER_RE.test(input.registrationIdentifier);
}

export async function getPublicCompanySupplierIds(supplierIds: readonly number[]) {
  const uniqueSupplierIds = Array.from(new Set(
    supplierIds.filter(supplierId => Number.isInteger(supplierId) && supplierId > 0),
  ));
  if (!uniqueSupplierIds.length) return new Set<number>();

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [eligibleRows, publishedRows] = await Promise.all([
    db
      .select({ supplierId: companies.userId })
      .from(companies)
      .innerJoin(users, eq(users.id, companies.userId))
      .where(and(
        inArray(companies.userId, uniqueSupplierIds),
        ...publicCompanyProfileEligibilityConditions(),
      )),
    db
      .select({ supplierId: inventories.userId })
      .from(inventories)
      .where(and(
        inArray(inventories.userId, uniqueSupplierIds),
        eq(inventories.status, "published"),
      ))
      .groupBy(inventories.userId),
  ]);
  const suppliersWithPublishedInventory = new Set(publishedRows.map(row => row.supplierId));
  return new Set(
    eligibleRows
      .map(row => row.supplierId)
      .filter(supplierId => suppliersWithPublishedInventory.has(supplierId)),
  );
}

/**
 * 搜索结果联系人 QQ：仅登录查询可取，且只为当前可公开访问并有公司页公开库存的企业返回。
 *
 * 该批量投影刻意不复用公司速览，避免搜索每张卡片额外消耗资料查询配额；也不选择手机号、
 * 微信号或其他联系人字段。调用方须将本查询故障降级为空映射，不能影响主搜索结果。
 */
export async function getSearchSupplierQqMap(supplierIds: number[], includeContact: boolean) {
  if (!includeContact) return new Map<number, string>();
  const uniqueSupplierIds = Array.from(new Set(
    supplierIds.filter(supplierId => Number.isInteger(supplierId) && supplierId > 0),
  )).slice(0, 50);
  if (!uniqueSupplierIds.length) return new Map<number, string>();

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      supplierId: companies.userId,
      qqId: users.qqId,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(and(
      inArray(companies.userId, uniqueSupplierIds),
      ...publicCompanyProfileEligibilityConditions(),
      sql`EXISTS (
        SELECT 1 FROM ${inventories}
        WHERE ${inventories.userId} = ${companies.userId}
          AND ${inventories.status} = 'published'
          AND ${companyCatalogVisibleCondition()}
      )`,
    ));

  const qqBySupplierId = new Map<number, string>();
  for (const row of rows) {
    const qq = row.qqId?.trim() ?? "";
    if (/^[1-9]\d{4,11}$/.test(qq)) qqBySupplierId.set(row.supplierId, qq);
  }
  return qqBySupplierId;
}

/** Batched multi-number projection for logged-in search results. */
export async function getSearchSupplierQqsMap(supplierIds: number[], includeContact: boolean) {
  const result = new Map<number, string[]>();
  if (!includeContact) return result;
  const uniqueSupplierIds = Array.from(new Set(supplierIds.filter(id => Number.isInteger(id) && id > 0))).slice(0, 50);
  if (!uniqueSupplierIds.length) return result;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({
    supplierId: companies.userId,
    qqId: users.qqId,
    profileUserId: userQqProfiles.userId,
    contacts: userQqProfiles.contacts,
    defaultQq: userQqProfiles.defaultQq,
    isPublic: userQqProfiles.isPublic,
  })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .leftJoin(userQqProfiles, eq(userQqProfiles.userId, companies.userId))
    .where(and(inArray(companies.userId, uniqueSupplierIds), ...publicCompanyProfileEligibilityConditions(), sql`EXISTS (
      SELECT 1 FROM ${inventories} WHERE ${inventories.userId} = ${companies.userId}
        AND ${inventories.status} = 'published' AND ${companyCatalogVisibleCondition()}
    )`));
  for (const row of rows) {
    // A nullable joined data field is not a row-presence signal: malformed or
    // empty new profiles must suppress the legacy public QQ. Old visibility
    // preferences are retired; only an absent row may use users.qqId as fallback.
    if (row.profileUserId !== null && row.profileUserId !== undefined) {
      result.set(row.supplierId, []);
      if (typeof row.contacts !== "string" || typeof row.defaultQq !== "string") {
        continue;
      }
      let rawNumbers: unknown;
      try {
        rawNumbers = JSON.parse(row.contacts);
      } catch {
        continue;
      }
      if (!Array.isArray(rawNumbers) || rawNumbers.length < 1 || rawNumbers.length > 3) continue;
      const normalizedNumbers = rawNumbers.map(normalizeSearchNewQq);
      if (normalizedNumbers.some((value): value is null => value === null)) continue;
      const numbers = normalizedNumbers as string[];
      if (new Set(numbers).size !== numbers.length) continue;
      const defaultQq = normalizeSearchNewQq(row.defaultQq);
      if (!defaultQq || !numbers.includes(defaultQq)) continue;
      result.set(row.supplierId, [defaultQq, ...numbers.filter(number => number !== defaultQq)]);
    } else if (row.qqId && /^[1-9]\d{4,11}$/.test(row.qqId.trim())) {
      result.set(row.supplierId, [row.qqId.trim()]);
    }
  }
  return result;
}

export async function getPublicCompanyProfile(supplierId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [profile] = await db
    .select({
      supplierId: users.id,
      contactName: users.name,
      contactPhone: users.phone,
      contactEmail: users.email,
      crmAccess: users.crmAccess,
      companyId: companies.id,
      companyName: companies.companyName,
      publicChineseName: approvedHongKongChineseNameSql(publicCompanyNameColumns),
      companyType: companies.companyType,
      companyRole: companies.companyRole,
      legalPerson: companies.legalPerson,
      regAddress: companies.regAddress,
      establishedAt: companies.establishedAt,
      certLevel: companies.certLevel,
      reviewStatus: companies.reviewStatus,
      creditCode: companies.creditCode,
      registrationRegion: companies.registrationRegion,
      registrationIdentifier: companies.registrationIdentifier,
      avatarPhotoId: companies.avatarPhotoId,
      avatarDisplayMode: companies.avatarDisplayMode,
      avatarCropZoom: companies.avatarCropZoom,
      avatarCropX: companies.avatarCropX,
      avatarCropY: companies.avatarCropY,
      homeCoverPhotoId: companies.homeCoverPhotoId,
      homeCoverDisplayMode: companies.homeCoverDisplayMode,
      homeCoverCropZoom: companies.homeCoverCropZoom,
      homeCoverCropX: companies.homeCoverCropX,
      homeCoverCropY: companies.homeCoverCropY,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .where(eq(companies.userId, supplierId))
    .limit(1);

  if (!isPublicCompanyProfileEligible(profile)) {
    return null;
  }
  const publicCompanyName = projectPublicCompanyName(profile);
  if (!publicCompanyName) return null;

  const [summary] = await db
    .select({
      publishedCount: sql<number>`COUNT(*)`,
      listingCount: sql<number>`SUM(CASE WHEN ${inventories.companyCatalogVisible} = 1 THEN 1 ELSE 0 END)`,
      latestPublishedAt: sql<Date | null>`MAX(CASE WHEN ${inventories.companyCatalogVisible} = 1 THEN ${inventories.publishedAt} ELSE NULL END)`,
    })
    .from(inventories)
    .where(and(eq(inventories.userId, supplierId), eq(inventories.status, "published")));

  const listingCount = Number(summary?.listingCount ?? 0);

  const photoRows = await db
      .select({
        id: companyProfilePhotos.id,
        url: companyProfilePhotos.url,
        thumbnailUrl: companyProfilePhotos.thumbnailUrl,
        name: companyProfilePhotos.name,
        caption: companyProfilePhotos.caption,
        category: companyProfilePhotos.category,
        sortOrder: companyProfilePhotos.sortOrder,
      })
      .from(companyProfilePhotos)
      .where(and(
        eq(companyProfilePhotos.companyId, profile.companyId),
        eq(companyProfilePhotos.status, "approved"),
        isNull(companyProfilePhotos.deletedAt),
      ))
      .orderBy(asc(companyProfilePhotos.sortOrder), asc(companyProfilePhotos.createdAt))
      .limit(COMPANY_PHOTO_LIMIT);
  const searchDisplayPhoto = profile.avatarPhotoId === null
    ? null
    : photoRows.find(photo => photo.id === profile.avatarPhotoId) ?? null;
  const homeCoverPhoto = profile.homeCoverPhotoId === null
    ? null
    : photoRows.find(photo => photo.id === profile.homeCoverPhotoId) ?? null;

  return {
    basicInfo: {
      supplierId: profile.supplierId,
      companyName: publicCompanyName,
      companyType: profile.companyType?.trim() || null,
      companyRole: profile.companyRole?.trim() || null,
      certLevel: profile.certLevel,
    },
    searchDisplayImage: searchDisplayPhoto ? {
      photoId: searchDisplayPhoto.id,
      url: searchDisplayPhoto.thumbnailUrl || searchDisplayPhoto.url,
      displayMode: profile.avatarDisplayMode === "photo" ? "photo" as const : "logo" as const,
      cropZoom: Math.min(200, Math.max(100, Number(profile.avatarCropZoom ?? 100))),
      cropX: Math.min(100, Math.max(-100, Number(profile.avatarCropX ?? 0))),
      cropY: Math.min(100, Math.max(-100, Number(profile.avatarCropY ?? 0))),
    } : null,
    homeCoverImage: homeCoverPhoto ? {
      photoId: homeCoverPhoto.id,
      url: homeCoverPhoto.thumbnailUrl || homeCoverPhoto.url,
      displayMode: profile.homeCoverDisplayMode === "logo" ? "logo" as const : "photo" as const,
      cropZoom: Math.min(200, Math.max(100, Number(profile.homeCoverCropZoom ?? 100))),
      cropX: Math.min(100, Math.max(-100, Number(profile.homeCoverCropX ?? 0))),
      cropY: Math.min(100, Math.max(-100, Number(profile.homeCoverCropY ?? 0))),
    } : null,
    licenseInfo: {
      ...(profile.registrationRegion === "CN" ? { legalPerson: profile.legalPerson!.trim() } : {}),
      registeredAddress: profile.regAddress!.trim(),
      establishedAt: profile.establishedAt,
    },
    contact: {
      name: profile.contactName?.trim() || "企业联系人",
      phone: profile.contactPhone?.trim() || null,
      email: profile.contactEmail?.trim() || null,
    },
    photos: photoRows.map(photo => ({
      id: photo.id,
      url: photo.url,
      thumbnailUrl: photo.thumbnailUrl || photo.url,
      name: photo.name || null,
      caption: photo.caption || null,
      category: photo.category as PublicCompanyPhotoCategory,
    })),
    business: {
      listingCount,
      latestPublishedAt: summary?.latestPublishedAt ?? null,
    },
  };
}

/**
 * 搜索结果公司名称悬浮速览。
 *
 * 该查询仅在用户稳定悬停后触发，不能并入搜索列表主接口，否则每页供应商资料和聚合统计会
 * 放大搜索首屏延迟。数量按当前已发布库存的完整型号去重；品牌按发布记录数取前三，
 * 空值不参与统计。公开资格与公司详情页完全一致。
 */
export async function getPublicCompanySummary(supplierId: number, includeContact = false) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [profile] = await db
    .select({
      supplierId: users.id,
      companyId: companies.id,
      companyName: companies.companyName,
      publicChineseName: approvedHongKongChineseNameSql(publicCompanyNameColumns),
      companyType: companies.companyType,
      certLevel: companies.certLevel,
      registrationRegion: companies.registrationRegion,
      reviewStatus: companies.reviewStatus,
      regAddress: companies.regAddress,
      establishedAt: companies.establishedAt,
      avatarPhotoId: companies.avatarPhotoId,
      avatarDisplayMode: companies.avatarDisplayMode,
      avatarCropZoom: companies.avatarCropZoom,
      avatarCropX: companies.avatarCropX,
      avatarCropY: companies.avatarCropY,
      ...(includeContact ? {
        contactPhone: users.phone,
        contactWechat: users.wechatId,
        contactQQ: users.qqId,
        contactQqProfileId: userQqProfiles.userId,
        contactQqNumbers: userQqProfiles.contacts,
        contactQqDefault: userQqProfiles.defaultQq,
      } : {}),
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .leftJoin(userQqProfiles, eq(userQqProfiles.userId, companies.userId))
    .where(and(
      eq(companies.userId, supplierId),
      ...publicCompanyProfileEligibilityConditions(),
    ))
    .limit(1);
  if (!profile) return null;
  const publicCompanyName = projectPublicCompanyName(profile);
  if (!publicCompanyName) return null;

  const brandName = sql<string>`TRIM(${inventories.brand})`;
  const publishedWhere = and(
    eq(inventories.userId, supplierId),
    eq(inventories.status, "published"),
  );
  const [countRows, brandRows, avatarRows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(DISTINCT NULLIF(TRIM(${inventories.partNumber}), ''))` })
      .from(inventories)
      .where(publishedWhere),
    db
      .select({ name: brandName, count: sql<number>`COUNT(*)` })
      .from(inventories)
      .where(and(publishedWhere, sql`TRIM(COALESCE(${inventories.brand}, '')) <> ''`))
      .groupBy(brandName)
      .orderBy(desc(sql`COUNT(*)`), asc(brandName))
      .limit(3),
    profile.avatarPhotoId === null
      ? Promise.resolve([])
      : db
          .select({
            id: companyProfilePhotos.id,
            url: companyProfilePhotos.url,
            thumbnailUrl: companyProfilePhotos.thumbnailUrl,
          })
          .from(companyProfilePhotos)
          .where(and(
            eq(companyProfilePhotos.id, profile.avatarPhotoId),
            eq(companyProfilePhotos.companyId, profile.companyId),
            eq(companyProfilePhotos.status, "approved"),
            isNull(companyProfilePhotos.deletedAt),
          ))
          .limit(1),
  ]);
  const listingCount = Number(countRows[0]?.count ?? 0);
  if (listingCount < 1) return null;
  const avatar = avatarRows[0] ?? null;
  let contactQq = profile.contactQQ?.trim() || null;
  if (includeContact && profile.contactQqProfileId != null) {
    contactQq = null;
    try {
      const numbers: unknown = JSON.parse(profile.contactQqNumbers ?? "");
      const defaultQq = normalizeSearchNewQq(profile.contactQqDefault);
      if (Array.isArray(numbers) && numbers.length >= 1 && numbers.length <= 3
        && numbers.every(value => normalizeSearchNewQq(value) === value)
        && new Set(numbers).size === numbers.length && defaultQq && numbers.includes(defaultQq)) {
        contactQq = defaultQq;
      }
    } catch { /* Damaged or cleared profiles must not republish the legacy number. */ }
  }

  return {
    supplierId: profile.supplierId,
    companyName: publicCompanyName,
    companyType: profile.companyType?.trim() || null,
    certLevel: profile.certLevel,
    listingCount,
    mainBrands: brandRows.map(row => row.name).filter(Boolean),
    mainCategories: [] as string[],
    ...(includeContact ? { contact: {
      phone: profile.contactPhone?.trim() || null,
      wechat: profile.contactWechat?.trim() || null,
      qq: contactQq,
    } } : {}),
    establishedAt: profile.establishedAt,
    registeredAddress: profile.regAddress!.trim(),
    avatar: avatar ? {
      photoId: avatar.id,
      url: avatar.thumbnailUrl || avatar.url,
      displayMode: profile.avatarDisplayMode === "photo" ? "photo" as const : "logo" as const,
      cropZoom: Math.min(200, Math.max(100, Number(profile.avatarCropZoom ?? 100))),
      cropX: Math.min(100, Math.max(-100, Number(profile.avatarCropX ?? 0))),
      cropY: Math.min(100, Math.max(-100, Number(profile.avatarCropY ?? 0))),
    } : null,
  };
}

/**
 * 首页“搜公司”只处理公司全称唯一匹配：找到即直达企业主页，不返回列表或排名。
 * 最终仍调用公开主页资格校验；没有库存的合格企业也能被搜到，物料是否出现在
 * 公司详情页仍由发布状态和 companyCatalogVisible 独立控制。
 */
export async function findExactPublicCompany(companyName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedName = normalizeExactCompanyName(companyName);
  if (!normalizedName) return { status: "not_found" as const };

  const candidates = await db
    .select({ supplierId: companies.userId })
    .from(companies)
    .where(and(
      eq(companies.reviewStatus, "approved"),
      or(eq(companies.certLevel, "certified"), eq(companies.certLevel, "premium")),
      publicCompanyNameExactMatchSql(publicCompanyNameColumns, normalizedName),
    ))
    .limit(3);

  const profiles = await Promise.all(
    candidates.map(candidate => getPublicCompanyProfile(candidate.supplierId)),
  );
  const visibleProfiles = profiles.filter(profile => profile !== null);

  if (visibleProfiles.length === 0) return { status: "not_found" as const };
  if (visibleProfiles.length > 1) return { status: "ambiguous" as const };
  return {
    status: "found" as const,
    supplierId: visibleProfiles[0].basicInfo.supplierId,
    companyName: visibleProfiles[0].basicInfo.companyName,
  };
}

/** 需要展示企业身份的公开入口共用同一组资料、认证与ERP资格条件。 */
export function publicCompanyProfileEligibilityConditions() {
  return [
    eq(companies.reviewStatus, "approved"),
    or(eq(companies.certLevel, "certified"), eq(companies.certLevel, "premium")),
    eq(users.crmAccess, true),
    sql`TRIM(COALESCE(${companies.companyName}, '')) <> ''`,
    or(
      and(
        eq(companies.registrationRegion, "CN"),
        sql`TRIM(COALESCE(${companies.creditCode}, '')) <> ''`,
        sql`TRIM(COALESCE(${companies.legalPerson}, '')) <> ''`,
      ),
      and(
        eq(companies.registrationRegion, "HK"),
        sql`REGEXP_LIKE(CONVERT(COALESCE(${companies.registrationIdentifier}, '') USING utf8mb4), '^HK:[0-9]{8}$', 'c')`,
      ),
    ),
    sql`TRIM(COALESCE(${companies.regAddress}, '')) <> ''`,
  ];
}

/**
 * 首页公司名称联想：返回当前具备公开资格的认证企业，不以库存是否存在为门槛。
 * 库存使用左连接，listingCount 只统计公司页公开的已发布物料，无库存时为 0。
 * 候选按公司全称字典序展示，不计算综合分、不参与商户排名。
 */
export async function suggestPublicCompanies(keywordInput: string, limitInput = 8) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const keyword = normalizeExactCompanyName(keywordInput).replace(/[%_\\]/g, "");
  if (keyword.length < 2) return [];
  const limit = Math.min(8, Math.max(1, Math.floor(limitInput)));

  const rows = await db
    .select({
      companyId: companies.id,
      supplierId: companies.userId,
      companyName: companies.companyName,
      publicChineseName: approvedHongKongChineseNameSql(publicCompanyNameColumns),
      registrationRegion: companies.registrationRegion,
      reviewStatus: companies.reviewStatus,
      avatarPhotoId: companies.avatarPhotoId,
      avatarDisplayMode: companies.avatarDisplayMode,
      avatarCropZoom: companies.avatarCropZoom,
      avatarCropX: companies.avatarCropX,
      avatarCropY: companies.avatarCropY,
      listingCount: sql<number>`SUM(CASE WHEN ${inventories.companyCatalogVisible} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.userId))
    .leftJoin(inventories, and(
      eq(inventories.userId, companies.userId),
      eq(inventories.status, "published"),
    ))
    .where(and(
      ...publicCompanyProfileEligibilityConditions(),
      publicCompanyNameLikeSql(publicCompanyNameColumns, keyword),
    ))
    .groupBy(
      companies.id,
      companies.userId,
      companies.companyName,
      companies.registrationRegion,
      companies.reviewStatus,
      companies.registrationData,
      companies.avatarPhotoId,
      companies.avatarDisplayMode,
      companies.avatarCropZoom,
      companies.avatarCropX,
      companies.avatarCropY,
    )
    .orderBy(asc(companies.companyName))
    .limit(limit);

  const avatarPhotoIds = rows
    .map(row => Number(row.avatarPhotoId))
    .filter(photoId => Number.isSafeInteger(photoId) && photoId > 0);
  const avatarRows = avatarPhotoIds.length
    ? await db
        .select({
          id: companyProfilePhotos.id,
          companyId: companyProfilePhotos.companyId,
          url: companyProfilePhotos.url,
          thumbnailUrl: companyProfilePhotos.thumbnailUrl,
        })
        .from(companyProfilePhotos)
        .where(and(
          inArray(companyProfilePhotos.id, avatarPhotoIds),
          eq(companyProfilePhotos.status, "approved"),
          isNull(companyProfilePhotos.deletedAt),
        ))
    : [];
  const avatarById = new Map(avatarRows.map(photo => [Number(photo.id), photo]));

  return rows.map(row => ({
    supplierId: row.supplierId,
    companyName: projectPublicCompanyName(row) || "",
    listingCount: Number(row.listingCount ?? 0),
    searchDisplayImage: (() => {
      const photo = avatarById.get(Number(row.avatarPhotoId));
      if (!photo || Number(photo.companyId) !== Number(row.companyId)) return null;
      return {
        photoId: Number(photo.id),
        url: photo.thumbnailUrl || photo.url,
        displayMode: row.avatarDisplayMode,
        cropZoom: row.avatarCropZoom,
        cropX: row.avatarCropX,
        cropY: row.avatarCropY,
      };
    })(),
  }));
}

export async function getPublicCompanyInventory(input: {
  supplierId: number;
  page: number;
  pageSize: number;
  keyword?: string;
}) {
  const profile = await getPublicCompanyProfile(input.supplierId);
  if (!profile) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.pageSize)));
  const keyword = input.keyword?.trim().slice(0, 64) || "";
  const conditions = [
    eq(inventories.userId, input.supplierId),
    eq(inventories.status, "published"),
    companyCatalogVisibleCondition(),
  ];
  if (keyword) {
    const pattern = `%${keyword}%`;
    conditions.push(or(
      like(inventories.partNumber, pattern),
      like(inventories.brand, pattern),
      like(inventories.category, pattern),
      like(inventories.pkg, pattern),
    )!);
  }
  const where = and(...conditions)!;
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(inventories)
    .where(where);
  const totalCount = Number(total ?? 0);
  const items = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      package: inventories.pkg,
      dateCode: inventories.dateCode,
      productionYear: inventories.prodYear,
      quantity: inventories.qtyOnSale,
      price: inventories.priceIncl,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      moq: inventories.moq,
      leadTime: inventories.leadTime,
      invoice: inventories.invoice,
      publishedAt: inventories.publishedAt,
      refreshedAt: inventories.refreshedAt,
    })
    .from(inventories)
    .where(where)
    .orderBy(desc(inventories.refreshedAt), desc(inventories.publishedAt), desc(inventories.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    page,
    pageSize,
    total: totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    keyword,
    items: items.map(item => ({
      ...item,
      quantity: Number(item.quantity),
      price: item.price === null ? null : Number(item.price),
      ladderPrices: item.ladderPrices ?? [],
    })),
  };
}

/**
 * 首页「优质供应商」展示位：只返回公开企业主页当前可访问的公司，
 * 每家优先取独立设置的公司展示主图；未设置或引用失效时回退排序第一张照片。
 * 只读公开数据，不含联系人等敏感字段。
 */
export type HomepageSupplierItem = {
  companyId: number;
  supplierId: number;
  companyName: string;
  photoUrl: string;
  displayMode: CompanyAvatarDisplayMode;
  cropZoom: number;
  cropX: number;
  cropY: number;
  photoCount: number;
};

export type HomepageSupplierLists = {
  featuredItems: HomepageSupplierItem[];
  residentItems: HomepageSupplierItem[];
  residentRotation: {
    date: string;
    candidateCount: number;
    startIndex: number;
    cycleDays: number;
  };
};

export const RESIDENT_SUPPLIER_ROTATION_TIME_ZONE = "Asia/Shanghai";

export function beijingResidentRotationDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESIDENT_SUPPLIER_ROTATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b > 0) [a, b] = [b, a % b];
  return a || 1;
}

export function selectDailyResidentCandidates<T extends { companyId: number }>(
  candidates: readonly T[],
  limit: number,
  rotationDate: string,
) {
  const stableCandidates = [...candidates].sort((left, right) => left.companyId - right.companyId);
  const safeLimit = Math.min(stableCandidates.length, Math.max(1, Math.floor(limit)));
  if (stableCandidates.length === 0) {
    return { items: [] as T[], startIndex: 0, cycleDays: 1 };
  }
  const dayIndex = Math.floor(Date.parse(`${rotationDate}T00:00:00Z`) / 86_400_000);
  const startIndex = ((dayIndex * safeLimit) % stableCandidates.length + stableCandidates.length)
    % stableCandidates.length;
  const items = Array.from({ length: safeLimit }, (_, offset) =>
    stableCandidates[(startIndex + offset) % stableCandidates.length]);
  return {
    items,
    startIndex,
    cycleDays: stableCandidates.length / greatestCommonDivisor(stableCandidates.length, safeLimit),
  };
}

type HomepageSupplierCandidate = {
  companyId: number;
  companyName: string | null;
  supplierId: number;
  homepageFeatured: number | boolean;
  homepageShowcased: number | boolean;
  homeCoverPhotoId: number | null;
  homeCoverDisplayMode: CompanyAvatarDisplayMode;
  homeCoverCropZoom: number | null;
  homeCoverCropX: number | null;
  homeCoverCropY: number | null;
  photoCount: number | string;
};

/**
 * 首页供应商双展示位：优质商家由受保护的后台状态显式决定；入驻商家需后台勾选「展示商家」，
 * 未勾选的公司照片不进入首页轮播。两个列表都只读取当前有公开资格、有效审核照片
 * 及公司页公开已发布库存的企业。优质商家仍按最近入驻优先。
 */
export async function listFeaturedSuppliers(limit = 20): Promise<HomepageSupplierLists> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));

  const rotationDate = beijingResidentRotationDate();
  const candidateResult = await db.execute(sql`
    WITH eligible_companies AS (
      SELECT
        ${companyProfilePhotos.companyId} AS companyId,
        ${companies.companyName} AS companyName,
        ${users.id} AS supplierId,
        ${companies.homepageFeatured} AS homepageFeatured,
        ${companies.homepageShowcased} AS homepageShowcased,
        ${companies.homeCoverPhotoId} AS homeCoverPhotoId,
        ${companies.homeCoverDisplayMode} AS homeCoverDisplayMode,
        ${companies.homeCoverCropZoom} AS homeCoverCropZoom,
        ${companies.homeCoverCropX} AS homeCoverCropX,
        ${companies.homeCoverCropY} AS homeCoverCropY,
        ${companies.merchantSinceAt} AS merchantSinceAt,
        ${companies.createdAt} AS companyCreatedAt,
        COUNT(DISTINCT ${companyProfilePhotos.id}) AS photoCount
      FROM ${companyProfilePhotos}
      INNER JOIN ${companies} ON ${companies.id} = ${companyProfilePhotos.companyId}
      INNER JOIN ${users} ON ${users.id} = ${companies.userId}
      WHERE ${and(
        eq(companyProfilePhotos.status, "approved"),
        isNull(companyProfilePhotos.deletedAt),
        ...publicCompanyProfileEligibilityConditions(),
        sql`EXISTS (
          SELECT 1
          FROM inventories AS published_inventory
          WHERE published_inventory.userId = ${users.id}
            AND published_inventory.status = 'published'
            AND published_inventory.companyCatalogVisible = 1
          LIMIT 1
        )`,
      )}
      GROUP BY
        ${companyProfilePhotos.companyId},
        ${companies.companyName},
        ${users.id},
        ${companies.homepageFeatured},
        ${companies.homepageShowcased},
        ${companies.homeCoverPhotoId},
        ${companies.homeCoverDisplayMode},
        ${companies.homeCoverCropZoom},
        ${companies.homeCoverCropX},
        ${companies.homeCoverCropY},
        ${companies.merchantSinceAt},
        ${companies.createdAt}
    )
    SELECT
      companyId, companyName, supplierId, homepageFeatured, homepageShowcased,
      homeCoverPhotoId, homeCoverDisplayMode, homeCoverCropZoom, homeCoverCropX, homeCoverCropY,
      photoCount
    FROM eligible_companies
    ORDER BY
      homepageFeatured DESC,
      COALESCE(merchantSinceAt, companyCreatedAt) DESC,
      companyCreatedAt DESC,
      companyId DESC
  `);
  const rows = (candidateResult as unknown as [HomepageSupplierCandidate[], unknown])[0] ?? [];
  if (rows.length === 0) {
    return {
      featuredItems: [],
      residentItems: [],
      residentRotation: { date: rotationDate, candidateCount: 0, startIndex: 0, cycleDays: 1 },
    };
  }
  const featuredRows = rows.filter(row => Boolean(Number(row.homepageFeatured))).slice(0, safeLimit);
  const residentCandidates = rows.filter(row =>
    !Boolean(Number(row.homepageFeatured)) && Boolean(Number(row.homepageShowcased))
  );
  const residentSelection = selectDailyResidentCandidates(residentCandidates, safeLimit, rotationDate);
  const selectedRows = [...featuredRows, ...residentSelection.items];

  const photos = await db
    .select({
      id: companyProfilePhotos.id,
      companyId: companyProfilePhotos.companyId,
      url: companyProfilePhotos.url,
      thumbnailUrl: companyProfilePhotos.thumbnailUrl,
    })
    .from(companyProfilePhotos)
    .where(and(
      inArray(companyProfilePhotos.companyId, selectedRows.map(row => row.companyId)),
      eq(companyProfilePhotos.status, "approved"),
      isNull(companyProfilePhotos.deletedAt),
    ))
    .orderBy(
      asc(companyProfilePhotos.companyId),
      asc(companyProfilePhotos.sortOrder),
      asc(companyProfilePhotos.createdAt),
    );
  const photosByCompany = new Map<number, typeof photos>();
  for (const photo of photos) {
    const companyPhotos = photosByCompany.get(photo.companyId) ?? [];
    companyPhotos.push(photo);
    photosByCompany.set(photo.companyId, companyPhotos);
  }

  const featuredItems: HomepageSupplierItem[] = [];
  const residentItems: HomepageSupplierItem[] = [];
  for (const row of selectedRows) {
    if (!row.companyName?.trim()) continue;
    const companyPhotos = photosByCompany.get(row.companyId) ?? [];
    // A deleted/rejected configured cover has been filtered out; fall back to the stable first valid photo.
    const coverOrFirst = companyPhotos.find(photo => photo.id === row.homeCoverPhotoId) ?? companyPhotos[0];
    const photoUrl = coverOrFirst?.thumbnailUrl || coverOrFirst?.url;
    if (!photoUrl) continue;
    const usesConfiguredCover = coverOrFirst.id === row.homeCoverPhotoId;
    const item: HomepageSupplierItem = {
      companyId: row.companyId,
      supplierId: row.supplierId,
      companyName: row.companyName.trim(),
      photoUrl,
      displayMode: usesConfiguredCover && row.homeCoverDisplayMode === "logo" ? "logo" : "photo",
      cropZoom: usesConfiguredCover
        ? Math.min(200, Math.max(100, Number(row.homeCoverCropZoom ?? 100)))
        : 100,
      cropX: usesConfiguredCover
        ? Math.min(100, Math.max(-100, Number(row.homeCoverCropX ?? 0)))
        : 0,
      cropY: usesConfiguredCover
        ? Math.min(100, Math.max(-100, Number(row.homeCoverCropY ?? 0)))
        : 0,
      photoCount: Number(row.photoCount),
    };
    if (Boolean(Number(row.homepageFeatured))) featuredItems.push(item);
    else residentItems.push(item);
  }
  return {
    featuredItems,
    residentItems,
    residentRotation: {
      date: rotationDate,
      candidateCount: residentCandidates.length,
      startIndex: residentSelection.startIndex,
      cycleDays: residentSelection.cycleDays,
    },
  };
}
