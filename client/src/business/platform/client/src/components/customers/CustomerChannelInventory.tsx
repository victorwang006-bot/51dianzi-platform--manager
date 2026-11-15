import React, { useEffect, useMemo, useRef, useState } from "react";
import { createBusinessScopeTrpcClient, trpc } from "../../../../../api/business-trpc";
import { useBusinessScope } from "../../../../../BusinessScope";
import { ChannelInventoryCopyPartNumber, MaterialEditPanel, PrivateNotesPanel, createRequestId, definitiveWriteFailure, errorMessage, materialFormFrom, materialInputFromForm, validateMaterialForm } from "../../pages/ChannelInventoryHost";
import type { MaterialForm } from "../../pages/ChannelInventoryMaterialEditPanel";
import { DEFAULT_CHANNEL_INVENTORY_COLUMNS, channelInventoryColumnLayout, channelInventoryMaterialAccess, channelInventoryMaterialEditGranted } from "../../pages/channelInventoryColumns";
import { ChannelReferenceCell } from "../../pages/ChannelReferenceCell";
import { ChannelInventoryManualReferenceFields } from "../../pages/ChannelInventoryManualReferenceFields";
import { manualReferenceDraftFrom, manualReferencePatch, manualReferenceRetentionKey, manualReferenceValidation } from "../../pages/manualReferenceEdit";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";
import { startChannelReferenceRefresh } from "../../pages/ChannelInventoryHost.referenceRefresh";
import type { ChannelReferenceRow } from "@shared/channelReference";
import { CollaborationNotesPanel } from "../channelInventory/CollaborationNotesPanel";
import { ChannelInventoryCustomerSource, ChannelInventorySourcePanel } from "../channelInventory/ChannelInventorySourcePanel";
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

