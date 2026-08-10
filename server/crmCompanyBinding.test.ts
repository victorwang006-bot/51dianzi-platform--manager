import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { merchants } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { appRouter } from "./routers";

if (!process.env.PORTAL_API_KEY) {
  process.env.PORTAL_API_KEY = "test-portal-key-local";
}
const PORTAL_KEY = process.env.PORTAL_API_KEY;

const CODES = {
  normalized: "91CRMBIND000000001",
  enabled: "91CRMBIND000000002",
  rejected: "91CRMBIND000000003",
  legacy: "91CRMBIND000000004",
  claimable: "91CRMBIND000000005",
  concurrent: "91CRMBIND000000006",
  accountRequired: "91CRMBIND000000007",
} as const;

function portalCtx(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: { "x-portal-key": PORTAL_KEY },
    } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function cleanup() {
  const connection = await db.getDb();
  if (!connection) return;
  await connection.delete(merchants).where(inArray(merchants.businessLicense, Object.values(CODES)));
}

async function merchantByCode(creditCode: string) {
  const connection = await db.getDb();
  if (!connection) throw new Error("Database not available");
  const rows = await connection.select().from(merchants)
    .where(eq(merchants.businessLicense, creditCode)).limit(1);
  return rows[0] ?? null;
}

describe("CRM 企业唯一绑定与重复申请保护", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("规范化信用代码并让同一账号重复提交保持幂等", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const first = await portal.submitCrmApplication({
      companyName: "规范化测试企业",
      creditCode: `  ${CODES.normalized.toLowerCase()}  `,
      portalUserId: " owner-normalized ",
      contactPhone: "13800001001",
    });
    expect(first).toMatchObject({
      accepted: true,
      created: true,
      code: "CRM_APPLICATION_ACCEPTED",
      crmStatus: "pending",
    });

    const second = await portal.submitCrmApplication({
      companyName: "不应覆盖的企业名称",
      creditCode: CODES.normalized,
      portalUserId: "owner-normalized",
      contactPhone: "13800009999",
    });
    expect(second).toMatchObject({
      accepted: false,
      created: false,
      code: "CRM_APPLICATION_PENDING",
    });

    const stored = await merchantByCode(CODES.normalized);
    expect(stored).toMatchObject({
      companyName: "规范化测试企业",
      contactPhone: "13800001001",
      crmOwnerPortalUserId: "owner-normalized",
    });
  });

  it("其他账号不能覆盖审核中的企业，且响应不泄露绑定账号和内部标识", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    await portal.submitCrmApplication({
      companyName: "审核中企业",
      creditCode: CODES.normalized,
      portalUserId: "owner-a",
      contactName: "原联系人",
      contactPhone: "13800001002",
    });

    const duplicate = await portal.submitCrmApplication({
      companyName: "恶意覆盖名称",
      creditCode: CODES.normalized,
      portalUserId: "owner-b",
      contactName: "其他联系人",
      contactPhone: "13800009998",
    });
    expect(duplicate).toMatchObject({
      accepted: false,
      created: false,
      code: "CRM_COMPANY_APPLICATION_PENDING",
      crmStatus: "pending",
      message: "该企业的 CRM 开通申请正在审核中",
    });
    expect(duplicate).not.toHaveProperty("merchantId");
    expect(duplicate).not.toHaveProperty("merchantNo");
    expect(JSON.stringify(duplicate)).not.toContain("owner-a");
    expect(JSON.stringify(duplicate)).not.toContain("13800001002");

    const stored = await merchantByCode(CODES.normalized);
    expect(stored).toMatchObject({
      companyName: "审核中企业",
      contactName: "原联系人",
      contactPhone: "13800001002",
      crmOwnerPortalUserId: "owner-a",
    });
  });

  it("已开通企业只允许绑定账号访问，其他账号获得明确但不泄密的提示", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const created = await portal.submitCrmApplication({
      companyName: "已开通企业",
      creditCode: CODES.enabled,
      portalUserId: "enabled-owner",
    });
    const connection = await db.getDb();
    await connection!.update(merchants).set({ crmStatus: "enabled" })
      .where(eq(merchants.id, created.merchantId!));

    const ownerRepeat = await portal.submitCrmApplication({
      companyName: "已开通企业",
      creditCode: CODES.enabled,
      portalUserId: "enabled-owner",
    });
    expect(ownerRepeat.code).toBe("CRM_ALREADY_ENABLED");

    const otherRepeat = await portal.submitCrmApplication({
      companyName: "已开通企业",
      creditCode: CODES.enabled,
      portalUserId: "other-owner",
    });
    expect(otherRepeat).toMatchObject({
      code: "CRM_COMPANY_ALREADY_ENABLED",
      message: "该公司已经开通CRM，请联系CEM管理员。",
    });
    expect(otherRepeat).not.toHaveProperty("merchantId");
    expect(otherRepeat).not.toHaveProperty("merchantNo");

    const ownerAccess = await portal.getCrmAccess({
      creditCode: CODES.enabled,
      portalUserId: "enabled-owner",
    });
    expect(ownerAccess).toMatchObject({ allowed: true, code: "CRM_ACCESS_GRANTED" });
    expect(ownerAccess.merchantNo).toBeTruthy();

    const otherAccess = await portal.getCrmAccess({
      creditCode: CODES.enabled,
      portalUserId: "other-owner",
    });
    expect(otherAccess).toMatchObject({
      allowed: false,
      code: "CRM_COMPANY_ALREADY_ENABLED",
      message: "该公司已经开通CRM，请联系CEM管理员。",
    });
    expect(otherAccess).not.toHaveProperty("merchantNo");
    expect(otherAccess).not.toHaveProperty("crmThreadNo");
  });

  it("同一账号可在被拒绝后重新申请，其他账号仍不能抢占", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const created = await portal.submitCrmApplication({
      companyName: "重新申请企业",
      creditCode: CODES.rejected,
      portalUserId: "reapply-owner",
    });
    const connection = await db.getDb();
    await connection!.update(merchants).set({ crmStatus: "rejected" })
      .where(eq(merchants.id, created.merchantId!));

    const other = await portal.submitCrmApplication({
      companyName: "其他账号企业",
      creditCode: CODES.rejected,
      portalUserId: "other-owner",
    });
    expect(other).toMatchObject({
      code: "CRM_COMPANY_ALREADY_BOUND",
      message: "该企业已绑定其他前台账号，请联系企业管理员或平台客服",
    });

    const reapplied = await portal.submitCrmApplication({
      companyName: "重新申请企业",
      creditCode: CODES.rejected,
      portalUserId: "reapply-owner",
      note: "已补充材料",
    });
    expect(reapplied).toMatchObject({
      accepted: true,
      code: "CRM_APPLICATION_REAPPLIED",
      crmStatus: "pending",
    });
  });

  it("存量已开通企业未绑定账号时要求平台确认，未申请企业可被首次安全认领", async () => {
    const connection = await db.getDb();
    await connection!.insert(merchants).values({
      merchantNo: "MCRMTESTLEGACY04",
      companyName: "存量已开通企业",
      businessLicense: CODES.legacy,
      crmStatus: "enabled",
      source: "portal",
    });
    await connection!.insert(merchants).values({
      merchantNo: "MCRMTESTCLAIM05",
      companyName: "存量未申请企业",
      businessLicense: CODES.claimable,
      crmStatus: "none",
      source: "admin",
    });

    const portal = appRouter.createCaller(portalCtx()).portal;
    const legacy = await portal.submitCrmApplication({
      companyName: "不得抢占存量企业",
      creditCode: CODES.legacy,
      portalUserId: "new-owner",
    });
    expect(legacy.code).toBe("CRM_BINDING_REQUIRED");

    const claimed = await portal.submitCrmApplication({
      companyName: "存量未申请企业",
      creditCode: CODES.claimable,
      portalUserId: "claim-owner",
    });
    expect(claimed).toMatchObject({ accepted: true, code: "CRM_APPLICATION_ACCEPTED" });
    expect(await merchantByCode(CODES.claimable)).toMatchObject({
      crmOwnerPortalUserId: "claim-owner",
      crmStatus: "pending",
    });
  });

  it("并发不同账号提交同一企业时只创建一条记录且仅一个账号获得归属", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const [first, second] = await Promise.all([
      portal.submitCrmApplication({
        companyName: "并发企业",
        creditCode: CODES.concurrent,
        portalUserId: "concurrent-a",
      }),
      portal.submitCrmApplication({
        companyName: "并发企业",
        creditCode: CODES.concurrent,
        portalUserId: "concurrent-b",
      }),
    ]);

    const results = [first, second];
    expect(results.filter((item) => item.accepted)).toHaveLength(1);
    expect(results.filter((item) => item.code === "CRM_COMPANY_APPLICATION_PENDING")).toHaveLength(1);

    const connection = await db.getDb();
    const rows = await connection!.select().from(merchants)
      .where(eq(merchants.businessLicense, CODES.concurrent));
    expect(rows).toHaveLength(1);
    expect(["concurrent-a", "concurrent-b"]).toContain(rows[0].crmOwnerPortalUserId);
  });

  it("未提供前台账号时返回结构化结果且不创建企业", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const result = await portal.submitCrmApplication({
      companyName: "缺少账号企业",
      creditCode: CODES.accountRequired,
    });
    expect(result).toMatchObject({
      accepted: false,
      created: false,
      code: "CRM_ACCOUNT_REQUIRED",
    });
    expect(await merchantByCode(CODES.accountRequired)).toBeNull();
  });
});
