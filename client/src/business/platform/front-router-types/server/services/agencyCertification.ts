import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { getDb } from "../db";
import { storagePutPrivate, ossGetSignedUrl, storageDelete } from "../storage";
import { decodeAndValidateSensitiveDocument } from "./sensitiveDocument";
import { normalizeEnterpriseCreditCode } from "./enterpriseAccess";

export type AgencyBinding = { creditCode: string; expectedOwnerUserId: number };
export type AgencyOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};
export type AgencyFile = { fileName: string; mimeType: string; base64: string };
export const AGENCY_MAX_FILE_BYTES = 10 * 1024 * 1024;
const fail = (
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" = "BAD_REQUEST"
): never => {
  throw new TRPCError({ code, message });
};
export function normalizeAgencyBrands(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 30)
    return fail("代理品牌最多30个");
  const seen = new Set<string>();
  const brands: string[] = [];
  for (const value of values) {
    const text = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!text || text.length > 80 || /[\x00-\x1f\x7f<>]/.test(text))
      return fail("代理品牌名称无效");
    const key = text.toLocaleLowerCase();
    if (!seen.has(key)) {
      brands.push(text);
      seen.add(key);
    }
  }
  if (!brands.length) return fail("请填写代理品牌");
  return brands;
}
export async function validateAgencyFile(file: AgencyFile) {
  const suffixes: Record<string, RegExp> = {
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
    "image/webp": /\.webp$/i,
    "application/pdf": /\.pdf$/i,
  };
  const fileName = file.fileName.normalize("NFKC").trim();
  if (
    !suffixes[file.mimeType] ||
    !suffixes[file.mimeType].test(fileName) ||
    fileName.length > 160 ||
    /[\x00-\x1f\x7f/\\]/.test(fileName)
  )
    return fail("仅支持JPG、PNG、WebP或PDF代理证");
  if (
    !file.base64 ||
    file.base64.length > Math.ceil(AGENCY_MAX_FILE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
  )
    return fail("文件无效或超过10MB");
  const body = Buffer.from(file.base64, "base64");
  if (
    !body.length ||
    body.length > AGENCY_MAX_FILE_BYTES ||
    body.toString("base64") !== file.base64
  )
    return fail("文件无效或超过10MB");
  if (file.mimeType === "application/pdf") {
    try {
      await decodeAndValidateSensitiveDocument(file.base64, "application/pdf");
    } catch {
      return fail("PDF文件结构无效，请上传可正常打开的静态代理证");
    }
  } else {
    const magic =
      file.mimeType === "image/jpeg"
        ? body[0] === 255 && body[1] === 216 && body[2] === 255
        : file.mimeType === "image/png"
          ? body
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : body.subarray(0, 4).toString() === "RIFF" &&
            body.subarray(8, 12).toString() === "WEBP";
    if (!magic) return fail("图片内容与类型不符");
    try {
      const image = sharp(body, { limitInputPixels: 40_000_000 });
      const meta = await image.metadata();
      if (!meta.width || !meta.height || (meta.pages ?? 1) > 1)
        return fail("请上传静态代理证图片");
      await image.toBuffer();
    } catch {
      return fail("代理证图片无法读取");
    }
  }
  return {
    body,
    fileName,
    mimeType: file.mimeType,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}
function rows(result: unknown): any[] {
  return (result as [any[], unknown])[0];
}
function decoded(value: unknown): string[] {
  try {
    return normalizeAgencyBrands(
      typeof value === "string" ? JSON.parse(value) : (value as string[])
    );
  } catch {
    return [];
  }
}
async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库暂不可用",
    });
  return db;
}
async function company(db: any, binding: AgencyBinding, lock = false) {
  const creditCode = normalizeEnterpriseCreditCode(binding.creditCode);
  if (!creditCode) return fail("企业信用代码无效");
  const result = rows(
    await db.execute(
      lock
        ? sql`SELECT id,userId FROM companies WHERE creditCode=${creditCode} LIMIT 2 FOR UPDATE`
        : sql`SELECT id,userId FROM companies WHERE creditCode=${creditCode} LIMIT 2`
    )
  );
  if (result.length !== 1) return fail("企业绑定不存在或不唯一", "NOT_FOUND");
  if (Number(result[0].userId) !== binding.expectedOwnerUserId)
    return fail("企业所有者已变化，请刷新后重试", "CONFLICT");
  return { id: Number(result[0].id), userId: Number(result[0].userId) };
}
export async function listAgencyCertifications(binding: AgencyBinding) {
  const db = await database();
  const c = await company(db, binding);
  const items = rows(
    await db.execute(
      sql`SELECT id,brands,fileName,status,revision,updatedAt FROM company_agency_certifications WHERE companyId=${c.id} AND ownerUserId=${c.userId} ORDER BY id DESC LIMIT 100`
    )
  );
  return {
    items: items.map(row => ({
      id: Number(row.id),
      brands: decoded(row.brands),
      fileName: String(row.fileName),
      status: row.status as "active" | "cancelled",
      revision: Number(row.revision),
      updatedAt: row.updatedAt,
    })),
  };
}
function hash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export async function mutateAgencyCertification(
  input: AgencyBinding & {
    id?: number;
    expectedRevision?: number;
    brands?: string[];
    file?: AgencyFile;
    requestId: string;
    operator: AgencyOperator;
    action: "save" | "cancel";
  }
) {
  const brands =
    input.action === "save" ? normalizeAgencyBrands(input.brands ?? []) : [];
  const file = input.file ? await validateAgencyFile(input.file) : null;
  if (input.action === "save" && !input.id && !file)
    return fail("请上传代理证");
  if (input.id && !input.expectedRevision)
    return fail("请刷新代理认证记录后重试");
  const db = await database();
  let uploadedKey: string | null = null;
  try {
    return await db.transaction(async tx => {
      const c = await company(tx, input, true);
      const payloadHash = hash({
        companyId: c.id,
        ownerUserId: c.userId,
        operatorId: input.operator.id,
        action: input.action,
        id: input.id ?? null,
        expectedRevision: input.expectedRevision ?? null,
        brands,
        fileName: file?.fileName ?? null,
        fileSha: file?.sha256 ?? null,
      });
      const prior = rows(
        await tx.execute(
          sql`SELECT payloadHash,resultId FROM company_agency_certification_audits WHERE companyId=${c.id} AND operatorId=${input.operator.id} AND requestId=${input.requestId} LIMIT 1 FOR UPDATE`
        )
      )[0];
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          return fail("本次提交标识已用于其他操作，请刷新重试", "CONFLICT");
        return { success: true as const, id: Number(prior.resultId) };
      }
      const existing = input.id
        ? rows(
            await tx.execute(
              sql`SELECT * FROM company_agency_certifications WHERE id=${input.id} AND companyId=${c.id} AND ownerUserId=${c.userId} LIMIT 1 FOR UPDATE`
            )
          )[0]
        : null;
      if (input.id && !existing) return fail("代理认证记录不存在", "NOT_FOUND");
      if (existing && Number(existing.revision) !== input.expectedRevision)
        return fail("记录已被修改，请刷新后重试", "CONFLICT");
      if (input.action === "cancel" && !existing)
        return fail("代理认证记录不存在", "NOT_FOUND");
      let resultId = input.id ?? 0;
      const before = existing
        ? {
            brands: decoded(existing.brands),
            status: existing.status,
            fileName: existing.fileName,
            revision: Number(existing.revision),
            objectKey: String(existing.objectKey),
          }
        : null;
      if (input.action === "cancel") {
        await tx.execute(
          sql`UPDATE company_agency_certifications SET status='cancelled',revision=revision+1,updatedBy=${input.operator.id},updatedAt=NOW() WHERE id=${resultId} AND companyId=${c.id}`
        );
      } else {
        // 上传仅发生在强绑定/版本/幂等检查通过后；文件始终显式private，失败不发布任何标识。
        const uploaded = file
          ? await storagePutPrivate(
              `agency-certificates/${c.id}/${randomUUID()}.${file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : file.mimeType === "image/webp" ? "webp" : "jpg"}`,
              file.body,
              file.mimeType
            )
          : null;
        uploadedKey = uploaded?.key ?? null;
        const key = uploaded?.key ?? existing?.objectKey;
        if (!key || !String(key).startsWith(`agency-certificates/${c.id}/`))
          return fail("代理证资料异常");
        const fileName = file?.fileName ?? existing.fileName,
          mimeType = file?.mimeType ?? existing.mimeType,
          fileSha = file?.sha256 ?? existing.fileSha256;
        if (existing)
          await tx.execute(
            sql`UPDATE company_agency_certifications SET brands=${JSON.stringify(brands)},objectKey=${key},fileName=${fileName},mimeType=${mimeType},fileSha256=${fileSha},status='active',revision=revision+1,updatedBy=${input.operator.id},updatedAt=NOW() WHERE id=${resultId} AND companyId=${c.id}`
          );
        else {
          const inserted = await tx.execute(
            sql`INSERT INTO company_agency_certifications (companyId,ownerUserId,brands,objectKey,fileName,mimeType,fileSha256,status,revision,createdBy,updatedBy) VALUES (${c.id},${c.userId},${JSON.stringify(brands)},${key},${fileName},${mimeType},${fileSha},'active',1,${input.operator.id},${input.operator.id})`
          );
          resultId = Number(
            (inserted as unknown as [{ insertId: number }, unknown])[0].insertId
          );
        }
      }
      const after = {
        brands: input.action === "cancel" ? before?.brands : brands,
        status: input.action === "cancel" ? "cancelled" : "active",
        fileName: file?.fileName ?? before?.fileName,
        revision: (before?.revision ?? 0) + 1,
        objectKey: uploadedKey ?? before?.objectKey,
      };
      await tx.execute(
        sql`INSERT INTO company_agency_certification_audits (companyId,ownerUserId,resultId,action,beforeValue,afterValue,operatorId,operatorName,operatorRole,requestId,payloadHash) VALUES (${c.id},${c.userId},${resultId},${input.action},${JSON.stringify(before)},${JSON.stringify(after)},${input.operator.id},${input.operator.name},${input.operator.role},${input.requestId},${payloadHash})`
      );
      return { success: true as const, id: resultId };
    });
  } catch (error) {
    // 未提交的文件无公开引用；提交成功的旧原件指针仅保留在私有审计中。
    if (uploadedKey)
      await storageDelete(uploadedKey).catch(() =>
        console.warn("[agency] private upload compensation pending")
      );
    throw error;
  }
}
export async function agencyCertificationDocument(
  input: AgencyBinding & { id: number; operator: AgencyOperator }
) {
  const db = await database();
  const c = await company(db, input);
  const row = rows(
    await db.execute(
      sql`SELECT objectKey,fileName FROM company_agency_certifications WHERE id=${input.id} AND companyId=${c.id} AND ownerUserId=${c.userId} LIMIT 1`
    )
  )[0];
  if (!row || !String(row.objectKey).startsWith(`agency-certificates/${c.id}/`))
    return fail("代理证不存在", "NOT_FOUND");
  await db.execute(
    sql`INSERT INTO company_agency_document_views (companyId,certificationId,operatorId,operatorName) VALUES (${c.id},${input.id},${input.operator.id},${input.operator.name})`
  );
  return {
    url: ossGetSignedUrl(row.objectKey, 600),
    expiresAt: Date.now() + 600_000,
    fileName: String(row.fileName),
  };
}
/** One bounded batch query per search; no object keys, URLs or pricing fields are selected. */
export async function agencyBrandsForSuppliers(
  supplierIds: Array<number | null>
): Promise<Map<number, string[]>> {
  const ids = Array.from(
    new Set(
      supplierIds.filter(
        (v): v is number =>
          typeof v === "number" && Number.isSafeInteger(v) && v > 0
      )
    )
  ).slice(0, 50);
  const result = new Map<number, string[]>();
  if (!ids.length) return result;
  try {
    const db = await database();
    const list = rows(
      await db.execute(
        sql`SELECT c.userId,a.brands FROM company_agency_certifications a INNER JOIN companies c ON c.id=a.companyId AND c.userId=a.ownerUserId WHERE a.status='active' AND c.reviewStatus='approved' AND c.userId IN (${sql.join(
          ids.map(v => sql`${v}`),
          sql`,`
        )}) ORDER BY a.id`
      )
    );
    for (const row of list) {
      const userId = Number(row.userId);
      const brands = [...(result.get(userId) ?? []), ...decoded(row.brands)];
      const unique = Array.from(
        new Map(
          brands.map(value => [value.toLocaleLowerCase(), value])
        ).values()
      );
      result.set(userId, unique);
    }
  } catch {
    console.warn("[agency] public brand lookup unavailable");
  }
  return result;
}
