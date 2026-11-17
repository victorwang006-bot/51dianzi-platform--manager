import { z } from "zod";
import type { SalesOrderDraftPayload } from "../../../shared/crmSalesOrderDrafts";
import {
  salesOrderCreateSchema,
  salesOrderCompanyStockCreateSchema,
  type SalesOrderDemandCandidate,
} from "../../../shared/crmSalesOrders";
import {
  emptyCompanyStockDraft,
  type CompanyStockFormDraft,
} from "./companyStockOrderDraft";
import type { SalesCustomer } from "../components/companyStock/SalesCustomerPicker";

const id = z.number().int().positive();
const customerSchema = z.object({
  id,
  name: z.string().min(1),
  archivedAt: z.string().nullable().optional(),
});
const lotSchema = z.object({
  lotId: id,
  inboundOrderId: id,
  partNumber: z.string().min(1),
  brand: z.string(),
  pkg: z.string(),
  dc: z.string(),
  lotNumber: z.string(),
  location: z.string(),
  availableQty: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
const stockLine = z.object({
  lot: lotSchema,
  qty: z.string(),
  agreedUnitPrice: z.string(),
});
const demandSchema = z.object({
  id,
  demandRevision: id.optional(),
  demandNo: z.string(),
  customerId: id,
  customerName: z.string(),
  projectName: z.string(),
  status: z.enum(["submitted", "processing"]),
  items: z.array(
    z.object({
      id,
      partNumber: z.string(),
      brand: z.string(),
      pkg: z.string(),
      qtyUnit: z.string(),
      demandQty: z.number().int().nonnegative(),
      remainingQty: z.number().int().nonnegative(),
      deliveryRequirement: z.string(),
      note: z.string(),
    })
  ),
});
const demandLines = z.array(
  z.object({ demandItemId: id, qty: z.string(), agreedUnitPrice: z.string() })
);
export type SalesOrderEntryState = {
  customer: SalesCustomer | null;
  source: "company_stock" | "demand";
  selectedDemand: SalesOrderDemandCandidate | null;
  lines: Array<{ demandItemId: number; qty: string; agreedUnitPrice: string }>;
  dueDate: string;
  confirmationNote: string;
  customerConfirmed: boolean;
  pendingRequest: ReturnType<typeof salesOrderCreateSchema.parse> | null;
  company: CompanyStockFormDraft;
};
export function parseSalesOrderEntryDraft(
  payload: SalesOrderDraftPayload
): SalesOrderEntryState {
  const form = payload.form ?? {};
  const customer = payload.customer
    ? customerSchema.parse(payload.customer)
    : null;
  const selectedDemand = form.selectedDemand
    ? demandSchema.parse(form.selectedDemand)
    : null;
  if (selectedDemand && customer && selectedDemand.customerId !== customer.id)
    throw new Error("草稿客户与需求不一致");
  const company = payload.company;
  const stock = emptyCompanyStockDraft();
  stock.lines = company?.lines
    ? z.array(stockLine).max(200).parse(company.lines)
    : [];
  stock.salesTaxMode = company?.salesTaxMode ?? "tax_included";
  stock.dueDate = company?.dueDate ?? "";
  stock.confirmationNote = company?.confirmationNote ?? "";
  stock.customerConfirmed = company?.customerConfirmed ?? false;
  stock.pendingRequest = company?.uncertain
    ? salesOrderCompanyStockCreateSchema.parse(company.uncertain)
    : null;
  if (
    stock.pendingRequest &&
    (!customer || stock.pendingRequest.customerId !== customer.id)
  )
    throw new Error("草稿原请求与客户不一致");
  const pending = form.pendingRequest
    ? salesOrderCreateSchema.parse(form.pendingRequest)
    : null;
  if (pending && (!selectedDemand || pending.demandId !== selectedDemand.id))
    throw new Error("草稿原请求与需求不一致");
  return {
    customer,
    source: payload.source ?? "company_stock",
    selectedDemand,
    lines: form.lines ? demandLines.parse(form.lines) : [],
    dueDate: typeof form.dueDate === "string" ? form.dueDate : "",
    confirmationNote:
      typeof form.confirmationNote === "string" ? form.confirmationNote : "",
    customerConfirmed: form.customerConfirmed === true,
    pendingRequest: pending,
    company: stock,
  };
}
export function serializeSalesOrderEntryDraft(
  value: SalesOrderEntryState
): SalesOrderDraftPayload {
  // JSON round-trip converts optional Date snapshots and drops undefined, never mutates a frozen payload.
  return JSON.parse(
    JSON.stringify({
      customer: value.customer
        ? {
            id: value.customer.id,
            name: value.customer.name,
            archivedAt: value.customer.archivedAt ?? null,
          }
        : null,
      source: value.source,
      demandId: value.selectedDemand?.id ?? null,
      company: {
        lines: value.company.lines,
        salesTaxMode: value.company.salesTaxMode,
        dueDate: value.company.dueDate,
        confirmationNote: value.company.confirmationNote,
        customerConfirmed: value.company.customerConfirmed,
        uncertain: value.company.pendingRequest,
      },
      form: {
        version: 1,
        selectedDemand: value.selectedDemand,
        lines: value.lines,
        dueDate: value.dueDate,
        confirmationNote: value.confirmationNote,
        customerConfirmed: value.customerConfirmed,
        pendingRequest: value.pendingRequest,
      },
    })
  );
}
