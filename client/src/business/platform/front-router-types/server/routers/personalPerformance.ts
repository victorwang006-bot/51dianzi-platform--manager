import { createCrmPermissionProcedure, router } from "../_core/trpc";
import { personalPerformanceInputSchema } from "../../../shared/personalPerformance";
import { summarizePersonalPerformance } from "../services/personalPerformance";
export const personalPerformanceRouter = router({
  summary: createCrmPermissionProcedure("sales.business_orders")
    .input(personalPerformanceInputSchema)
    .query(({ ctx, input }) =>
      summarizePersonalPerformance(
        {
          enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
          actorUserId: ctx.user.id,
        },
        input
      )
    ),
});
