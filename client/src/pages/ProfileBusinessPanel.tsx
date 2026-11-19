import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";
import type { PersonalReadErrorCategory } from "@shared/personalCommission";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { currentShanghaiMonth, validMonth } from "./profileModel";
import { useProfileBusinessQuery } from "./profileBusinessQuery";
import { ProfileCommissionResults } from "./ProfileCommissionResults";
import { ProfilePerformanceResults } from "./ProfilePerformanceResults";

type Selection = {
  month: string; merchantId: number | null;
  performancePage: number; commissionPage: number;
  groupRevision: number; performanceRevision: number; commissionRevision: number;
};
function requestToken(value: Selection, kind: "performance" | "commission") {
  return `${value.groupRevision}:${value.month}:${value.merchantId}:${kind === "performance" ? value.performancePage : value.commissionPage}:${kind === "performance" ? value.performanceRevision : value.commissionRevision}`;
}
function BusinessLoading({ label }: { label: string }) {
  return <div className="pc-loading" role="status" aria-label={`正在加载${label}`}>
    <Skeleton className="h-8 w-40" /><Skeleton className="h-24 w-full" />
  </div>;
}
const ERROR_LABELS: Record<PersonalReadErrorCategory, string> = {
  identity_scope: "当前员工绑定、公司读取范围或登录状态不可用，请核对已有授权。",
  delegation_unavailable: "个人统计读取通道暂不可用，请稍后重试。",
  source_invalid: "个人统计来源或分页口径无法核实，暂不可用。",
  query_failed: "个人统计查询暂不可用，请稍后重试。",
};
function BusinessFailure({ label, retry, fetching, unavailable }: {
  label: string; retry(): void; fetching: boolean;
  unavailable?: { reason: string; errorCategory?: PersonalReadErrorCategory; correlationId?: string };
}) {
  // Do not expose arbitrary transport errors (SQL, stack traces or secrets).
  return <div className="pc-state pc-state--error" role="alert"><div>
    <span>{unavailable?.errorCategory ? ERROR_LABELS[unavailable.errorCategory] : unavailable?.reason || `${label}查询失败，请稍后重试。`}</span>
    {unavailable?.correlationId && <p className="pc-muted">查询编号：{unavailable.correlationId}</p>}
  </div><Button size="sm" variant="outline" disabled={fetching} onClick={retry}>
    <RefreshCw className={fetching ? "animate-spin" : undefined} />重试
  </Button></div>;
}

