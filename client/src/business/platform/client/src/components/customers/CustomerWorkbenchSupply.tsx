import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../../../../api/business-trpc";
import { businessIndustryCodeSchema } from "../../../../shared/businessIndustry";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { supplyLocation, useCustomerSupplyAuthority } from "./customerSupply";
import { withCustomerContactScope, type CustomerContactScope } from "./customerContacts";
import { errorMessage } from "./customerUtils";

export type CustomerWorkbenchSupplyProps = {
  customerId: number; scope: CustomerContactScope | null; scopeReady: boolean;
  customerVersion?: number; archived?: boolean; isCurrent?: () => boolean;
  onAction?: (action: () => void) => void; onOpenChange?: (open: boolean) => void;
};

/** UI intents only: the existing context/getChannel and importer retain all authorization checks. */
export function CustomerWorkbenchSupply(props: CustomerWorkbenchSupplyProps) {
  const { customerId, scope, scopeReady } = props;
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const authority = useCustomerSupplyAuthority(scope, scopeReady);
  const descriptionId = useId();
  const identity = authority.identity;
  const readEnabled = authority.canRead && Boolean(identity);
  const contextEnabled = Boolean(identity) && (authority.canRead || authority.canWrite);
  const summaryQuery = trpc.channelInventory.customerSupplySummary.useQuery(scope
    ? withCustomerContactScope(scope, { customerIds: [customerId] })
    : { customerIds: [customerId], expectedActorUserId: 0, expectedEnterpriseId: 0 }, {
    enabled: readEnabled, retry: false, staleTime: 0, placeholderData: undefined,
  });
  const contextQuery = trpc.channelInventory.customerSupplyContext.useQuery(scope
    ? withCustomerContactScope(scope, { customerId })
    : { customerId, expectedActorUserId: 0, expectedEnterpriseId: 0 }, {
    enabled: contextEnabled, retry: false, staleTime: 0, placeholderData: undefined,
    refetchOnMount: "always", refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const summary = readEnabled && !summaryQuery.isError && !summaryQuery.isFetching
    && !summaryQuery.isPlaceholderData && summaryQuery.isFetchedAfterMount !== false
    ? summaryQuery.data?.items.find(item => item.customerId === customerId) : undefined;
  const contextMatches = contextQuery.data?.customer.id === customerId
    && (props.customerVersion === undefined || contextQuery.data.customer.version === props.customerVersion);
  const context = contextEnabled && contextMatches && !contextQuery.isError && !contextQuery.isFetching
    && !contextQuery.isPlaceholderData && contextQuery.isFetchedAfterMount !== false ? contextQuery.data : undefined;
  const boundChannelId = context?.channel && Number.isSafeInteger(context.channel.id) && context.channel.id > 0 ? context.channel.id : null;
  // Summary intentionally hides channelId at zero stock; only context proves a binding.
  const stockChannelId = readEnabled && summary?.canViewStock && Number.isSafeInteger(summary.channelId) && (summary.channelId ?? 0) > 0
    ? (!context || boundChannelId === summary.channelId ? summary.channelId : null) : readEnabled ? boundChannelId : null;
  const missingIndustry = Boolean(context && !businessIndustryCodeSchema.safeParse(context.customer.industryCode).success);
  const uploadReason = authority.failed ? "库存权限核验失败，请重试。"
    : props.archived || context?.customer.archivedAt ? "该客户已归档，不能上传物料表。"
    : !authority.canWrite ? "当前账号没有客户供应上传权限。"
    : contextQuery.isError ? `读取供货设置失败：${errorMessage(contextQuery.error)}`
    : !context ? "正在核验客户供货设置…"
    : missingIndustry ? "客户缺少合法所属行业，请先在客户档案补全资料。"
    : !context.canUpload ? context.disabledReason || "当前账号没有客户供应上传权限。"
    : context.channel && !context.channel.active ? "关联渠道已停用，请核实后再上传。" : "";
  const canUpload = Boolean(identity && context && !uploadReason);
  const settingsReason = !readEnabled ? "暂无供货设置查看权限。"
    : contextQuery.isError ? "供货设置读取失败，请重试。"
    : !context ? "正在核验客户供货关联…"
    : !boundChannelId ? context.canUpload ? "尚未绑定供货渠道，可在上传物料表中人工选择并确认关联现有渠道。"
      : context.disabledReason || "未能核验可查看的供货关联，请联系有权人员确认。" : "";

  const latest = useRef(props); latest.current = props;
  const live = useRef({ identityKey: identity?.key, canUpload, context, readEnabled, boundChannelId, stockChannelId });
  live.current = { identityKey: identity?.key, canUpload, context, readEnabled, boundChannelId, stockChannelId };
  const lifecycle = useRef({ mounted: true, generation: 0, key: "", allowed: false });
  const sessionKey = `${identity?.enterpriseId}:${identity?.actorUserId}:${identity?.key}:${customerId}:${props.customerVersion ?? contextQuery.data?.customer.version}`;
  // Background fetching masks new actions, but cannot unmount a dirty importer.
  // A real identity/version/archive/read refusal still invalidates immediately.
  const allowed = Boolean(identity && authority.canWrite && !props.archived && scopeReady
    && !contextQuery.isError && !contextQuery.isPlaceholderData && contextMatches
    && !contextQuery.data?.customer.archivedAt && contextQuery.data?.canUpload === true
    && businessIndustryCodeSchema.safeParse(contextQuery.data?.customer.industryCode).success
    && (!contextQuery.data?.channel || contextQuery.data.channel.active) && (props.isCurrent?.() ?? true));
  if (lifecycle.current.key !== sessionKey || (lifecycle.current.allowed && !allowed)) lifecycle.current.generation++;
  lifecycle.current.key = sessionKey; lifecycle.current.allowed = allowed;
  const [session, setSession] = useState<{ key: string; generation: number; customerVersion: number } | null>(null);
  const active = Boolean(session && session.key === sessionKey && session.generation === lifecycle.current.generation
    && allowed && session.customerVersion === contextQuery.data?.customer.version);
  const openRef = useRef(false);
  const close = () => { lifecycle.current.generation++; openRef.current = false; latest.current.onOpenChange?.(false); setSession(null); };
  useLayoutEffect(() => {
    lifecycle.current.mounted = true;
    return () => {
      lifecycle.current.mounted = false; lifecycle.current.generation++;
      if (openRef.current) latest.current.onOpenChange?.(false);
      openRef.current = false;
    };
  }, []);
  useEffect(() => { if (session && !active) close(); }, [session, active]);
  useEffect(() => {
    if (contextEnabled && contextQuery.isError) authority.onAuthorizationError(contextQuery.error);
  }, [contextEnabled, contextQuery.isError, contextQuery.error]);
  const act = (action: () => void) => props.onAction ? props.onAction(action) : action();
  const openUpload = () => {
    if (!identity || !context || !canUpload || openRef.current) return;
    const key = identity.key; const version = context.customer.version; const generation = lifecycle.current.generation;
    act(() => {
      if (!lifecycle.current.mounted || !lifecycle.current.allowed || lifecycle.current.generation !== generation || live.current.identityKey !== key
        || !live.current.canUpload || live.current.context?.customer.version !== version || openRef.current) return;
      openRef.current = true; latest.current.onOpenChange?.(true);
      setSession({ key: sessionKey, generation: lifecycle.current.generation, customerVersion: version });
    });
  };
  const viewSettings = () => {
    if (!identity || !readEnabled || !boundChannelId) return;
    const key = identity.key; const id = boundChannelId; const generation = lifecycle.current.generation;
    act(() => {
      if (lifecycle.current.mounted && lifecycle.current.generation === generation && live.current.identityKey === key
        && live.current.readEnabled && live.current.boundChannelId === id && (latest.current.isCurrent?.() ?? true))
        navigate(supplyLocation(id, "channels"));
    });
  };
  const retry = () => {
    if (authority.failed) void authority.retry();
    if (contextEnabled) void contextQuery.refetch();
    if (readEnabled) void summaryQuery.refetch();
  };
  const isSessionCurrent = () => Boolean(session && lifecycle.current.mounted && lifecycle.current.allowed
    && openRef.current && lifecycle.current.key === session.key && lifecycle.current.generation === session.generation
    && (latest.current.isCurrent?.() ?? true));
  return <section className="customer-workbench-panel"><h2 className="admin-section-title">客户供应库存</h2>
    <p className="customer-detail-meta">与采购需求分开。</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="crm-btn crm-btn-primary" aria-disabled={!canUpload} aria-describedby={uploadReason ? descriptionId : undefined}
        onClick={openUpload}>上传物料表</button>
      <button type="button" className="crm-btn" disabled={Boolean(settingsReason)} title={settingsReason || undefined} onClick={viewSettings}>供货设置</button>
      {stockChannelId ? <button type="button" className="crm-btn" onClick={() => {
        const generation = lifecycle.current.generation;
        act(() => {
          if (live.current.identityKey === identity?.key && live.current.stockChannelId === stockChannelId
            && live.current.readEnabled && lifecycle.current.mounted && lifecycle.current.generation === generation
            && (latest.current.isCurrent?.() ?? true)) navigate(supplyLocation(stockChannelId, "materials"));
        });
      }}>查看供应库存{summary && summary.materialCount !== null && Number.isSafeInteger(summary.materialCount) && summary.materialCount >= 0 ? `（${summary.materialCount}）` : ""}</button> : null}
    </div>
    {uploadReason ? <p id={descriptionId} className="customer-detail-meta">{uploadReason}</p> : null}
    {context?.disabledReason && context.disabledReason !== uploadReason && context.disabledReason !== settingsReason ? <p className="customer-detail-meta">{context.disabledReason}</p> : null}
    {settingsReason ? <p className="customer-detail-meta">{settingsReason}</p> : context && (!authority.canWrite || !context.canUpload || props.archived) ? <p className="customer-detail-meta">供货设置入口可查看；编辑能力仍由原渠道页面核验，当前上传只读。</p> : null}
    {authority.failed || contextQuery.isError || (readEnabled && summaryQuery.isError) ? <p role="alert">{summaryQuery.isError && readEnabled ? `读取客户供应库存失败：${errorMessage(summaryQuery.error)}` : "供货权限或关联核验失败。"} <button type="button" className="crm-link" onClick={retry}>重试供应库存</button></p>
      : !readEnabled ? <p className="customer-workbench-empty">暂无供应库存查看权限。</p>
      : !stockChannelId ? <p className="customer-workbench-empty">{!summary || !context ? "正在核验客户供应渠道…" : "暂无可查看的供应库存。"}</p> : null}
    {active && identity && session ? <CustomerSupplyUploadDialog customerId={customerId} identity={identity} isCurrent={isSessionCurrent}
      onClose={() => { if (isSessionCurrent()) close(); }} onComplete={() => {
        if (!isSessionCurrent()) return;
        // Refresh metadata only; the importer owns its queue, source locks and portal close timing.
        void utils.channelInventory.customerSupplySummary.invalidate();
        void utils.channelInventory.customerSupplyContext.invalidate();
      }} onAuthorizationError={authority.onAuthorizationError} /> : null}
  </section>;
}