type Panel = { key: string; kind: "source" | "notes" | "private" | "edit"; id: number; generation: number };
const columnLayout = channelInventoryColumnLayout(DEFAULT_CHANNEL_INVENTORY_COLUMNS, false);
export function CustomerChannelInventory(props: CustomerChannelInventoryProps) {
  const utils = trpc.useUtils();
  const business = useBusinessScope();
  const [filters, setFilters] = useState({ partNumber: "", brand: "" });
  const [draft, setDraft] = useState(filters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const editPending = useRef(false);
  const frozen = useRef<SupplyInputs["updateTeamMaterial"] | null>(null);
  const deferredRefresh = useRef(false);
  // These refs are authoritative even before busy/retryLocked has rerendered.
  const unresolvedEdit = () => editPending.current || frozen.current !== null;
  const input = useMemo(() => customerInventoryInput(props.identity, props.customerId, filters, page), [props.identity.enterpriseId, props.identity.actorUserId, props.customerId, filters, page]);
  const authorityKey = JSON.stringify([business.storageScope, business.contextVerification?.identity,
    business.contextVerification?.state, business.contextVerification?.authorizationVersion, business.contextVerification?.readVersion,
    business.officialInventoryPermissions, business.frontUser.id, business.staffPrincipal]);
  const scopeKey = JSON.stringify([props.identity.key, props.identity.enterpriseId, props.identity.actorUserId, props.customerId, props.customerVersion, authorityKey]);
  const appliedRefresh = useRef({ scopeKey, version: props.refreshVersion });
  if (appliedRefresh.current.scopeKey !== scopeKey) {
    // Identity, authorization and customer version changes must never be frozen.
    appliedRefresh.current = { scopeKey, version: props.refreshVersion };
    deferredRefresh.current = false;
  } else if (appliedRefresh.current.version !== props.refreshVersion) {
    if (unresolvedEdit()) deferredRefresh.current = true;
    else {
      appliedRefresh.current.version = props.refreshVersion;
      deferredRefresh.current = false; // This reread also covers deferred focus/refresh.
    }
  }
  const key = JSON.stringify([scopeKey, input, revision, appliedRefresh.current.version, props.enabled]);
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
  const contextVerified = business.contextVerification?.state === "verified"
    && business.contextVerification.identity === business.storageScope
    && business.frontUser.id === props.identity.actorUserId
    && business.staffPrincipal?.frontendUserId === props.identity.actorUserId
    && business.staffPrincipal?.enterpriseId === props.identity.enterpriseId
    && business.officialInventoryPermissions.read === true;
  const materialContext = readable && contextVerified && business.officialInventoryPermissions.write === true && result?.canWrite === true;
  const accessRef = useRef(materialContext); accessRef.current = materialContext;
  const access = (row: (typeof rows)[number]) => channelInventoryMaterialAccess(row, current() && accessRef.current);
  const refresh = async () => {
    if (!current()) return;
    if (unresolvedEdit()) { deferredRefresh.current = true; return; }
    deferredRefresh.current = false;
    setRevision(value => value + 1);
  };
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
    const focus = () => { void refresh(); };
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
    && liveRows.current.some(row => row.id === visiblePanel?.id
      && (visiblePanel.kind !== "source" && visiblePanel.kind !== "edit" || access(row)));
  const modalOpen = Boolean(visiblePanel && panelRow
    && (visiblePanel.kind !== "source" && visiblePanel.kind !== "edit" || access(panelRow)) || publishing.dialog);
  const openRef = useRef(false);
  useEffect(() => {
    if (openRef.current !== modalOpen) { openRef.current = modalOpen; latest.current.onOpenChange?.(modalOpen); }
  }, [modalOpen]);
  useEffect(() => () => { if (openRef.current) latest.current.onOpenChange?.(false); openRef.current = false; }, []);
  const act = (action: () => void) => {
    if (!current() || !result || unresolvedEdit() || retryLocked) return;
    const expectedGeneration = lifecycle.current.generation;
    const guarded = () => { if (current() && !unresolvedEdit() && !retryLocked && lifecycle.current.generation === expectedGeneration && liveRows.current.length) action(); };
    props.onAction ? props.onAction(guarded) : guarded();
  };
  const open = (id: number, kind: Panel["kind"]) => act(() => {
    const row = liveRows.current.find(item => item.id === id);
    if (!row || (kind === "source" || kind === "edit") && !access(row)
      || kind === "private" && (!row.isMine || !nativeNote)) return;
    setPanel({ id, kind, key, generation: lifecycle.current.generation });
  });

  // Read saved marketplace references through the same BFF boundary as the Host.
  // The exact customer-scoped list input is mandatory; never fall back to a global page.
  const referenceAllowed = Boolean(result && readable && contextVerified
    && Number.isSafeInteger(business.merchantId) && business.merchantId > 0 && rows.length
    && new Set(rows.map(row => row.id)).size === rows.length);
  const referenceKey = referenceAllowed ? JSON.stringify([key, business.merchantId, rows.map(row => [row.id, row.partNumber, row.brand])]) : "";
  const referenceLive = useRef(referenceKey); referenceLive.current = referenceKey;
  const [references, setReferences] = useState<{ key: string; items: ChannelReferenceRow[] }>({ key: "", items: [] });
  const currentReferences = new Map((referenceAllowed && references.key === referenceKey ? references.items : []).map(row => [row.materialId, row.references]));
  useEffect(() => {
    if (!referenceKey) return;
    const referenceClient = createBusinessScopeTrpcClient(business.merchantId);
    const referenceCurrent = () => current() && referenceLive.current === referenceKey;
    return startChannelReferenceRefresh({
      rows, refresh: false, isCurrent: referenceCurrent,
      lookup: (refresh, signal) => referenceClient.channelReference.lookup.query({ listInput: input, materialIds: rows.map(row => row.id), refresh }, { signal }),
      onData: value => { if (referenceCurrent()) setReferences({ key: referenceKey, items: value.items }); },
      onError: error => { if (referenceCurrent()) { setReferences({ key: referenceKey, items: [] }); latest.current.onAuthorizationError(error); } },
      onBusy: () => undefined, onStopped: () => undefined,
    });
  }, [referenceKey]);

  // Public editing shares the Host's modal, form validation and manual-price
  // contract. CRM/source grants remain server-owned and are rechecked at every step.
  const [editor, setEditor] = useState<SupplyOutputs["getTeamMaterialForEdit"] | null>(null);
  const [editorKey, setEditorKey] = useState("");
  const [form, setForm] = useState<MaterialForm>(() => materialFormFrom({ channelId: null, partNumber: "", brand: "", qty: null, dateCode: null, price: null, taxIncluded: null, leadTime: null } as SupplyOutputs["getTeamMaterialForEdit"]));
  const [manualDraft, setManualDraft] = useState(() => manualReferenceDraftFrom({}));
  const [confirmation, setConfirmation] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const editRequest = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const update = trpc.channelInventory.updateTeamMaterial.useMutation();
  const editingId = visiblePanel?.kind === "edit" && panelRow && access(panelRow) ? panelRow.id : undefined;
  const editingKey = editingId === undefined ? "" : JSON.stringify([key, generation, editingId]);
  const editingLive = useRef(editingKey); editingLive.current = editingKey;
  const editCurrent = () => Boolean(editingKey && editingLive.current === editingKey && panelCurrent());
  const closeEdit = () => { if (editCurrent() && !unresolvedEdit()) setPanel(null); };
  useEffect(() => {
    const request = ++editRequest.current;
    setEditor(null); setEditMessage(""); setEditBusy(false); setRetryLocked(false);
    frozen.current = null; editPending.current = false;
    if (editingId === undefined) return;
    const controller = new AbortController();
    const valid = () => !controller.signal.aborted && editRequest.current === request && editCurrent();
    void utils.client.channelInventory.getTeamMaterialForEdit.query({ ...context, id: editingId }, { signal: controller.signal }).then(detail => {
      if (!valid()) return;
      if (detail.id !== editingId || !channelInventoryMaterialEditGranted(detail)) throw new Error("库存编辑范围或写权限未能确认，请刷新后重试。");
      setEditor(detail); setEditorKey(editingKey); setForm(materialFormFrom(detail)); setManualDraft(manualReferenceDraftFrom(detail)); setConfirmation("");
    }).catch(error => { if (valid()) { latest.current.onAuthorizationError(error); setEditMessage(errorMessage(error, "库存详情读取失败。")); } });
    return () => { controller.abort(); editRequest.current++; };
  }, [editingKey]);
  useEffect(() => {
    // Unknown receipts keep the original UUID/payload. Only a confirmed outcome
    // (or the existing permitted close) releases an ordinary deferred reread.
    if (!editBusy && !retryLocked && !unresolvedEdit() && deferredRefresh.current && current()) void refresh();
  }, [editBusy, retryLocked, editingKey, key]);
  useEffect(() => {
    if (!editor || !editingKey) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [editor, editingKey]);
  const retentionKey = editor ? manualReferenceRetentionKey(editor, form, manualDraft) : "";
  const submitEdit = async () => {
    if (!editCurrent() || !editor || editorKey !== editingKey || !channelInventoryMaterialEditGranted(editor) || editPending.current) return;
    const validation = validateMaterialForm(form, false);
    if (!frozen.current) validation.push(...manualReferenceValidation(manualDraft));
    if (validation.length) { setEditMessage(validation.join("；")); return; }
    if (!frozen.current && retentionKey && confirmation !== retentionKey) return;
    const body = materialInputFromForm(form);
    const payload = frozen.current ?? { ...context, id: editor.id, expectedRevision: editor.revision, requestId: createRequestId(),
      partNumber: body.partNumber, brand: body.brand, qty: body.qty, dateCode: body.dateCode, price: body.price,
      taxIncluded: body.taxIncluded, leadTime: body.leadTime, ...manualReferencePatch(editor, manualDraft) };
    frozen.current = payload;
    const request = editRequest.current;
    const valid = () => editCurrent() && request === editRequest.current;
    editPending.current = true; setEditBusy(true); setEditMessage("");
    try {
      await update.mutateAsync(payload);
    } catch (error) {
      if (!valid()) return;
      latest.current.onAuthorizationError(error);
      if (definitiveWriteFailure(error)) { frozen.current = null; setRetryLocked(false); setEditMessage(errorMessage(error, "库存保存失败，请刷新后重试。")); }
      else { setRetryLocked(true); setEditMessage("保存结果未确认。公共资料已锁定，请按原请求重试，不会重复修改库存。"); }
      return;
    } finally { if (valid()) { editPending.current = false; setEditBusy(false); } }
    if (!valid()) return;
    // A confirmed write is finished before refresh. Neither a rejected cache
    // invalidation nor a failed list reread may freeze/retry this saved UUID.
    frozen.current = null; setRetryLocked(false); setPanel(null);
    const settleRefresh = (action: () => unknown): Promise<unknown> => {
      try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
    };
    // Invalidate only this proven actor/enterprise, including main-Host list
    // variants. A late receipt must never invalidate the next identity's cache.
    await Promise.allSettled([
      settleRefresh(() => utils.channelInventory.listTeamMaterials.invalidate(context)),
      settleRefresh(refresh),
    ]);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); if (!current() || unresolvedEdit()) return;
    const next = { partNumber: draft.partNumber.normalize("NFKC").trim(), brand: draft.brand.trim() };
    setFilters(next); setPage(1);
    if (page === 1 && next.partNumber === filters.partNumber && next.brand === filters.brand) void refresh();
  };
  const loading = readable && (query.key !== key || query.loading);
  const error = readable && query.key === key ? query.error : undefined;
  return <section className="ci-page ci-host ci-panel ci-flat-view customer-channel-inventory" aria-label="客户渠道库存列表">
    <form className="ci-toolbar" onSubmit={submit}>
      <label className="ci-field ci-toolbar-search"><span className="ci-filter-label">型号</span><input aria-label="筛选客户库存型号" placeholder="搜索型号" maxLength={128} value={draft.partNumber} onChange={event => setDraft(value => ({ ...value, partNumber: event.target.value }))} /></label>
      <label className="ci-field ci-brand-input"><span className="ci-filter-label">品牌</span><input aria-label="筛选客户库存品牌" placeholder="搜索品牌" maxLength={64} value={draft.brand} onChange={event => setDraft(value => ({ ...value, brand: event.target.value }))} /></label>
      <button type="submit" className="ci-button ci-primary" disabled={!readable || editBusy || retryLocked}>搜索</button>
      <button type="button" className="ci-button" disabled={!readable || editBusy || retryLocked} onClick={() => void refresh()}>刷新库存</button>
      <span className="ci-filter-count">{result ? `${result.total} 条库存 · ${result.bindingCount} 个已确认可读渠道` : loading ? "正在读取库存条数…" : "库存条数不可用"}</span>
    </form>
    <div className="ci-tablewrap ci-compact-tablewrap"><table className="ci-table ci-compact-stock-table ci-stock-edit-table admin-table-readable customer-channel-inventory-table" style={{ "--ci-stock-min-width": `${columnLayout.minWidth}px` } as React.CSSProperties}>
      <colgroup>{columnLayout.visible.map(column => <col key={column.id} data-column={column.id} style={{ width: column.width }} />)}</colgroup>
      <thead><tr><th className="ci-material-part-col">型号</th><th className="ci-material-brand-col">品牌</th><th className="ci-material-recorder-col">负责人</th><th className="ci-material-source-col" title="已确认关联的 CRM 客户；与公共渠道参考独立">来源客户</th><th className="ci-material-qty-col">可供数量</th><th className="ci-material-price-col">报价 CNY</th><th className="ci-material-reference-col" title="立创商城公共网页参考">渠道参考一</th><th className="ci-material-reference-col" title="云汉芯城公共网页参考">渠道参考二</th><th className="ci-col-actions">操作</th></tr></thead>
      <tbody>
        {!readable ? <tr><td colSpan={9} className="ci-empty">正在核验客户库存读取权限…</td></tr> : loading ? <tr><td colSpan={9} className="ci-empty">正在读取客户渠道库存…</td></tr> : error ? <tr><td colSpan={9} className="ci-empty ci-host-error" role="alert">{error}</td></tr> : !result ? <tr><td colSpan={9} className="ci-empty">客户库存范围尚未确认。</td></tr> : result.bindingCount === 0 ? null : !rows.length ? <tr><td colSpan={9} className="ci-empty">已确认绑定渠道暂无符合筛选条件的库存。</td></tr> : null}
        {rows.map(row => {
          const granted = channelInventoryMaterialAccess(row, materialContext);
          return <tr key={row.id}>
            <td className="ci-material-part-col"><ChannelInventoryCopyPartNumber partNumber={row.partNumber} resetKey={key} /></td>
            <td className="ci-material-brand-col" title={row.brand}>{row.brand || "—"}</td>
            <td className="ci-material-recorder-col admin-cell-primary" title={row.originalRecorderName ?? "待核实"}>{row.originalRecorderName ?? "待核实"}</td>
            <td className="ci-material-source-col"><ChannelInventoryCustomerSource material={row} contextVerified={granted} /></td>
            <td className="ci-number ci-material-qty-col admin-cell-primary">{row.qty === null ? "待确认" : row.qty.toLocaleString("zh-CN")}</td>
            <td className="ci-price ci-material-price-col admin-cell-primary">{row.price === null ? "面议" : `¥${row.price}`}{typeof row.taxIncluded === "boolean" ? <small className="ci-subtext admin-cell-secondary">{row.taxIncluded ? "含税" : "未税"}</small> : null}</td>
            <td className="ci-material-reference-col" data-reference-source="lcsc"><ChannelReferenceCell key={referenceKey} source="lcsc" partNumber={row.partNumber} manualPrice={row.manualReferenceLcsc} quote={currentReferences.get(row.id)?.lcsc} /></td>
            <td className="ci-material-reference-col" data-reference-source="ickey"><ChannelReferenceCell key={referenceKey} source="ickey" partNumber={row.partNumber} manualPrice={row.manualReferenceIckey} quote={currentReferences.get(row.id)?.ickey} /></td>
            <td className="ci-col-actions"><div className="ci-row-actions"><button type="button" className="ci-inline-link ci-edit-entry" aria-label={`编辑库存：${row.partNumber}`} disabled={!granted || editBusy || retryLocked} title={granted ? "编辑公共库存，可补全型号和品牌" : "只读：当前库存编辑与来源客户授权不可用"} onClick={() => open(row.id, "edit")}>编辑</button><CustomerInventoryMore row={row} granted={granted} locked={editBusy || retryLocked} nativeNote={nativeNote} publishing={publishing.action(row)} open={open} /></div></td>
          </tr>;
        })}
      </tbody>
    </table></div>
    {result ? <nav className="ci-pagination" aria-label="客户渠道库存分页"><span>共 {result.total} 条，第 {page} / {Math.max(1, result.pageCount)} 页</span><button type="button" className="ci-button" disabled={page <= 1 || editBusy || retryLocked} onClick={() => { if (current() && !unresolvedEdit()) setPage(value => value - 1); }}>上一页</button><button type="button" className="ci-button" disabled={page >= Math.max(1, result.pageCount) || editBusy || retryLocked} onClick={() => { if (current() && !unresolvedEdit()) setPage(value => value + 1); }}>下一页</button></nav> : null}
    {publishing.dialog}
    {visiblePanel && panelRow && visiblePanel.kind === "source" && access(panelRow) ? <ChannelInventorySourcePanel key={`${key}:source:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} scopeKey={scopeKey} active={readable && materialContext} isCurrent={panelCurrent} onClose={() => setPanel(null)} onAuthorizationError={props.onAuthorizationError} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "notes" ? <CollaborationNotesPanel key={`${key}:notes:${panelRow.id}`} materialId={panelRow.id} partNumber={panelRow.partNumber} brand={panelRow.brand} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} canWriteNote={nativeNote} canAddNote={nativeNote && panelRow.canAddNote} isCurrent={panelCurrent} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
    {visiblePanel && panelRow && visiblePanel.kind === "private" && panelRow.isMine && nativeNote ? <PrivateNotesPanel key={`${key}:private:${panelRow.id}`} materialId={panelRow.id} enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} isCurrent={() => panelCurrent() && liveRows.current.find(row => row.id === panelRow.id)?.isMine === true} onClose={() => setPanel(null)} onComplete={() => void refresh()} /> : null}
    {editingKey && editCurrent() ? editor && editorKey === editingKey ? <MaterialEditPanel key={editingKey} mode="edit" form={form} setForm={setForm} onIdentityChange={() => setConfirmation("")}
      busy={editBusy} retryLocked={retryLocked} channels={[]} nativeNote={nativeNote} dialogRef={dialogRef}
      context={context} scopeKey={scopeKey} isCurrent={editCurrent} message={editMessage} onClose={closeEdit} onSubmit={() => void submitEdit()}
      onKeyDown={event => {
        if (event.key === "Escape" && !unresolvedEdit() && !retryLocked && editCurrent()) { event.preventDefault(); closeEdit(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      manualFields={<ChannelInventoryManualReferenceFields draft={manualDraft} partNumber={editor.partNumber}
        autoReferences={rows.some(row => row.id === editor.id && row.partNumber === editor.partNumber && row.brand === editor.brand) ? currentReferences.get(editor.id) : undefined}
        locked={editBusy || retryLocked} retentionRequired={Boolean(retentionKey)} retentionConfirmed={Boolean(retentionKey && confirmation === retentionKey)}
        onChange={(field, value) => { if (!editCurrent() || unresolvedEdit() || retryLocked) return; setManualDraft(previous => ({ ...previous, [field]: { value, edited: true } })); setConfirmation(""); }}
        onConfirm={confirmed => { if (editCurrent() && !unresolvedEdit() && !retryLocked) setConfirmation(confirmed ? retentionKey : ""); }} />}
    /> : <div className="ci-modal-backdrop" role="presentation"><section className="ci-host-dialog ci-host-material-dialog" role="dialog" aria-modal="true" aria-label="编辑渠道库存"><header><h2>编辑渠道库存</h2><button type="button" className="ci-icon-close" aria-label="关闭库存编辑" onClick={closeEdit}>×</button></header><p className={editMessage ? "ci-error" : "ci-empty"} role={editMessage ? "alert" : "status"}>{editMessage || "正在读取库存编辑权限…"}</p></section></div> : null}
  </section>;
}

/** Keep the Host's compact edit/more row; existing customer actions retain their
 * parent onAction guard and source is never offered on a canViewSource hint alone. */
function CustomerInventoryMore({ row, granted, locked, nativeNote, publishing, open }: {
  row: SupplyOutputs["listTeamMaterials"]["items"][number];
  granted: boolean;
  locked: boolean;
  nativeNote: boolean;
  publishing: React.ReactElement<{ children?: React.ReactNode; disabled?: boolean }>;
  open: (id: number, kind: Panel["kind"]) => void;
}) {
  const publishActions = publishing.type === React.Fragment ? publishing.props.children : publishing;
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button type="button" className="ci-inline-link" disabled={locked} aria-label={`更多库存操作：${row.partNumber}`}>更多</button></DropdownMenuTrigger>
    <DropdownMenuContent className="ci-channel-actions-menu ci-material-actions-menu" align="end" onCloseAutoFocus={event => {
      const dialog = document.querySelector<HTMLElement>('.customer-channel-inventory [role="dialog"]');
      if (!dialog) return;
      event.preventDefault();
      const focused = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement) ? document.activeElement : null;
      setTimeout(() => {
        if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
        (focused?.isConnected ? focused : dialog.querySelector<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? dialog).focus({ preventScroll: true });
      }, 0);
    }}>
      {React.Children.map(publishActions, action => React.isValidElement<{ disabled?: boolean }>(action) ? <DropdownMenuItem asChild disabled={action.props.disabled}>{action}</DropdownMenuItem> : null)}
      <DropdownMenuItem onSelect={() => open(row.id, "notes")}>备注（{row.noteCount}）</DropdownMenuItem>
      {row.isMine && nativeNote ? <DropdownMenuItem aria-label={`本人备注：${row.partNumber}`} onSelect={() => open(row.id, "private")}>本人备注</DropdownMenuItem> : null}
      {granted ? <DropdownMenuItem onSelect={() => open(row.id, "source")}>查看来源</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
