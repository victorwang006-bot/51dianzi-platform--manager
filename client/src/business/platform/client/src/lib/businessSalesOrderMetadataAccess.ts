type Access = {
  merchantId: number;
  canWrite: boolean;
  readCapabilities: readonly string[];
  writeCapabilities: readonly string[];
};

/** UI availability only; the BFF and original ERP remain authoritative. */
export function businessSalesOrderMetadataCanWrite(input: {
  verified: boolean;
  merchantId: number | null | undefined;
  pageWritable: boolean;
  access: Access;
}): boolean {
  return input.verified === true && input.pageWritable === true
    && typeof input.merchantId === "number" && Number.isSafeInteger(input.merchantId) && input.merchantId > 0
    && input.access.merchantId === input.merchantId
    && input.access.canWrite === true
    && input.access.readCapabilities.includes("crm.sales_orders")
    && input.access.writeCapabilities.includes("crm.sales_orders");
}
