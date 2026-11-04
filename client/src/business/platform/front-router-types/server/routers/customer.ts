import { z } from "zod";
import { customerOwnershipQuerySchema } from "../../../shared/customerOwnership";
import { customerStarContextInputSchema, customerStarContextSchema, customerSetStarSchema, customerSetStarResultSchema } from "../../../shared/customerStars";
import { getCustomerStarContext, setCustomerStar } from "../services/customerStars";
import {
  customerCreateSchema,
  customerFollowUpSchema,
  customerListSchema,
  customerUpdateSchema,
} from "../../../shared/crmCustomers";
import {
  contactsAddSchema,
  contactsEditSchema,
  contactsListSchema,
  contactsSetPrimarySchema,
  contactsStopSchema,
  contactsSummarySchema,
  createMultiSchema,
  updateBasicSchema,
} from "../../../shared/customerContacts";
import { createCrmAnyPermissionProcedure, router } from "../_core/trpc";
import {
  contactsAdd,
  contactsEdit,
  contactsList,
  contactsSetPrimary,
  contactsStop,
  contactsSummary,
  createMulti,
  updateBasic,
} from "../services/customerContacts";
import {
  addCustomerFollowUp,
  archiveCustomer,
  checkCustomerDuplicate,
  searchCustomerOwnership,
  createCustomer,
  getCustomer,
  getCustomerContext,
  listCustomers,
  restoreCustomer,
  transferCustomer,
  updateCustomer,
  type CustomerServerScope,
} from "../services/crmCustomers";

const customerProcedure = createCrmAnyPermissionProcedure([
  "customers.manage",
  "customers.manage_all",
]);

function scopeFor(ctx: {
  user: { id: number };
  enterprisePermissionScope: {
    enterprise: { id: number };
    isOwner: boolean;
    permissionKeys: readonly string[];
  };
}): CustomerServerScope {
  // Customer ownership always uses the authenticated independent user, never effectiveUserId.
  return {
    enterpriseId: ctx.enterprisePermissionScope.enterprise.id,
    actorUserId: ctx.user.id,
    canManageAll: ctx.enterprisePermissionScope.isOwner
      || ctx.enterprisePermissionScope.permissionKeys.includes("customers.manage_all"),
  };
}

const idSchema = z.object({ id: z.number().int().positive() });
const archiveSchema = idSchema.extend({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1, "请输入归档原因").max(500),
});
const restoreSchema = idSchema.extend({ version: z.number().int().positive() });
const transferSchema = idSchema.extend({
  version: z.number().int().positive(),
  assignedUserId: z.number().int().positive(),
  reason: z.string().trim().min(1, "请输入转移原因").max(500),
});
const duplicateSchema = z.object({
  name: z.string().trim().min(1, "请输入客户名称").max(128),
  phone: z.string().trim().max(64).optional(),
  email: z.string().trim().max(254).optional(),
  excludeId: z.number().int().positive().optional(),
});

export const customerRouter = router({
  context: customerProcedure.query(({ ctx }) => getCustomerContext(scopeFor(ctx))),

  starContext: customerProcedure.input(customerStarContextInputSchema).output(customerStarContextSchema).query(({ ctx }) =>
    getCustomerStarContext(scopeFor(ctx))),
  // A personal preference needs customer read, not customer.write; the service rechecks both current readers.
  setStar: customerProcedure.input(customerSetStarSchema).output(customerSetStarResultSchema).mutation(({ ctx, input }) =>
    setCustomerStar(scopeFor(ctx), input)),

  list: customerProcedure.input(customerListSchema).query(({ ctx, input }) =>
    listCustomers(scopeFor(ctx), input)),

  get: customerProcedure.input(idSchema).query(({ ctx, input }) =>
    getCustomer(scopeFor(ctx), input.id)),

  ownershipSearch: customerProcedure.input(customerOwnershipQuerySchema).query(({ ctx, input }) =>
    searchCustomerOwnership(scopeFor(ctx), input)),
  checkDuplicate: customerProcedure.input(duplicateSchema).query(({ ctx, input }) =>
    checkCustomerDuplicate(scopeFor(ctx), input)),

  create: customerProcedure.input(customerCreateSchema).mutation(({ ctx, input }) =>
    createCustomer(scopeFor(ctx), input)),

  createMulti: customerProcedure.input(createMultiSchema).mutation(({ ctx, input }) =>
    createMulti(scopeFor(ctx), input)),

  update: customerProcedure.input(customerUpdateSchema).mutation(({ ctx, input }) =>
    updateCustomer(scopeFor(ctx), input)),

  updateBasic: customerProcedure.input(updateBasicSchema).mutation(({ ctx, input }) =>
    updateBasic(scopeFor(ctx), input)),

  contactsList: customerProcedure.input(contactsListSchema).query(({ ctx, input }) =>
    contactsList(scopeFor(ctx), input)),

  contactsSummary: customerProcedure.input(contactsSummarySchema).query(({ ctx, input }) =>
    contactsSummary(scopeFor(ctx), input)),

  contactsAdd: customerProcedure.input(contactsAddSchema).mutation(({ ctx, input }) =>
    contactsAdd(scopeFor(ctx), input)),

  contactsEdit: customerProcedure.input(contactsEditSchema).mutation(({ ctx, input }) =>
    contactsEdit(scopeFor(ctx), input)),

  contactsStop: customerProcedure.input(contactsStopSchema).mutation(({ ctx, input }) =>
    contactsStop(scopeFor(ctx), input)),

  contactsSetPrimary: customerProcedure.input(contactsSetPrimarySchema).mutation(({ ctx, input }) =>
    contactsSetPrimary(scopeFor(ctx), input)),

  addFollowUp: customerProcedure.input(customerFollowUpSchema).mutation(({ ctx, input }) =>
    addCustomerFollowUp(scopeFor(ctx), input)),

  archive: customerProcedure.input(archiveSchema).mutation(({ ctx, input }) =>
    archiveCustomer(scopeFor(ctx), input)),

  restore: customerProcedure.input(restoreSchema).mutation(({ ctx, input }) =>
    restoreCustomer(scopeFor(ctx), input)),

  transfer: customerProcedure.input(transferSchema).mutation(({ ctx, input }) =>
    transferCustomer(scopeFor(ctx), input)),
});
