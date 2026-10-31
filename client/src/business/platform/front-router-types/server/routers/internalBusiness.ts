import { z } from "zod";
import { customerListSchema } from "../../../shared/crmCustomers";
import { purchaseOrderListSchema } from "../../../shared/purchaseOrders";
import { salesOrderListSchema } from "../../../shared/crmSalesOrders";
import { publicProcedure, router } from "../_core/trpc";
import { requireInternalEnterprisePortalKey } from "./internalEnterprise";
import {
  getInternalBusinessContext,
  listInternalBusinessCustomers,
  listInternalBusinessPurchaseOrders,
  listInternalBusinessSalesOrders,
  validateInternalBusinessStaffBindingCandidate,
} from "../services/internalBusinessAccess";
import {
  BUSINESS_METHOD_IDS,
  executeInternalBusinessMethod,
} from "../services/internalBusinessDelegation";

const creditCodeSchema = z.string().trim().min(1).max(64);
const registrationIdentifierSchema = z.string().trim().regex(/^HK:\d{8}$/i, "香港企业标识必须为 HK: 加 8 位商业登记号码 BRN");
const bindingInput = z.object({
  creditCode: creditCodeSchema.optional(),
  registrationIdentifier: registrationIdentifierSchema.optional(),
  expectedOwnerUserId: z.number().int().positive(),
}).refine(
  value => Boolean(value.creditCode) !== Boolean(value.registrationIdentifier),
  "必须且只能提供统一社会信用代码或香港企业标识",
);

const trustedStaffBindingInput = z.object({
  staffUserId: z.number().int().positive(),
  adminAccountId: z.number().int().positive(),
  bindingVersion: z.number().int().positive(),
});
const staffBindingInput = bindingInput.safeExtend({ staffUserId: z.number().int().positive() });
const requestIdSchema = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const adminActorInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  role: z.string().trim().min(1).max(64),
});

function requirePortalKey(headers: Record<string, unknown> | undefined) {
  requireInternalEnterprisePortalKey(headers);
}

/**
 * Internal-only API. Parent mounts this router at `internalBusiness` on the
 * front AppRouter. Every procedure requires the service key; no browser cookie,
 * bearer token, browser-supplied enterprise ID, owner or actor is accepted.
 */
export const internalBusinessRouter = router({
  /** Candidate verification for the backend-only binding registrar. */
  staffBindingCandidate: publicProcedure
    .input(z.object({ staffUserId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      return validateInternalBusinessStaffBindingCandidate(input.staffUserId);
    }),

  context: publicProcedure
    .input(bindingInput.safeExtend(trustedStaffBindingInput.shape))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const { staffUserId, adminAccountId, bindingVersion, ...binding } = input;
      const trustedBinding = trustedStaffBindingInput.parse({ staffUserId, adminAccountId, bindingVersion });
      return getInternalBusinessContext(binding, trustedBinding);
    }),

  /**
   * Fixed business command bridge. `method` is a zod enum compiled from the
   * source-controlled manifest; params are parsed again by the original target
   * tRPC procedure, never trusted at this transport boundary.
   */
  execute: publicProcedure
    .input(bindingInput.safeExtend({
      staffUserId: z.number().int().positive(),
      bindingVersion: z.number().int().positive(),
      adminActor: adminActorInput,
      requestId: requestIdSchema,
      method: z.enum(BUSINESS_METHOD_IDS),
      params: z.unknown(),
    }))
    .mutation(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const { staffUserId, bindingVersion, adminActor, requestId, method, params, ...binding } = input;
      return executeInternalBusinessMethod({
        method,
        params,
        binding,
        staffUserId,
        adminActor,
        bindingVersion,
        requestId,
        req: ctx.req,
        res: ctx.res,
      });
    }),

  /* Existing narrow server-only callers remain fixed and key-protected. */
  customerList: publicProcedure
    .input(staffBindingInput.safeExtend({ filters: customerListSchema }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const { staffUserId, filters, ...binding } = input;
      return listInternalBusinessCustomers({ binding, staffUserId, filters });
    }),

  purchaseOrderList: publicProcedure
    .input(staffBindingInput.safeExtend({ filters: purchaseOrderListSchema }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const { staffUserId, filters, ...binding } = input;
      return listInternalBusinessPurchaseOrders({ binding, staffUserId, filters });
    }),

  salesOrderList: publicProcedure
    .input(staffBindingInput.safeExtend({ filters: salesOrderListSchema }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const { staffUserId, filters, ...binding } = input;
      return listInternalBusinessSalesOrders({ binding, staffUserId, filters });
    }),
});
