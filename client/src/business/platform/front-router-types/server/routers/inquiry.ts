import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { submitAdminInquiry, postInquiryToChat } from "../services/customerService";
import {
  QUICK_INQUIRY_COMPANY_NAME_MAX_LENGTH,
  QUICK_INQUIRY_PART_NUMBER_MAX_LENGTH,
  QUICK_INQUIRY_PART_NUMBER_PATTERN,
  QUICK_INQUIRY_QUANTITY_PATTERN,
} from "../../../shared/inquiryValidation";

/** 简单限频：同一用户 30 秒内只允许提交一次询价 */
const lastSubmitAt = new Map<number, number>();

export const quickInquiryInputSchema = z.object({
  partNumber: z
    .string()
    .trim()
    .min(2, "请填写料号")
    .max(QUICK_INQUIRY_PART_NUMBER_MAX_LENGTH, "料号最多64个字符")
    .regex(QUICK_INQUIRY_PART_NUMBER_PATTERN, "料号仅支持字母、数字及 - _ . / +")
    .transform(value => value.toUpperCase()),
  companyName: z
    .string()
    .trim()
    .min(2, "请填写公司名称")
    .max(QUICK_INQUIRY_COMPANY_NAME_MAX_LENGTH, "公司名称最多100个字符"),
  brand: z.string().trim().max(50).optional(),
  quantity: z
    .string()
    .trim()
    .regex(QUICK_INQUIRY_QUANTITY_PATTERN, "数量请输入1至12位正整数"),
  targetPrice: z.string().trim().max(30).optional(),
  remark: z.string().trim().max(500).optional(),
});

export const inquiryRouter = router({
  /**
   * 首页「快速询价」：料号、公司名称、数量必填，品牌/价格/备注选填。
   * 提交后组织为结构化文本，同步到后台控制台"消息"模块。
   */
  quickSubmit: protectedProcedure
    .input(quickInquiryInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const last = lastSubmitAt.get(ctx.user.id) ?? 0;
      if (now - last < 30_000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "提交太频繁，请30秒后再试" });
      }

      const lines = [
        `【快速询价】`,
        `公司名称：${input.companyName}`,
        `料号：${input.partNumber}`,
        input.brand ? `品牌：${input.brand}` : null,
        `数量：${input.quantity}`,
        input.targetPrice ? `目标价格：${input.targetPrice}` : null,
        input.remark ? `备注：${input.remark}` : null,
      ].filter(Boolean);

      const user = ctx.user as {
        id: number;
        name?: string | null;
        phone?: string | null;
        email?: string | null;
      };
      const result = await submitAdminInquiry({
        subject: `快速询价 - ${input.partNumber}`,
        content: lines.join("\n"),
        user,
      });
      if (!result) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价提交失败，请稍后重试或联系客服" });
      }
      lastSubmitAt.set(ctx.user.id, now);
      if (lastSubmitAt.size > 5000) lastSubmitAt.clear();

      // 聊一聊自动触发：询价消息卡片 + 客服"已收到"确认（失败不阻塞询价）
      const conversationId = await postInquiryToChat({
        card: {
          companyName: input.companyName,
          partNumber: input.partNumber,
          brand: input.brand,
          quantity: input.quantity,
          targetPrice: input.targetPrice,
          remark: input.remark,
          threadNo: result.threadNo,
        },
        user: { id: ctx.user.id },
      });

      return { ok: true, threadNo: result.threadNo, conversationId };
    }),
});
