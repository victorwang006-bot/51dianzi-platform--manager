import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../../api/business-trpc";
import { errorMessage } from "./customerUtils";
import { supplyLocation, useCustomerSupplyAuthority } from "./customerSupply";
import { withCustomerContactScope, type CustomerContactScope } from "./customerContacts";

export function CustomerWorkbenchMaterials({ customerId, scope, scopeReady, canReadOrders }: {
  customerId: number; scope: CustomerContactScope | null; scopeReady: boolean; canReadOrders: boolean;
}) {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const listQuery = trpc.customerDemand.list.useQuery({ customerId, page, pageSize: 20 }, { retry: false, staleTime: 0, placeholderData: undefined });
  const result = !listQuery.isError && !listQuery.isFetching && !listQuery.isPlaceholderData && listQuery.isFetchedAfterMount !== false
    && listQuery.data?.items.every(item => item.customerId === customerId) ? listQuery.data : undefined;
  const selected = result?.items.find(item => item.id === selectedId) ?? result?.items[0];
  const query = trpc.customerDemand.get.useQuery({ id: selected?.id ?? 0 }, { enabled: Boolean(selected), retry: false, staleTime: 0, placeholderData: undefined });
  const detail = !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    && selected && query.data?.id === selected.id && query.data.customerId === customerId ? query.data : undefined;
  return <>
    <section className="customer-workbench-panel">
      <h2 className="admin-section-title">客户需求物料</h2>
      <p className="customer-detail-meta">按需求记录查看物料，与订单及供应库存分开。</p>
      {listQuery.isError ? <p role="alert">读取需求失败：{errorMessage(listQuery.error)}</p> : !result ? <p className="customer-workbench-empty">正在读取需求…</p> : !result.items.length ? <p className="customer-workbench-empty">暂无客户需求物料</p> : <>
        <label className="customer-workbench-material-select">需求记录<select className="crm-input" value={selected?.id ?? ""} onChange={event => setSelectedId(Number(event.target.value))}>{result.items.map(item => <option key={item.id} value={item.id}>{item.demandNo} · {item.projectName || "未填写项目"}</option>)}</select></label>
        {query.isError ? <p role="alert">读取需求详情失败：{errorMessage(query.error)}</p> : !detail ? <p className="customer-workbench-empty">正在核验当前客户物料…</p> : <div className="customer-workbench-table-scroll"><table className="crm-table"><thead><tr><th>型号 / 品牌</th><th>封装</th><th>需求数量</th><th>交期要求</th></tr></thead><tbody>{detail.items.map((item, index) => <tr key={item.id ?? index}><td>{item.partNumber || "—"}<span className="customer-detail-meta"> {item.brand}</span></td><td>{item.pkg || "—"}</td><td>{item.qty ?? "—"} {item.qtyUnit}</td><td>{item.deliveryRequirement || "—"}</td></tr>)}</tbody></table></div>}
        <div className="customer-workbench-pagination"><span>共 {result.total} 条需求 · 第 {page} 页</span><button type="button" className="crm-btn" disabled={page <= 1 || listQuery.isFetching} onClick={() => { setPage(value => value - 1); setSelectedId(null); }}>上一页</button><button type="button" className="crm-btn" disabled={page * 20 >= result.total || listQuery.isFetching} onClick={() => { setPage(value => value + 1); setSelectedId(null); }}>下一页</button></div>
      </>}
    </section>
    <CustomerWorkbenchOrderMaterials customerId={customerId} canRead={canReadOrders} />
    <CustomerWorkbenchSupply customerId={customerId} scope={scope} scopeReady={scopeReady} />
  </>;
}

