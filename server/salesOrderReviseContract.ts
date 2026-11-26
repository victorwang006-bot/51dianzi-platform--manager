import { z } from "zod";
const __rvId = z.number().int().positive().max(2147483647);
const __rvPrice = z.string().trim().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/, "金额最多 4 位小数，且不能为负数");
export const salesReviseSchema = z.object({
  id: __rvId,
  version: __rvId,
  requestId: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  reason: z.string().trim().min(1, "请填写修改原因").max(200),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  confirmationNote: z.string().trim().min(1, "请填写客户确认说明").max(500),
  salesTaxMode: z.enum(["tax_included", "tax_excluded"]).optional(),
  customerId: __rvId.optional(),
  lines: z.array(z.object({ orderItemId: __rvId, orderedQty: z.number().int().positive().max(999999999), unitPrice: __rvPrice }).strict()).min(1).max(200),
  expenses: z.array(z.object({ title: z.string().trim().min(1).max(64), amount: __rvPrice, note: z.string().trim().max(500).optional() }).strict()).max(30)
}).strict().superRefine((v, ctx) => {
  const ids = new Set<number>();
  v.lines.forEach((l, i) => { if (ids.has(l.orderItemId)) ctx.addIssue({ code: "custom", path: ["lines", i], message: "订单明细重复" }); ids.add(l.orderItemId); });
});

export type SalesReviseInput = z.infer<typeof salesReviseSchema>;
