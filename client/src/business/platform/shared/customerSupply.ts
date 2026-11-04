import { z } from "zod";
const id = z.number().int().safe().positive();
const expected = { expectedEnterpriseId: id, expectedActorUserId: id };
export const customerSupplySummarySchema = z.object({ ...expected, customerIds: z.array(id).max(100) }).strict();
export const customerSupplyContextSchema = z.object({ ...expected, customerId: id }).strict();
/** Shared verbatim with createMaterial: no customer mode inference or tax defaults. */
export const channelMaterialCreateFields = {
  partNumber: z.string().transform(value => value.normalize("NFKC").trim()).pipe(z.string().min(1, "请输入型号").max(128)),
  brand: z.string().trim().min(1, "请输入品牌").max(64),
  qty: z.number().int().safe().min(0).max(2_147_483_647).nullable(),
  dateCode: z.string().trim().max(32).nullable().optional().transform(value => value ?? null),
  price: z.string().trim().max(32).regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/, "价格格式无效").nullable().optional().transform(value => value ?? null),
  currency: z.literal("CNY").default("CNY"),
  taxIncluded: z.boolean().nullable(),
  leadTime: z.string().trim().max(64).nullable().optional().transform(value => value ?? null),
  note: z.string().max(2_000).nullable().optional().transform(value => value ?? null),
};
export const createCustomerMaterialSchema = z.object({
  ...expected, customerId: id, expectedCustomerVersion: id,
  sourceProfile: z.object({ type: z.enum(["factory", "agent", "trade", "other"]), existingChannelId: id.optional() }).strict().optional(),
  ...channelMaterialCreateFields, uploadBatchId: id.optional(), requestId: z.string().uuid("请求号无效"),
}).strict();
export type CreateCustomerMaterialInput = z.output<typeof createCustomerMaterialSchema>;
export type CustomerSupplyContextInput = z.output<typeof customerSupplyContextSchema>;
export type CustomerSupplySummaryInput = z.output<typeof customerSupplySummarySchema>;
