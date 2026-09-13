import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const layout = read("../client/src/components/DashboardLayout.tsx");
const schema = read("../drizzle/schema.ts");
const sqlMigration = read("../drizzle/0022_admin_module_notification_cursors.sql");
const migrationJournal = read("../drizzle/meta/_journal.json");
const db = read("./db.ts");
const router = read("./routers.ts");
const deploy = read("../deploy/deploy-admin.sh");
const migrationRunner = read("../scripts/apply-admin-module-notification-schema.mjs");

const moduleDefinitions = [
  ["商户管理", "merchants"],
  ["订单管理", "orders"],
  ["评价管理", "reviews"],
  ["用户管理", "portalUsers"],
] as const;

describe("后台业务模块新增提醒", () => {
  it("为四个指定侧栏模块复用消息中心红色数字角标", () => {
    for (const [label, module] of moduleDefinitions) {
      expect(layout).toContain(`label: "${label}"`);
      expect(layout).toContain(`notificationModule: "${module}"`);
    }
    expect(layout).toContain("trpc.moduleNotification.summary.useQuery");
    expect(layout).toContain("refetchInterval: canReadAnyNotifiedModule ? 30000 : false");
    expect(layout).toContain("bg-red-500");
    expect(layout).toContain('badgeCount > 99 ? "99+" : badgeCount');
  });

  it("进入对应模块时只清除当前管理员该模块的提醒", () => {
    expect(layout).toContain("ADMIN_NOTIFICATION_MODULE_BY_PATH");
    expect(layout).toContain("trpc.moduleNotification.markSeen.useMutation");
    expect(layout).toContain("markModuleSeen.mutate({ module: activeNotificationModule })");
    expect(layout).toContain("markModuleSeen.mutate({ module: item.notificationModule })");
    expect(layout).toContain("counts: { ...current.counts, [module]: 0 }");
    expect(router).toContain("adminNotificationViewerKey(ctx)");
    expect(router).toContain("local:${ctx.adminAccount.id}");
    expect(router).toContain("oauth:${ctx.user.id}");
  });

  it("服务端按模块读权限过滤计数并保持商户、订单销售范围隔离", () => {
    expect(router).toContain('merchants: "merchants.read"');
    expect(router).toContain('orders: "orders.read"');
    expect(router).toContain('reviews: "logs.read"');
    expect(router).toContain('portalUsers: "portalUsers.read"');
    expect(router).toContain("assertNotificationModuleReadable(ctx, input.module)");
    expect(router).toContain("salesStaffCodes: await getAdminSalesStaffCodes(ctx)");
    expect(db).toContain('alias: "merchant" | "order"');
    expect(db).toContain("inArray(merchants.salesOwnerCode, salesStaffCodes)");
    expect(db).toContain("c.salesOwnerCode IN");
    expect(db).toContain("if (salesStaffCodes.length === 0) return sql`1 = 0`");
  });

  it("使用单调业务 ID 游标，首次建立当前基线且不把历史数据全部标红", () => {
    expect(schema).toContain('mysqlTable(\n  "admin_module_notification_cursors"');
    expect(schema).toContain('lastSeenId: bigint("lastSeenId", { mode: "number" }).default(0).notNull()');
    expect(schema).toContain('uniqueIndex("admin_module_notification_viewer_module_unique")');
    expect(db).toContain("if (lastSeenId === undefined)");
    expect(db).toContain("VALUES (${input.viewerKey}, ${module}, ${stat.maxId})");
    expect(db).toContain("counts[module] = stat.unread");
    expect(db).toContain("= GREATEST(");
    expect(db).toContain("VALUES(\\`lastSeenId\\`)");
    expect(db).not.toContain("DELETE FROM admin_module_notification_cursors");
  });

  it("四类计数与各管理页事实源一致", () => {
    expect(db).toContain("MAX(${merchants.id})");
    expect(db).toContain("FROM ${sql.raw(PLATFORM_DB)}.orders o");
    expect(db).toContain('module === "reviews" ? "public_company_reviews" : "users"');
    expect(db).toContain("role = 'user' AND id > ${lastSeenId}");
    expect(db).toContain("LEFT JOIN ${sql.raw(PLATFORM_DB)}.companies c ON c.userId = o.buyerId");
    expect(db).toContain(".where(and(gt(merchants.id, lastSeenId), scope))");
    expect(db).toContain("WHERE o.id > ${lastSeenId} AND ${scope}");
    expect(db).not.toContain("SUM(CASE WHEN o.id >");
  });

  it("生产发布在切换前幂等创建并验证游标表与索引", () => {
    expect(sqlMigration).toContain("CREATE TABLE IF NOT EXISTS `admin_module_notification_cursors`");
    expect(sqlMigration).toContain("UNIQUE KEY `admin_module_notification_viewer_module_unique`");
    expect(migrationJournal).toContain('"tag": "0022_admin_module_notification_cursors"');
    expect(migrationRunner).toContain("GET_LOCK");
    expect(migrationRunner).toContain("information_schema.COLUMNS");
    expect(migrationRunner).toContain("viewerKey,module");
    expect(deploy).toContain("apply-admin-module-notification-schema.mjs");
    expect(deploy.indexOf("apply-admin-module-notification-schema.mjs")).toBeLessThan(
      deploy.indexOf('echo "=== 5. 原子切换软链 ==="'),
    );
  });
});
