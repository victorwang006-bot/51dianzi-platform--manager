import { serverMoney } from "./companyStockSales";
import type {
  SalesProfitBreakdown,
  SalesCommissionPreview,
} from "../../../../shared/crmSalesOrders";

export function SalesProfitSummary({
  profit,
  commission,
}: {
  profit?: SalesProfitBreakdown;
  commission?: SalesCommissionPreview;
}) {
  const validMoney = (value: unknown): value is string =>
    typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value);
  const nonPositive = (value: string) =>
    /^-/.test(value) || /^0+(?:\.0+)?$/.test(value);
  const ready =
    profit?.status === "ready" &&
    validMoney(profit.salesAmount) &&
    validMoney(profit.costAmount) &&
    validMoney(profit.expenseAmount) &&
    validMoney(profit.netProfit) &&
    validMoney(profit.grossProfit) &&
    validMoney(profit.taxDeductionAmount) &&
    !/^-/.test(profit.salesAmount) &&
    !/^-/.test(profit.costAmount) &&
    !/^-/.test(profit.expenseAmount) &&
    (profit.salesTaxMode === "tax_included" ||
      profit.salesTaxMode === "tax_excluded");
  const commissionReady =
    ready &&
    commission &&
    !commission.configPending &&
    validMoney(commission.estimatedAmount) &&
    !/^-/.test(commission.estimatedAmount);
  const collection =
    commission?.collectionStatus === "collected"
      ? "已回款"
      : commission?.collectionStatus === "partial"
        ? "部分回款，尚未计入"
        : "未回款，尚未计入";
  // Defensive display only: never turn loss/unknown server results into a positive commission.
  const commissionValue = (value: string | null | undefined) =>
    !validMoney(value) ||
    /^-/.test(value) ||
    (ready && nonPositive(profit.netProfit!) && !nonPositive(value))
      ? "待核"
      : serverMoney(value);
  return (
    <details className="sales-profit-result crm-sales-orders-fold" data-profit-fold>
      <summary>利润与提成</summary>
      <div className="sales-profit-summary" aria-label="利润与提成">
        <span>
          订单利润{" "}
          <strong>{ready ? serverMoney(profit.netProfit) : "待核"}</strong>
        </span>
        <span>
          预计提成{" "}
          <strong>
            {commissionReady
              ? commissionValue(commission.estimatedAmount)
              : "待核"}
          </strong>
        </span>
        <span>
          已计入{" "}
          <strong>
            {commissionReady && commission.collectionStatus === "collected"
              ? commissionValue(commission.earnedAmount)
              : "—"}
          </strong>
        </span>
        <span className="admin-cell-secondary">{collection}</span>
      </div>
      {!ready || commission?.configPending ? (
        <p className="admin-cell-secondary" role="status">
          {profit?.status === "unknown_cost" ? "成本待核" : "服务端结果待核"}
        </p>
      ) : null}
      <details className="crm-sales-orders-fold">
        <summary>费用、采购成本与税扣明细</summary>
        <div className="sales-profit-summary">
          <span>销售额 {serverMoney(profit?.salesAmount)}</span>
          <span>采购成本 {serverMoney(profit?.costAmount)}</span>
          <span>差价 {serverMoney(profit?.grossProfit)}</span>
          <span>税扣 {serverMoney(profit?.taxDeductionAmount)}</span>
          <span>销售费用 {serverMoney(profit?.expenseAmount)}</span>
          <span>净利润 {ready ? serverMoney(profit.netProfit) : "待核"}</span>
          <span>
            {profit?.salesTaxMode === "tax_excluded"
              ? "未税口径"
              : profit?.salesTaxMode === "tax_included"
                ? "含税口径"
                : "口径待核"}
          </span>
        </div>
        {commission?.reason ? (
          <div className="admin-cell-secondary">{commission.reason}</div>
        ) : null}
      </details>
    </details>
  );
}
