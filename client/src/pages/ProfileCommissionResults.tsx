import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalCommissionResult } from "@shared/personalCommission";
import { useEffect, useId, useRef, useState } from "react";
import { BusinessAmount, BusinessPagination, BusinessStatus } from "./ProfileBusinessUi";
import { ProfileCommissionDrawer } from "./ProfileCommissionDrawer";
import { businessDate, COLLECTION_LABELS, commissionAmount, commissionPendingReason } from "./commissionPresentation";

export { businessDate } from "./commissionPresentation";
type CommissionResult = Extract<PersonalCommissionResult, { status: "available" }>;

export function ProfileCommissionResults({ result, fetching, onPage }: {
  result: CommissionResult;
  fetching: boolean;
  onPage(page: number): void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  // Store an ID, not a detail snapshot. A changed result cannot expose an old selection.
  const [selected, setSelected] = useState<{ id: number; result: CommissionResult } | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const order = selected?.result === result && !fetching ? result.items.find(item => item.id === selected.id) : undefined;
  useEffect(() => { setSelected(null); setHelpOpen(false); }, [result, fetching]);
  return <>
    <div className="pc-stat-grid pc-business-summaries pc-business-commission-summaries">
      <BusinessAmount label="预计提成" amount={result.estimatedAmount} unavailableLabel="待核" formatAmount={commissionAmount}
        note={result.estimatedAmount === null ? `已核小计 ${commissionAmount(result.verifiedEstimatedAmount)}` : undefined} />
      <BusinessAmount label="回款达标提成" amount={result.earnedAmount} unavailableLabel="待核" formatAmount={commissionAmount}
        help={<button type="button" className="pc-business-commission-help" aria-label="回款达标提成说明"
          aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(open => !open)}>?</button>}
        note={result.earnedAmount === null ? `已核小计 ${commissionAmount(result.verifiedEarnedAmount)}` : undefined}>
        {helpOpen && <p id={helpId} className="pc-muted pc-business-commission-help-text">足额回款订单的提成预估，不代表已发放</p>}
      </BusinessAmount>
    </div>
    <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>提成明细</CardTitle>
      <span className="pc-muted">人民币（元）</span>
    </CardHeader>
      <div className="pc-table-scroll"><table className="pc-table pc-business-table pc-business-commission-table" aria-label="提成明细">
        <thead><tr><th>订单</th><th className="pc-numeric">销售额</th><th className="pc-numeric">已回款</th>
          <th className="pc-numeric">待回款</th><th className="pc-numeric">预计提成</th><th>回款状态</th></tr></thead>
        <tbody>{result.items.length ? result.items.map(item => <tr key={item.id}>
          <td><button type="button" className="pc-business-commission-order" aria-label={`查看订单 ${item.orderNumber} 的提成详情`}
            aria-haspopup="dialog" disabled={fetching} onClick={event => { returnFocus.current = event.currentTarget; setSelected({ id: item.id, result }); }}>{item.orderNumber}</button>
            <small className="pc-muted">{businessDate(item.createdAt)}</small></td>
          <td className="pc-numeric">{commissionAmount(item.totalAmount)}</td>
          <td className="pc-numeric">{commissionAmount(item.bankCashPaidAmount)}</td>
          <td className="pc-numeric">{commissionAmount(item.collectionGap)}</td>
          <td className={`pc-numeric${item.calculationStatus === "pending" ? " pc-business-commission-pending" : ""}`}>
            {item.calculationStatus === "pending" ? commissionPendingReason(item.pendingReason) : commissionAmount(item.estimatedAmount)}</td>
          <td><BusinessStatus pending={item.collectionStatus !== "collected"}>{COLLECTION_LABELS[item.collectionStatus]}</BusinessStatus></td>
        </tr>) : <tr><td colSpan={6} className="pc-center">该月暂无本人已确认订单。</td></tr>}</tbody>
      </table></div>
      <BusinessPagination label="提成" page={result.page} pageSize={result.pageSize} total={result.total} fetching={fetching} onPage={onPage} />
    </Card>
    <ProfileCommissionDrawer order={order} result={result} returnFocus={returnFocus} onClose={() => setSelected(null)} />
  </>;
}
