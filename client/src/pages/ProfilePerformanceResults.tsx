import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalPerformanceResult } from "@shared/personalPerformance";
import { BusinessAmount, BusinessPagination } from "./ProfileBusinessUi";
import { businessDate, commissionAmount } from "./commissionPresentation";

export function ProfilePerformanceResults({ result, fetching, onPage }: {
  result: Extract<PersonalPerformanceResult, { status: "available" }>;
  fetching: boolean;
  onPage(page: number): void;
}) {
  return <>
    <div className="pc-stat-grid">
      <div className="pc-stat"><span>本人订单数</span><strong>{result.orderCount}</strong><small>该月创建 · 笔</small></div>
      <BusinessAmount label="销售额" amount={result.orderAmount} formatAmount={commissionAmount} />
      <BusinessAmount label="该月登记现金回款" amount={result.collectedAmount} formatAmount={commissionAmount} />
    </div>
    <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>本人订单明细</CardTitle></CardHeader>
      <div className="pc-table-scroll"><table className="pc-table" aria-label="本人订单明细">
        <thead><tr><th>订单编号</th><th>创建时间</th><th className="pc-center">状态</th><th className="pc-numeric">销售金额</th></tr></thead>
        <tbody>{result.items.length ? result.items.map(order => <tr key={order.id}>
          <td>{order.orderNumber}</td><td>{businessDate(order.createdAt)}</td><td className="pc-center">已确认</td>
          <td className="pc-numeric">{commissionAmount(order.totalAmount)}</td>
        </tr>) : <tr><td colSpan={4} className="pc-center">该月暂无本人已确认订单。</td></tr>}</tbody>
      </table></div>
      <BusinessPagination label="业绩" page={result.page} pageSize={result.pageSize} total={result.total} fetching={fetching} onPage={onPage} />
    </Card>
  </>;
}
