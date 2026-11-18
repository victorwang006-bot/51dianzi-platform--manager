import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PersonalCommissionOrder, PersonalCommissionResult } from "@shared/personalCommission";
import type { RefObject } from "react";
import { businessDate, commissionAmount, commissionFormula, commissionPendingReason, commissionRate } from "./commissionPresentation";

type CommissionResult = Extract<PersonalCommissionResult, { status: "available" }>;

export function ProfileCommissionDrawer({ order, result, onClose, returnFocus }: {
  order: PersonalCommissionOrder | undefined;
  result: CommissionResult;
  onClose(): void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  return <Dialog open={!!order} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="personal-center pc-business-commission-drawer" showCloseButton={false}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (returnFocus.current?.isConnected) returnFocus.current.focus();
      }}>
      {order && <>
        <DialogHeader className="pc-business-drawer-header">
          <div className="pc-business-drawer-title-row"><DialogTitle>订单提成详情</DialogTitle>
            <DialogClose asChild><Button type="button" size="sm" variant="outline" aria-label="关闭订单提成详情">关闭</Button></DialogClose>
          </div>
          <DialogDescription>{order.orderNumber} · {businessDate(order.createdAt)}</DialogDescription>
        </DialogHeader>
        <div className="pc-business-drawer-body">
          {order.calculationStatus === "pending" && <p className="pc-business-drawer-pending" role="status">{commissionPendingReason(order.pendingReason)}</p>}
          <dl className="pc-business-drawer-values">
            <div><dt>销售额</dt><dd>{commissionAmount(order.totalAmount)}</dd></div>
            <div><dt>采购成本</dt><dd>{commissionAmount(order.costAmount, "成本待核")}</dd></div>
            <div><dt>费用</dt><dd>{commissionAmount(order.expenseAmount, "费用待核")}</dd></div>
            <div><dt>净利润</dt><dd>{commissionAmount(order.netProfit, "净利润待核")}</dd></div>
            <div><dt>提成比例</dt><dd>{commissionRate(order.rate)}</dd></div>
            <div><dt>预计提成</dt><dd>{order.calculationStatus === "pending" ? commissionPendingReason(order.pendingReason) : commissionAmount(order.estimatedAmount)}</dd></div>
          </dl>
          <section className="pc-business-drawer-formula" aria-label="计算公式"><h3>计算公式</h3>
            {commissionFormula(order).map(line => <p key={line}>{line}</p>)}
          </section>
          <details className="pc-business-drawer-audit"><summary>规则与来源详情</summary>
            <dl className="pc-business-drawer-values">
              <div><dt>规则版本</dt><dd>{order.policyVersion || "待确认"}</dd></div>
              <div><dt>财务审计编号</dt><dd>{order.financialAuditId ?? "待核"}</dd></div>
              <div><dt>税务口径</dt><dd>{order.salesTaxMode === "tax_included" ? "含税" : order.salesTaxMode === "tax_excluded" ? "不含税" : "待核"}</dd></div>
            </dl>
            <h4>统计口径</h4><p>{result.basis}</p>
            <h4>发放来源</h4><p>{result.payoutReason}</p>
          </details>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
