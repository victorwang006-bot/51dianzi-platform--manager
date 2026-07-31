import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";
import { eq } from "drizzle-orm";
import { merchants } from "../drizzle/schema";

const PORTAL_KEY = "test-portal-key-12345";

function createPortalContext(portalKey?: string): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: portalKey ? { "x-portal-key": portalKey } : {},
    } as unknown as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

const uniqueLicense = `91330100TEST${Date.now().toString().slice(-6)}`;
const createdMerchantIds = new Set<number>();

const submission = {
  companyName: "测试对接电子有限公司",
  contactName: "张对接",
  contactPhone: "13900001111",
  contactEmail: "portal-test@example.com",
  businessLicense: uniqueLicense,
  licenseImageUrl: "https://example.com/license.jpg",
  agreementFileUrl: "https://example.com/agreement.pdf",
  agreementSigned: true,
  registeredAddress: "杭州市滨江区测试路 1 号",
  legalPersonName: "李法人",
  legalPersonPhone: "13800002222",
};

beforeAll(() => {
  process.env.PORTAL_API_KEY = PORTAL_KEY;
});

afterAll(async () => {
  const conn = await db.getDb();
  if (!conn) return;
  for (const id of createdMerchantIds) {
    await conn.delete(merchants).where(eq(merchants.id, id));
  }
});

describe("portal.submitMerchant", () => {
  it("缺少对接密钥时拒绝访问", async () => {
    const caller = appRouter.createCaller(createPortalContext());
    await expect(caller.portal.submitMerchant(submission)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("错误对接密钥时拒绝访问", async () => {
    const caller = appRouter.createCaller(createPortalContext("wrong-key"));
    await expect(caller.portal.submitMerchant(submission)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("正确密钥可提交入驻资料并创建 pending 商户", async () => {
    const caller = appRouter.createCaller(createPortalContext(PORTAL_KEY));
    const result = await caller.portal.submitMerchant(submission);
    createdMerchantIds.add(result.merchantId);
    expect(result.created).toBe(true);
    expect(result.status).toBe("pending");
    expect(result.merchantNo).toMatch(/^M\d+/);

    const merchant = await db.getMerchantById(result.merchantId);
    expect(merchant).not.toBeNull();
    expect(merchant?.companyName).toBe(submission.companyName);
    expect(merchant?.contactEmail).toBe(submission.contactEmail);
    expect(merchant?.licenseImageUrl).toBe(submission.licenseImageUrl);
    expect(merchant?.agreementFileUrl).toBe(submission.agreementFileUrl);
    expect(merchant?.agreementStatus).toBe("signed");
    expect(merchant?.source).toBe("portal");
    expect(merchant?.submittedAt).toBeTruthy();
  });

  it("同一营业执照号重复提交为幂等更新而非新建", async () => {
    const caller = appRouter.createCaller(createPortalContext(PORTAL_KEY));
    const updated = await caller.portal.submitMerchant({
      ...submission,
      contactName: "王更新",
      contactPhone: "13711113333",
    });
    expect(updated.created).toBe(false);

    const merchant = await db.getMerchantById(updated.merchantId);
    expect(merchant?.contactName).toBe("王更新");
    expect(merchant?.contactPhone).toBe("13711113333");
  });

  it("可选参数 salesOwner 写入商户销售负责人列，重复提交可更新", async () => {
    const caller = appRouter.createCaller(createPortalContext(PORTAL_KEY));
    const license = `91330100SALES${Date.now().toString().slice(-6)}`;
    const created = await caller.portal.submitMerchant({
      ...submission,
      businessLicense: license,
      salesOwner: "赵销售",
    });
    createdMerchantIds.add(created.merchantId);
    expect(created.created).toBe(true);
    let merchant = await db.getMerchantById(created.merchantId);
    expect(merchant?.salesOwner).toBe("赵销售");

    // 不传 salesOwner 时保留原值
    await caller.portal.submitMerchant({ ...submission, businessLicense: license });
    merchant = await db.getMerchantById(created.merchantId);
    expect(merchant?.salesOwner).toBe("赵销售");

    // 再次提交可更新销售负责人
    await caller.portal.submitMerchant({ ...submission, businessLicense: license, salesOwner: "钱销售" });
    merchant = await db.getMerchantById(created.merchantId);
    expect(merchant?.salesOwner).toBe("钱销售");
  });
});

describe("merchant.review 状态精简", () => {
  it("reject/terminate 不再是合法的审核操作", () => {
    const reviewInput = { id: 1, action: "reject", note: "x" };
    // zod 校验应拒绝 reject
    const caller = appRouter.createCaller({
      user: {
        id: 1, openId: "local_admin:8", email: null, name: "t", loginMethod: "password",
        role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} },
      res: { cookie: () => undefined, clearCookie: () => undefined },
    } as unknown as TrpcContext);
    return expect(
      caller.merchant.review(reviewInput as never)
    ).rejects.toThrowError();
  });
});
