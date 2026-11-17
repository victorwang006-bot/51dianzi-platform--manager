import type { SalesOrderCompanyStockCreateInput } from "../../../shared/crmSalesOrders";
import type { LotDraft } from "../components/companyStock/companyStockSales";
export type CompanyStockFormDraft = {
  lines: LotDraft[];
  salesTaxMode: "tax_included" | "tax_excluded";
  dueDate: string;
  confirmationNote: string;
  customerConfirmed: boolean;
  pendingRequest: SalesOrderCompanyStockCreateInput | null;
};
export const emptyCompanyStockDraft = (): CompanyStockFormDraft => ({
  lines: [], salesTaxMode: "tax_included", dueDate: "", confirmationNote: "", customerConfirmed: false, pendingRequest: null,
});
