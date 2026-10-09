import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const routers = read("server/routers.ts");
const database = read("server/db.ts");
const proxy = read("server/platformAgencyCertificationApi.ts");

function merchantRouterBlock() {
  const start = routers.indexOf("  merchant: router({");
  const end = routers.indexOf("\n  // ───", start + 20);
  expect(start, "缺少 merchant 路由").toBeGreaterThan(-1);
  return routers.slice(start, end === -1 ? undefined : end);
}

function procedureBody(name: string) {
  const block = merchantRouterBlock();
  const start = block.indexOf(`    ${name}:`);
  expect(start, `缺少 ${name} 接口`).toBeGreaterThan(-1);
  const rest = block.slice(start);
  const next = rest.slice(1).search(/\n    [a-zA-Z][a-zA-Z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("商户代理认证后台入口及归属范围", () => {
  it("列表和证件短链使用既有商户读取权限，保存和取消使用既有商户写权限", () => {
    expect(procedureBody("agencyCertifications")).toContain("agencyCertifications: merchantReadProcedure");
    expect(procedureBody("agencyCertificationDocument")).toContain("agencyCertificationDocument: merchantReadProcedure");
    expect(procedureBody("saveAgencyCertification")).toContain("saveAgencyCertification: merchantWriteProcedure");
    expect(procedureBody("cancelAgencyCertification")).toContain("cancelAgencyCertification: merchantWriteProcedure");
    expect(procedureBody("saveAgencyCertification")).not.toContain("crmRebindProcedure");
    expect(procedureBody("cancelAgencyCertification")).not.toContain("salesOwnerAssignProcedure");
  });

  it("每个过程只接收 merchantId 和业务字段，信用代码、企业 owner 及操作人均由服务器按销售范围派生", () => {
    for (const name of ["agencyCertifications", "saveAgencyCertification", "cancelAgencyCertification", "agencyCertificationDocument"]) {
      const body = procedureBody(name);
      expect(body).toContain("getPlatformCompanyMediaBinding(ctx, input.merchantId)");
      expect(body).toContain("operator: platformUserOperatorFromContext(ctx)");
      expect(body).not.toContain("creditCode: z.");
      expect(body).not.toContain("expectedOwnerUserId: z.");
      expect(body).not.toContain("operator: z.");
    }
    expect(routers).toContain("await assertMerchantInSalesScope(ctx, merchantId)");
    expect(routers).toContain("merchant.businessLicense");
    expect(routers).toContain("merchant.crmOwnerPortalUserId");
  });

  it("保存强制新建上传原件、接受编辑保留原件、传递 revision/requestId，并在服务端标准化品牌", () => {
    const save = procedureBody("saveAgencyCertification");
    expect(save).toContain("id: z.number().int().positive().optional()");
    expect(save).toContain("expectedRevision: z.number().int().min(0).optional()");
    expect(save).toContain("file: AGENCY_CERTIFICATION_FILE_SCHEMA.optional()");
    expect(save).toContain("新建代理认证必须上传代理证");
    expect(save).toContain("requestId: z.string().uuid");
    expect(save).toContain("brands: AGENCY_CERTIFICATION_BRANDS_SCHEMA");
    expect(save).toContain("upsertPlatformAgencyCertification");
    expect(routers).toContain("normalizeAgencyCertificationBrands");
    expect(routers).toContain('.normalize("NFKC")');
    expect(routers).toContain("toLocaleLowerCase()");
    expect(routers).toContain("代理品牌最多 30 项");
    expect(routers).toContain("每个代理品牌最多 80 个字符");
  });

  it("严格限制 JPG/PNG/WebP/PDF、10MiB 和文件内容，且私有原件仅受控签发短时链接", () => {
    expect(routers).toContain("AGENCY_CERTIFICATION_MAX_BYTES = 10 * 1024 * 1024");
    expect(routers).toContain('"application/pdf"');
    expect(routers).toContain("isValidAgencyCertificationBuffer");
    expect(routers).toContain("代理证文件内容与类型不匹配");
    const document = procedureBody("agencyCertificationDocument");
    expect(document).toContain("getPlatformAgencyCertificationDocument");
    expect(document).toContain("document.fileName");
    expect(document).not.toContain("objectKey");
    expect(document).not.toContain("base64");
    expect(proxy).toContain("internalAgencyCertification.${procedure}");
    expect(proxy).toContain('"x-portal-key": key');
    expect(proxy).toContain("x-internal-operator-id");
    expect(proxy).toContain("raw.split(key).join(\"[REDACTED]\")");
    expect(proxy).not.toContain("objectKey");
  });

  it("成功保存、取消与查看均留商户级审计，但审计数据不包含原件链接、对象键或 base64", () => {
    for (const name of ["saveAgencyCertification", "cancelAgencyCertification", "agencyCertificationDocument"]) {
      expect(procedureBody(name)).toContain("db.recordMerchantAgencyCertificationAudit");
    }
    const auditStart = database.indexOf("export async function recordMerchantAgencyCertificationAudit");
    const auditEnd = database.indexOf("// ─── 企业公司信息墙", auditStart);
    const audit = database.slice(auditStart, auditEnd);
    expect(audit).toContain('action: "create" | "update" | "cancel" | "document_view"');
    expect(audit).toContain('module: "merchants"');
    expect(audit).toContain('targetType: "merchant"');
    expect(audit).toContain("certificationId");
    expect(audit).not.toContain("objectKey");
    expect(audit).not.toContain("base64");
    expect(audit).not.toContain("url:");
  });
});
