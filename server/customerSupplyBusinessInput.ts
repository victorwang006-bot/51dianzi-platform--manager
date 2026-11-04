import type { z } from "zod";
import {
  customerSupplySummarySchema,
  customerSupplyContextSchema,
  createCustomerMaterialSchema,
} from "../client/src/business/platform/shared/customerSupply";

// Canonical front shared input mirror: this BFF must not maintain a second schema.
export { customerSupplySummarySchema, customerSupplyContextSchema, createCustomerMaterialSchema };

export const CUSTOMER_SUPPLY_BUSINESS_METHOD_IDS = [
  "channelInventory.customerSupplySummary",
  "channelInventory.customerSupplyContext",
  "channelInventory.createCustomerMaterial",
] as const;

export const CUSTOMER_SUPPLY_BUSINESS_INPUT_SCHEMAS: Readonly<Record<(typeof CUSTOMER_SUPPLY_BUSINESS_METHOD_IDS)[number], z.ZodType>> = {
  "channelInventory.customerSupplySummary": customerSupplySummarySchema,
  "channelInventory.customerSupplyContext": customerSupplyContextSchema,
  "channelInventory.createCustomerMaterial": createCustomerMaterialSchema,
};

export function isCustomerSupplyBusinessMethod(method: string | undefined): method is (typeof CUSTOMER_SUPPLY_BUSINESS_METHOD_IDS)[number] {
  return CUSTOMER_SUPPLY_BUSINESS_METHOD_IDS.some(fixedMethod => fixedMethod === method);
}
