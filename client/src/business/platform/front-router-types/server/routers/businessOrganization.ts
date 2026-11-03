import { protectedProcedure, router } from "../_core/trpc";
import {
  businessAuditSchema, businessCreateTeamSchema, businessSetMemberSchema,
  businessUpdateMemberAccessSchema, businessUpdateTeamSchema,
} from "../../../shared/businessOrganization";
import { requireActiveEnterpriseScope } from "../services/enterprisePermissions";
import { businessOrganizationService } from "../services/businessOrganization";

/** Enterprise selection comes from protectedProcedure's trusted request context, never a payload. */
export const businessOrganizationRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.overview(ctx.user.id, scope.enterprise.id);
  }),
  createTeam: protectedProcedure.input(businessCreateTeamSchema).mutation(async ({ ctx, input }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.createTeam(ctx.user.id, scope.enterprise.id, input);
  }),
  updateTeam: protectedProcedure.input(businessUpdateTeamSchema).mutation(async ({ ctx, input }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.updateTeam(ctx.user.id, scope.enterprise.id, input);
  }),
  setMember: protectedProcedure.input(businessSetMemberSchema).mutation(async ({ ctx, input }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.setMember(ctx.user.id, scope.enterprise.id, input);
  }),
  updateMemberAccess: protectedProcedure.input(businessUpdateMemberAccessSchema).mutation(async ({ ctx, input }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.updateMemberAccess(ctx.user.id, scope.enterprise.id, input);
  }),
  audit: protectedProcedure.input(businessAuditSchema).query(async ({ ctx, input }) => {
    const scope = await requireActiveEnterpriseScope(ctx.user.id);
    return businessOrganizationService.audit(ctx.user.id, scope.enterprise.id, input);
  }),
});
