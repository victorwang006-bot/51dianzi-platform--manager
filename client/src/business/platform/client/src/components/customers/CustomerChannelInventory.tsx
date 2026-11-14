import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { useBusinessScope } from "../../../../../BusinessScope";
import { ChannelInventoryPartNumber, channelInventoryUpdatedAt, PrivateNotesPanel } from "../../pages/ChannelInventoryHost";
import { CollaborationNotesPanel } from "../channelInventory/CollaborationNotesPanel";
import { ChannelInventorySourcePanel } from "../channelInventory/ChannelInventorySourcePanel";
import { useFactoryMaterialPublish } from "../channelInventory/FactoryMaterialPublish";
import { inventoryError } from "../channelInventory/management";
import type { InventoryCompanyProjection } from "../channelInventory/company";
import type { SupplyIdentity, SupplyInputs, SupplyOutputs } from "./customerSupply";
import "./CustomerChannelInventory.css";

export type CustomerChannelInventoryProps = {
  customerId: number;
  customerVersion?: number;
  identity: SupplyIdentity;
  enabled: boolean;
  refreshVersion?: number;
  isCurrent?: () => boolean;
  onAction?: (action: () => void) => void;
  onOpenChange?: (open: boolean) => void;
  onAuthorizationError: (error: unknown) => void;
};
/** Additive contract on the existing listTeamMaterials endpoint; never a parallel table/API. */
export type CustomerInventoryInput = SupplyInputs["listTeamMaterials"] & { customerId: number };
export type CustomerInventoryResult = SupplyOutputs["listTeamMaterials"] & {
  customerId: number;
  customerVersion?: number;
  bindingCount: number;
};
const PAGE_SIZE = 20;
export function customerInventoryInput(identity: SupplyIdentity, customerId: number, filters: { partNumber: string; brand: string }, page: number): CustomerInventoryInput {
  return { expectedEnterpriseId: identity.enterpriseId, expectedActorUserId: identity.actorUserId,
    customerId, partNumber: filters.partNumber.normalize("NFKC").trim() || undefined,
    brand: filters.brand.trim() || undefined, page, pageSize: PAGE_SIZE };
}
/** Defense-in-depth on a server-filtered response, not client filtering of a global read. */
export function verifiedCustomerInventory(value: SupplyOutputs["listTeamMaterials"], input: CustomerInventoryInput, version?: number): CustomerInventoryResult {
  const result = value as Partial<CustomerInventoryResult>;
  if (result.customerId !== input.customerId || !Number.isSafeInteger(result.bindingCount) || result.bindingCount! < 0
    || (version !== undefined && result.customerVersion !== undefined && result.customerVersion !== version)
    || result.page !== input.page || result.pageSize !== input.pageSize || !Number.isSafeInteger(result.total) || result.total! < 0
    || !Number.isSafeInteger(result.pageCount) || result.pageCount! < 0
    || result.pageCount !== Math.ceil(result.total! / input.pageSize!)
    || !Array.isArray(result.items) || result.items.length > input.pageSize!
    || (result.bindingCount === 0 && (result.total !== 0 || result.items.length !== 0))
    || result.items.some(row => {
      const company = (row as typeof row & InventoryCompanyProjection).company;
      return !Number.isSafeInteger(row.id) || row.id <= 0 || row.currency !== "CNY" || row.canViewSource !== true
        || (company != null && company.id !== input.customerId);
    })) {
    throw new Error("客户库存范围未能确认，未展示其他公司的库存。请刷新或联系管理员核实接口版本。");
  }
  return result as CustomerInventoryResult;
}

