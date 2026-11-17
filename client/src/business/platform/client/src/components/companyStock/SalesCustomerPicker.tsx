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
  const query = trpc.customer.list.useQuery(
    {
      keyword,
      scope: context.data?.canManageAll ? "all" : "mine",
      archived: false,
      due: "all",
      page,
      pageSize: 10,
    },
    {
      enabled: enabled && contextReady,
      staleTime: 0,
      retry: false,
      placeholderData: undefined,
      refetchOnMount: "always",
    }
  );
  const rows =
    enabled &&
    contextReady &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    !query.isPlaceholderData &&
    query.isFetchedAfterMount !== false
      ? (query.data?.items ?? [])
      : [];
  const search = () => {
    setKeyword(draft.trim());
    setPage(1);
  };
  return (
    <div className="space-y-2">
      <div className="company-stock-toolbar">
        <input
          className="crm-input"
          aria-label="搜索有权限客户"
          placeholder="搜索客户"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") search();
          }}
        />
        <button type="button" className="crm-btn" onClick={search}>
          搜索
        </button>
      </div>
      <div className="company-stock-scroll">
        <table className="company-stock-table" aria-label="有权限客户">
          <thead>
            <tr>
              <th>客户</th>
              <th>选择</th>
            </tr>
          </thead>
          <tbody>
            {context.isError || query.isError ? (
              <tr>
                <td colSpan={2} role="alert">
                  {context.error?.message ||
                    query.error?.message ||
                    "客户读取失败"}{" "}
                  <button
                    type="button"
                    className="crm-btn"
                    onClick={() => {
                      void context.refetch();
                      void query.refetch();
                    }}
                  >
                    重试
                  </button>
                </td>
              </tr>
            ) : context.isFetching || query.isFetching ? (
              <tr>
                <td colSpan={2}>正在核验客户…</td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={2}>无可用客户</td>
              </tr>
            ) : (
              rows.map(customer => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>
                    <button
                      type="button"
                      className="crm-btn"
                      disabled={Boolean(customer.archivedAt)}
                      onClick={() => {
                        if (session.isWritable() && !customer.archivedAt)
                          onSelect(customer);
                      }}
                    >
                      选择客户
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="company-stock-toolbar">
        <button
          type="button"
          className="crm-btn"
          disabled={page <= 1 || query.isFetching}
          onClick={() => setPage(p => p - 1)}
        >
          上一页
        </button>
        <span>{page}</span>
        <button
          type="button"
          className="crm-btn"
          disabled={page * 10 >= (query.data?.total ?? 0) || query.isFetching}
          onClick={() => setPage(p => p + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
