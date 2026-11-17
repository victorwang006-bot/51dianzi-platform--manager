import { useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import {
  useCompanyStockScope,
  useCompanyStockSession,
} from "./useCompanyStockSession";
export type SalesCustomer = {
  id: number;
  name: string;
  archivedAt?: string | Date | null;
};
export function SalesCustomerPicker(
  props: Parameters<typeof SalesCustomerSession>[0]
) {
  const scope = useCompanyStockScope();
  return (
    <SalesCustomerSession
      key={scope.identityKey}
      {...props}
      enabled={props.enabled && scope.ready}
    />
  );
}
function SalesCustomerSession({
  onSelect,
  enabled,
}: {
  onSelect: (customer: SalesCustomer) => void;
  enabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<"current_team" | "enterprise">("current_team");
  const [page, setPage] = useState(1);
  const scope = useCompanyStockScope();
  const session = useCompanyStockSession(enabled);
  enabled = enabled && scope.ready;
  const context = trpc.customer.context.useQuery(undefined, {
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  const contextReady =
    enabled &&
    context.isSuccess &&
    !context.isFetching &&
    !context.isError &&
    !context.isPlaceholderData &&
    context.isFetchedAfterMount !== false;
  const defaults = context.data?.salesOrderPicker;
  // Old backend versions must not silently strip picker flags and return all CRM rows.
  const rangeAllowed = range !== "enterprise" || context.data?.canReadEnterprise === true;
  const searchReady = Boolean(contextReady && defaults && rangeAllowed && keyword && draft.trim() === keyword);
  const query = trpc.customer.list.useQuery(
    {
      keyword,
      scope: "mine",
      salesOrderPicker: range,
      archived: false,
      due: "all",
      page,
      pageSize: 10,
      expectedActorUserId: context.data?.actorUserId,
    },
    {
      enabled: enabled && searchReady,
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const rows =
    searchReady &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount !== false
      ? (query.data?.items ?? [])
      : [];
  const search = () => {
    const term = draft.trim();
    if (!term || !contextReady || !defaults || !rangeAllowed) return;
    if (term === keyword && page === 1) void query.refetch();
    setKeyword(term);
    setPage(1);
  };
  const switchRange = (next: "current_team" | "enterprise") => {
    if (next === "enterprise" && !context.data?.canReadEnterprise) return;
    setRange(next);
    setDraft("");
    setKeyword("");
    setPage(1);
  };
  const defaultLabel = defaults?.scope === "team" ? defaults.teamName || "当前团队" : "本人";
  return (
    <div className="space-y-2">
      <div className="company-stock-toolbar">
        <label>
          客户范围{" "}
          <select
            className="crm-input"
            aria-label="客户搜索范围"
            value={range}
            disabled={!contextReady || !defaults}
            onChange={e => switchRange(e.target.value === "enterprise" ? "enterprise" : "current_team")}
          >
            <option value="current_team">{defaultLabel} · 后台来源</option>
            {context.data?.canReadEnterprise && <option value="enterprise">主动搜索全企业 · 全部来源</option>}
          </select>
        </label>
        <input
          className="crm-input"
          aria-label="搜索有权限客户"
          placeholder="输入客户名称或联系人后搜索"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <button type="button" className="crm-btn" disabled={!draft.trim() || !contextReady || !defaults || !rangeAllowed} onClick={search}>
          搜索
        </button>
      </div>
      <p className="crm-muted">不默认加载客户名单；范围由服务端核验。后台来源仅认创建追踪，不代表测试或导入数据。</p>
      <div className="company-stock-scroll">
        <table className="company-stock-table" aria-label="有权限客户">
          <thead>
            <tr>
              <th>客户 / 创建者</th>
              <th>负责人 / 记录团队</th>
              <th>创建来源</th>
              <th>选择</th>
            </tr>
          </thead>
          <tbody>
            {context.isError || (searchReady && query.isError) ? (
              <tr>
                <td colSpan={4} role="alert">
                  {context.error?.message || query.error?.message || "客户读取失败"}{" "}
                  <button type="button" className="crm-btn" onClick={() => {
                    if (context.isError) void context.refetch();
                    else if (searchReady) void query.refetch();
                  }}>重试</button>
                </td>
              </tr>
            ) : context.isFetching || (searchReady && query.isFetching) ? (
              <tr><td colSpan={4}>正在核验客户…</td></tr>
            ) : contextReady && !defaults ? (
              <tr><td colSpan={4} role="alert">客户范围服务尚未就绪，请刷新或联系管理员；未加载旧版全量名单。</td></tr>
            ) : !searchReady ? (
              <tr><td colSpan={4}>请先输入关键词并搜索；切换范围后需重新搜索。</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={4}>当前范围无匹配客户{range === "current_team" && context.data?.canReadEnterprise ? "；可主动切换全企业搜索其他团队或来源。" : "。"}</td></tr>
            ) : (
              rows.map(customer => (
                <tr key={customer.id}>
                  <td>{customer.name}<div className="crm-muted">创建者：{customer.createdByName || `用户${customer.createdByUserId}`} · #{customer.id}</div></td>
                  <td>{customer.assignedName || `用户${customer.assignedUserId}`}<div className="crm-muted">{customer.pickerProvenance?.teamName || "未记录团队（不推测）"}</div></td>
                  <td>{customer.pickerProvenance?.creationOrigin === "backend" ? `后台业务创建 · 账号${customer.pickerProvenance.createdAdminAccountId}` : "无后台创建追踪（来源未核实）"}</td>
                  <td>
                    <button type="button" className="crm-btn" disabled={Boolean(customer.archivedAt)} onClick={() => {
                      if (searchReady && session.isWritable() && !customer.archivedAt) onSelect(customer);
                    }}>选择客户</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="company-stock-toolbar">
        <button type="button" className="crm-btn" disabled={!searchReady || page <= 1 || query.isFetching} onClick={() => setPage(p => p - 1)}>上一页</button>
        <span>{page}</span>
        <button type="button" className="crm-btn" disabled={!searchReady || page * 10 >= (query.data?.total ?? 0) || query.isFetching} onClick={() => setPage(p => p + 1)}>下一页</button>
      </div>
    </div>
  );
}
