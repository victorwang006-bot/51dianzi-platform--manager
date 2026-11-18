import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalCommissionOrder, PersonalCommissionPendingReason, PersonalCommissionResult } from "@shared/personalCommission";
import { BusinessAmount, BusinessPagination, BusinessStatus } from "./ProfileBusinessUi";
import { decimalAmount } from "./profileModel";

const PENDING_REASONS: Record<PersonalCommissionPendingReason, string> = {
  unknown_policy: "历史规则版本待确认",
  missing_financial_audit: "缺少财务审计快照",
  audit_mismatch: "审计快照与订单不一致",
  missing_cost: "成本待核",
  incomplete_allocations: "批次成本分配不完整",
  unknown_tax_basis: "订单税务口径待核",
  invalid_financial_evidence: "财务证据待核",
};
const COLLECTION_LABELS: Record<PersonalCommissionOrder["collectionStatus"], string> = {
  uncollected: "未回款", partial: "部分回款", collected: "足额回款",
};

export function businessDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function ProfileCommissionResults({ result, fetching, onPage }: {
  result: Extract<PersonalCommissionResult, { status: "available" }>;
  fetching: boolean;
  onPage(page: number): void;
}) {
  const heading = result.orderCount === 0 ? "该月暂无本人订单" : result.pendingCount > 0 ? "部分或全部订单待核" : "已有可核实预览";
  return <>
    <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>{heading}</CardTitle>
      <span className="pc-muted">{result.currencyLabel}（{result.currency}）</span>
    </CardHeader><CardContent className="pc-card-content">
      <p className="pc-muted pc-business-note">预计按订单创建月归属；回款达标按该月订单截至当前累计银行/现金回款判断，不是当月结算或工资到账。</p>
    </CardContent></Card>
    <div className="pc-stat-grid pc-business-summaries">
      <BusinessAmount label="预计提成合计" amount={result.estimatedAmount} unavailableLabel="待核"
        note={result.estimatedAmount === null ? `完整合计待核 · 已核小计 ${decimalAmount(result.verifiedEstimatedAmount)} ${result.currency}` : "服务器全量订单预览 · 非已发放"} />
      <BusinessAmount label="回款达标提成预览" amount={result.earnedAmount} unavailableLabel="待核"
        note={result.earnedAmount === null ? `完整合计待核 · 已核小计 ${decimalAmount(result.verifiedEarnedAmount)} ${result.currency}` : "仅足额银行/现金回款订单 · 非已结算"} />
      <div className="pc-stat"><span>待核订单</span><strong>{result.pendingCount}</strong>
        <small>全量 {result.orderCount} 笔 · 可核 {result.readyCount} 笔</small></div>
      <div className="pc-stat"><span>已发放提成</span><strong>来源未接通</strong>
        <small>金额未知 · 无真实发放证据</small></div>
    </div>
    <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>本人提成明细</CardTitle>
      <span className="pc-muted">账期登记不计入现金回款</span>
    </CardHeader>
      <div className="pc-table-scroll"><table className="pc-table pc-business-table" aria-label="本人提成明细">
        <thead><tr><th>订单 / 创建时间</th><th className="pc-numeric">销售金额</th><th className="pc-numeric">预计提成</th>
          <th className="pc-numeric">累计银行/现金回款</th><th className="pc-numeric">未回款差额</th><th>回款状态</th>
          <th className="pc-numeric">回款达标预览</th><th>规则与核验</th></tr></thead>
        <tbody>{result.items.length ? result.items.map(order => <tr key={order.id}>
          <td>{order.orderNumber}<small className="pc-muted">{businessDate(order.createdAt)}</small></td>
          <td className="pc-numeric">{decimalAmount(order.totalAmount)}</td>
          <td className="pc-numeric">{order.calculationStatus === "pending" ? "待核" : decimalAmount(order.estimatedAmount)}</td>
          <td className="pc-numeric">{decimalAmount(order.bankCashPaidAmount)}</td>
          <td className="pc-numeric">{decimalAmount(order.collectionGap)}</td>
          <td><BusinessStatus pending={order.collectionStatus !== "collected"}>{COLLECTION_LABELS[order.collectionStatus]}</BusinessStatus></td>
          <td className="pc-numeric">{order.calculationStatus === "pending" ? "待核" : decimalAmount(order.earnedAmount)}</td>
          <td><BusinessStatus pending={order.calculationStatus === "pending"}>{order.calculationStatus === "pending" ? "待核" : "可核预览"}</BusinessStatus>
            {order.pendingReason && <small className="pc-muted">{PENDING_REASONS[order.pendingReason]}</small>}
            <small className="pc-muted">版本：{order.policyVersion || "待确认"}</small>
            <small className="pc-muted">{order.salesTaxMode === "tax_included" ? "含税" : order.salesTaxMode === "tax_excluded" ? "不含税" : "税务口径待核"} · 规则/权益待确认</small>
          </td>
        </tr>) : <tr><td colSpan={8} className="pc-center">该月暂无本人已确认订单。</td></tr>}</tbody>
      </table></div>
      <BusinessPagination label="提成" page={result.page} pageSize={result.pageSize} total={result.total} fetching={fetching} onPage={onPage} />
    </Card>
    <p className="pc-muted pc-business-note">无真实发放证据；预计及达标预览不代表个人权益审批、已结算或已发放。</p>
    <details className="pc-basis"><summary>提成口径与来源</summary><p>{result.basis}</p><p>{result.payoutReason}</p></details>
  </>;
}
