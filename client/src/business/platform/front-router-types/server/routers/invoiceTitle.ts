import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { INVOICE_TITLE_TYPES } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform(value => value || null);

const invoiceTitleFields = z.object({
  type: z.enum(INVOICE_TITLE_TYPES),
  title: z.string().trim().min(1, "请输入发票抬头").max(128),
  taxNumber: optionalText(32),
  registeredAddress: optionalText(255),
  registeredPhone: optionalText(32),
  bankName: optionalText(128),
  bankAccount: optionalText(64),
  email: z
    .union([z.string().trim().email("请输入正确的收票邮箱").max(320), z.literal(""), z.null()])
    .optional()
    .transform(value => value || null),
  isDefault: z.boolean().optional(),
});

type InvoiceInput = z.infer<typeof invoiceTitleFields>;

function validateInvoiceTitle(input: InvoiceInput, ctx: z.RefinementCtx) {
  if (input.type !== "personal" && !input.taxNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["taxNumber"], message: "企业发票请输入纳税人识别号" });
  }
  if (input.type === "special") {
    const required = [
      ["registeredAddress", input.registeredAddress, "专用发票请输入注册地址"],
      ["registeredPhone", input.registeredPhone, "专用发票请输入注册电话"],
      ["bankName", input.bankName, "专用发票请输入开户行"],
      ["bankAccount", input.bankAccount, "专用发票请输入银行账号"],
    ] as const;
    required.forEach(([path, value, message]) => {
      if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    });
  }
}

export const invoiceTitleInput = invoiceTitleFields.superRefine(validateInvoiceTitle);
const invoiceTitleWithIdInput = invoiceTitleFields
  .extend({ id: z.number().int().positive() })
  .superRefine(validateInvoiceTitle);

function toFields(input: InvoiceInput) {
  return {
    type: input.type,
    title: input.title,
    taxNumber: input.taxNumber,
    registeredAddress: input.registeredAddress,
    registeredPhone: input.registeredPhone,
    bankName: input.bankName,
    bankAccount: input.bankAccount,
    email: input.email,
    isDefault: Boolean(input.isDefault),
  };
}

function toInsert(userId: number, input: InvoiceInput) {
  return { userId, ...toFields(input) };
}

export const invoiceTitleRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => db.getInvoiceTitlesByUser(ctx.user.id)),

  create: protectedProcedure.input(invoiceTitleInput).mutation(async ({ ctx, input }) => {
    const id = await db.createInvoiceTitle(toInsert(ctx.user.id, input));
    return { id };
  }),

  update: protectedProcedure
    .input(invoiceTitleWithIdInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updated = await db.updateInvoiceTitle(ctx.user.id, id, toFields(data));
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "发票抬头不存在" });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getInvoiceTitlesByUser(ctx.user.id);
      if (!existing.some(item => item.id === input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "发票抬头不存在" });
      }
      await db.deleteInvoiceTitle(ctx.user.id, input.id);
      return { ok: true };
    }),

  setDefault: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.updateInvoiceTitle(ctx.user.id, input.id, { isDefault: true });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "发票抬头不存在" });
      return { ok: true };
    }),
});
