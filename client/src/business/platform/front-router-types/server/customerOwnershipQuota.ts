import { TRPCError } from "@trpc/server";
import { getRateLimitStore } from "./rateLimitStore";

export async function consumeCustomerOwnershipQuota(scope: { enterpriseId: number; actorUserId: number }) {
  const prefix = `crm-ownership:${scope.enterpriseId}:${scope.actorUserId}`;
  const store = getRateLimitStore();
  if (await store.increment(`${prefix}:minute`, 60_000) > 30) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "归属查询过于频繁，请稍后再试" });
  }
  if (await store.increment(`${prefix}:day`, 86_400_000) > 300) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "24小时归属查询次数已达上限，请稍后再试" });
  }
}
