import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalPerformanceResult } from "@shared/personalPerformance";
import { BusinessAmount, BusinessPagination } from "./ProfileBusinessUi";
import { businessDate } from "./ProfileCommissionResults";
import { decimalAmount } from "./profileModel";

export function ProfilePerformanceResults({ result, fetching, onPage }: {
  result: Extract<PersonalPerformanceResult, { status: "available" }>;
  fetching: boolean;
  onPage(page: number): void;
}) {
  return <>
    <p className="pc-muted pc-business-note">订单及销售额按订单创建月；现金回款按付款日期月统计，与下方该月订单的累计回款达标预览不同。</p>
    <div className="pc-stat-grid">
      <div className="pc-stat"><span>本人订单数</span><strong>{result.orderCount}</strong><small>该月创建 · 笔</small></div>
      <BusinessAmount label="销售额" amount={result.orderAmount} note={`${result.currencyLabel}（${result.currency}）`} />
      <BusinessAmount label="该月登记现金回款" amount={result.collectedAmount} note={`按付款日期 · ${result.currency} · 非提成发放`} />
    </div>
    <Card className="pc-card"><CardHeader className="pc-card-header"><CardTitle>本人订单明细</CardTitle>
      <span className="pc-muted">{result.currencyLabel}（{result.currency}）</span>
    </CardHeader>
      <div className="pc-table-scroll"><table className="pc-table" aria-label="本人订单明细">
        <thead><tr><th>订单编号</th><th>创建时间</th><th className="pc-center">状态</th><th className="pc-numeric">销售金额</th></tr></thead>
        <tbody>{result.items.length ? result.items.map(order => <tr key={order.id}>
          <td>{order.orderNumber}</td><td>{businessDate(order.createdAt)}</td><td className="pc-center">已确认</td>
          <td className="pc-numeric">{decimalAmount(order.totalAmount)}</td>
        </tr>) : <tr><td colSpan={4} className="pc-center">该月暂无本人已确认订单。</td></tr>}</tbody>
      </table></div>
      <BusinessPagination label="业绩" page={result.page} pageSize={result.pageSize} total={result.total} fetching={fetching} onPage={onPage} />
    </Card>
    <details className="pc-basis"><summary>统计口径与不可用数据</summary><p>{result.basis}</p>
      <p>账期登记：{decimalAmount(result.monthlyBookedAmount)} {result.currency}（不计入现金回款）</p>
      <p>退款：暂无可核实账本，不以0代替。</p>
    </details>
  </>;
}
