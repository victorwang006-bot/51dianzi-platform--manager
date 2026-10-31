import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { companies } from "../../drizzle/schema";
import { SUPPLIER_NAME_FALLBACK } from "../../../shared/supplierDisplayName";

/**
 * 公开名称投影只读取已审核 HK 注册资料中的 chineseName；它绝不读取 pendingDraft，
 * 也不会把证件名称回写到工商登记名或企业身份表。
 */
export type PublicCompanyNameColumns = {
  companyName: SQLWrapper;
  registrationRegion: SQLWrapper;
  reviewStatus: SQLWrapper;
  registrationData: SQLWrapper;
  certLevel: SQLWrapper;
  reviewedAt: SQLWrapper;
};

/** 与公司全称查询既有规则一致：只忽略半角、全角及换行空白。 */
export function normalizedCompanyNameSql(value: SQLWrapper): SQL<string> {
  return sql<string>`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${value}), ' ', ''), '　', ''), CHAR(9), ''), CHAR(10), ''), CHAR(13), '')`;
}

/**
 * 从 JSON 字段安全提取候选中文名。IF 的 fallback 保证损坏的旧 JSON 也不会传给
 * JSON_EXTRACT；仅接受 JSON string，拒绝 null、数组、对象与全空白值。
 */
function registrationChineseNameSql(
  registrationData: SQLWrapper
): SQL<string | null> {
  const safeRegistrationData = sql`IF(JSON_VALID(${registrationData}), ${registrationData}, JSON_OBJECT())`;
  const chineseName = sql<
    string | null
  >`JSON_UNQUOTE(JSON_EXTRACT(${safeRegistrationData}, '$.chineseName'))`;
  return sql<string | null>`CASE
    WHEN JSON_TYPE(JSON_EXTRACT(${safeRegistrationData}, '$.chineseName')) = 'STRING'
      AND REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${chineseName}), CHAR(9), ''), CHAR(10), ''), CHAR(13), ''), '　', '') <> ''
    THEN TRIM(${chineseName})
    ELSE NULL
  END`;
}

/**
 * 复审会将 reviewStatus 改为 pending，但 certified/premium + reviewedAt 证明原资料
 * 已审核；只读取 registrationData，绝不读取新 pendingDraft，也不改变公开资格门禁。
 */
export function approvedHongKongChineseNameSql(
  columns: PublicCompanyNameColumns
): SQL<string | null> {
  const chineseName = registrationChineseNameSql(columns.registrationData);
  return sql<string | null>`CASE
    WHEN ${columns.registrationRegion} = 'HK'
      AND (${columns.reviewStatus} = 'approved'
        OR (${columns.certLevel} IN ('certified', 'premium') AND ${columns.reviewedAt} IS NOT NULL))
    THEN ${chineseName}
    ELSE NULL
  END`;
}

/**
 * 返回公共展示名；SQL 候选之外再以纯函数 fail closed，便于模拟 DB 结果测试。
 * 不翻译或转换繁简体，只去除名称两端的空白。
 */
export function selectPublicCompanyName(input: {
  companyName: unknown;
  registrationRegion: unknown;
  reviewStatus: unknown;
  certLevel?: unknown;
  reviewedAt?: unknown;
  approvedChineseName?: unknown;
} ): string | null {
  const registeredName =
    typeof input.companyName === "string" ? input.companyName.trim() : "";
  if (!registeredName) return null;
  const chineseName =
    typeof input.approvedChineseName === "string"
      ? input.approvedChineseName.trim()
      : "";
  return input.registrationRegion === "HK" &&
    (input.reviewStatus === "approved" ||
      (["certified", "premium"].includes(String(input.certLevel)) &&
        input.reviewedAt != null)) &&
    chineseName
    ? chineseName
    : registeredName;
}

/** 已审核 HK 中文名优先；所有其他情形仍使用原登记名。 */
export function publicCompanyDisplayNameSql(
  columns: PublicCompanyNameColumns
): SQL<string | null> {
  return sql<
    string | null
  >`COALESCE(${approvedHongKongChineseNameSql(columns)}, ${columns.companyName})`;
}

/** 英文/原登记名和获准中文名都可命中同一企业的完整名称查询。 */
export function publicCompanyNameExactMatchSql(
  columns: PublicCompanyNameColumns,
  normalizedName: string
): SQL {
  return sql`(
    ${normalizedCompanyNameSql(columns.companyName)} = ${normalizedName}
    OR ${normalizedCompanyNameSql(approvedHongKongChineseNameSql(columns))} = ${normalizedName}
  )`;
}

/** 企业名称联想同时查原登记名和获准中文名，结果仍保持既有登记名排序。 */
export function publicCompanyNameLikeSql(
  columns: PublicCompanyNameColumns,
  normalizedKeyword: string
): SQL {
  const pattern = `%${normalizedKeyword}%`;
  return sql`(
    ${normalizedCompanyNameSql(columns.companyName)} LIKE ${pattern}
    OR ${normalizedCompanyNameSql(approvedHongKongChineseNameSql(columns))} LIKE ${pattern}
  )`;
}

/**
 * 物料搜索 SQL 使用 c/u 别名。只供 searchPublishedInventories 的三个查询分支调用，
 * 不改变购物车、订单、论坛等非搜索供应商名称投影。
 */
export function materialSearchSupplierNameSql(): SQL<string> {
  return sql<string>`COALESCE(
    ${publicCompanyDisplayNameSql({
      companyName: sql.raw("c.companyName"),
      registrationRegion: sql.raw("c.registrationRegion"),
      reviewStatus: sql.raw("c.reviewStatus"),
      registrationData: sql.raw("c.registrationData"),
      certLevel: sql.raw("c.certLevel"),
      reviewedAt: sql.raw("c.reviewedAt"),
    })},
    u.name,
    u.username,
    ${SUPPLIER_NAME_FALLBACK}
  )`;
}

/** 公开查询只选择安全的中文名称标量，不选择或返回完整 registrationData JSON。 */
export const publicCompanyNameColumns = {
  companyName: companies.companyName,
  registrationRegion: companies.registrationRegion,
  reviewStatus: companies.reviewStatus,
  registrationData: companies.registrationData,
  certLevel: companies.certLevel,
  reviewedAt: companies.reviewedAt,
};

export function projectPublicCompanyName(row: {
  companyName: unknown;
  registrationRegion: unknown;
  reviewStatus: unknown;
  certLevel?: unknown;
  reviewedAt?: unknown;
  publicChineseName?: unknown;
}) {
  return selectPublicCompanyName({
    companyName: row.companyName,
    registrationRegion: row.registrationRegion,
    reviewStatus: row.reviewStatus,
    certLevel: row.certLevel,
    reviewedAt: row.reviewedAt,
    approvedChineseName: row.publicChineseName,
  });
}

