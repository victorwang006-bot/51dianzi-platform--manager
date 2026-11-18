import { router } from "../_core/trpc";
import { personalSalesReadProcedure } from "./personalSalesRead";
import { personalPerformanceInputSchema } from "../../../shared/personalPerformance";
import { summarizePersonalPerformance } from "../services/personalPerformance";
export const personalPerformanceRouter = router({
  summary: personalSalesReadProcedure
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
