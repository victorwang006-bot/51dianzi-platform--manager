import { router, createCrmPermissionProcedure } from "../_core/trpc";
import {
  acceptedQuoteOptionsSchema, purchaseOrderCancelSchema, purchaseOrderCreateSchema,
  purchaseOrderIdSchema, purchaseOrderInboundCandidatesSchema, purchaseOrderInvoiceSchema,
  purchaseOrderLinkInboundSchema, purchaseOrderListSchema, purchaseOrderPaymentSchema,
  purchaseOrderShippingSchema, purchaseOrderVoidInvoiceSchema,
} from "../../../shared/purchaseOrders";
import {
  acceptedQuoteOptions, cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder,
  linkPurchaseInbound, listPurchaseOrders, purchaseInboundCandidates,
  recordPurchaseInvoice, updatePurchasePayment, updatePurchaseShipping, voidPurchaseInvoice,
} from "../services/purchaseOrders";

const procurementOrderProcedure = createCrmPermissionProcedure("procurement.orders");
function scopeFor(ctx: { user: { id: number }; enterprisePermissionScope: {
  enterprise: { id: number }; dataOwnerUserId: number;
} }) {
  return {
    enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
    ownerUserId: ctx.enterprisePermissionScope.dataOwnerUserId,
    actorUserId: ctx.user.id,
  };
}

export const purchaseOrderRouter = router({
  list: procurementOrderProcedure.input(purchaseOrderListSchema)
    .query(({ ctx, input }) => listPurchaseOrders(scopeFor(ctx), input)),
  get: procurementOrderProcedure.input(purchaseOrderIdSchema)
    .query(({ ctx, input }) => getPurchaseOrder(scopeFor(ctx), input.id)),
  acceptedQuoteOptions: procurementOrderProcedure.input(acceptedQuoteOptionsSchema)
    .query(({ ctx, input }) => acceptedQuoteOptions(scopeFor(ctx), input)),
  inboundCandidates: procurementOrderProcedure.input(purchaseOrderInboundCandidatesSchema)
    .query(({ ctx, input }) => purchaseInboundCandidates(scopeFor(ctx), input)),
  create: procurementOrderProcedure.input(purchaseOrderCreateSchema)
    .mutation(({ ctx, input }) => createPurchaseOrder(scopeFor(ctx), input)),
  updatePayment: procurementOrderProcedure.input(purchaseOrderPaymentSchema)
    .mutation(({ ctx, input }) => updatePurchasePayment(scopeFor(ctx), input)),
  updateShipping: procurementOrderProcedure.input(purchaseOrderShippingSchema)
    .mutation(({ ctx, input }) => updatePurchaseShipping(scopeFor(ctx), input)),
  linkInbound: procurementOrderProcedure.input(purchaseOrderLinkInboundSchema)
    .mutation(({ ctx, input }) => linkPurchaseInbound(scopeFor(ctx), input)),
  recordInvoice: procurementOrderProcedure.input(purchaseOrderInvoiceSchema)
    .mutation(({ ctx, input }) => recordPurchaseInvoice(scopeFor(ctx), input)),
  voidInvoice: procurementOrderProcedure.input(purchaseOrderVoidInvoiceSchema)
    .mutation(({ ctx, input }) => voidPurchaseInvoice(scopeFor(ctx), input)),
  cancel: procurementOrderProcedure.input(purchaseOrderCancelSchema)
    .mutation(({ ctx, input }) => cancelPurchaseOrder(scopeFor(ctx), input)),
});