function CustomerWorkbenchOrderMaterials({ customerId, canRead }: { customerId: number; canRead: boolean }) {
  const [page, setPage] = useState(1);
  const query = trpc.crmSalesOrder.customerMaterials.useQuery({ customerId, page, pageSize: 20 }, {
    enabled: canRead, retry: false, staleTime: 0, placeholderData: undefined,
  });
  const result = canRead && !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    && query.data?.items.every(item => item.customerId === customerId) ? query.data : undefined;
  return <section className="customer-workbench-panel"><h2 className="admin-section-title">客户订单物料快照</h2>
    <p className="customer-detail-meta">每行对应一笔订单；取消订单不计待交付。</p>
    {!canRead ? <p className="customer-workbench-empty">暂无订单查看权限。</p> : query.isError ? <p role="alert">读取订单物料失败：{errorMessage(query.error)} <button type="button" className="crm-link" onClick={() => void query.refetch()}>重试</button></p> : !result ? <p className="customer-workbench-empty">正在读取客户订单物料…</p> : !result.items.length ? <p className="customer-workbench-empty">暂无客户订单物料</p> : <>
      <div className="customer-workbench-table-scroll"><table className="crm-table"><thead><tr><th>订单 / 型号</th><th>状态</th><th>订购数量</th><th>已出数量</th><th>待出数量</th><th>成交含税单价</th></tr></thead><tbody>{result.items.map(item => <tr key={`${item.orderId}:${item.id}`}><td>{item.orderNumber}<br />{item.partNumber} · {item.brand}</td><td>{item.status === "cancelled" ? "已取消" : "有效订单"}</td><td>{item.orderedQty} {item.qtyUnit}</td><td>{item.shippedQty} {item.qtyUnit}</td><td>{item.remainingQty} {item.qtyUnit}</td><td>{item.unitPrice}</td></tr>)}</tbody></table></div>
      <div className="customer-workbench-pagination"><span>共 {result.total} 行订单物料 · 第 {page} 页</span><button type="button" className="crm-btn" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" className="crm-btn" disabled={page * 20 >= result.total || query.isFetching} onClick={() => setPage(value => value + 1)}>下一页</button></div>
    </>}
  </section>;
}

function CustomerWorkbenchSupply({ customerId, scope, scopeReady }: {
  customerId: number; scope: CustomerContactScope | null; scopeReady: boolean;
}) {
  const [, navigate] = useLocation();
  const authority = useCustomerSupplyAuthority(scope, scopeReady);
  const query = trpc.channelInventory.customerSupplySummary.useQuery(scope
    ? withCustomerContactScope(scope, { customerIds: [customerId] })
    : { customerIds: [customerId], expectedActorUserId: 0, expectedEnterpriseId: 0 }, {
    enabled: authority.canRead && Boolean(authority.identity), retry: false, staleTime: 0, placeholderData: undefined,
  });
  const summary = authority.canRead && !query.isError && !query.isFetching && !query.isPlaceholderData && query.isFetchedAfterMount !== false
    ? query.data?.items.find(item => item.customerId === customerId) : undefined;
  const channelId = summary?.canViewStock && Number.isSafeInteger(summary.channelId) && (summary.channelId ?? 0) > 0 ? summary.channelId : null;
  return <section className="customer-workbench-panel"><h2 className="admin-section-title">客户供应库存</h2>
    <p className="customer-detail-meta">与采购需求分开。</p>
    {authority.failed ? <p role="alert">库存权限核验失败 <button type="button" className="crm-link" onClick={() => void authority.retry()}>重试</button></p> : !authority.canRead ? <p className="customer-workbench-empty">暂无供应库存查看权限。</p> : query.isError ? <p role="alert">读取客户供应渠道失败：{errorMessage(query.error)} <button type="button" className="crm-link" onClick={() => void query.refetch()}>重试</button></p> : !summary ? <p className="customer-workbench-empty">正在核验客户供应渠道…</p> : channelId ? <button type="button" className="crm-btn" onClick={() => navigate(supplyLocation(channelId, "materials"))}>查看供应库存{summary.materialCount === null ? "" : `（${summary.materialCount}）`}</button> : <p className="customer-workbench-empty">暂无可查看的供应库存。</p>}
  </section>;
}
