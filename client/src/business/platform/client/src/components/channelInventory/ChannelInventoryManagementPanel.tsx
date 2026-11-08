import React, { useEffect, useRef, useState } from "react";
import { formatBeijingDateTime } from "../../../../shared/beijingTime";
import { DEFAULT_BATCH_LIST_STATE, type ChannelInventoryBatchListState } from "../../../../../../lib/channelInventoryNavigation";
import {
  deletableCurrentPage, inventoryDefinitiveFailure, inventoryError, inventoryRequestId,
  type DeletedMaterial, type DeleteMaterialRow, type InventoryContext,
  type InventoryManagementClient, type InventoryPage, type UploadBatchRecord,
} from "./management";
import "./management.css";

type ConfirmationProps = {
  title: string; children: React.ReactNode; busy: boolean; locked: boolean;
  disabled?: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel?: string;
};
export function InventoryConfirmation({ title, children, busy, locked, disabled, onCancel, onConfirm, confirmLabel = "确认" }: ConfirmationProps) {
  const dialog = useRef<HTMLElement>(null);
  const titleId = React.useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <div className="ci-modal-backdrop" role="presentation">
    <section ref={dialog} className="ci-host-dialog ci-management-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key === "Escape" && !busy && !locked) { event.preventDefault(); onCancel(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><div><h2 id={titleId}>{title}</h2></div><button type="button" className="ci-icon-close" aria-label="关闭确认" disabled={busy || locked} onClick={onCancel}>×</button></header>
      <div className="ci-dialog-scroll ci-management-content">{children}{locked ? <p className="ci-error" role="alert">结果尚未确认，请按原请求重试；不会另起请求重复操作。</p> : null}</div>
      <footer><button type="button" className="ci-button" disabled={busy || locked} onClick={onCancel}>取消</button><button type="button" className="ci-button ci-primary" disabled={busy || disabled} onClick={onConfirm}>{busy ? "处理中…" : locked ? "按原请求重试" : confirmLabel}</button></footer>
    </section>
  </div>;
}

