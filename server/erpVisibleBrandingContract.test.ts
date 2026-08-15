import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("后台 ERP 用户可见品牌与 CRM 内部兼容契约", () => {
  it("商户管理统一展示 ERP 状态与操作提示", () => {
    const merchants = read("client/src/pages/Merchants.tsx");

    expect(merchants).toContain('enabled: "通过（开通 ERP）"');
    expect(merchants).toContain('disabled: "暂停 ERP"');
    expect(merchants).toContain("ERP 已恢复");
    expect(merchants).toContain("已绑定前台用户并开通 ERP");
    expect(merchants).toContain("进入并使用 ERP 系统");
    expect(merchants).not.toContain("通过（开通 CRM）");
    expect(merchants).not.toContain("进入并使用 CRM 系统");
  });

  it("所有前台可见审核状态和重复企业提示统一使用 ERP", () => {
    const db = read("server/db.ts");

    expect(db).toContain('"该公司已经开通ERP,请联系管理员"');
    expect(db).toContain('"该企业的 ERP 开通申请正在审核中"');
    expect(db).toContain('disabled: "您的ERP权限已经被暂停，请联系客服"');
    expect(db).toContain('pending: "您的ERP开通申请正在审核中，请耐心等待"');
    expect(db).toContain('rejected: "您的ERP开通申请未通过，如有疑问请联系客服"');
    expect(db).toContain('none: "您尚未开通ERP，请先提交企业开通申请"');
    expect(db).not.toContain("该公司已经开通CRM");
  });

  it("数据库字段、函数和协议状态码保持 CRM 技术标识", () => {
    const db = read("server/db.ts");
    const routers = read("server/routers.ts");

    expect(db).toContain("crmStatus");
    expect(db).toContain("CRM_COMPANY_ALREADY_ENABLED");
    expect(db).toContain("CRM_ACCESS_GRANTED");
    expect(routers).toContain("setMerchantCrmStatus");
    expect(routers).toContain("rebindCrmOwner");
    expect(routers).toContain("rebindMerchantCrmOwner");
  });
});
