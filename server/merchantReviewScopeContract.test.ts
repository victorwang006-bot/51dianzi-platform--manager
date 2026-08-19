import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 商家审核「按销售归属分派」的契约测试。
 *
 * 这些约束一旦回退不会有任何报错，只会静默越权——
 * 销售能审核、开通 ERP、发消息到别人名下的商家，
 * 界面与日志均看不出异常。因此必须由测试守护。
 */

const root = join(__dirname, "..");
const routers = readFileSync(join(root, "server/routers.ts"), "utf8");
const permissions = readFileSync(join(root, "shared/adminPermissions.ts"), "utf8");

/** 取出 merchant 路由的完整代码块 */
function merchantRouterBlock(): string {
  const start = routers.indexOf("  merchant: router({");
  expect(start, "未找到 merchant 路由").toBeGreaterThan(-1);
  // 下一个顶层路由的起点作为结束边界
  const rest = routers.slice(start + 20);
  const endRel = rest.search(/\n  [a-zA-Z]+: router\(\{/);
  return endRel === -1 ? rest : rest.slice(0, endRel);
}

describe("归属校验函数：语义与错误码", () => {
  it("assertMerchantInSalesScope 存在且复用统一的范围来源", () => {
    expect(routers).toContain("async function assertMerchantInSalesScope");
    const body = routers.slice(
      routers.indexOf("async function assertMerchantInSalesScope"),
      routers.indexOf("function mapSalesScopeError"),
    );
    // 必须走 getAdminSalesStaffCodes，不得自行拼装范围
    expect(body).toContain("await getAdminSalesStaffCodes(ctx)");
    // 必须把范围传给 db 层查询，否则校验形同虚设
    expect(body).toMatch(/db\.getMerchantById\(merchantId,\s*codes\)/);
  });

  it("越权时返回 NOT_FOUND 而非 FORBIDDEN，避免泄露他人商户的存在", () => {
    const body = routers.slice(
      routers.indexOf("async function assertMerchantInSalesScope"),
      routers.indexOf("function mapSalesScopeError"),
    );
    expect(body).toContain('code: "NOT_FOUND"');
    expect(body).not.toContain('code: "FORBIDDEN"');
  });

  it("不得用 ?? [] 或 || undefined 折叠范围的三态语义", () => {
    /*
     * getAdminSalesStaffCodes 返回三态：
     *   undefined = 不限（超级管理员）
     *   []        = 什么都看不到
     *   [...]     = 限定工号
     * 用 ?? [] 会把超管降级为看不到任何商户；
     * 用 || undefined 会把空范围提升为不限，造成越权。
     */
    const body = routers.slice(
      routers.indexOf("async function assertMerchantInSalesScope"),
      routers.indexOf("function mapSalesScopeError"),
    );
    expect(body).not.toMatch(/getAdminSalesStaffCodes\(ctx\)\s*\?\?\s*\[\]/);
    expect(body).not.toMatch(/getAdminSalesStaffCodes\(ctx\)\s*\|\|\s*undefined/);
  });
});

describe("商户写接口：全部必须先做归属校验", () => {
  const block = merchantRouterBlock();

  /** 取某个 procedure 的实现体 */
  function procedureBody(name: string): string {
    const idx = block.indexOf(`${name}:`);
    expect(idx, `未找到 ${name} 接口`).toBeGreaterThan(-1);
    const rest = block.slice(idx);
    // 下一个同级 procedure 作为边界
    const endRel = rest.slice(1).search(/\n    [a-zA-Z]+:\s/);
    return endRel === -1 ? rest : rest.slice(0, endRel + 1);
  }

  it("review（审核入驻）已接入归属校验", () => {
    expect(procedureBody("review")).toContain("await assertMerchantInSalesScope(ctx, input.id)");
  });

  it("setCrmStatus（开通/拒绝/暂停 ERP）已接入归属校验", () => {
    expect(procedureBody("setCrmStatus")).toContain(
      "await assertMerchantInSalesScope(ctx, input.id)",
    );
  });

  it("sendMessage（以平台身份发信）已接入归属校验", () => {
    expect(procedureBody("sendMessage")).toContain(
      "await assertMerchantInSalesScope(ctx, input.id)",
    );
  });

  it("rebindCrmOwner 走同一校验，且不得退回无范围查询", () => {
    const body = procedureBody("rebindCrmOwner");
    expect(body).toContain("assertMerchantInSalesScope(ctx, input.id)");
    // 原先的 getMerchantById(input.id) 少传范围，属口径不一致
    expect(body).not.toMatch(/db\.getMerchantById\(input\.id\)/);
  });

  it("校验必须发生在状态变更之前", () => {
    // 若先改状态再校验，越权操作已经生效，校验失去意义
    const body = procedureBody("review");
    const assertIdx = body.indexOf("assertMerchantInSalesScope");
    const updateIdx = body.indexOf("db.updateMerchantStatus");
    expect(assertIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(updateIdx);
  });
});

describe("读接口的范围过滤不得丢失", () => {
  const block = merchantRouterBlock();

  it("list 与 detail 仍按销售范围过滤", () => {
    expect(block).toMatch(/getMerchants\(input,\s*await getAdminSalesStaffCodes\(ctx\)\)/);
    expect(block).toMatch(/getMerchantById\(input\.id,\s*await getAdminSalesStaffCodes\(ctx\)\)/);
  });
});

describe("角色权限：销售需具备商户写权限才能审核", () => {
  it("merchant_mgr 拥有 merchants.write", () => {
    /*
     * 生产库 5 个销售账号均为 merchant_mgr。
     * 若移除该权限，销售将无法审核自己名下的商家，
     * 审核会全部回压到 admin。
     */
    const line = permissions
      .split("\n")
      .find(l => l.trimStart().startsWith("merchant_mgr:"));
    expect(line, "未找到 merchant_mgr 权限定义").toBeTruthy();
    expect(line).toContain("merchants.write");
    expect(line).toContain("merchants.read");
  });

  it("super_admin 拥有全部权限（无归属商家的兜底审核人）", () => {
    /*
     * 前台开通 ERP 时销售负责人为选填（可选「暂不选择」），
     * 未选择的商家 salesOwnerCode 为空。SQL 的 IN 列表永不匹配 NULL，
     * 因此这类商家仅超级管理员可见可审，必须保留其全权。
     */
    expect(permissions).toMatch(/super_admin:\s*ADMIN_PERMISSIONS/);
  });
});
