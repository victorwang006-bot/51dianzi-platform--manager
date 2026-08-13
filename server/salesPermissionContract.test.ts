import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const schema = read("drizzle/schema.ts");
const migration = read("scripts/apply-sales-permissions-schema.mjs");
const permissions = read("shared/adminPermissions.ts");
const routers = read("server/routers.ts");
const db = read("server/db.ts");
const adminsPage = read("client/src/pages/Admins.tsx");
const dashboard = read("client/src/components/DashboardLayout.tsx");
const orderProxy = read("server/platformOrderApi.ts");

describe("后台双角色与销售权限实施契约", () => {
  it("数据库同时保留员工主数据、账号多负责人范围和商户稳定负责人代码", () => {
    expect(schema).toContain('export const salesStaff = mysqlTable("sales_staff"');
    expect(schema).toContain('export const adminUserSalesScopes = mysqlTable("admin_user_sales_scopes"');
    expect(schema).toContain('salesOwnerCode: varchar("salesOwnerCode"');
    expect(schema).toContain('merchants_sales_owner_code_idx');
  });

  it("幂等迁移初始化六名员工且不删除任何业务结构", () => {
    for (const name of ["Victor", "Ocean", "Bella", "Doomi", "Mark", "Jean"]) {
      expect(migration).toContain(`"${name}"`);
    }
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS sales_staff");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS admin_user_sales_scopes");
    expect(migration).toContain("UPDATE admin_users SET adminRole='merchant_mgr' WHERE adminRole<>'super_admin'");
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
  });

  it("公开角色只保留超级管理员和普通用户", () => {
    expect(permissions).toContain('export const ADMIN_ROLES = ["super_admin", "merchant_mgr"] as const');
    expect(permissions).toContain('export type AdminRole = (typeof ADMIN_ROLES)[number]');
    expect(permissions).toContain('merchant_mgr: ["merchants.read", "merchants.write", "orders.read"]');
    for (const legacyRole of ["operation", "customer_svc", "risk_control", "finance", "auditor"]) {
      expect(permissions).not.toContain(`${legacyRole}: [`);
    }
  });

  it("新建和修改用户在角色权限后提供销售权限多选", () => {
    const roleLabelIndex = adminsPage.indexOf("<Label>角色权限");
    const salesLabelIndex = adminsPage.indexOf("<Label>销售权限");
    expect(roleLabelIndex).toBeGreaterThanOrEqual(0);
    expect(salesLabelIndex).toBeGreaterThan(roleLabelIndex);
    expect(adminsPage).toContain("选择1名为普通销售，选择多名为主管范围");
    expect(adminsPage).toContain("trpc.salesStaff.list.useQuery");
    expect(adminsPage).toContain("新增员工");
    expect(routers).toContain('adminRole: z.enum(["super_admin", "merchant_mgr"])');
    expect(routers).toContain("salesStaffCodes: z.array");
  });

  it("普通用户菜单仅由商户与订单权限可见，订单保持商户管理子项", () => {
    expect(dashboard).toContain('label: "商户管理", path: "/merchants", permission: "merchants.read"');
    expect(dashboard).toContain('label: "订单管理", path: "/orders", permission: "orders.read" as AdminPermission, nested: true');
    expect(permissions).not.toContain('merchant_mgr: ["materials.read"');
    expect(permissions).not.toContain('merchant_mgr: ["messages.read"');
  });

  it("商户与订单范围均由服务端根据账号范围计算", () => {
    expect(routers).toContain("getAdminUserSalesScopeCodes(ctx.adminAccount.id)");
    expect(routers).toContain("db.getMerchants(input, await getAdminSalesStaffCodes(ctx))");
    expect(routers).toContain("requireVisibleMerchant(ctx, input.id)");
    expect(db).toContain("inArray(merchants.salesOwnerCode, salesStaffCodes)");
    expect(orderProxy).toContain("visibleCompanyCreditCodes");
    expect(orderProxy).not.toContain("input.visibleCompanyCreditCodes");
  });
});
