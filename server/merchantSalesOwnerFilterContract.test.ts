import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const db = read("server/db.ts");
const router = read("server/routers.ts");
const page = read("client/src/pages/Merchants.tsx");
const ownerFilter = read("client/src/components/SalesOwnerFilterCombobox.tsx");
const schema = read("drizzle/schema.ts");
const migration = read("scripts/apply-merchant-sales-owner-filter-schema.mjs");
const deploy = read("deploy/deploy-admin.sh");

function section(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("商户销售负责人筛选", () => {
  it("服务端在计数和分页前组合负责人、关键词与销售范围条件", () => {
    const list = section(db, "export async function getMerchants", "/**\n * 商户页负责人筛选选项");
    expect(list).toContain("salesOwnerCode?: string");
    expect(list).toContain('salesOwnerCode === "$unassigned"');
    expect(list).toContain("isNull(merchants.salesOwnerCode)");
    expect(list).toContain('eq(merchants.salesOwnerCode, "")');
    expect(list).toContain("conditions.push(eq(merchants.salesOwnerCode, salesOwnerCode))");
    expect(list).toContain("!salesStaffCodes.includes(salesOwnerCode)");
    expect(list.indexOf("const where =")).toBeLessThan(list.indexOf("count(*)"));
    expect(list.indexOf("count(*)")).toBeLessThan(list.indexOf(".limit(pageSize)"));
  });

  it("普通后台账号不能枚举范围外负责人或查看未分配商户", () => {
    const options = section(db, "export async function getMerchantSalesOwnerFilterOptions", "/** 按 ID 取商户");
    expect(options).toContain("inArray(salesStaff.staffCode, salesStaffCodes)");
    expect(options).toContain("canViewUnassigned: salesStaffCodes === undefined");
    expect(router).toContain("getMerchantSalesOwnerFilterOptions(await getAdminSalesStaffCodes(ctx))");
    expect(router).toContain('z.literal("$unassigned")');
    expect(router).toContain("getMerchants(input, await getAdminSalesStaffCodes(ctx))");
  });

  it("页面提供姓名工号搜索、单选即筛选、未分配和简洁重置", () => {
    expect(page).toContain("<SalesOwnerFilterCombobox");
    expect(ownerFilter).toContain('aria-label="按销售负责人筛选商户"');
    expect(ownerFilter).toContain('placeholder="搜索姓名或工号"');
    expect(ownerFilter).toContain('value={`${staff.displayName} ${staff.staffCode}');
    expect(ownerFilter).toContain('select("$unassigned")');
    expect(ownerFilter).toContain('staff.active ? "启用" : "停用"');
    expect(ownerFilter).toContain("duplicateNames");
    expect(ownerFilter).toContain('`（${staff.staffCode}）`');
    expect(ownerFilter).toContain('className="max-h-[min(420px,60vh)]"');
    expect(ownerFilter).toContain('heading={`负责人（${options.length}人）`}');
    expect(ownerFilter).toContain("options.map(staff =>");
    expect(ownerFilter).not.toMatch(/options\.(slice|splice)\(/);
    expect(page).toContain('salesOwnerCode: salesOwnerFilter === "all" ? undefined : salesOwnerFilter');
    expect(page).toContain("setSalesOwnerFilter(value)");
    expect(page).toContain("setPage(1)");
    expect(page).toContain("resetFilters");
    expect(page).toContain(">\n              重置\n            </Button>");
  });

  it("负责人变更后刷新筛选选项，停用负责人没有商户时退出无效筛选", () => {
    expect(page).toContain("utils.merchant.salesOwnerFilterOptions.invalidate()");
    expect(page).toContain("salesOwnerFilterOptions.options.some");
    expect(page).toContain('setSalesOwnerFilter("all")');
  });

  it("生产迁移创建负责人和时间复合索引并在切换前验证", () => {
    expect(schema).toContain('index("merchants_sales_owner_created_idx")');
    expect(schema).toContain("table.salesOwnerCode");
    expect(schema).toContain("table.createdAt");
    expect(migration).toContain("GET_LOCK");
    expect(migration).toContain("CREATE INDEX `merchants_sales_owner_created_idx`");
    expect(migration).toContain('String(verified.columnsCsv) !== "salesOwnerCode,createdAt"');
    expect(deploy).toContain("apply-merchant-sales-owner-filter-schema.mjs");
    expect(deploy.indexOf("apply-merchant-sales-owner-filter-schema.mjs")).toBeLessThan(
      deploy.indexOf("=== 5. 原子切换软链 ==="),
    );
  });
});
