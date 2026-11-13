import { trpc } from "../../../../../api/business-trpc";
import { CUSTOMER_STAGE_LABELS, type CustomerRecord, type CustomerFollowUp } from "../../../../shared/crmCustomers";
import { CUSTOMER_DEMAND_STATUS_LABELS } from "../../../../shared/customerDemands";
import { getBusinessIndustryLabel } from "../../../../shared/businessIndustry";
import { errorMessage, formatCustomerDateTime } from "./customerUtils";
import type { CustomerWorkbenchTab } from "./customerWorkbench";

export function CustomerWorkbenchOverview({ customer, followUps, canReadOrders, onTab }: {
  customer: CustomerRecord; followUps: CustomerFollowUp[]; canReadOrders: boolean; onTab: (tab: CustomerWorkbenchTab) => void;
}) {
  const query = trpc.customerDemand.list.useQuery({ customerId: customer.id, page: 1, pageSize: 3 }, {
    retry: false, staleTime: 0, placeholderData: undefined,
  });
  const result = !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    && query.data?.items.every(item => item.customerId === customer.id) ? query.data : undefined;
  const latest = [...followUps].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return <div className="customer-workbench-overview">
    <section className="customer-workbench-panel">
      <h2 className="admin-section-title">客户摘要</h2>
      <dl className="customer-workbench-summary">
        <div><dt>当前阶段</dt><dd>{CUSTOMER_STAGE_LABELS[customer.stage]}</dd></div>
        <div><dt>所属行业</dt><dd>{getBusinessIndustryLabel(customer.industryCode)}</dd></div>
        <div><dt>主联系人</dt><dd>{customer.contactName || "—"} · {customer.phone || "—"}</dd></div>
        <div><dt>下次跟进</dt><dd>{formatCustomerDateTime(customer.nextFollowUpAt)}</dd></div>
        <div><dt>公司地址</dt><dd>{[customer.province, customer.city, customer.district, customer.address].filter(Boolean).join(" ") || "—"}</dd></div>
      </dl>
      <button type="button" className="crm-link" onClick={() => onTab("company")}>查看公司与全部联系人</button>
    </section>
    <section className="customer-workbench-panel">
      <div className="customer-workbench-panel-heading"><h2 className="admin-section-title">需求与下一步</h2><button type="button" className="crm-link" onClick={() => onTab("demands")}>查看需求与报价</button></div>
      {query.isError ? <p role="alert">读取需求失败：{errorMessage(query.error)} <button type="button" className="crm-link" onClick={() => void query.refetch()}>重试</button></p> : !result ? <p className="customer-workbench-empty" role="status">正在读取客户需求…</p> : <>
        <p className="customer-detail-meta" title="仅展示最近需求，不是全部待办统计">共 {result.total} 笔需求 · 最近 {result.items.length} 笔</p>
        {result.items.length ? <ul className="customer-workbench-samples">{result.items.map(item => <li key={item.id}><span>{item.demandNo} · {item.projectName || "未填写项目"}</span><span>{CUSTOMER_DEMAND_STATUS_LABELS[item.status]}</span></li>)}</ul> : <p className="customer-workbench-empty">暂无客户需求记录</p>}
      </>}
    </section>
    <CustomerWorkbenchOrderSummary customerId={customer.id} canRead={canReadOrders} onOrders={() => onTab("orders")} />
    <section className="customer-workbench-panel">
      <div className="customer-workbench-panel-heading"><h2 className="admin-section-title">最近跟进</h2><button type="button" className="crm-link" onClick={() => onTab("followups")}>查看跟进记录</button></div>
      {latest ? <><p className="customer-detail-meta">{latest.authorName} · {formatCustomerDateTime(latest.occurredAt)}</p><p className="customer-workbench-follow-preview">{latest.content}</p></> : <p className="customer-workbench-empty">暂无跟进记录</p>}
    </section>
  </div>;
}

function CustomerWorkbenchOrderSummary({ customerId, canRead, onOrders }: { customerId: number; canRead: boolean; onOrders: () => void }) {
  const query = trpc.crmSalesOrder.customerSummary.useQuery({ customerId }, {
    enabled: canRead, retry: false, staleTime: 0, placeholderData: undefined,
  });
  const summary = canRead && !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    && query.data?.customerId === customerId ? query.data : undefined;
  return <section className="customer-workbench-panel">
    <div className="customer-workbench-panel-heading"><h2 className="admin-section-title">订单待办</h2>{canRead && <button type="button" className="crm-link" onClick={onOrders}>查看客户订单</button>}</div>
    {!canRead ? <p className="customer-workbench-empty">暂无订单查看权限。</p> : query.isError ? <p role="alert">读取订单统计失败：{errorMessage(query.error)} <button type="button" className="crm-link" onClick={() => void query.refetch()}>重试</button></p> : !summary ? <p className="customer-workbench-empty" role="status">正在读取客户订单待办…</p> : <>
      <dl className="customer-workbench-summary">
        <div><dt>全部订单</dt><dd>{summary.totalOrders}</dd></div>
        <div><dt>待登记收款</dt><dd>{summary.awaitingPaymentOrders}</dd></div>
        <div><dt>待出货</dt><dd>{summary.awaitingShipmentOrders}</dd></div>
        <div><dt>月结登记</dt><dd>{summary.monthlyOrders}</dd></div>
      </dl>
    </>}
  </section>;
}