type DeleteProps = {
  client: InventoryManagementClient; context?: InventoryContext; scopeKey: string;
  rows: readonly DeleteMaterialRow[]; canWrite: boolean; isCurrent: () => boolean;
  onComplete: () => Promise<unknown>; onAuthorizationError: (error: unknown) => void;
};
/** Selection is scoped synchronously to this page/filter/authority, not effect-only. */
export function useMaterialDeletion(props: DeleteProps) {
  const [selection, setSelection] = useState<{ key: string; ids: number[] }>({ key: props.scopeKey, ids: [] });
  const [pending, setPending] = useState<{ key: string; rows: DeleteMaterialRow[]; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props); latest.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSelection({ key: props.scopeKey, ids: [] }); setPending(null); setLocked(false); setBusy(false); setMessage(""); }, [props.scopeKey]);
  const eligible = deletableCurrentPage(props.rows, props.canWrite);
  const selected = selection.key === props.scopeKey ? eligible.filter(row => selection.ids.includes(row.id)) : [];
  const toggle = (id: number) => {
    if (busyRef.current || !eligible.some(row => row.id === id)) return;
    setSelection({ key: props.scopeKey, ids: selected.some(row => row.id === id) ? selected.filter(row => row.id !== id).map(row => row.id) : [...selected.map(row => row.id), id] });
  };
  const selectAll = () => {
    if (!busyRef.current) setSelection({ key: props.scopeKey, ids: selected.length === eligible.length ? [] : eligible.map(row => row.id) });
  };
  const requestDelete = (rows = selected) => {
    if (busyRef.current || !props.context || !props.isCurrent()) return;
    const allowed = rows.filter(row => eligible.some(item => item.id === row.id && item.revision === row.revision));
    if (!allowed.length || allowed.length > 100) return;
    setMessage(""); setLocked(false);
    setPending({ key: props.scopeKey, rows: allowed.map(row => ({ ...row })), requestId: inventoryRequestId() });
  };
  const confirm = async () => {
    const snapshot = pending;
    const origin = props;
    const current = () => mounted.current && latest.current.isCurrent() && latest.current.scopeKey === origin.scopeKey;
    if (!snapshot || busyRef.current || !origin.context || !origin.canWrite || !current()) return;
    if (!locked && snapshot.rows.some(row => !eligible.some(item => item.id === row.id && item.revision === row.revision))) {
      setPending(null); setMessage("选中库存的版本或删除权限已改变，请刷新后重新选择。"); return;
    }
    busyRef.current = true; setBusy(true);
    try {
      const result = await origin.client.deleteMaterials.mutate({ ...origin.context, items: snapshot.rows.map(row => ({ id: row.id, expectedRevision: row.revision })), requestId: snapshot.requestId });
      if (!current()) return;
      setPending(null); setLocked(false); setSelection({ key: origin.scopeKey, ids: [] });
      setMessage(`已移入回收站 ${result.deletedCount} 条，跳过 ${result.skippedCount} 条。${result.results.filter(row => !row.success && row.reason).map(row => `#${row.id}：${row.reason}`).join("；")}`);
      await origin.onComplete();
    } catch (error) {
      if (!current()) return;
      origin.onAuthorizationError(error);
      if (inventoryDefinitiveFailure(error)) {
        setPending(null); setLocked(false); setMessage(inventoryError(error)); await origin.onComplete();
      } else { setLocked(true); setMessage(inventoryError(error, "删除结果尚未确认。")); }
    } finally { busyRef.current = false; if (current()) setBusy(false); }
  };
  const activePending = pending?.key === props.scopeKey && props.canWrite ? pending : null;
  return {
    eligible, selected, toggle, selectAll, requestDelete, busy,
    cancelSelection: () => { if (!busyRef.current) setSelection({ key: props.scopeKey, ids: [] }); },
    toolbar: selected.length ? <div className="ci-toolbar ci-selection-toolbar" role="group" aria-label="当前页批量删除"><span>已选 {selected.length} 条</span><button type="button" className="ci-button ci-danger-link" disabled={busy} onClick={() => requestDelete()}>批量删除</button><button type="button" className="ci-button" disabled={busy} onClick={() => setSelection({ key: props.scopeKey, ids: [] })}>取消选择</button><span className="ci-readonly">仅当前页，不跨页选择</span></div> : null,
    feedback: message ? <p className="ci-readonly" role="status">{message}</p> : null,
    dialog: activePending ? <InventoryConfirmation title={activePending.rows.length === 1 ? "删除渠道库存" : "批量删除渠道库存"} busy={busy} locked={locked} onCancel={() => setPending(null)} onConfirm={() => void confirm()} confirmLabel={`移入回收站 ${activePending.rows.length} 条`}>
      <p>确认删除以下 {activePending.rows.length} 条库存吗？删除后进入回收站，可按权限恢复；不会删除关联渠道。</p>
      <ul>{activePending.rows.map(row => <li key={row.id}>{row.partNumber} · 可供数量：{row.qty === null ? "待确认" : row.qty.toLocaleString("zh-CN")}</li>)}</ul>
      {message ? <p className="ci-error" role="alert">{message}</p> : null}
    </InventoryConfirmation> : null,
  };
}

type PanelProps = {
  mode: "batches" | "trash"; client: InventoryManagementClient; context: InventoryContext;
  canWrite: boolean; isCurrent: () => boolean; onViewBatch: (id: number) => void;
  listState?: ChannelInventoryBatchListState; onListStateChange?: (state: ChannelInventoryBatchListState) => void;
  focusBatchId?: number; onClearBatchFocus?: () => void;
  onComplete: () => Promise<unknown>; onAuthorizationError: (error: unknown) => void;
};
type Action =
  | { kind: "rename"; batch: UploadBatchRecord; name: string; requestId: string }
  | { kind: "archive"; batch: UploadBatchRecord; requestId: string }
  | { kind: "deleteBatch"; batch: UploadBatchRecord; preview: { total: number; eligibleCount: number; conflictCount: number; revision: number }; requestId: string }
  | { kind: "restore"; material: DeletedMaterial; requestId: string };
