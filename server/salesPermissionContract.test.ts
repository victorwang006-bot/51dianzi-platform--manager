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
const ordersPage = read("client/src/pages/Orders.tsx");
const orderProxy = read("server/platformOrderApi.ts");

describe("后台双角色与销售权限实施契约", () => {
  it("数据库同时保留员工主数据、账号多负责人范围和商户稳定负责人代码", () => {
    expect(schema).toContain('export const salesStaff = mysqlTable("sales_staff"');
    expect(schema).toContain('export const adminUserSalesScopes = mysqlTable("admin_user_sales_scopes"');
    expect(schema).toContain('adminUserId: int("adminUserId")');
    expect(schema).toContain('sales_staff_admin_user_unique');
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
    expect(migration).toContain("sales_staff.adminUserId added");
    expect(migration).toContain("INSERT IGNORE INTO admin_user_sales_scopes");
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
  });

  it("公开角色只保留超级管理员和普通用户", () => {
    expect(permissions).toContain('export const ADMIN_ROLES = ["super_admin", "merchant_mgr"] as const');
    expect(permissions).toContain('export type AdminRole = (typeof ADMIN_ROLES)[number]');
    expect(permissions).toContain('merchant_mgr: ["merchants.read", "merchants.write", "orders.read", "profile.manage"]');
    for (const legacyRole of ["operation", "customer_svc", "risk_control", "finance", "auditor"]) {
      expect(permissions).not.toContain(`${legacyRole}: [`);
    }
  });

  it("新建和修改用户是唯一销售身份入口，普通用户默认本人且可追加主管范围", () => {
    const roleLabelIndex = adminsPage.indexOf("<Label>角色权限");
    const salesLabelIndex = adminsPage.indexOf("<Label>销售权限");
    expect(roleLabelIndex).toBeGreaterThanOrEqual(0);
    expect(salesLabelIndex).toBeGreaterThan(roleLabelIndex);
    expect(adminsPage).toContain("默认仅本人；可追加其他普通用户");
    expect(adminsPage).toContain("普通用户创建后自动生成销售身份并默认绑定本人");
    expect(adminsPage).toContain("trpc.salesStaff.list.useQuery");
    expect(adminsPage).not.toContain("新增员工");
    expect(adminsPage).not.toContain("trpc.salesStaff.create");
    expect(adminsPage).not.toContain("trpc.salesStaff.update");
    expect(routers).not.toContain("db.createSalesStaff");
    expect(routers).not.toContain("db.updateSalesStaff");
    expect(db).toContain("syncAdminUserSalesIdentity");
    expect(db).toContain("ownSalesStaffCode");
    expect(routers).toContain('adminRole: z.enum(["super_admin", "merchant_mgr"])');
    expect(routers).toContain("salesStaffCodes: z.array");
  });

  it("用户列表保留销售权限列并以单行摘要展示多人范围", () => {
    expect(adminsPage).toContain("<th>销售权限</th>");
    expect(adminsPage).toContain("`${salesScopeNames[0]}等${salesScopeNames.length}人`");
    expect(adminsPage).toContain('title={fullSalesScope}');
    expect(adminsPage).toContain('aria-label={`销售权限：${fullSalesScope}`}');
    expect(adminsPage).toContain('max-w-[170px] whitespace-nowrap text-xs');
    expect(adminsPage).toContain("全部销售范围");
  });

  it("普通用户业务菜单仅显示同级商户与订单，系统菜单提供个人信息", () => {
    expect(dashboard).toContain('label: "商户管理", path: "/merchants", permission: "merchants.read"');
    expect(dashboard).toContain('label: "订单管理", path: "/orders", permission: "orders.read" as AdminPermission, nested: false');
    expect(dashboard).toContain('label: "个人信息", path: "/profile", permission: "profile.manage" as AdminPermission, nested: false');
    expect(permissions).not.toContain('merchant_mgr: ["materials.read"');
    expect(permissions).not.toContain('merchant_mgr: ["messages.read"');
  });

  it("订单顶部统计区域采用两列移动端、四列桌面端的紧凑卡片", () => {
    expect(ordersPage).toContain('grid grid-cols-2 gap-2.5 xl:grid-cols-4');
    expect(ordersPage.match(/min-h-\[88px\]/g)).toHaveLength(4);
    expect(ordersPage).toContain('rounded-lg bg-blue-50 p-2');
    expect(ordersPage).toContain('rounded-full border px-2.5 py-1 text-xs');
    expect(ordersPage).not.toContain('flex items-center justify-between p-5');
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
