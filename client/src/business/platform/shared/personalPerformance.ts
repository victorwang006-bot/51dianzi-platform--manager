import { z } from "zod";
export const personalMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月份格式须为YYYY-MM")
  .refine(
    value =>
      Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 9998,
    "年份不在有效范围"
  );
export const personalPerformanceInputSchema = z
  .object({
    month: personalMonthSchema,
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(10),
  })
  .strict();
const base = {
  month: personalMonthSchema,
  currency: z.literal("CNY"),
  currencyLabel: z.literal("人民币（含税）"),
  timezone: z.literal("Asia/Shanghai"),
};
const amount = z.string().regex(/^\d+\.\d{4}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const personalPerformanceOrderSchema = z
  .object({
    id: z.number().int().positive(),
    orderNumber: z.string().max(128),
    status: z.literal("confirmed"),
    totalAmount: amount,
    createdAt: z.iso.datetime(),
    currencyLabel: z.literal("人民币（含税）"),
  })
  .strict();
export const personalPerformanceResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...base,
      status: z.literal("available"),
      orderCount: count,
      orderAmount: amount,
      collectedAmount: amount,
      monthlyBookedAmount: amount,
      refundAmount: z.null(),
      refundStatus: z.literal("unavailable"),
      basis: z.string().max(2000),
      items: z.array(personalPerformanceOrderSchema).max(50),
      total: count,
      page: z.number().int().min(1).max(100000),
      pageSize: z.number().int().min(1).max(50),
    })
    .strict(),
  z
    .object({
      ...base,
      status: z.literal("unavailable"),
      reason: z.string().max(500),
    })
    .strict(),
]);
export type PersonalPerformanceResult = z.infer<
  typeof personalPerformanceResultSchema
>;