export default function ProfileBusinessPanel({ prefix, isCurrent }: {
  prefix: readonly unknown[];
  isCurrent(): boolean;
}) {
  // Use the same bound client as the profile/security operations, not a new RPC client.
  const rpc = trpc.useUtils().client.personalCenter;
  const queryClient = useQueryClient();
  const businessPrefix = useMemo(() => [...prefix, "business"], [prefix]);
  const live = useRef(true);
  const [selection, setSelection] = useState<Selection>(() => ({ month: currentShanghaiMonth(), merchantId: null,
    performancePage: 1, commissionPage: 1, groupRevision: 0, performanceRevision: 0, commissionRevision: 0 }));
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectedCompanyRef = useRef<number | null>(null);
  function current() { return live.current && isCurrent(); }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      void queryClient.cancelQueries({ queryKey: businessPrefix });
      queryClient.removeQueries({ queryKey: businessPrefix });
    };
  }, [businessPrefix, queryClient]);
  const companiesQuery = useProfileBusinessQuery({ queryKey: [...businessPrefix, "companies"], enabled: true,
    isCurrent: current, read: signal => rpc.businessCompanies.query(undefined, { signal }) });
  const companies = companiesQuery.data ?? [];
  const merchantId = companies.some(company => company.merchantId === selection.merchantId) ? selection.merchantId :
    companies.length === 1 && selection.merchantId === null ? companies[0].merchantId : null;
  selectedCompanyRef.current = companiesQuery.isFetching || companiesQuery.isError ? null : merchantId;
  const enabled = !companiesQuery.isFetching && !companiesQuery.isError && merchantId !== null && validMonth(selection.month);
  const performanceToken = requestToken(selection, "performance");
  const commissionToken = requestToken(selection, "commission");
  const performanceQuery = useProfileBusinessQuery({
    queryKey: [...businessPrefix, "performance", selection.month, merchantId, selection.performancePage, selection.groupRevision, selection.performanceRevision],
    enabled,
    isCurrent: () => current() && selectedCompanyRef.current === merchantId && requestToken(selectionRef.current, "performance") === performanceToken,
    read: async signal => {
      const result = await rpc.performance.query({ month: selection.month, merchantId: merchantId!, page: selection.performancePage, pageSize: 10 }, { signal });
      if (result.month !== selection.month || (result.status === "available" && (result.page !== selection.performancePage || result.pageSize !== 10))) throw new Error("SOURCE_SCOPE_MISMATCH");
      return result;
    },
  });
  const commissionQuery = useProfileBusinessQuery({
    queryKey: [...businessPrefix, "commission", selection.month, merchantId, selection.commissionPage, selection.groupRevision, selection.commissionRevision],
    enabled,
    isCurrent: () => current() && selectedCompanyRef.current === merchantId && requestToken(selectionRef.current, "commission") === commissionToken,
    read: async signal => {
      const result = await rpc.commission.query({ month: selection.month, merchantId: merchantId!, page: selection.commissionPage, pageSize: 10 }, { signal });
      if (result.month !== selection.month || (result.status === "available" && (result.page !== selection.commissionPage || result.pageSize !== 10))) throw new Error("SOURCE_SCOPE_MISMATCH");
      return result;
    },
  });
  function select(next: Selection) {
    // Fence synchronously, even if an old promise completes before React commits.
    selectionRef.current = next;
    setSelection(next);
  }
  function changeMonth(month: string) {
    if (!validMonth(month) || month === selectionRef.current.month) return;
    const previous = selectionRef.current;
    select({ ...previous, month, performancePage: 1, commissionPage: 1, groupRevision: previous.groupRevision + 1 });
  }
  function changeCompany(value: string) {
    const company = companies.find(item => String(item.merchantId) === value);
    if (!company || company.merchantId === selectedCompanyRef.current) return;
    selectedCompanyRef.current = company.merchantId;
    const previous = selectionRef.current;
    select({ ...previous, merchantId: company.merchantId, performancePage: 1, commissionPage: 1, groupRevision: previous.groupRevision + 1 });
  }
  function changePage(kind: "performance" | "commission", page: number) {
    const previous = selectionRef.current;
    select(kind === "performance" ? { ...previous, performancePage: page, performanceRevision: previous.performanceRevision + 1 } :
      { ...previous, commissionPage: page, commissionRevision: previous.commissionRevision + 1 });
  }
  const performance = performanceQuery.data;
  const commission = commissionQuery.data;
  return <>
    <div className="pc-filter"><Label htmlFor="pc-month">订单创建月份</Label>
      <Input id="pc-month" type="month" min="2000-01" max="9998-12" value={selection.month} onChange={event => changeMonth(event.target.value)} />
      <Label htmlFor="pc-company">业务公司</Label>
      <select id="pc-company" className="pc-company-select" value={merchantId === null ? "" : String(merchantId)}
        disabled={companiesQuery.isFetching || companiesQuery.isError || !companies.length} onChange={event => changeCompany(event.target.value)}>
        {merchantId === null && <option value="" disabled>{companies.length ? "请选择已有授权公司" : "暂无可用授权公司"}</option>}
        {companies.map(company => <option key={company.merchantId} value={String(company.merchantId)}>{company.label}</option>)}
      </select><span className="pc-muted">北京时间</span>
    </div>
    {companiesQuery.isFetching ? <BusinessLoading label="授权公司" /> : companiesQuery.isError ?
      <BusinessFailure label="授权公司" retry={() => { void companiesQuery.refetch(); }} fetching={companiesQuery.isFetching} /> :
      !companies.length ? <div className="pc-state">暂无可用的授权业务公司，业绩与提成不可用。请核对已有员工绑定和读取权限。</div> :
      merchantId === null ? <div className="pc-state">请选择已有授权业务公司后查看本人业绩与提成。</div> : <>
        <section className="pc-results" aria-label="我的业绩"><h2 className="pc-section-title">我的业绩</h2>
          {performanceQuery.isFetching || performanceQuery.isPending ? <BusinessLoading label="本人业绩" /> : performanceQuery.isError ?
            <BusinessFailure label="业绩" retry={() => { void performanceQuery.refetch(); }} fetching={performanceQuery.isFetching} /> :
            performance?.status === "unavailable" ? <BusinessFailure label="业绩" unavailable={performance} retry={() => { void performanceQuery.refetch(); }} fetching={performanceQuery.isFetching} /> :
            performance?.status === "available" ? <ProfilePerformanceResults result={performance} fetching={performanceQuery.isFetching} onPage={page => changePage("performance", page)} /> :
            <div className="pc-state">暂无可核实的业绩数据。</div>}
        </section>
        <section className="pc-results" aria-label="我的提成"><h2 className="pc-section-title pc-business-commission-title">我的提成
          {!commissionQuery.isFetching && !commissionQuery.isPending && !commissionQuery.isError && commission?.status === "available" && commission.pendingCount > 0 &&
            <span className="pc-business-status pc-business-status--pending">待核 {commission.pendingCount} 笔</span>}
        </h2>
          {commissionQuery.isFetching || commissionQuery.isPending ? <BusinessLoading label="本人提成" /> : commissionQuery.isError ?
            <BusinessFailure label="提成" retry={() => { void commissionQuery.refetch(); }} fetching={commissionQuery.isFetching} /> :
            commission?.status === "unavailable" ? <BusinessFailure label="提成" unavailable={commission} retry={() => { void commissionQuery.refetch(); }} fetching={commissionQuery.isFetching} /> :
            commission?.status === "available" ? <ProfileCommissionResults key={JSON.stringify([businessPrefix, merchantId, commissionToken])} result={commission} fetching={commissionQuery.isFetching} onPage={page => changePage("commission", page)} /> :
            <div className="pc-state">暂无可核实的提成数据。</div>}
        </section>
      </>}
  </>;
}