type Panel = { key: string; kind: "source" | "notes" | "private"; id: number; generation: number };
export function CustomerChannelInventory(props: CustomerChannelInventoryProps) {
  const utils = trpc.useUtils();
  const business = useBusinessScope();
  const [filters, setFilters] = useState({ partNumber: "", brand: "" });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const input = useMemo(() => customerInventoryInput(props.identity, props.customerId, filters, page), [props.identity, props.customerId, filters, page]);
  const scopeKey = JSON.stringify([props.identity.key, props.identity.enterpriseId, props.identity.actorUserId, props.customerId, props.customerVersion]);
  const key = JSON.stringify([scopeKey, input, revision, props.refreshVersion, props.enabled]);
  const [query, setQuery] = useState<{ key: string; result?: CustomerInventoryResult; error?: string; loading: boolean; proofVersion?: number }>({ key: "", loading: true });
  const [panel, setPanel] = useState<Panel | null>(null);
  const lifecycle = useRef({ mounted: false, key, generation: 0 });
  if (lifecycle.current.key !== key) { lifecycle.current.key = key; lifecycle.current.generation++; }
  const latest = useRef(props); latest.current = props;
  const readable = props.enabled && (props.isCurrent?.() ?? true);
  const result = readable && query.key === key && !query.loading && !query.error ? query.result : undefined;
  const rows = result?.items ?? [];
  const liveRows = useRef(rows); liveRows.current = rows;
  const current = () => lifecycle.current.mounted && latest.current.enabled && (latest.current.isCurrent?.() ?? true)
    && lifecycle.current.key === key;
  const refresh = async () => { if (current()) setRevision(value => value + 1); };
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => { lifecycle.current.mounted = false; lifecycle.current.generation++; };
  }, []);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    const generation = lifecycle.current.generation;
    const valid = () => !controller.signal.aborted && current() && lifecycle.current.generation === generation;
    setQuery({ key, loading: true });
    void utils.client.channelInventory.listTeamMaterials.query(input, { signal: controller.signal }).then(value => {
      if (!valid()) return;
      const checked = verifiedCustomerInventory(value, input, props.customerVersion);
      setQuery({ key, result: checked, loading: false, proofVersion: generation });
    }).catch(error => {
      if (!valid()) return;
      props.onAuthorizationError(error);
      setQuery({ key, loading: false, error: inventoryError(error, "读取客户渠道库存失败，请刷新后重试。") });
    });
    return () => controller.abort();
  }, [key, readable, utils, input]);
  useEffect(() => {
    const focus = () => { if (current()) setRevision(value => value + 1); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [key]);
  useEffect(() => { setPanel(null); }, [key, readable]);
  const nativeNote = business.officialInventoryPermissions.note === true;
  const nativePublish = business.officialInventoryPermissions.publish === true;
  const context = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  const publishing = useFactoryMaterialPublish({ rows, context, scopeKey: key,
    authorized: business.frontUser.role === "user" || business.frontUser.role === "admin",
    available: readable && nativePublish && !query.error, proofReady: Boolean(result), proofVersion: query.proofVersion,
    isCurrent: current, onComplete: refresh, onAuthorizationError: props.onAuthorizationError,
    onAction: action => {
      const generation = lifecycle.current.generation;
      const guarded = () => { if (current() && lifecycle.current.generation === generation) action(); };
      props.onAction ? props.onAction(guarded) : guarded();
    } });
  const visiblePanel = panel && panel.key === key && readable && result ? panel : null;
  const panelRow = visiblePanel ? rows.find(row => row.id === visiblePanel.id) : undefined;
  const generation = visiblePanel?.generation;
  const panelCurrent = () => current() && lifecycle.current.generation === generation
    && liveRows.current.some(row => row.id === visiblePanel?.id);
  const modalOpen = Boolean(visiblePanel && panelRow || publishing.dialog);
  const openRef = useRef(false);
  useEffect(() => {
    if (openRef.current !== modalOpen) { openRef.current = modalOpen; latest.current.onOpenChange?.(modalOpen); }
  }, [modalOpen]);
  useEffect(() => () => { if (openRef.current) latest.current.onOpenChange?.(false); openRef.current = false; }, []);
  const act = (action: () => void) => {
    if (!current() || !result) return;
    const expectedGeneration = lifecycle.current.generation;
    const guarded = () => { if (current() && lifecycle.current.generation === expectedGeneration && liveRows.current.length) action(); };
    props.onAction ? props.onAction(guarded) : guarded();
  };
  const open = (id: number, kind: Panel["kind"]) => act(() => {
    const row = liveRows.current.find(item => item.id === id);
    if (!row || kind === "private" && (!row.isMine || !nativeNote)) return;
    setPanel({ id, kind, key, generation: lifecycle.current.generation });
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (!current()) return;
    const next = { partNumber: draft.partNumber.normalize("NFKC").trim(), brand: draft.brand.trim() };
    setFilters(next); setPage(1);
    if (page === 1 && next.partNumber === filters.partNumber && next.brand === filters.brand) void refresh();
  };
  const loading = readable && (query.key !== key || query.loading);
  const error = readable && query.key === key ? query.error : undefined;
  return <section className="ci-page ci-host ci-panel customer-channel-inventory" aria-label="客户渠道库存列表">
    <form className="ci-toolbar" onSubmit={submit}>
      <label className="ci-field ci-toolbar-search"><span className="ci-filter-label">型号</span><input aria-label="筛选客户库存型号" placeholder="搜索型号" maxLength={128} value={draft.partNumber} onChange={event => setDraft(value => ({ ...value, partNumber: event.target.value }))} /></label>
      <label className="ci-field ci-brand-input"><span className="ci-filter-label">品牌</span><input aria-label="筛选客户库存品牌" placeholder="搜索品牌" maxLength={64} value={draft.brand} onChange={event => setDraft(value => ({ ...value, brand: event.target.value }))} /></label>
      <button type="submit" className="ci-button ci-primary" disabled={!readable}>搜索</button>
      <button type="button" className="ci-button" disabled={!readable} onClick={() => void refresh()}>刷新库存</button>
      <span className="ci-filter-count">{result ? `${result.total} 条库存 · ${result.bindingCount} 个已确认可读渠道` : loading ? "正在读取库存条数…" : "库存条数不可用"}</span>
    </form>
    <div className="ci-tablewrap ci-compact-tablewrap"><table className="ci-table ci-compact-stock-table ci-stock-edit-table admin-table-readable customer-channel-inventory-table">
      <colgroup><col /><col style={{ width: 100 }} /><col style={{ width: 96 }} /><col style={{ width: 104 }} /><col style={{ width: 128 }} /><col style={{ width: 112 }} /><col style={{ width: 148 }} /><col style={{ width: 140 }} /><col style={{ width: 216 }} /></colgroup>
      <thead><tr><th className="ci-material-part-col">型号</th><th className="ci-material-brand-col">品牌</th><th className="ci-material-recorder-col">负责人</th><th className="ci-material-qty-col">可供数量</th><th className="ci-material-price-col">报价 CNY</th><th className="ci-material-lead-col">交期</th><th className="ci-material-date-col">更新时间</th><th className="ci-material-source-col">渠道来源</th><th className="ci-col-actions">操作</th></tr></thead>
      <tbody>
        {!readable ? <tr><td colSpan={9} className="ci-empty">正在核验客户库存读取权限…</td></tr> : loading ? <tr><td colSpan={9} className="ci-empty">正在读取客户渠道库存…</td></tr> : error ? <tr><td colSpan={9} className="ci-empty ci-host-error" role="alert">{error}</td></tr> : !result ? <tr><td colSpan={9} className="ci-empty">客户库存范围尚未确认。</td></tr> : result.bindingCount === 0 ? null : !rows.length ? <tr><td colSpan={9} className="ci-empty">已确认绑定渠道暂无符合筛选条件的库存。</td></tr> : null}
        {rows.map(row => {
          const updated = channelInventoryUpdatedAt(row.updatedAt);
          return <tr key={row.id}>
            <td className="ci-material-part-col"><ChannelInventoryPartNumber partNumber={row.partNumber} resetKey={key} /></td>
            <td className="ci-material-brand-col" title={row.brand}>{row.brand || "—"}</td>
            <td className="ci-material-recorder-col" title={row.originalRecorderName ?? "待核实"}>{row.originalRecorderName ?? "待核实"}</td>
            <td className="ci-number ci-material-qty-col">{row.qty === null ? "待确认" : row.qty.toLocaleString("zh-CN")}</td>
            <td className="ci-price ci-material-price-col">{row.price === null ? "面议" : `¥${row.price}`}{typeof row.taxIncluded === "boolean" ? <small className="ci-subtext">{row.taxIncluded ? "含税" : "未税"}</small> : null}</td>
            <td className="ci-material-lead-col">{row.leadTime || "待确认"}</td>
            <td className="ci-date ci-material-date-col">{updated ? <time className="ci-updated-at admin-cell-secondary" title={updated.full} dateTime={`${updated.full.slice(0, 19).replace(" ", "T")}+08:00`}><ChannelInventoryPartNumber partNumber={updated.full} displayValue={updated.compact} kind="time" resetKey={key} /></time> : null}</td>
            <td className="ci-material-source-col"><button type="button" className={`ci-inline-link${row.canViewSource ? "" : " ci-source-link-muted"}`} onClick={() => open(row.id, "source")}>查看来源</button></td>
            <td className="ci-col-actions"><div className="ci-row-actions">{publishing.action(row)}<button type="button" className="ci-inline-link" onClick={() => open(row.id, "notes")}>备注（{row.noteCount}）</button>{row.isMine && nativeNote ? <button type="button" className="ci-inline-link" aria-label={`本人备注：${row.partNumber}`} onClick={() => open(row.id, "private")}>本人备注</button> : null}</div></td>
          </tr>;
        })}
      </tbody>
    </table></div>
    {result ? <nav className="ci-pagination" aria-label="客户渠道库存分页"><span>共 {result.total} 条，第 {page} / {Math.max(1, result.pageCount)} 页</span><button type="button" className="ci-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><button type="button" className="ci-button" disabled={page >= Math.max(1, result.pageCount)} onClick={() => setPage(value => value + 1)}>下一页</button></nav> : null}
    {publishing.dialog}
    {visiblePanel && panelRow && visiblePanel.kind === "source" ? <ChannelInventorySourcePanel key={`${key}:source:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} scopeKey={scopeKey} active={readable} isCurrent={panelCurrent} onClose={() => setPanel(null)} onAuthorizationError={props.onAuthorizationError} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "notes" ? <CollaborationNotesPanel key={`${key}:notes:${panelRow.id}`} materialId={panelRow.id} partNumber={panelRow.partNumber} brand={panelRow.brand} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} canWriteNote={nativeNote} canAddNote={nativeNote && panelRow.canAddNote} isCurrent={panelCurrent} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "private" && panelRow.isMine && nativeNote ? <PrivateNotesPanel key={`${key}:private:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} isCurrent={() => panelCurrent() && liveRows.current.find(row => row.id === panelRow.id)?.isMine === true} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
  </section>;
}
