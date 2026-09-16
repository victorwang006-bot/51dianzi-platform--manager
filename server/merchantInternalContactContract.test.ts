import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const schema = read("drizzle/schema.ts");
const db = read("server/db.ts");
const router = read("server/routers.ts");
const page = read("client/src/pages/Merchants.tsx");
const detailPage = read("client/src/pages/MerchantDetail.tsx");
const migration = read("scripts/apply-merchant-internal-contact-schema.mjs");
const deploy = read("deploy/deploy-admin.sh");

function section(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("后台用户名独立存储", () => {
  it("使用可空独立字段且迁移纳入正式发布", () => {
    expect(schema).toContain('internalContactName: varchar("internalContactName", { length: 64 })');
    expect(migration).toContain("ALTER TABLE `merchants` ADD COLUMN `internalContactName` varchar(64) NULL");
    expect(migration).toContain("information_schema.COLUMNS");
    expect(deploy).toContain("apply-merchant-internal-contact-schema.mjs");
  });

  it("只更新后台商户表，不同步主站企业资料，并记录审计", () => {
    const fn = section(db, "export async function setMerchantInternalContactName", "export async function updateMerchantStatus");
    expect(fn).toContain("db.transaction");
    expect(fn).toContain('.for("update")');
    expect(fn).toContain("allowedSalesStaffCodes.includes(currentOwnerCode)");
    expect(fn).toContain("INTERNAL_CONTACT_NAME_CHANGED");
    expect(fn).toContain(".set({ internalContactName: nextName })");
    expect(fn).toContain('action: "merchant.internal-contact.update"');
    expect(fn).not.toContain("PLATFORM_DB");
    expect(fn).not.toContain("companies");
  });
});

describe("后台用户名修改权限与UI", () => {
  it("接口要求商户写权限并复核正式负责人范围", () => {
    const route = section(router, "setInternalContactName: merchantWriteProcedure", "/** 分配、变更或清空销售负责人");
    expect(route).toContain("await assertMerchantInSalesScope(ctx, input.id)");
    expect(route).toContain("const allowedSalesStaffCodes = await getAdminSalesStaffCodes(ctx)");
    expect(route).toContain("allowedSalesStaffCodes,");
    expect(route).toContain("expectedInternalContactName");
    expect(route).toContain("INTERNAL_CONTACT_NAME_CHANGED");
  });

  it("列表仅展示用户名，修改入口转移到详情页的小型标签", () => {
    expect(page).toContain("internalContactName || systemContactName");
    expect(page).toContain("<th>用户名</th>");
    expect(page).not.toContain("setInternalContactName.useMutation");
    expect(page).not.toContain('aria-label="修改用户名"');
    expect(detailPage).toContain("trpc.merchant.setInternalContactName.useMutation");
    expect(detailPage).toContain("merchant.canManage && !usernameEditing");
    expect(detailPage).toContain('aria-label="修改用户名"');
    expect(detailPage).toContain('text-[10px] font-normal text-primary');
    expect(detailPage).toContain("expectedInternalContactName: merchant.internalContactName");
    expect(detailPage).toContain("merchant.internalContactName?.trim() || merchant.contactName");
    expect(detailPage).toContain("清空后保存可恢复原用户名");
  });

  it("详情接口仅向负责人范围内账号开放修改入口", () => {
    const detailRoute = section(router, "detail: merchantReadProcedure", "/**\n     * 营业执照属于敏感资料");
    expect(detailRoute).toContain("const salesStaffCodes = await getAdminSalesStaffCodes(ctx)");
    expect(detailRoute).toContain("canManage: salesStaffCodes === undefined");
    expect(detailRoute).toContain("salesStaffCodes.includes(merchant.salesOwnerCode?.trim().toLowerCase() || \"\")");
  });
});
