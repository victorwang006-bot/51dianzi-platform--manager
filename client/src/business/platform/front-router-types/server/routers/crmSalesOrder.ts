import { createCrmPermissionProcedure, router } from "../_core/trpc";
import type { StaffDelegation } from "../_core/context";
import { newInformationFactsInputSchema, newInformationFactsResultSchema } from "../../../shared/adminNewInformationFacts";
import { readCrmSalesNewInformationFacts } from "../services/adminNewInformationSources/sales";
import {
  salesOrderCandidateListSchema,
  salesOrderCancelSchema,
  salesOrderCreateSchema,
  salesOrderCustomerSummarySchema,
  salesOrderCustomerMaterialsSchema,
  salesOrderIdSchema,
  salesOrderListSchema,
  salesOrderPaymentSchema,
  salesOrderShipSchema,
  salesOrderCompanyStockCandidatesSchema,
  salesOrderCompanyStockPreviewSchema,
  salesOrderCompanyStockCreateSchema,
  salesOrderCompanyStockAllocateSchema,
  salesOrderCompanyStockShipSchema,
  salesOrderExpensesSchema,
} from "../../../shared/crmSalesOrders";
import {
  cancelSalesOrder,
  createSalesOrder,
  getSalesOrder,
  getSalesOrderCustomerSummary,
  listSalesOrderCustomerMaterials,
  listSalesOrderCandidates,
  listSalesOrders,
  recordSalesOrderPayment,
  shipSalesOrder,
  type CrmSalesOrderScope,
  listSalesOrderCompanyStockCandidates,
  previewSalesOrderCompanyStock,
  createSalesOrderCompanyStock,
  allocateSalesOrderCompanyStock,
  shipSalesOrderCompanyStock,
  updateSalesExpenses,
} from "../services/crmSalesOrders";

const salesOrderProcedure = createCrmPermissionProcedure("sales.business_orders");

function scopeFor(ctx: { user: { id: number }; enterprisePermissionScope: { enterprise: { id: number } }; staffDelegation?: StaffDelegation }): CrmSalesOrderScope {
  // Use the signed-in employee, rather than CRM's legacy effective data owner alias.
  return { enterpriseId: ctx.enterprisePermissionScope.enterprise.id, actorUserId: ctx.user.id, staffDelegation: ctx.staffDelegation };
}

export const crmSalesOrderRouter = router({
  newInformationFacts: salesOrderProcedure.input(newInformationFactsInputSchema)
    .output(newInformationFactsResultSchema).query(({ ctx, input }) => readCrmSalesNewInformationFacts(scopeFor(ctx), input)),
  list: salesOrderProcedure.input(salesOrderListSchema).query(({ ctx, input }) => listSalesOrders(scopeFor(ctx), input)),
  candidates: salesOrderProcedure.input(salesOrderCandidateListSchema).query(({ ctx, input }) => listSalesOrderCandidates(scopeFor(ctx), input)),
  get: salesOrderProcedure.input(salesOrderIdSchema).query(({ ctx, input }) => getSalesOrder(scopeFor(ctx), input)),
  customerSummary: salesOrderProcedure.input(salesOrderCustomerSummarySchema).query(({ ctx, input }) => getSalesOrderCustomerSummary(scopeFor(ctx), input)),
  customerMaterials: salesOrderProcedure.input(salesOrderCustomerMaterialsSchema).query(({ ctx, input }) => listSalesOrderCustomerMaterials(scopeFor(ctx), input)),
  create: salesOrderProcedure.input(salesOrderCreateSchema).mutation(({ ctx, input }) => createSalesOrder(scopeFor(ctx), input)),
  cancel: salesOrderProcedure.input(salesOrderCancelSchema).mutation(({ ctx, input }) => cancelSalesOrder(scopeFor(ctx), input)),
  recordPayment: salesOrderProcedure.input(salesOrderPaymentSchema).mutation(({ ctx, input }) => recordSalesOrderPayment(scopeFor(ctx), input)),
  ship: salesOrderProcedure.input(salesOrderShipSchema).mutation(({ ctx, input }) => shipSalesOrder(scopeFor(ctx), input)),
  companyStockCandidates: salesOrderProcedure.input(salesOrderCompanyStockCandidatesSchema).query(({ ctx, input }) => listSalesOrderCompanyStockCandidates(scopeFor(ctx), input)),
  previewCompanyStock: salesOrderProcedure.input(salesOrderCompanyStockPreviewSchema).query(({ ctx, input }) => previewSalesOrderCompanyStock(scopeFor(ctx), input)),
  createCompanyStock: salesOrderProcedure.input(salesOrderCompanyStockCreateSchema).mutation(({ ctx, input }) => createSalesOrderCompanyStock(scopeFor(ctx), input)),
  allocateCompanyStock: salesOrderProcedure.input(salesOrderCompanyStockAllocateSchema).mutation(({ ctx, input }) => allocateSalesOrderCompanyStock(scopeFor(ctx), input)),
  shipCompanyStock: salesOrderProcedure.input(salesOrderCompanyStockShipSchema).mutation(({ ctx, input }) => shipSalesOrderCompanyStock(scopeFor(ctx), input)),
  updateSalesExpenses: salesOrderProcedure.input(salesOrderExpensesSchema).mutation(({ ctx, input }) => updateSalesExpenses(scopeFor(ctx), input)),
});
