import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const merchantsSource = readFileSync(
  new URL("../client/src/pages/Merchants.tsx", import.meta.url),
  "utf8",
);

function section(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("销售负责人分配权限", () => {
  it("负责人变更仅允许超级管理员", () => {
    const guard = section(routerSource, "const salesOwnerAssignProcedure", "function auditActorFromContext");
    expect(guard).toContain('role !== "super_admin"');
    expect(guard).toContain("只有超级管理员可以分配销售负责人");
    const route = section(routerSource, "setSalesOwner: salesOwnerAssignProcedure", "setCrmStatus:");
    expect(route).toContain("expectedSalesOwnerCode");
    expect(route).toContain("SALES_OWNER_CHANGED");
  });
});

describe("销售负责人原子同步", () => {
  it("事务锁定商户、校验启用销售并同步前台企业资料", () => {
    const fn = section(dbSource, "export async function setMerchantSalesOwner", "export async function updateMerchantStatus");
    expect(fn).toContain("db.transaction");
    expect(fn).toContain('.for("update")');
    expect(fn).toContain('eq(salesStaff.status, "active")');
    expect(fn).toContain("UPDATE ${sql.raw(PLATFORM_DB)}.companies");
    expect(fn).toContain("salesOwnerCode = ${nextCode}");
    expect(fn).toContain('action: "merchant.sales-owner.assign"');
  });

  it("销售个人后台继续按 salesOwnerCode 实时过滤商户", () => {
    const list = section(dbSource, "export async function getMerchants", "export async function getMerchantById");
    expect(list).toContain("inArray(merchants.salesOwnerCode, salesStaffCodes)");
  });
});

describe("商户列表负责人下拉", () => {
  it("超级管理员可选择启用销售或未分配，并提交并发前置值", () => {
    expect(merchantsSource).toContain("trpc.salesStaff.list.useQuery");
    expect(merchantsSource).toContain("trpc.merchant.setSalesOwner.useMutation");
    expect(merchantsSource).toContain('<SelectItem value="unassigned">未分配</SelectItem>');
    expect(merchantsSource).toContain("expectedSalesOwnerCode: salesOwnerCode || null");
    expect(merchantsSource).toContain("isSuperAdmin ? (");
  });
});
