import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const routers = read("server/routers.ts");
const database = read("server/db.ts");
const proxy = read("server/platformAgencyCertificationApi.ts");
function procedureBody(name: string) {
  const start = routers.indexOf(`    ${name}:`);
  expect(start).toBeGreaterThan(-1);
  const rest = routers.slice(start);
  const next = rest.slice(1).search(/\n    [a-zA-Z][a-zA-Z0-9]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}
const names = ["agencyCertifications", "saveAgencyCertification", "cancelAgencyCertification", "reviewAgencyCertification", "agencyCertificationDocument"];
describe("商户代理认证后台审核合同", () => {
  it("结果列表只读，原件、认定、撤销与审核全部要求商户写权限", () => {
    expect(procedureBody("agencyCertifications")).toContain("agencyCertifications: merchantReadProcedure");
    for (const name of names.slice(1)) expect(procedureBody(name)).toContain(`${name}: merchantWriteProcedure`);
  });
  it("五接口复用负责范围内的CN/HK专用绑定和服务器operator，不接收浏览器归属或身份", () => {
    for (const name of names) {
      const body = procedureBody(name);
      expect(body).toContain("getPlatformAgencyCertificationBinding(ctx, input.merchantId)");
      expect(body).toContain("operator: platformUserOperatorFromContext(ctx)");
      expect(body).not.toContain("getPlatformCompanyMediaBinding");
      for (const field of ["creditCode: z.", "registrationIdentifier: z.", "expectedOwnerUserId: z.", "operator: z."]) expect(body).not.toContain(field);
    }
    const helper = routers.slice(routers.indexOf("async function getPlatformAgencyCertificationBinding"), routers.indexOf("// 前台对接鉴权"));
    expect(helper).toContain("await assertMerchantInSalesScope(ctx, merchantId)");
    expect(helper).toContain("merchant.crmOwnerPortalUserId");
    expect(helper).toContain('merchant.registrationRegion === "HK"');
    expect(helper).toContain("/^HK:\\d{8}$/");
    expect(helper).toContain("registrationIdentifier, expectedOwnerUserId");
    expect(routers).toContain("db.getOwnedMerchantById(merchantId, codes)");
  });
  it("manual新建原件必填、编辑版本必填，审核要求revision/requestId且驳回原因非空", () => {
    const save = procedureBody("saveAgencyCertification");
    expect(save).toContain("file: AGENCY_CERTIFICATION_FILE_SCHEMA.optional()");
    expect(save).toContain("新建代理认证必须上传代理证");
    expect(save).toContain("编辑代理认证必须提供版本号");
    expect(save).toContain("brands: AGENCY_CERTIFICATION_BRANDS_SCHEMA");
    expect(save).toContain("certificationId: result.id");
    const review = procedureBody("reviewAgencyCertification");
    expect(review).toContain('decision: z.enum(["approve", "reject"])');
    expect(review).toContain("expectedRevision: z.number().int().min(0)");
    expect(review).toContain("requestId: z.string().uuid");
    expect(review).toContain("驳回原因不能为空");
    expect(review).toContain("reviewReason: input.reviewReason");
    expect(review).toContain("reviewPlatformAgencyCertification");
  });
  it("图片/PDF保留10MiB与内容校验，撤销不删除，原件仅短链；后台旧审计不含密钥或文件正文", () => {
    expect(routers).toContain("AGENCY_CERTIFICATION_MAX_BYTES = 10 * 1024 * 1024");
    expect(routers).toContain("代理证文件内容与类型不匹配");
    expect(procedureBody("cancelAgencyCertification")).not.toMatch(/storageDelete|deleteAgency/);
    expect(procedureBody("agencyCertificationDocument")).toContain("getPlatformAgencyCertificationDocument");
    expect(proxy).toContain('raw.split(key).join("[REDACTED]")');
    const audit = database.slice(database.indexOf("export async function recordMerchantAgencyCertificationAudit"), database.indexOf("// ─── 企业公司信息墙"));
    expect(audit).toContain('module: "merchants"');
    for (const secret of ["objectKey", "base64", "url:"]) expect(audit).not.toContain(secret);
  });
});
