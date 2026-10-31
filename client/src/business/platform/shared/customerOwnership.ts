import { z } from "zod";

export const customerOwnershipQuerySchema = z.object({
  companyName: z.string().trim().min(2, "请输入至少2个字的客户公司名称").max(128, "公司名称不能超过128字"),
}).strict();
export type CustomerOwnershipQuery = z.infer<typeof customerOwnershipQuerySchema>;
export type CustomerOwnershipMatch = {
  companyName: string;
  ownerName: string;
  ownership: "mine" | "colleague";
  archived: boolean;
  matchType: "exact" | "similar";
  /** No ID is exposed for a colleague's private customer. */
  viewableCustomerId: number | null;
};
export type CustomerOwnershipResult = {
  query: string;
  matches: CustomerOwnershipMatch[];
  hasMore: boolean;
};
