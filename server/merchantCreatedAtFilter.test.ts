import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isValidCalendarDate,
  resolveMerchantCreatedAtBounds,
} from "../shared/merchantCreatedAtFilter";

const root = join(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const db = read("server/db.ts");
const router = read("server/routers.ts");
const page = read("client/src/pages/Merchants.tsx");
const filter = read("client/src/components/MerchantCreatedAtFilter.tsx");
const schema = read("drizzle/schema.ts");
const migration = read("scripts/apply-merchant-created-at-filter-schema.mjs");
const deploy = read("deploy/deploy-admin.sh");

function section(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("商户入驻时间筛选", () => {
  const now = new Date("2026-09-16T04:30:00.000Z");

  it("固定使用北京时间自然日计算常用范围", () => {
    expect(resolveMerchantCreatedAtBounds({ createdAtPreset: "today" }, now)).toEqual({
      from: new Date("2026-09-15T16:00:00.000Z"),
      to: new Date("2026-09-16T16:00:00.000Z"),
    });
    expect(resolveMerchantCreatedAtBounds({ createdAtPreset: "last7Days" }, now)).toEqual({
      from: new Date("2026-09-09T16:00:00.000Z"),
      to: new Date("2026-09-16T16:00:00.000Z"),
    });
    expect(resolveMerchantCreatedAtBounds({ createdAtPreset: "last30Days" }, now)).toEqual({
      from: new Date("2026-08-17T16:00:00.000Z"),
      to: new Date("2026-09-16T16:00:00.000Z"),
    });
    expect(resolveMerchantCreatedAtBounds({ createdAtPreset: "thisMonth" }, now)).toEqual({
      from: new Date("2026-08-31T16:00:00.000Z"),
      to: new Date("2026-09-30T16:00:00.000Z"),
    });
  });

  it("自定义范围包含结束日期且拒绝无效日期", () => {
    expect(resolveMerchantCreatedAtBounds({
      createdAtPreset: "custom",
      createdFrom: "2026-09-01",
      createdTo: "2026-09-15",
    }, now)).toEqual({
      from: new Date("2026-08-31T16:00:00.000Z"),
      to: new Date("2026-09-15T16:00:00.000Z"),
    });
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(() => resolveMerchantCreatedAtBounds({
      createdAtPreset: "custom",
      createdFrom: "2026-09-16",
      createdTo: "2026-09-15",
    }, now)).toThrow("INVALID_MERCHANT_CREATED_RANGE");
  });

  it("服务端在总数和分页前组合时间条件", () => {
    const list = section(db, "export async function getMerchants", "/**\n * 商户页负责人筛选选项");
    expect(list).toContain("resolveMerchantCreatedAtBounds(params)");
    expect(list).toContain("gte(merchants.createdAt, createdAtBounds.from)");
    expect(list).toContain("lt(merchants.createdAt, createdAtBounds.to)");
    expect(list.indexOf("createdAtBounds")).toBeLessThan(list.indexOf("const where ="));
    expect(list.indexOf("const where =")).toBeLessThan(list.indexOf("count(*)"));
  });

  it("接口校验预设、自定义日期完整性和顺序", () => {
    const listRoute = section(router, "list: merchantReadProcedure", "salesOwnerFilterOptions:");
    expect(listRoute).toContain("MERCHANT_CREATED_AT_PRESETS");
    expect(listRoute).toContain("isValidCalendarDate");
    expect(listRoute).toContain('input.createdAtPreset === "custom"');
    expect(listRoute).toContain("input.createdFrom > input.createdTo");
  });

  it("页面提供单个紧凑按钮、常用预设、自定义区间及联动重置", () => {
    expect(page).toContain("<MerchantCreatedAtFilter");
    expect(page).toContain("createdAtPreset:");
    expect(page).toContain('setCreatedAtFilter({ preset: "all" })');
    expect(page).toContain('createdAtFilter.preset !== "all"');
    expect(filter).toContain('aria-label="按入驻时间筛选商户"');
    expect(filter).toContain('{ value: "today", label: "今天" }');
    expect(filter).toContain('{ value: "last7Days", label: "近 7 天" }');
    expect(filter).toContain('{ value: "last30Days", label: "近 30 天" }');
    expect(filter).toContain('{ value: "thisMonth", label: "本月" }');
    expect(filter).toContain('type="date"');
    expect(filter).toContain("应用区间");
  });

  it("生产发布先幂等创建并验证 createdAt 索引", () => {
    expect(schema).toContain('index("merchants_created_at_idx").on(table.createdAt)');
    expect(migration).toContain("GET_LOCK");
    expect(migration).toContain("CREATE INDEX `merchants_created_at_idx`");
    expect(migration).toContain('String(verified.columnsCsv) !== "createdAt"');
    expect(deploy).toContain("apply-merchant-created-at-filter-schema.mjs");
    expect(deploy.indexOf("apply-merchant-created-at-filter-schema.mjs")).toBeLessThan(
      deploy.indexOf("=== 5. 原子切换软链 ==="),
    );
  });
});
