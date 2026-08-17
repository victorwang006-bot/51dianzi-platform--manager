import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 销售归属同步契约：ERP 开通申请必须把销售**工号**写入商户记录。
 *
 * 背景（2026-08-17 生产缺陷）：
 * 前台 ERP 开通页可选择「销售负责人」，工号也正确存入前台 companies 表，
 * 但后台接收接口 `portal.submitCrmApplication` 的 input schema 里
 * 既没有 salesOwner 也没有 salesOwnerCode，`submitCrmApplication()` 的
 * profileFields 同样不含归属字段。销售信息只能经 `note` 落到 crmNote 文本，
 * 导致 merchants.salesOwnerCode 恒为空。
 *
 * 后果：admin_user_sales_scopes 的数据隔离以 salesOwnerCode 为唯一过滤键，
 * 归属为空即等于所有销售都看不到自己名下客户，后台「销售负责人」列显示 "-"。
 *
 * 本文件断言修复后的链路完整性，防止字段再次被移除。
 */

const routersSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

/** 截取 portal.submitCrmApplication 过程的源码片段。 */
function crmApplicationProcedureSource(): string {
  const start = routersSource.indexOf("submitCrmApplication: publicProcedure");
  expect(start).toBeGreaterThan(-1);
  // 下一个兄弟过程作为结束边界
  const end = routersSource.indexOf("getMessages: publicProcedure", start);
  expect(end).toBeGreaterThan(start);
  return routersSource.slice(start, end);
}

describe("portal.submitCrmApplication 销售归属入参契约", () => {
  it("input schema 必须同时接受 salesOwner 与 salesOwnerCode", () => {
    const procedure = crmApplicationProcedureSource();
    expect(procedure).toContain("salesOwner: z.string().max(64).optional().nullable()");
    expect(procedure).toContain("salesOwnerCode: z.string().trim().toLowerCase()");
  });

  it("工号格式校验与 submitMerchant 保持一致，不接受任意文本", () => {
    const procedure = crmApplicationProcedureSource();
    expect(procedure).toContain("regex(/^[a-z0-9_-]{1,64}$/)");
  });

  it("必须经 resolvePortalSalesOwner 校验后再落库，不得直接写入原始入参", () => {
    const procedure = crmApplicationProcedureSource();
    expect(procedure).toContain("resolvePortalSalesOwner(input.salesOwnerCode, input.salesOwner)");
    // 原始 salesOwner / salesOwnerCode 必须被剔除，改用校验后的 owner 覆盖
    expect(procedure).toContain("salesOwner: _legacyOwner");
    expect(procedure).toContain("salesOwnerCode: _ownerCode");
    expect(procedure).toContain("db.submitCrmApplication({ ...rest, ...owner })");
  });

  it("不得退化为仅把销售姓名塞进 note 文本", () => {
    const procedure = crmApplicationProcedureSource();
    // note 仍可存在（人工可读备注），但归属字段必须独立传递
    const hasOwnerField = procedure.includes("salesOwnerCode");
    expect(hasOwnerField).toBe(true);
  });
});

describe("submitCrmApplication 落库契约", () => {
  it("CrmApplicationInput 必须声明销售归属字段", () => {
    const start = dbSource.indexOf("export interface CrmApplicationInput");
    expect(start).toBeGreaterThan(-1);
    const end = dbSource.indexOf("export async function submitCrmApplication", start);
    const iface = dbSource.slice(start, end);
    expect(iface).toContain("salesOwner?: string | null");
    expect(iface).toContain("salesOwnerCode?: string | null");
  });

  it("profileFields 必须写入归属，且用 !== undefined 区分「清空」与「不改动」", () => {
    const start = dbSource.indexOf("const profileFields = {");
    expect(start).toBeGreaterThan(-1);
    const end = dbSource.indexOf("try {", start);
    const fields = dbSource.slice(start, end);

    expect(fields).toContain("input.salesOwner !== undefined");
    expect(fields).toContain("input.salesOwnerCode !== undefined");
    expect(fields).toContain("{ salesOwner: input.salesOwner }");
    expect(fields).toContain("{ salesOwnerCode: input.salesOwnerCode }");

    // 真值判定会把「显式清空」误判为「不改动」，属于错误写法。
    expect(fields).not.toContain("...(input.salesOwnerCode ? {");
    expect(fields).not.toContain("...(input.salesOwner ? {");
  });
});

describe("数据隔离依赖归属字段（回归保护）", () => {
  it("可见范围过滤仍以 merchants.salesOwnerCode 为键", () => {
    // 若此断言失败，说明隔离逻辑被改写，需重新评估归属同步的必要性。
    expect(dbSource).toContain("inArray(merchants.salesOwnerCode, salesStaffCodes)");
  });

  it("getAdminSalesStaffCodes 的 undefined/空数组语义未被折叠", () => {
    expect(routersSource).toContain("async function getAdminSalesStaffCodes");
    expect(routersSource).toContain('if (account.adminRole === "super_admin") return undefined');
  });
});
