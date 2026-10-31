import { createCrmAnyPermissionProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { adminDbAvailable, dictLookup } from "../adminDb";
import { demandQuoteAcceptSchema, demandQuoteHistorySchema, demandQuoteListSchema, demandQuoteSaveSchema, demandQuoteWithdrawSchema } from "../../../shared/customerDemandQuotes";
import { acceptDemandQuote, listDemandQuoteHistory, listDemandQuotes, saveDemandQuote, withdrawDemandQuote } from "../services/customerDemandQuotes";
import {
  customerDemandSaveSchema, customerDemandListSchema, customerDemandIdSchema,
  customerDemandRevisionListSchema, procurementDemandListSchema, procurementDemandClaimSchema, salesDemandListSchema,
} from "../../../shared/customerDemands";
import {
  saveCustomerDemand, listCustomerDemands, getCustomerDemand,
  listDemandRevisions, listProcurementDemands, getProcurementDemand, claimProcurementDemand, listSalesDemands,
} from "../services/customerDemands";

const salesProcedure = createCrmAnyPermissionProcedure(["customers.manage", "customers.manage_all"]);
const procurementProcedure = createCrmAnyPermissionProcedure(["procurement.demands"]);
const quoteReadProcedure = createCrmAnyPermissionProcedure(["customers.manage", "customers.manage_all", "procurement.demands"]);
function scopeFor(ctx: { user: { id: number }; enterprisePermissionScope: { enterprise: { id: number } } }) {
  // Independent employee identity; never use the legacy effectiveUserId owner alias.
  return { enterpriseId: ctx.enterprisePermissionScope.enterprise.id, actorUserId: ctx.user.id };
}
export const customerDemandRouter = router({
  suggestPartNumbers: salesProcedure.input(z.object({
    keyword: z.string().max(128).transform(value => value.normalize("NFKC").trim().toUpperCase()),
    limit: z.number().int().min(1).max(12).default(8),
  })).query(async ({ input }) => {
    if (input.keyword.length < 2 || !adminDbAvailable()) return [];
    try { return await dictLookup(input.keyword, input.limit); }
    catch { console.warn("[customerDemand.suggestPartNumbers] material dictionary unavailable"); return []; }
  }),
  quoteSave: procurementProcedure.input(demandQuoteSaveSchema).mutation(({ ctx, input }) => saveDemandQuote(scopeFor(ctx), input)),
  quoteWithdraw: procurementProcedure.input(demandQuoteWithdrawSchema).mutation(({ ctx, input }) => withdrawDemandQuote(scopeFor(ctx), input)),
  quoteList: quoteReadProcedure.input(demandQuoteListSchema).query(({ ctx, input }) => listDemandQuotes(scopeFor(ctx), input)),
  quoteHistory: quoteReadProcedure.input(demandQuoteHistorySchema).query(({ ctx, input }) => listDemandQuoteHistory(scopeFor(ctx), input)),
  quoteAccept: salesProcedure.input(demandQuoteAcceptSchema).mutation(({ ctx, input }) => acceptDemandQuote(scopeFor(ctx), input)),
  save: salesProcedure.input(customerDemandSaveSchema).mutation(({ ctx, input }) => saveCustomerDemand(scopeFor(ctx), input)),
  list: salesProcedure.input(customerDemandListSchema).query(({ ctx, input }) => listCustomerDemands(scopeFor(ctx), input)),
  salesList: salesProcedure.input(salesDemandListSchema).query(({ ctx, input }) => listSalesDemands(scopeFor(ctx), input)),
  get: salesProcedure.input(customerDemandIdSchema).query(({ ctx, input }) => getCustomerDemand(scopeFor(ctx), input)),
  revisionHistory: salesProcedure.input(customerDemandRevisionListSchema).query(({ ctx, input }) => listDemandRevisions(scopeFor(ctx), input)),
  procurementList: procurementProcedure.input(procurementDemandListSchema).query(({ ctx, input }) => listProcurementDemands(scopeFor(ctx), input)),
  procurementGet: procurementProcedure.input(customerDemandIdSchema).query(({ ctx, input }) => getProcurementDemand(scopeFor(ctx), input)),
  claim: procurementProcedure.input(procurementDemandClaimSchema).mutation(({ ctx, input }) => claimProcurementDemand(scopeFor(ctx), input)),
});