export function ChannelInventoryManagementPanel(props: PanelProps) {
  const [localListState, setLocalListState] = useState<ChannelInventoryBatchListState>(DEFAULT_BATCH_LIST_STATE);
  const listState = props.listState ?? localListState;
  const { page, channelId, archived } = listState;
  const updateListState = (next: ChannelInventoryBatchListState) => { setLocalListState(next); props.onListStateChange?.(next); };
  const [reload, setReload] = useState(0);
  const key = JSON.stringify([props.context, props.mode, page, channelId, archived, props.focusBatchId, reload]);
  const [query, setQuery] = useState<{ key: string; loading: boolean; error?: string; batches?: InventoryPage<UploadBatchRecord>; trash?: InventoryPage<DeletedMaterial> }>({ key: "", loading: true });
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props); latest.current = props;
  const previewAbort = useRef<AbortController | null>(null);
  const liveKey = useRef(key); liveKey.current = key;
  const current = () => mounted.current && latest.current.isCurrent();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; previewAbort.current?.abort(); }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    const valid = () => current() && !abort.signal.aborted && liveKey.current === key;
    setQuery({ key, loading: true });
    const parsed = Number(channelId);
    if (channelId && (!/^\d+$/.test(channelId) || !Number.isSafeInteger(parsed) || parsed <= 0)) {
      setQuery({ key, loading: false, error: "渠道 ID 须为正整数。" }); return;
    }
    void (async () => {
      try {
        if (props.mode === "batches") {
          // The deployed router has no get-by-ID endpoint. Search only its
          // authorized list and expose the exact match, never a same-name batch.
          // Missing/hidden targets are intentionally indistinguishable.
          let result: InventoryPage<UploadBatchRecord>;
          if (props.focusBatchId !== undefined) {
            if (!Number.isSafeInteger(props.focusBatchId) || props.focusBatchId <= 0) throw new Error("批次 ID 无效，未定位其他批次。");
            let target: UploadBatchRecord | undefined;
            let nextPage = 1;
            let pageCount = 1;
            do {
              const found = await props.client.listUploadBatches.query({ ...props.context, page: nextPage, pageSize: 100, archived: undefined, channelId: undefined }, { signal: abort.signal });
              if (!valid()) return;
              if (!Array.isArray(found.items) || found.page !== nextPage || !Number.isSafeInteger(found.total) || found.total < 0) throw new Error("批次定位读取失败，未展示其他批次。");
              pageCount = Math.max(1, Math.ceil(found.total / 100));
              if (pageCount > 1000) throw new Error("批次定位范围过大，请返回上传批次列表筛选；未猜配历史记录。");
              target = found.items.find(item => item.id === props.focusBatchId);
              if (target) { result = { ...found, items: [target], total: 1, page: 1, pageSize: 100, pageCount: 1 }; break; }
              nextPage += 1;
            } while (nextPage <= pageCount);
            if (!target) throw new Error("来源批次不存在或当前不可查看，未定位其他批次。");
          } else {
            result = await props.client.listUploadBatches.query({ ...props.context, page, pageSize: 20, channelId: channelId ? parsed : undefined, archived: archived === "all" ? undefined : archived === "archived" }, { signal: abort.signal });
          }
          if (valid()) setQuery({ key, loading: false, batches: result! });
        } else {
          const result = await props.client.listDeletedMaterials.query({ ...props.context, page, pageSize: 20 }, { signal: abort.signal });
          if (valid()) setQuery({ key, loading: false, trash: result });
        }
      } catch (error) { if (valid()) { props.onAuthorizationError(error); setQuery({ key, loading: false, error: inventoryError(error, "列表读取失败。") }); } }
    })();
    return () => abort.abort();
  }, [key, props.mode, props.client, props.context, page, channelId, archived]);
  useEffect(() => {
    const refresh = () => { if (!busyRef.current) setReload(value => value + 1); };
    window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => { if (!props.canWrite) { setAction(null); setLocked(false); previewAbort.current?.abort(); } }, [props.canWrite]);
  const result = query.key === key && current() ? props.mode === "batches" ? query.batches : query.trash : undefined;
  const writable = props.canWrite && result?.canWrite !== false && result?.readOnly !== true && Boolean(result) && !query.error;
  const liveBatch = (batch: UploadBatchRecord) => query.key === key ? query.batches?.items.find(item => item.id === batch.id) : undefined;
  const canEditBatch = (batch: UploadBatchRecord) => writable && Boolean(liveBatch(batch)) && liveBatch(batch)?.canEdit !== false && liveBatch(batch)?.readOnly !== true;
  const canDeleteBatch = (batch: UploadBatchRecord) => writable && Boolean(liveBatch(batch)) && liveBatch(batch)?.canDelete !== false && liveBatch(batch)?.readOnly !== true;
  const canRestore = (material: DeletedMaterial) => writable && query.key === key && query.trash?.items.some(item => item.id === material.id && item.canRestore === true) === true;
  const preview = async (batch: UploadBatchRecord) => {
    if (!canDeleteBatch(batch) || busyRef.current || !current()) return;
    const originalKey = key;
    const abort = new AbortController(); previewAbort.current = abort;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await props.client.previewDeleteUploadBatch.query({ ...props.context, id: batch.id }, { signal: abort.signal });
      if (current() && !abort.signal.aborted && liveKey.current === originalKey && latest.current.canWrite) setAction({ kind: "deleteBatch", batch, preview: response, requestId: inventoryRequestId() });
    } catch (error) { if (current() && !abort.signal.aborted) { props.onAuthorizationError(error); setMessage(inventoryError(error, "整批删除预览失败。")); } }
    finally { busyRef.current = false; if (current()) setBusy(false); }
  };
  const openAction = (next: Action) => { if (!busyRef.current && current()) { setLocked(false); setMessage(""); setAction(next); } };
  const submit = async () => {
    const snapshot = action;
    if (!snapshot || busyRef.current || !writable || !current()) return;
    if (snapshot.kind === "rename" && (!snapshot.name.trim() || snapshot.name.trim().length > 128)) { setMessage("请输入 1 到 128 字的批次名称。"); return; }
    if (snapshot.kind === "restore" ? !canRestore(snapshot.material) : snapshot.kind === "deleteBatch" ? !canDeleteBatch(snapshot.batch) : !canEditBatch(snapshot.batch)) return;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      let detail = "操作已保存。";
      if (snapshot.kind === "restore") {
        await props.client.restoreMaterial.mutate({ ...props.context, id: snapshot.material.id, expectedRevision: snapshot.material.revision, requestId: snapshot.requestId });
        detail = "库存已恢复；不会自动恢复被禁用的共享。";
      } else if (snapshot.kind === "deleteBatch") {
        const response = await props.client.deleteUploadBatch.mutate({ ...props.context, id: snapshot.batch.id, expectedRevision: snapshot.preview.revision, requestId: snapshot.requestId });
        detail = `本批已移入回收站 ${response.deletedCount} 条，跳过 ${response.skippedCount} 条。关联渠道保留，本批后续上传已关闭。`;
      } else {
        await props.client.updateUploadBatch.mutate({ ...props.context, id: snapshot.batch.id, expectedRevision: snapshot.batch.revision, requestId: snapshot.requestId, ...(snapshot.kind === "rename" ? { name: snapshot.name.trim() } : { archived: !snapshot.batch.archived }) });
        detail = snapshot.kind === "rename" ? "批次名称已保存；库存未改变。" : snapshot.batch.archived ? "已取消归档；库存未改变。" : "批次已归档；库存未改变。";
      }
      if (!current()) return;
      setAction(null); setLocked(false); setMessage(detail); setReload(value => value + 1);
      await props.onComplete();
    } catch (error) {
      if (!current()) return;
      props.onAuthorizationError(error);
      if (inventoryDefinitiveFailure(error)) { setAction(null); setLocked(false); setReload(value => value + 1); await props.onComplete(); }
      else setLocked(true);
      setMessage(inventoryError(error));
    } finally { busyRef.current = false; if (current()) setBusy(false); }
  };
  const batches = query.key === key && current() ? query.batches?.items ?? [] : [];
  const trash = query.key === key && current() ? query.trash?.items ?? [] : [];
  const loading = query.key !== key || query.loading;
  const title = props.mode === "batches" ? "上传批次" : "回收站";
  const pageCount = Math.max(1, result?.pageCount ?? 1);
  const actionAllowed = action && (action.kind === "restore" ? canRestore(action.material) : action.kind === "deleteBatch" ? canDeleteBatch(action.batch) : canEditBatch(action.batch));
  return <section className="ci-panel" aria-label={`${title}管理列表`}>
    {props.focusBatchId !== undefined ? <div className="ci-supply-location"><span>精确定位来源批次 #{props.focusBatchId}</span><button type="button" className="ci-button" onClick={props.onClearBatchFocus}>返回上传批次列表</button></div> : null}
    <div className="ci-toolbar">
      {props.mode === "batches" && props.focusBatchId === undefined ? <><label className="ci-field ci-short-select"><span className="ci-filter-label">渠道 ID</span><input aria-label="筛选批次渠道 ID" inputMode="numeric" placeholder="渠道 ID" value={channelId} disabled={busy || locked} onChange={event => updateListState({ ...listState, channelId: event.target.value, page: 1 })} /></label><label className="ci-field ci-short-select"><span className="ci-filter-label">归档状态</span><select aria-label="筛选批次归档状态" value={archived} disabled={busy || locked} onChange={event => updateListState({ ...listState, archived: event.target.value as typeof archived, page: 1 })}><option value="active">未归档</option><option value="archived">已归档</option><option value="all">全部批次</option></select></label></> : null}
      <button type="button" className="ci-button" disabled={busy || locked} onClick={() => setReload(value => value + 1)}>刷新</button><span className="ci-filter-count">{result ? `${result.total} 条${title}` : loading ? "正在读取条数…" : "条数不可用"}</span>
    </div>
    <p className="ci-readonly">{props.mode === "batches" ? "命名和归档仅整理上传历史，不删除库存；整批删除需先核验当前可删除范围。" : "删除库存不会连带删除渠道；恢复不会自动重新启用原先禁用的共享。"}</p>
    {message ? <p className="ci-readonly" role="status">{message}</p> : null}
    <div className="ci-tablewrap"><table className={`ci-table admin-table-readable ${props.mode === "batches" ? "ci-upload-batches-table" : "ci-trash-table"}`}>
      <thead>{props.mode === "batches" ? <tr><th>文件 / 批次名称</th><th>批次编号</th><th>渠道</th><th>上传者</th><th>上传时间</th><th>关联行 / 未删除条数</th><th className="ci-col-actions">操作</th></tr> : <tr><th>型号 / 品牌</th><th>上传批次 ID</th><th>删除时间</th><th className="ci-col-actions">操作</th></tr>}</thead>
      <tbody>
        {loading ? <tr><td colSpan={props.mode === "batches" ? 7 : 4} className="ci-empty">正在读取{title}…</td></tr> : query.error ? <tr><td colSpan={props.mode === "batches" ? 7 : 4} className="ci-empty ci-host-error" role="alert">{query.error}</td></tr> : !result?.items.length ? <tr><td colSpan={props.mode === "batches" ? 7 : 4} className="ci-empty">暂无{title}记录。</td></tr> : null}
        {props.mode === "batches" ? batches.map(batch => <tr key={batch.id}><td><strong className="ci-cell-title admin-cell-primary">{batch.name || batch.fileName}</strong>{batch.name ? <small className="ci-subtext admin-cell-secondary">{batch.fileName}</small> : null}{batch.archived ? <small className="ci-subtext">已归档</small> : null}</td><td>{batch.batchCode}<small className="ci-subtext">ID：{batch.id}</small></td><td>{batch.channelName}</td><td>{batch.uploadedByName}</td><td className="ci-date">{formatBeijingDateTime(batch.createdAt) || "—"}</td><td>{batch.successCount} / {batch.remainingCount}<small className="ci-subtext">计划 {batch.totalRows} 条</small></td><td className="ci-col-actions"><div className="ci-row-actions ci-management-actions"><button type="button" className="ci-inline-link" disabled={busy || locked} onClick={() => props.onViewBatch(batch.id)}>查看库存</button>{canEditBatch(batch) ? <><button type="button" className="ci-inline-link" disabled={busy || locked} onClick={() => openAction({ kind: "rename", batch, name: batch.name ?? "", requestId: inventoryRequestId() })}>命名</button><button type="button" className="ci-inline-link" disabled={busy || locked} onClick={() => openAction({ kind: "archive", batch, requestId: inventoryRequestId() })}>{batch.archived ? "取消归档" : "归档"}</button></> : null}{canDeleteBatch(batch) ? <button type="button" className="ci-inline-link ci-danger-link" disabled={busy || locked} onClick={() => void preview(batch)}>整批删除</button> : null}</div></td></tr>) : trash.map(material => <tr key={material.id}><td><strong className="ci-cell-title admin-cell-primary">{material.partNumber}</strong><small className="ci-subtext admin-cell-secondary">{material.brand}</small></td><td>{material.uploadBatchId ?? "—"}</td><td className="ci-date">{formatBeijingDateTime(material.deletedAt) || "—"}</td><td className="ci-col-actions">{writable && material.canRestore ? <button type="button" className="ci-inline-link" disabled={busy || locked} onClick={() => openAction({ kind: "restore", material, requestId: inventoryRequestId() })}>恢复</button> : <span className="ci-readonly">只读</span>}</td></tr>)}
      </tbody>
    </table></div>
    <nav className="ci-pagination" aria-label={`${title}分页`}><span>{result ? `共 ${result.total} 条，第 ${props.focusBatchId === undefined ? page : 1} / ${pageCount} 页` : loading ? "正在读取分页…" : "分页条数不可用"}</span><button type="button" className="ci-button" disabled={busy || locked || !result || props.focusBatchId !== undefined || page <= 1} onClick={() => updateListState({ ...listState, page: page - 1 })}>上一页</button><button type="button" className="ci-button" disabled={busy || locked || !result || props.focusBatchId !== undefined || page >= pageCount} onClick={() => updateListState({ ...listState, page: page + 1 })}>下一页</button></nav>
    {action && actionAllowed ? <InventoryConfirmation title={action.kind === "rename" ? "命名上传批次" : action.kind === "archive" ? action.batch.archived ? "取消归档" : "归档上传批次" : action.kind === "restore" ? "恢复渠道库存" : "整批删除渠道库存"} busy={busy} locked={locked} onCancel={() => { setAction(null); setMessage(""); }} onConfirm={() => void submit()} confirmLabel={action.kind === "deleteBatch" ? "确认整批删除" : action.kind === "restore" ? "确认恢复" : "保存"}>
      {action.kind === "rename" ? <><p>批次 {action.batch.batchCode}；仅修改历史名称，不影响库存。</p><label className="ci-field"><span>批次名称</span><input aria-label="批次名称" maxLength={128} value={action.name} disabled={busy || locked} onChange={event => setAction({ ...action, name: event.target.value })} /></label></> : action.kind === "archive" ? <p>确认{action.batch.archived ? "取消归档" : "归档"}批次“{action.batch.name || action.batch.batchCode}”？仅整理上传历史，不删除库存。</p> : action.kind === "restore" ? <p>确认恢复型号“{action.material.partNumber}”（{action.material.brand}）？不会自动恢复被禁用的共享。</p> : <><p>批次“{action.batch.name || action.batch.batchCode}”当前共 {action.preview.total} 条库存，可删除 {action.preview.eligibleCount} 条，冲突 / 无权删除 {action.preview.conflictCount} 条。</p><p>按本次预览版本确认；仅符合条件的库存进入回收站，不删除渠道，并关闭本批后续上传。提交前发生变化时需重新预览。</p>{!action.preview.eligibleCount ? <p className="ci-error">当前删除 0 条库存；确认后仍将关闭本批后续上传，冲突库存保留。</p> : null}</>}
      {message ? <p className="ci-error" role="alert">{message}</p> : null}
    </InventoryConfirmation> : null}
  </section>;
}
