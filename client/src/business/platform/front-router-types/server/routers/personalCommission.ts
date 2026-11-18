import { router } from "../_core/trpc";
import { personalSalesReadProcedure } from "./personalSalesRead";
import { personalCommissionInputSchema } from "../../../shared/personalCommission";
import { summarizePersonalCommission } from "../services/personalCommission";
export const personalCommissionRouter = router({
  summary: personalSalesReadProcedure
    .input(personalCommissionInputSchema)
    .query(({ ctx, input }) => summarizePersonalCommission({
      enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
      actorUserId: ctx.user.id,
    }, input)),
});
