import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { customerUploadDownloadSchema, customerUploadHistoryListSchema, customerUploadManageMarkSchema, customerUploadResultSchema } from "../../../../shared/customerUploadHistory";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "../channelInventory/bridge";
import { batchUploadDialogStyle } from "../channelInventory/BatchUpload";
import { customerSupplySessionSuffix, type SupplyIdentity } from "./customerSupply";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { downloadedFile, fileInput, historyStates, parseResult, resultGuide, resultSubmission, savePrivateFile, uuid, type History, type HistoryDetail, type HistoryFile, type HistoryState, type ResultRow, type HistoryIssue } from "./customerUploadHistory";
import "./CustomerUploadHistory.css";

type Props = { customerId: number; identity: SupplyIdentity; isCurrent: () => boolean; onClose: () => void; onComplete: () => void; onAuthorizationError: (error: unknown) => void };
export function CustomerUploadHistoryDialog(props: Props) {
  return <HistorySession key={`${props.identity.key}:${props.customerId}`} {...props} />;
}
function HistorySession(props: Props) {
  const utils = trpc.useUtils();
  const [view, setView] = useState<"mine" | "management">("mine"); const [canManage, setCanManage] = useState(false);
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState(""); const [customerFilter, setCustomerFilter] = useState(""); const [uploader, setUploader] = useState(""); const [stateFilter, setStateFilter] = useState<HistoryState | "">("");
  const [items, setItems] = useState<History[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [detail, setDetail] = useState<HistoryDetail | null>(null); const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<HistoryDetail | null>(null); const [reviewFile, setReviewFile] = useState<File | undefined>(); const [reason, setReason] = useState(""); const [resultFile, setResultFile] = useState<File | null>(null); const [issuesFile, setIssuesFile] = useState<File | null>(null);
  const [resultRows, setResultRows] = useState<ResultRow[]>([]); const [resultIssues, setResultIssues] = useState<HistoryIssue[]>([]); const [dirty, setDirty] = useState(false);
  const mounted = useRef(true); const requests = useRef(new Set<AbortController>()); const generation = useRef(0); const detailSerial = useRef(0); const running = useRef(false);
  const latest = useRef(props); latest.current = props; const current = () => mounted.current && latest.current.isCurrent();
  const expected = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  type PendingOperation = { kind: "mark"; input: Parameters<typeof utils.client.channelInventory.customerUploadManageMark.mutate>[0] } | { kind: "result"; input: Parameters<typeof utils.client.channelInventory.customerUploadResult.mutate>[0] };
  const operationKey = `customer-upload-history-operation:${customerSupplySessionSuffix(props.identity, props.customerId)}`;
  const [initialOperation] = useState((): { pending: PendingOperation | null; blocked: boolean } => {
    try {
      const raw = sessionStorage.getItem(operationKey);
      if (!raw) return { pending: null, blocked: false };
      const stored = JSON.parse(raw);
      const input = stored.kind === "mark" ? customerUploadManageMarkSchema.parse(stored.input)
        : stored.kind === "result" ? customerUploadResultSchema.parse(stored.input) : null;
      if (!input || input.expectedEnterpriseId !== expected.expectedEnterpriseId || input.expectedActorUserId !== expected.expectedActorUserId) throw new Error("原操作身份不匹配");
      return { pending: stored.kind === "mark" ? { kind: "mark", input: customerUploadManageMarkSchema.parse(input) }
        : { kind: "result", input: customerUploadResultSchema.parse(input) }, blocked: false };
    } catch { return { pending: null, blocked: true }; }
  });
  const pending = useRef<PendingOperation | null>(initialOperation.pending);
  const recoveryBlocked = initialOperation.blocked;
  const controller = () => { const c = new AbortController(); requests.current.add(c); return c; };
  const fail = (error: unknown) => { if (current()) { latest.current.onAuthorizationError(error); setError(error instanceof Error ? error.message : "历史服务读取失败。"); } };
  const resetResult = () => { setResultFile(null); setIssuesFile(null); setResultRows([]); setResultIssues([]); setDirty(false); setReason(""); };
  const queryList = async (after?: string) => {
    const token = ++generation.current; const c = controller(); setLoading(true); setError("");
    try {
      const customerId = view === "mine" ? props.customerId : customerFilter ? Number(customerFilter) : undefined;
      const input = customerUploadHistoryListSchema.parse({ ...expected, view, ...(customerId ? { customerId } : {}), ...(uploader ? { uploadedByFrontUserId: Number(uploader) } : {}), ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), ...(stateFilter ? { states: [stateFilter] } : {}), ...(after ? { cursor: after } : {}), pageSize: 20 });
      const result = await utils.client.channelInventory.customerUploadHistoryList.query(input, { signal: c.signal });
      if (!current() || token !== generation.current) return;
      setItems(previous => after ? [...previous, ...result.items] : result.items); setCursor(result.nextCursor); setCanManage(result.canManage); if (!after) setSelected([]);
    } catch (error) { if (token === generation.current) fail(error); }
    finally { requests.current.delete(c); if (current() && token === generation.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; detailSerial.current++; requests.current.forEach(c => c.abort()); }; }, []);
  useEffect(() => { void queryList(); }, [view, refresh]);
  const openDetail = async (historyId: string, versionId?: string, reconcile = true) => {
    if (!current() || running.current) return;
    if ((dirty || pending.current) && !window.confirm("当前结果草稿或未知操作尚未完成。请先保存/核实；是否仅刷新原任务？")) return;
    if (pending.current && pending.current.input.historyId !== historyId) { setError("未知操作必须按原UUID核实，不能切换任务。"); return; }
    const token = ++detailSerial.current; const c = controller(); setLoading(true); setError("");
    try {
      let result = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId, ...(versionId ? { versionId } : {}) }, { signal: c.signal });
      if (!current() || token !== detailSerial.current) return;
      setDetail(result);
      if (reconcile && result.confirmation) {
        await utils.client.channelInventory.customerUploadReconcileBatch.mutate({ ...expected, historyId, confirmationId: result.confirmation.confirmationId, requestId: uuid() }, { signal: c.signal });
        if (!current() || token !== detailSerial.current) return;
        result = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId, ...(versionId ? { versionId } : {}) }, { signal: c.signal });
      }
      if (!current() || token !== detailSerial.current) return;
      setDetail(result); if (!pending.current) resetResult();
    } catch (error) { if (token === detailSerial.current) fail(error); }
    finally { requests.current.delete(c); if (current() && token === detailSerial.current) setLoading(false); }
  };
  const download = async (files: { historyId: string; fileId: string }[], includeManifest = false, bytes = 0) => {
    if (!current() || running.current) return;
    if (!files.length || files.length > 20 || bytes > 10485760) { setError("批量任务包最多20份原文件、合计10MiB；请减少勾选并明确分批下载。"); return; }
    const c = controller(); running.current = true; setBusy(true); setError("");
    try { const input = customerUploadDownloadSchema.parse({ ...expected, files, includeManifest }); const result = await utils.client.channelInventory.customerUploadDownload.mutate(input, { signal: c.signal }); if (current()) savePrivateFile(result); }
    catch (error) { fail(error); }
    finally { requests.current.delete(c); running.current = false; if (current()) setBusy(false); }
  };
  const runPending = async () => {
    const operation = pending.current; if (!operation || running.current || !current() || recoveryBlocked) return;
    const c = controller(); running.current = true; setBusy(true); setError("");
    try {
      // Freeze the full canonical operation before the first write; quota/storage failure is fail closed.
      try { sessionStorage.setItem(operationKey, JSON.stringify(operation)); }
      catch { throw new Error("浏览器无法保存原操作恢复记录，已阻止提交；请保留文件并检查存储权限或缩小结果文件。"); }
      if (operation.kind === "mark") await utils.client.channelInventory.customerUploadManageMark.mutate(operation.input, { signal: c.signal });
      else await utils.client.channelInventory.customerUploadResult.mutate(operation.input, { signal: c.signal });
      if (!current()) return;
      sessionStorage.removeItem(operationKey); pending.current = null; resetResult(); setRefresh(v => v + 1);
      running.current = false; await openDetail(operation.input.historyId, undefined, false);
    } catch (error) { fail(error); }
    finally { requests.current.delete(c); running.current = false; if (current()) setBusy(false); }
  };
  const mark = (action: "start_parsing" | "return_for_supplement" | "fail_parse" | "cancel") => {
    if (!detail || pending.current || !current() || recoveryBlocked) return;
    try { const input = customerUploadManageMarkSchema.parse({ ...expected, historyId: detail.history.historyId, expectedRevision: detail.history.revision, requestId: uuid(), action, reason: reason.trim() || null }); pending.current = { kind: "mark", input }; setDirty(true); void runPending(); }
    catch (error) { fail(error); }
  };
  const loadResult = async (file: File) => {
    if (!detail || running.current || pending.current || detail.confirmation || recoveryBlocked) return;
    const token = ++detailSerial.current; const historyId = detail.history.historyId; setBusy(true); running.current = true; setError("");
    try { const parsed = await parseResult(file, detail.originalSheets); if (!current() || token !== detailSerial.current || detail.history.historyId !== historyId) return; setResultFile(file); setResultRows(parsed.rows); setResultIssues(parsed.issues); setDirty(true); }
    catch (error) { fail(error); }
    finally { running.current = false; if (current() && token === detailSerial.current) setBusy(false); }
  };
  const submitResult = async () => {
    if (!detail || !resultFile || !resultRows.length || !current() || running.current || pending.current || detail.confirmation || !detail.history.capabilities.canUploadResult || recoveryBlocked) return;
    const token = detailSerial.current; running.current = true; setBusy(true); setError("");
    try {
      const normalizedFile = await fileInput(resultFile); const problemFile = issuesFile ? await fileInput(issuesFile) : undefined;
      if (!current() || token !== detailSerial.current) return;
      const result = resultSubmission(resultRows, resultIssues);
      const input = customerUploadResultSchema.parse({ ...expected, historyId: detail.history.historyId, expectedRevision: detail.history.revision, requestId: uuid(), parentVersionId: detail.history.latestVersionId, normalizedFile, ...(problemFile ? { issuesFile: problemFile } : {}), ...result });
      pending.current = { kind: "result", input }; running.current = false; await runPending();
    } catch (error) { fail(error); }
    finally { running.current = false; if (current()) setBusy(false); }
  };
  const close = () => {
    if (running.current) { setError("当前请求尚未结束，请等待并保留原操作UUID。"); return; }
    if ((dirty || pending.current) && !window.confirm(pending.current ? "服务端操作可能已提交，请记下任务UUID并核实原操作，不要重复回传。是否关闭？" : "尚有未保存的解析结果/原因草稿，是否关闭？")) return;
    props.onClose();
  };
  const guide = () => {
    if (!detail || !current()) return;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...resultGuide, taskNo: detail.history.historyId, originalFile: detail.history.originalFile, originalSheets: detail.originalSheets }, null, 2));
    let raw = ""; for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...Array.from(bytes.subarray(i, i + 32768)));
    savePrivateFile({ fileName: `任务-${detail.history.historyId}-来源与字段指南.json`, mimeType: "application/json", byteSize: bytes.length, base64: btoa(raw) });
  };
  const startReview = async () => {
    if (!detail?.history.capabilities.canConfirm || !current() || pending.current || running.current || recoveryBlocked) return;
    const c = controller(); setBusy(true); running.current = true;
    try { if (detail.confirmation) await utils.client.channelInventory.customerUploadReconcileBatch.mutate({ ...expected, historyId: detail.history.historyId, confirmationId: detail.confirmation.confirmationId, requestId: uuid() }, { signal: c.signal }); const fresh = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: detail.history.historyId }, { signal: c.signal }); if (!current()) return; if (!fresh.history.capabilities.canConfirm) throw new Error("服务端已撤销本账号确认资格。");
      let file: File | undefined;
      if (!fresh.confirmation && !fresh.selectedVersion && fresh.history.mode === "standard") {
        const bytes = await utils.client.channelInventory.customerUploadDownload.mutate({ ...expected, files: [{ historyId: fresh.history.historyId, fileId: fresh.history.originalFile.fileId }], includeManifest: false }, { signal: c.signal });
        if (!current()) return; file = downloadedFile(bytes);
      }
      setReviewFile(file); setReview(fresh); }
    catch (error) { fail(error); }
    finally { requests.current.delete(c); running.current = false; if (current()) setBusy(false); }
  };
  if (!props.isCurrent()) return null;
  if (review) return <CustomerSupplyUploadDialog initialFile={reviewFile} initialHistory={review} customerId={review.history.customerId} identity={props.identity} isCurrent={current} onClose={() => { setReview(null); void openDetail(review.history.historyId); }} onComplete={() => { props.onComplete(); setRefresh(v => v + 1); }} onAuthorizationError={props.onAuthorizationError} />;
  const selectedItems = items.filter(item => selected.includes(item.historyId));
  const fileRow = (file: HistoryFile | null | undefined, label: string) => file ? <div className="history-file"><span>{label}：{file.fileName}</span><small>{file.byteSize}字节 · {file.sha256.slice(0, 12)}</small><Button type="button" className="ci-button" disabled={busy || !detail?.history.capabilities.canDownload} onClick={() => detail && void download([{ historyId: detail.history.historyId, fileId: file.fileId }], false, file.byteSize)}>下载{label}</Button></div> : null;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="ci-dialog customer-upload-history" style={{ ...batchUploadDialogStyle, width: "min(1100px, calc(100vw - 24px))", maxWidth: "1100px" }} aria-describedby={undefined} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (running.current || dirty || pending.current) { event.preventDefault(); close(); } }}>
    <DialogHeader><DialogTitle>客户解析历史</DialogTitle></DialogHeader>
    {recoveryBlocked ? <p role="alert">原操作恢复记录无效或存储不可读取，已阻止全部新管理/结果/确认写入，请先核实原任务，不会清除或重建未知请求。</p> : null}
    {pending.current ? <p role="status">原操作待核实：任务 {pending.current.input.historyId}，操作UUID {pending.current.input.requestId}。关闭重开仍只允许原操作重试，不创建新结果版本。</p> : null}
    <div className="history-toolbar"><Button type="button" className="ci-button" aria-pressed={view === "mine"} disabled={busy || !!pending.current} onClick={() => { if (dirty && !window.confirm("保留当前任务草稿，仅切换列表？")) return; setView("mine"); }}>客户历史</Button>{canManage ? <Button type="button" className="ci-button" aria-pressed={view === "management"} disabled={busy || !!pending.current} onClick={() => setView("management")}>解析管理</Button> : null}<Button type="button" className="ci-button" disabled={loading || busy} onClick={() => setRefresh(v => v + 1)}>刷新历史</Button></div>
    <div className="history-filters"><label>起始日期（北京）<input aria-label="历史起始日期" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label><label>结束日期（北京）<input aria-label="历史结束日期" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>{view === "management" ? <><label>当前企业可读客户ID<input aria-label="管理客户ID" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} /></label><label>上传者前台ID<input aria-label="管理上传人ID" value={uploader} onChange={e => setUploader(e.target.value)} /></label></> : null}<label>状态<select aria-label="历史状态" value={stateFilter} onChange={e => setStateFilter(e.target.value as HistoryState | "")}><option value="">全部</option>{Object.entries(historyStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button type="button" className="ci-button" disabled={loading || busy} onClick={() => void queryList()}>筛选</Button></div>
    <div className="history-scroll">{loading ? <p role="status">正在按当前权限读取历史…</p> : null}
      <div className="history-actions"><Button type="button" className="ci-button" disabled={!selected.length || busy} onClick={() => void download(selectedItems.map(item => ({ historyId: item.historyId, fileId: item.originalFile.fileId })), true, selectedItems.reduce((n, item) => n + item.originalFile.byteSize, 0))}>批量下载原文件＋任务清单ZIP（{selected.length}）</Button><small>每批最多20份且原文件总计10MiB；ZIP/清单超限由服务端拒绝，请明确分批。</small></div>
      <table><thead><tr><th>选择</th><th>任务UUID／日期</th><th>客户／上传人</th><th>原文件／独立上传</th><th>状态／服务端统计</th><th>操作</th></tr></thead><tbody>{items.map(item => <tr key={item.historyId}><td><input type="checkbox" aria-label={`选择任务${item.historyId}`} checked={selected.includes(item.historyId)} disabled={!item.capabilities.canDownload || busy} onChange={e => setSelected(previous => e.target.checked ? [...previous, item.historyId] : previous.filter(id => id !== item.historyId))} /></td><td><code>{item.historyId}</code><br />{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td><td>{item.customerName} #{item.customerId}<br />{item.uploadedBy.displayName} #{item.uploadedBy.frontUserId}</td><td>{item.originalFile.fileName}<br />{item.mode === "parse" ? "解析上传" : "表格上传"} · 每次上传独立历史 · v{item.latestVersionNo}</td><td>{historyStates[item.state]}<br />成功{item.stats.successCount}／待核实{item.stats.unknownCount}／待确认{item.stats.pendingCount}</td><td><Button type="button" className="ci-button" disabled={busy} onClick={() => void openDetail(item.historyId)}>查看任务</Button></td></tr>)}</tbody></table>
      {!loading && !items.length ? <p>当前权限及筛选范围内暂无历史。</p> : null}{cursor ? <Button type="button" className="ci-button" disabled={loading || busy} onClick={() => void queryList(cursor)}>加载更多历史</Button> : null}
      {detail ? <section className="history-detail"><strong>任务UUID：<code>{detail.history.historyId}</code> · {historyStates[detail.history.state]} · revision {detail.history.revision}</strong>
        <p className="history-note">{detail.history.customerName} #{detail.history.customerId} · 上传人 {detail.history.uploadedBy.displayName} #{detail.history.uploadedBy.frontUserId} · {new Date(detail.history.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
        <div className="history-stats"><span>原行 {detail.history.stats.sourceRowCount ?? "待解析"}</span><span>结果 {detail.history.stats.resultRowCount}</span><span>待确认 {detail.history.stats.pendingCount}</span><span>排除 {detail.history.stats.excludedCount}</span><span>真实成功 {detail.history.stats.successCount}</span><span>未知 {detail.history.stats.unknownCount}</span><span>当前仍存 {detail.history.stats.remainingMaterialCount ?? "待核实"}</span></div>
        {fileRow(detail.history.originalFile, "原文件")}<label>结果版本<select aria-label="结果版本" value={detail.selectedVersion?.versionId ?? ""} disabled={busy || !!pending.current} onChange={e => void openDetail(detail.history.historyId, e.target.value || undefined)}><option value="">最新版本</option>{detail.versions.map(version => <option key={version.versionId} value={version.versionId}>版本{version.versionNo} · {version.createdAt}</option>)}</select></label>
        {fileRow(detail.selectedVersion?.normalizedFile, "整理结果")}{fileRow(detail.selectedVersion?.issuesFile, "问题清单")}
        {detail.selectedVersion ? <p className="history-note">原文件所有工作表均保留；结果来源覆盖{new Set(detail.selectedVersion.rows.flatMap(row => row.sourceRefs.map(ref => `${ref.sheetIndex}:${ref.rowNumber}`))).size}个原行。原表共{detail.originalSheets.reduce((n, sheet) => n + sheet.rows.length, 0)}行（含表头），未覆盖来源请人工核实；正式完成以本次候选确认/明确排除与真实回执为准，表头不猜作库存。</p> : null}
        {detail.selectedVersion ? <details className="history-issues"><summary>结果与待确认问题（{detail.selectedVersion.rows.length}行／{detail.selectedVersion.issues.length}项）</summary>{detail.selectedVersion.rows.map(row => <p key={row.rowId}><code>{row.rowId}</code> · {row.candidate.partNumber ?? "型号待补"}／{row.candidate.brand ?? "品牌待补"} · 数量{row.candidate.qty ?? "待确认"}／价格{row.candidate.price ?? "待确认"}／币种{row.candidate.currency ?? "待确认"}／含税{row.candidate.taxIncluded == null ? "待确认" : row.candidate.taxIncluded ? "是" : "否"}<br />来源：{row.sourceRefs.map(ref => `${ref.sheetName} #${ref.rowNumber}`).join("；")}<br />{row.issues.map(issue => `${issue.message}${issue.resolved ? `（已解决：${issue.resolution}）` : "（待确认）"}`).join("；")}</p>)}</details> : null}
        {detail.confirmation ? <p role="status">已有持久确认批次 {detail.confirmation.batch?.batchCode ?? "待核实"}（含unknown／成功）。请完成或核实原批次；禁止回传新版本、替换文件或生成新UUID。</p> : null}
        <div className="history-actions"><Button type="button" className="ci-button" disabled={busy} onClick={guide}>下载任务来源与字段指南</Button><Button type="button" className="ci-button ci-primary" disabled={busy || !!pending.current || !detail.history.capabilities.canConfirm || (!detail.selectedVersion && !detail.confirmation && detail.history.mode === "parse")} onClick={() => void startReview()}>{detail.confirmation ? "核实并恢复原批次" : "核对并上传"}</Button>{!detail.history.capabilities.canConfirm ? <small>当前账号不可正式确认；管理权限不允许冒充原上传者。</small> : null}</div>
        {(detail.history.capabilities.canManage || detail.history.capabilities.canCancel) ? <><label>管理操作原因（退回／失败／取消必填，最多1000字）<textarea aria-label="历史操作原因" maxLength={1000} value={reason} disabled={busy || !!pending.current} onChange={e => { setReason(e.target.value); setDirty(Boolean(e.target.value)); }} /></label><div className="history-actions">{detail.history.capabilities.canManage ? <><Button type="button" className="ci-button" disabled={busy || !!pending.current || !!detail.confirmation} onClick={() => mark("start_parsing")}>标记解析中</Button><Button type="button" className="ci-button" disabled={busy || !!pending.current || !!detail.confirmation} onClick={() => mark("return_for_supplement")}>退回补充</Button><Button type="button" className="ci-button" disabled={busy || !!pending.current || !!detail.confirmation} onClick={() => mark("fail_parse")}>标记解析失败</Button></> : null}{detail.history.capabilities.canCancel ? <Button type="button" className="ci-button" disabled={busy || !!pending.current || !!detail.confirmation} onClick={() => mark("cancel")}>取消任务</Button> : null}</div></> : null}
        {detail.history.capabilities.canUploadResult && !detail.confirmation ? <div><p>回传明确绑定任务：<code>{detail.history.historyId}</code>；整理表必须有标准列＋【原工作表】【原行号】【原内容】。所有候选先待确认，管理员不会直接入库；新版本保留旧文件。</p><label className="ci-field"><span>整理结果表（仅一张结果工作表）</span><input aria-label="回传整理结果" type="file" accept=".xlsx,.xls,.csv" disabled={busy || !!pending.current} onChange={e => { const file = e.target.files?.[0]; if (file) void loadResult(file); e.target.value = ""; }} /></label><label className="ci-field"><span>问题清单文件（可选CSV／Excel）</span><input aria-label="回传问题清单" type="file" accept=".xlsx,.xls,.csv" disabled={busy || !!pending.current} onChange={e => { setIssuesFile(e.target.files?.[0] ?? null); setDirty(true); e.target.value = ""; }} /></label>
          {resultRows.length ? <details className="history-issues" open><summary>回传候选 {resultRows.length} 行；问题 {resultIssues.length} 项</summary>{resultIssues.map(issue => <label className="ci-field" key={issue.issueId}><span>{issue.field}：{issue.message}</span><input aria-label={`问题解决依据${issue.issueId}`} maxLength={1000} placeholder="未核实留空；已核实填写依据" value={issue.resolution ?? ""} onChange={e => { const resolution = e.target.value; setResultIssues(previous => previous.map(item => item.issueId === issue.issueId ? { ...item, resolved: Boolean(resolution.trim()), resolution: resolution.trim() || null } : item)); setDirty(true); }} /></label>)}</details> : null}
          <Button type="button" className="ci-button ci-primary" disabled={busy || !!pending.current || !resultRows.length} onClick={() => void submitResult()}>按此任务UUID保存新结果版本</Button></div> : null}
      </section> : null}
      {error ? <p className="ci-error" role="alert">{error}</p> : null}{pending.current && !busy ? <Button type="button" className="ci-button" onClick={() => void runPending()}>按原操作UUID重试（不换版本／任务）</Button> : null}
    </div><div className="ci-dialog-footer"><Button type="button" className="ci-button" onClick={close}>关闭历史</Button></div>
  </DialogContent></Dialog>;
}
