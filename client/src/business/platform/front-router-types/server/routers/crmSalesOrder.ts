import { createCrmPermissionProcedure, router } from "../_core/trpc";
import {
  salesOrderCandidateListSchema,
  salesOrderCancelSchema,
  salesOrderCreateSchema,
  salesOrderIdSchema,
  salesOrderListSchema,
  salesOrderPaymentSchema,
  salesOrderShipSchema,
} from "../../../shared/crmSalesOrders";
import {
  cancelSalesOrder,
  createSalesOrder,
  getSalesOrder,
  listSalesOrderCandidates,
  listSalesOrders,
  recordSalesOrderPayment,
  shipSalesOrder,
  type CrmSalesOrderScope,
} from "../services/crmSalesOrders";

const salesOrderProcedure = createCrmPermissionProcedure("sales.business_orders");

function scopeFor(ctx: { user: { id: number }; enterprisePermissionScope: { enterprise: { id: number } } }): CrmSalesOrderScope {
  // Use the signed-in employee, rather than CRM's legacy effective data owner alias.
  return { enterpriseId: ctx.enterprisePermissionScope.enterprise.id, actorUserId: ctx.user.id };
}

export const crmSalesOrderRouter = router({
  list: salesOrderProcedure.input(salesOrderListSchema).query(({ ctx, input }) => listSalesOrders(scopeFor(ctx), input)),
  candidates: salesOrderProcedure.input(salesOrderCandidateListSchema).query(({ ctx, input }) => listSalesOrderCandidates(scopeFor(ctx), input)),
  get: salesOrderProcedure.input(salesOrderIdSchema).query(({ ctx, input }) => getSalesOrder(scopeFor(ctx), input)),
  create: salesOrderProcedure.input(salesOrderCreateSchema).mutation(({ ctx, input }) => createSalesOrder(scopeFor(ctx), input)),
  cancel: salesOrderProcedure.input(salesOrderCancelSchema).mutation(({ ctx, input }) => cancelSalesOrder(scopeFor(ctx), input)),
  recordPayment: salesOrderProcedure.input(salesOrderPaymentSchema).mutation(({ ctx, input }) => recordSalesOrderPayment(scopeFor(ctx), input)),
  ship: salesOrderProcedure.input(salesOrderShipSchema).mutation(({ ctx, input }) => shipSalesOrder(scopeFor(ctx), input)),
});
