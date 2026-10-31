import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { storageGetAccessUrl } from "../storage";
import { triggerCoffeeVoucherAward } from "../services/coffeeVoucherCampaign";

/**
 * 企业认证人工审核（仅平台管理员 role=admin 可用）：
 * - list：按状态查看企业认证申请
 * - approve：审核通过 → 开通该用户 CRM 权限、certLevel 升为 certified
 * - reject：驳回并记录原因（不回收已开通的 CRM 权限）
 */
export const companyReviewRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "approved", "rejected"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const rows = await db.listCompaniesForReview(input?.status);
      return Promise.all(rows.map(async row => {
        const { licenseObjectKey, bankLicenseObjectKey, licenseUrl, bankLicenseUrl, ...company } = row.company;
        return {
          ...row,
          company: {
            ...company,
            hasLicense: Boolean(licenseObjectKey || licenseUrl),
            hasBankLicense: Boolean(bankLicenseObjectKey || bankLicenseUrl),
            licenseAccessUrl: licenseObjectKey
              ? await storageGetAccessUrl(licenseObjectKey, 15 * 60)
              : licenseUrl,
            bankLicenseAccessUrl: bankLicenseObjectKey
              ? await storageGetAccessUrl(bankLicenseObjectKey, 15 * 60)
              : bankLicenseUrl,
          },
        };
      }));
    }),

  approve: adminProcedure
    .input(z.object({ companyId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const application = (await db.listCompaniesForReview()).find(row => row.company.id === input.companyId);
      if (application?.company.registrationRegion === "HK") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "香港BR／CI与银行资料请在管理后台香港申请审核流程复核，不可使用内地旧审核入口" });
      const company = await db.reviewCompany(input.companyId, "approve");
      if (company?.userId) await triggerCoffeeVoucherAward(company.userId);
      return { success: true, company } as const;
    }),

  reject: adminProcedure
    .input(
      z.object({
        companyId: z.number().int().positive(),
        reason: z.string().min(1, "请填写驳回原因").max(500),
      }),
    )
    .mutation(async ({ input }) => {
      const application = (await db.listCompaniesForReview()).find(row => row.company.id === input.companyId);
      if (application?.company.registrationRegion === "HK") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "香港申请请在管理后台香港资料审核流程处理" });
      const company = await db.reviewCompany(input.companyId, "reject", input.reason);
      return { success: true, company } as const;
    }),
});
