import React, { useEffect, useRef, useState } from "react";
import { zipSync } from "fflate";
import { trpc } from "../../../../../api/business-trpc";
import { customerUploadDownloadSchema, customerUploadHistoryListSchema } from "../../../../shared/customerUploadHistory";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../channelInventory/bridge";
import { batchUploadDialogStyle } from "../channelInventory/BatchUpload";
import type { SupplyIdentity } from "./customerSupply";
import { downloadedFile, savePrivateFile, type History, type HistoryDetail } from "./customerUploadHistory";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { CustomerUploadFailuresDialog } from "./CustomerUploadFailuresDialog";
import { inventoryRequestId } from "../channelInventory/management";
import { definitiveWriteFailure } from "../../pages/ChannelInventoryHost";
import "./CustomerUploadHistory.css";

type Props = { customerId: number; identity: SupplyIdentity; isCurrent: () => boolean; onClose: () => void; onComplete: () => void; onViewBatch?: (id: number) => void; onAuthorizationError: (error: unknown) => void };
export function CustomerUploadHistoryDialog(props: Props) {
  return <HistorySession key={`${props.identity.key}:${props.customerId}`} {...props} />;
}
function HistorySession(props: Props) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [items, setItems] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [tab, setTab] = useState<"original" | "content">("original");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [continuing, setContinuing] = useState<{ detail: HistoryDetail; file?: File } | null>(null);
  const [failureDetail, setFailureDetail] = useState<HistoryDetail | null>(null);
  const [deleteReview, setDeleteReview] = useState<{ historyId: string; batchId: number; revision: number; eligible: number; conflicts: number; failed: number; requestId: string; locked: boolean } | null>(null);
  const deleteFrozen = useRef<typeof deleteReview>(null);
  const actionRunning = useRef(false);
  const mounted = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const listSerial = useRef(0);
  const previewSerial = useRef(0);
  const previewRequest = useRef<AbortController | null>(null);
  const downloadRunning = useRef(false);
  const latest = useRef(props); latest.current = props;
  const current = () => mounted.current && latest.current.isCurrent();
  const expected = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  const controller = () => { const c = new AbortController(); requests.current.add(c); return c; };
  const message = (e: unknown) => e instanceof Error ? e.message : "读取失败，请重试";
  const isMissing = (e: unknown) => /原文件.*(?:不存在|丢失|缺失|不可用)|文件.*(?:不存在|丢失|缺失)|FILE_NOT_FOUND|NoSuchKey/i.test(message(e));
  const report = (e: unknown) => { if (current()) { latest.current.onAuthorizationError(e); setError(message(e)); } };
  const cancelPreview = () => {
    previewSerial.current++; previewRequest.current?.abort(); previewRequest.current = null;
    setPreviewId(null); setDetail(null); setPreviewLoading(false); setPreviewError("");
  };
  const close = () => {
    if (actionRunning.current || deleteFrozen.current?.locked) return;
    listSerial.current++; previewSerial.current++; requests.current.forEach(c => c.abort());
    latest.current.onClose();
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; listSerial.current++; previewSerial.current++; requests.current.forEach(c => c.abort()); };
  }, []);
  useEffect(() => {
    const token = ++listSerial.current;
    const c = controller();
    setLoading(true); setItems([]); setSelected([]); setPage(0); setError(""); cancelPreview();
    const read = async () => {
      try {
        const rows = new Map<string, History>();
        const seen = new Set<string>();
        let cursor: string | null = null;
        do {
          const input = customerUploadHistoryListSchema.parse({ ...expected, customerId: props.customerId, view: "mine", ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), ...(cursor ? { cursor } : {}), pageSize: 50 });
          const result = await utils.client.channelInventory.customerUploadHistoryList.query(input, { signal: c.signal });
          if (!current() || c.signal.aborted || token !== listSerial.current) return;
          for (const item of result.items) {
            if (item.customerId !== props.customerId) throw new Error("上传记录归属不匹配");
            rows.set(item.historyId, item);
          }
          cursor = result.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error("读取未完成，请刷新重试");
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (current() && token === listSerial.current) setItems(Array.from(rows.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.historyId.localeCompare(a.historyId)));
      } catch (e) { if (!c.signal.aborted && token === listSerial.current) report(e); }
      finally { requests.current.delete(c); if (current() && token === listSerial.current) setLoading(false); }
    };
    // Debounce date changes; keyword filtering uses the complete authorised customer list.
    const timer = setTimeout(() => void read(), dateFrom || dateTo ? 250 : 0);
    return () => { clearTimeout(timer); c.abort(); requests.current.delete(c); };
  }, [dateFrom, dateTo, refresh]);
  useEffect(() => { setPage(0); setSelected([]); }, [search]);
  const openPreview = async (historyId: string) => {
    if (!current() || loading) return;
    previewRequest.current?.abort();
    const token = ++previewSerial.current; const c = controller(); previewRequest.current = c;
    setPreviewId(historyId); setDetail(null); setPreviewLoading(true); setPreviewError(""); setTab("original"); setSheetIndex(0); setPreviewPage(0);
    try {
      const result = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId }, { signal: c.signal });
      if (!current() || c.signal.aborted || token !== previewSerial.current) return;
      if (result.history.historyId !== historyId || result.history.customerId !== props.customerId) throw new Error("上传记录归属不匹配");
      setDetail(result);
    } catch (e) {
      if (current() && !c.signal.aborted && token === previewSerial.current) {
        latest.current.onAuthorizationError(e); setPreviewError(isMissing(e) ? "原文件不可用" : message(e));
        if (isMissing(e)) setUnavailable(previous => Array.from(new Set([...previous, historyId])));
      }
    } finally { requests.current.delete(c); if (current() && token === previewSerial.current) setPreviewLoading(false); }
  };
  const readDetail = async (item: History) => {
    const value = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: item.historyId });
    if (!current()) throw new Error("当前会话已变化");
    if (value.history.historyId !== item.historyId || value.history.customerId !== props.customerId
      || (value.confirmation && value.confirmation.batch.customerId !== props.customerId)) throw new Error("上传记录归属不匹配");
    return value;
  };
  const viewBatch = async (item: History) => {
    if (!current() || actionRunning.current || deleteFrozen.current) return;
    actionRunning.current = true; setBusy(true); setError("");
    try { const value = await readDetail(item); if (value.confirmation) latest.current.onViewBatch?.(value.confirmation.batch.id); else setError("尚未导入物料"); }
    catch (e) { if (current()) report(e); }
    finally { actionRunning.current = false; if (current()) setBusy(false); }
  };
  const continueUpload = async (item: History) => {
    if (!current() || actionRunning.current || deleteFrozen.current || !item.capabilities.canConfirm) return;
    actionRunning.current = true; setBusy(true); setError("");
    try {
      const value = await readDetail(item);
      if (!value.history.capabilities.canConfirm) throw new Error("当前账号不能继续该批次");
      if (value.confirmation && (value.history.stats.repairableCount ?? 0) > 0) { setFailureDetail(value); return; }
      let file: File | undefined;
      if (!value.confirmation && !value.selectedVersion) {
        const downloaded = await utils.client.channelInventory.customerUploadDownload.mutate({ ...expected,
          files: [{ historyId: item.historyId, fileId: value.history.originalFile.fileId }], includeManifest: false });
        if (!current()) return;
        file = downloadedFile(downloaded);
      }
      if (current()) setContinuing({ detail: value, file });
    } catch (e) { if (current()) report(e); }
    finally { actionRunning.current = false; if (current()) setBusy(false); }
  };
  const prepareDelete = async (item: History) => {
    if (!current() || actionRunning.current || deleteFrozen.current) return;
    actionRunning.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const value = await readDetail(item);
      if (value.history.capabilities.canConfirm !== true || value.history.batchClosed === true) throw new Error("当前账号不能删除该批次");
      if (!value.confirmation) throw new Error("尚无已确认批次");
      const preview = await utils.client.channelInventory.previewDeleteUploadBatch.query({ ...expected, id: value.confirmation.batch.id });
      if (!current()) return;
      if (![preview.total, preview.eligibleCount, preview.conflictCount, preview.revision].every(Number.isSafeInteger)
        || preview.total < 0 || preview.eligibleCount < 0 || preview.conflictCount < 0 || preview.revision <= 0
        || preview.eligibleCount + preview.conflictCount !== preview.total) throw new Error("删除范围未能确认");
      const review = { historyId: item.historyId, batchId: value.confirmation.batch.id, revision: preview.revision,
        eligible: preview.eligibleCount, conflicts: preview.conflictCount,
        failed: (value.history.stats.repairableCount ?? value.history.stats.failedCount) + value.history.stats.pendingCount + value.history.stats.unknownCount,
        requestId: inventoryRequestId(), locked: false };
      deleteFrozen.current = review; setDeleteReview(review);
    } catch (e) { if (current()) report(e); }
    finally { actionRunning.current = false; if (current()) setBusy(false); }
  };
  const deleteBatch = async () => {
    const frozen = deleteFrozen.current;
    if (!frozen || !current() || actionRunning.current) return;
    actionRunning.current = true; setBusy(true); setError("");
    try {
      const receipt = await utils.client.channelInventory.deleteUploadBatch.mutate({ ...expected, id: frozen.batchId,
        expectedRevision: frozen.revision, requestId: frozen.requestId });
      if (!current() || deleteFrozen.current !== frozen) return;
      if (!Number.isSafeInteger(receipt.deletedCount) || !Number.isSafeInteger(receipt.skippedCount)
        || receipt.deletedCount < 0 || receipt.skippedCount < 0 || receipt.deletedCount + receipt.skippedCount !== frozen.eligible + frozen.conflicts) throw new Error("删除回执未能确认");
      deleteFrozen.current = null; setDeleteReview(null);
      setFeedback(receipt.skippedCount ? `已删除 ${receipt.deletedCount} 条，${receipt.skippedCount} 条已变更，未删除` : "已删除");
      latest.current.onComplete(); setRefresh(value => value + 1);
    } catch (e) {
      if (!current() || deleteFrozen.current !== frozen) return;
      latest.current.onAuthorizationError(e);
      if (definitiveWriteFailure(e)) { deleteFrozen.current = null; setDeleteReview(null); setError(message(e)); }
      else { const locked = { ...frozen, locked: true }; deleteFrozen.current = locked; setDeleteReview(locked); setError("删除结果待确认，请按原请求重试"); }
    } finally { actionRunning.current = false; if (current()) setBusy(false); }
  };
  const canDownload = (item: History) => item.capabilities.canDownload && !unavailable.includes(item.historyId);
  const download = async (files: History[]) => {
    if (!current() || downloadRunning.current || loading || !files.length || files.some(item => !canDownload(item))) return;
    if (files.length > 20 || files.reduce((sum, item) => sum + item.originalFile.byteSize, 0) > 10485760) { setError("每次最多下载20个文件，合计不超过10MB"); return; }
    const c = controller(); downloadRunning.current = true; setBusy(true); setError("");
    try {
      const archive: Record<string, Uint8Array> = Object.create(null);
      for (const item of files) {
        if (!current() || c.signal.aborted) return;
        const input = customerUploadDownloadSchema.parse({ ...expected, files: [{ historyId: item.historyId, fileId: item.originalFile.fileId }], includeManifest: false });
        const result = await utils.client.channelInventory.customerUploadDownload.mutate(input, { signal: c.signal });
        if (!current() || c.signal.aborted) return;
        const file = downloadedFile(result);
        if (files.length === 1) { savePrivateFile(result); return; }
        let name = file.name; let suffix = 2;
        const dot = file.name.lastIndexOf(".");
        while (Object.hasOwn(archive, name)) name = dot > 0 ? `${file.name.slice(0, dot)} (${suffix++})${file.name.slice(dot)}` : `${file.name} (${suffix++})`;
        archive[name] = new Uint8Array(await file.arrayBuffer());
      }
      if (!current() || c.signal.aborted) return;
      const bytes = zipSync(archive, { level: 6 });
      if (bytes.length > 10485760) throw new Error("下载包超过10MB，请减少所选文件");
      let raw = "";
      for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...Array.from(bytes.subarray(i, i + 32768)));
      savePrivateFile({ fileName: "上传文件.zip", mimeType: "application/zip", byteSize: bytes.length, base64: btoa(raw) });
    } catch (e) {
      if (!c.signal.aborted && current()) {
        latest.current.onAuthorizationError(e); setError(isMissing(e) ? "原文件不可用" : message(e));
        if (isMissing(e) && files.length === 1) setUnavailable(previous => Array.from(new Set([...previous, files[0].historyId])));
      }
    } finally { requests.current.delete(c); downloadRunning.current = false; if (current()) setBusy(false); }
  };
  if (!props.isCurrent()) return null;
  const keyword = search.trim().toLocaleLowerCase();
  const filtered = items.filter(item => !keyword || `${item.originalFile.fileName}\n${item.uploadedBy.displayName}`.toLocaleLowerCase().includes(keyword));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const activePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(activePage * 20, (activePage + 1) * 20);
  const selectedItems = filtered.filter(item => selected.includes(item.historyId) && canDownload(item));
  const selectable = visible.filter(canDownload);
  const previewItem = detail?.history ?? items.find(item => item.historyId === previewId);
  const sheet = detail?.originalSheets[sheetIndex];
  const previewRows = tab === "content" ? detail?.selectedVersion?.rows ?? [] : sheet?.rows ?? [];
  const previewPages = Math.max(1, Math.ceil(previewRows.length / 100));
  const activePreviewPage = Math.min(previewPage, previewPages - 1);
  const columnCount = Math.max(0, ...(sheet?.rows.map(row => row.cells.length) ?? []));
  const columnName = (index: number) => { let name = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; };
  const displayCells = (row: HistoryDetail["originalSheets"][number]["rows"][number]) => {
    const values = row.cells.map(value => value == null ? "" : String(value));
    try {
      const stored = JSON.parse(row.originalContent);
      if (!Array.isArray(stored?.evidence) || stored.rowNumber !== row.rowNumber) return values;
      for (const entry of stored.evidence) {
        if (!entry || typeof entry.cell !== "string") continue;
        const index = Array.from({ length: values.length }, (_, i) => `${columnName(i)}${row.rowNumber}`).indexOf(entry.cell);
        if (index < 0) continue;
        if (entry.formulaPresent) values[index] = typeof entry.formula === "string" && entry.formula ? `=${entry.formula}` : "[公式]";
        else if (typeof entry.formattedText === "string") values[index] = entry.formattedText;
      }
    } catch { /* Older manifests and CSV evidence retain their original cell text. */ }
    return values;
  };
  const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const date = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const toggleVisible = (checked: boolean) => setSelected(previous => checked ? Array.from(new Set([...previous, ...selectable.map(item => item.historyId)])) : previous.filter(id => !selectable.some(item => item.historyId === id)));
  if (failureDetail && current()) return <CustomerUploadFailuresDialog customerId={props.customerId} identity={props.identity} detail={failureDetail} isCurrent={current}
    onClose={() => { if (current()) { setFailureDetail(null); setRefresh(value => value + 1); } }}
    onComplete={() => { if (current()) latest.current.onComplete(); }} onAuthorizationError={props.onAuthorizationError} />;
  if (continuing && current()) return <CustomerSupplyUploadDialog customerId={props.customerId} identity={props.identity}
    initialFile={continuing.file} initialHistory={continuing.detail} isCurrent={current}
    onClose={() => { if (current()) { setContinuing(null); setRefresh(value => value + 1); } }}
    onComplete={() => { if (current()) latest.current.onComplete(); }} onAuthorizationError={props.onAuthorizationError} />;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="ci-dialog customer-upload-history" style={{ ...batchUploadDialogStyle, width: "min(1180px, calc(100vw - 24px))", maxWidth: "1180px" }} aria-describedby={undefined} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (previewId) { event.preventDefault(); cancelPreview(); } }}>
    <DialogHeader><DialogTitle>上传历史</DialogTitle></DialogHeader>
    <div className="history-toolbar">
      <input className="history-search" aria-label="搜索文件名或上传人" placeholder="搜索文件名 / 上传人" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="history-date-range"><input aria-label="上传起始日期" title="上传起始日期（北京时间）" type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} /><span>至</span><input aria-label="上传结束日期" title="上传结束日期（北京时间）" type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} /></div>
      <button type="button" className="history-secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新</button>
    </div>
    {deleteReview ? <section className="history-delete-review" role="alertdialog" aria-label="删除该批次？"><strong>删除该批次？</strong><p>将删除 {deleteReview.eligible} 条物料，关闭 {deleteReview.failed} 条待处理记录。</p>{deleteReview.conflicts ? <p>{deleteReview.conflicts} 条已变更，不会删除。</p> : null}<div className="history-row-actions"><button type="button" className="history-secondary" disabled={busy || deleteReview.locked} onClick={() => { if (!current() || actionRunning.current || deleteFrozen.current?.locked || deleteFrozen.current !== deleteReview) return; deleteFrozen.current = null; setDeleteReview(null); }}>取消</button><button type="button" className="history-secondary history-danger" disabled={busy} onClick={() => void deleteBatch()}>{busy ? "删除中…" : deleteReview.locked ? "按原请求重试" : "删除"}</button></div></section> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
    <div className="history-body">
      <div className="history-list-panel"><div className="history-scroll">
        <table className="history-list"><thead><tr><th className="history-check"><input type="checkbox" aria-label="选择本页文件" checked={selectable.length > 0 && selectable.every(item => selected.includes(item.historyId))} disabled={loading || busy || !selectable.length} onChange={e => toggleVisible(e.target.checked)} /></th><th>文件名称</th><th>上传时间</th><th>上传人</th><th>成功 / 失败</th><th>操作</th></tr></thead><tbody>{visible.map(item => <tr key={item.historyId} className={previewId === item.historyId ? "is-previewing" : undefined}>
          <td><input type="checkbox" aria-label={`选择文件${item.historyId}`} checked={selected.includes(item.historyId) && canDownload(item)} disabled={loading || busy || !canDownload(item)} onChange={e => setSelected(previous => e.target.checked ? Array.from(new Set([...previous, item.historyId])) : previous.filter(id => id !== item.historyId))} /></td>
          <td className="history-filename"><button type="button" className="history-link history-name" title={item.originalFile.fileName} disabled={loading} onClick={() => void openPreview(item.historyId)}>{item.originalFile.fileName}</button>{unavailable.includes(item.historyId) ? <span className="history-unavailable">原文件不可用</span> : null}</td>
          <td className="history-date">{date(item.createdAt)}</td><td className="history-uploader" title={item.uploadedBy.displayName}>{item.uploadedBy.displayName}</td><td className="history-size">{item.stats.successCount || item.stats.repairableCount || item.stats.failedCount ? `${item.stats.successCount} / ${item.stats.repairableCount ?? item.stats.failedCount}` : "—"}{item.stats.unknownCount ? <small>待确认 {item.stats.unknownCount}</small> : null}</td>
          <td><div className="history-row-actions"><button type="button" className="history-link" disabled={loading || busy || Boolean(deleteReview)} onClick={() => void viewBatch(item)}>查看物料</button>{item.capabilities.canConfirm && item.state !== "cancelled" && ((item.stats.repairableCount ?? 0) > 0 || item.stats.pendingCount > 0 || item.stats.unknownCount > 0 || !item.uploadBatch) ? <button type="button" className="history-link" disabled={loading || busy || Boolean(deleteReview)} onClick={() => void continueUpload(item)}>{(item.stats.repairableCount ?? 0) > 0 ? "处理失败" : "继续导入"}</button> : null}{item.uploadBatch && item.batchClosed === false && item.capabilities.canConfirm ? <button type="button" className="history-link history-danger" disabled={loading || busy || Boolean(deleteReview)} onClick={() => void prepareDelete(item)}>删除整批</button> : null}</div></td>
        </tr>)}</tbody></table>
        {loading ? <p className="history-empty" role="status">加载中…</p> : !visible.length && !error ? <p className="history-empty">{search || dateFrom || dateTo ? "无匹配文件" : "暂无上传记录"}</p> : null}
      </div>
      {error ? <p className="history-error" role="alert">{error}</p> : null}
      <div className="history-footer"><div className="history-selection">{selectedItems.length ? <><span>已选 {selectedItems.length} 项</span><button type="button" className="history-secondary" disabled={loading || busy} onClick={() => void download(selectedItems)}>下载所选</button></> : null}</div><div className="history-pagination"><span>共 {filtered.length} 条</span><button type="button" className="history-icon" aria-label="上一页" disabled={loading || activePage === 0} onClick={() => setPage(activePage - 1)}>‹</button><span>{activePage + 1} / {pageCount}</span><button type="button" className="history-icon" aria-label="下一页" disabled={loading || activePage >= pageCount - 1} onClick={() => setPage(activePage + 1)}>›</button></div></div></div>
      {previewId ? <section className="history-preview" aria-label="文件预览"><div className="history-preview-header"><strong title={previewItem?.originalFile.fileName}>{previewItem?.originalFile.fileName ?? "文件预览"}</strong><div className="history-row-actions"><button type="button" className="history-link" disabled={busy || !previewItem || !canDownload(previewItem)} onClick={() => previewItem && void download([previewItem])}>下载</button><button type="button" className="history-icon" aria-label="关闭预览" onClick={cancelPreview}>×</button></div></div>
        {detail?.selectedVersion?.rows.length ? <div className="history-tabs" role="tablist" aria-label="预览内容"><button type="button" role="tab" aria-selected={tab === "original"} onClick={() => { setTab("original"); setPreviewPage(0); }}>原文件</button><button type="button" role="tab" aria-selected={tab === "content"} onClick={() => { setTab("content"); setPreviewPage(0); }}>整理内容</button></div> : null}
        <div className="history-preview-scroll">{previewLoading ? <p className="history-empty" role="status">加载中…</p> : previewError ? <p className="history-error" role="alert">{previewError}</p> : tab === "original" ? sheet?.rows.length ? <table className="history-sheet"><thead><tr><th>#</th>{Array.from({ length: columnCount }, (_, index) => <th key={index}>{columnName(index)}</th>)}</tr></thead><tbody>{sheet.rows.slice(activePreviewPage * 100, (activePreviewPage + 1) * 100).map(row => { const cells = displayCells(row); return <tr key={row.rowNumber}><th>{row.rowNumber}</th>{Array.from({ length: columnCount }, (_, index) => <td key={index}>{cells[index] ?? ""}</td>)}</tr>; })}</tbody></table> : <p className="history-empty">暂不支持预览</p> : <table className="history-sheet"><thead><tr><th>型号</th><th>品牌</th><th>数量</th><th>价格</th><th>币种</th><th>备注</th></tr></thead><tbody>{detail?.selectedVersion?.rows.slice(activePreviewPage * 100, (activePreviewPage + 1) * 100).map(row => <tr key={row.rowId}><td>{row.candidate.partNumber ?? "—"}</td><td>{row.candidate.brand ?? "—"}</td><td>{row.candidate.qty ?? "—"}</td><td>{row.candidate.price ?? "—"}</td><td>{row.candidate.currency ?? "—"}</td><td>{row.candidate.note ?? ""}</td></tr>)}</tbody></table>}</div>
        {detail ? <div className="history-preview-footer">{tab === "original" && detail.originalSheets.length ? <select aria-label="预览工作表" value={sheetIndex} onChange={e => { setSheetIndex(Number(e.target.value)); setPreviewPage(0); }}>{detail.originalSheets.map((item, index) => <option key={item.sheetIndex} value={index}>{item.sheetName}</option>)}</select> : <span />}{previewPages > 1 ? <div className="history-pagination"><button type="button" className="history-icon" aria-label="预览上一页" disabled={activePreviewPage === 0} onClick={() => setPreviewPage(activePreviewPage - 1)}>‹</button><span>{activePreviewPage + 1} / {previewPages}</span><button type="button" className="history-icon" aria-label="预览下一页" disabled={activePreviewPage >= previewPages - 1} onClick={() => setPreviewPage(activePreviewPage + 1)}>›</button></div> : null}</div> : null}
      </section> : null}
    </div>
  </DialogContent></Dialog>;
}
