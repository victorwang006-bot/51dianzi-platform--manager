import React, { useEffect, useRef, useState } from "react";
import { trpc } from "../../../../../api/business-trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button } from "../channelInventory/bridge";
import { BatchUpload, batchUploadDialogStyle, type BatchUploadDialogControls, type CustomerConfirmRows, type FailureExportSource } from "../channelInventory/BatchUpload";
import { fields, mapGrid, suggestMapping, toPayload, type Draft } from "../channelInventory/import";
import { inventoryRequestId, type ManagedBatchEntry } from "../channelInventory/management";
import { canonicalConfirmationPayload, recoveryEntries, savePrivateFile, type HistoryDetail, type SourceRef } from "./customerUploadHistory";
import { supplyReceipt, type SupplyIdentity } from "./customerSupply";
import type { ConfirmationEntry, CustomerUploadRepairPrepareConfirmationInput } from "../../../../shared/customerUploadHistory";
import "./CustomerUploadHistory.css";

type Props = { customerId: number; identity: SupplyIdentity; detail: HistoryDetail; isCurrent: () => boolean; onClose: () => void; onComplete: () => void; onAuthorizationError: (error: unknown) => void };
type RepairSession = { historyId: string; confirmationId: string; customerId: number; batchId: number; historyRevision: number; batchRevision: number; customerVersion?: number };
export function CustomerUploadFailuresDialog(props: Props) {
  const utils = trpc.useUtils();
  const controls = useRef<BatchUploadDialogControls | null>(null);
  const mounted = useRef(true);
  const latest = useRef(props); latest.current = props;
  const origin = useRef(props).current;
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const canonical = useRef(new Map<string, ConfirmationEntry>());
  const prepared = useRef<ManagedBatchEntry[]>([]);
  const frozenPrepare = useRef<CustomerUploadRepairPrepareConfirmationInput | null>(null);
  const customerVersion = useRef<number | undefined>(undefined);
  const [contextVersion, setContextVersion] = useState<number>();
  const expected = { expectedEnterpriseId: props.identity.enterpriseId, expectedActorUserId: props.identity.actorUserId };
  const confirmation = props.detail.confirmation;
  const current = () => mounted.current && latest.current.isCurrent() && latest.current.customerId === origin.customerId
    && latest.current.identity.key === origin.identity.key && latest.current.identity.enterpriseId === origin.identity.enterpriseId
    && latest.current.identity.actorUserId === origin.identity.actorUserId && latest.current.detail.history.historyId === origin.detail.history.historyId
    && latest.current.detail.history.revision === origin.detail.history.revision
    && latest.current.detail.history.uploadBatch?.revision === origin.detail.history.uploadBatch?.revision
    && latest.current.detail.confirmation?.confirmationId === origin.detail.confirmation?.confirmationId;
  const report = (error: unknown) => { if (current()) { latest.current.onAuthorizationError(error); setMessage(error instanceof Error ? error.message : "操作失败"); } };
  const [initial] = useState(() => {
    try {
      if (!confirmation || confirmation.batch.customerId !== props.customerId || props.detail.history.customerId !== props.customerId) throw new Error("批次归属未能确认");
      const rows: { row: number; draft: Draft; metadata: { logicalRowId: string; sourceRefs: SourceRef[] }; exportSources?: FailureExportSource[]; failureReason: string }[] = [];
      const sourceRows = new Set<string>();
      let fallback = false;
      const dataFirstRows = new Set([...confirmation.entries, ...confirmation.excludedRows]
        .flatMap(row => row.sourceRefs ?? []).filter(ref => ref.rowNumber === 1).map(ref => ref.sheetIndex));
      for (const entry of confirmation.entries) canonical.current.set(entry.rowRequestId, entry);
      const claimed = new Set(confirmation.entries.map(entry => entry.logicalRowId));
      for (const excluded of confirmation.excludedRows) {
        if (!excluded.reason.startsWith("跳过问题行：") || claimed.has(excluded.logicalRowId)) continue;
        if (!excluded.sourceRefs?.length) throw new Error("原行来源不完整，请导出核对");
        if (rows.some(row => row.metadata.logicalRowId === excluded.logicalRowId)) throw new Error("问题行逻辑标识重复，不能猜测来源");
        const candidates = props.detail.selectedVersion?.rows.filter(row => row.logicalRowId === excluded.logicalRowId) ?? [];
        if (candidates.length > 1) throw new Error("候选物料不能唯一匹配原行");
        const candidate = candidates[0];
        const refKey = (ref: SourceRef) => JSON.stringify([ref.sheetIndex, ref.sheetName, ref.rowNumber, ref.originalRowHash, ref.cellRange ?? null]);
        if (candidate && (props.detail.selectedVersion?.versionId !== confirmation.versionId
          || JSON.stringify(candidate.sourceRefs.map(refKey).sort()) !== JSON.stringify(excluded.sourceRefs.map(refKey).sort()))) throw new Error("候选版本或原行来源不匹配，不能猜测数据");
        const exportSources: FailureExportSource[] = [];
        let missingHeader = false;
        for (const ref of excluded.sourceRefs) {
          const rowKey = `${ref.sheetIndex}:${ref.rowNumber}`;
          if (sourceRows.has(rowKey)) throw new Error("原行来源重复或存在歧义，请导出核对");
          sourceRows.add(rowKey);
          if (!props.detail.originalSheets.length) continue;
          const sheets = props.detail.originalSheets.filter(sheet => sheet.sheetIndex === ref.sheetIndex && sheet.sheetName === ref.sheetName);
          const sources = sheets.length === 1 ? sheets[0].rows.filter(row => row.rowNumber === ref.rowNumber) : [];
          const headers = sheets.length === 1 ? sheets[0].rows.filter(row => row.rowNumber === 1) : [];
          if (sources.length !== 1 || headers.length > 1 || sources[0].originalRowHash !== ref.originalRowHash) throw new Error("原行证据不匹配或不能唯一关联，请导出核对");
          // Row 1 is not a header merely because it is first. Canonical or
          // excluded material references prove it is data, not column evidence.
          if (!headers.length || dataFirstRows.has(ref.sheetIndex)) { missingHeader = true; continue; }
          const header = headers[0].cells;
          if (!header.length || fields.some(field => header.filter(cell => suggestMapping([cell])[field.key] === 0).length > 1)) throw new Error("原表列映射存在歧义，请先核对原表");
          if (fields.every(field => suggestMapping(header)[field.key] < 0)) { missingHeader = true; continue; }
          exportSources.push({ sheetIndex: ref.sheetIndex, sheetName: ref.sheetName, rowNumber: ref.rowNumber, originalRowHash: ref.originalRowHash,
            header: [...header], mapping: suggestMapping(header), cells: [...sources[0].cells] });
        }
        // A multi-source candidate must not silently lose its headerless refs.
        if (missingHeader) exportSources.length = 0;
        let draft: Draft;
        if (candidate) {
          const value = candidate.candidate;
          draft = { partNumber: value.partNumber ?? "", brand: value.brand ?? "", qty: value.qty == null ? "" : String(value.qty),
            dateCode: value.dateCode ?? "", price: value.price ?? "", currency: value.currency ?? "",
            taxIncluded: value.taxIncluded == null ? "unknown" : String(value.taxIncluded), leadTime: value.leadTime ?? "", note: value.note ?? "" };
        } else {
          if (exportSources.length !== 1) throw new Error(exportSources.length ? "多来源行缺少可信候选，请先导出核对" : "缺少可信原表和候选物料，不能猜测数据");
          const source = exportSources[0];
          const mapping = source.mapping;
          const mapped = mapGrid([source.header, source.cells], mapping, [source.header, source.cells]);
          if (mapped.length !== 1) throw new Error("原行不能唯一映射");
          draft = { ...mapped[0].draft, currency: mapping.currency < 0 ? "" : String(source.cells[mapping.currency] ?? "").trim() };
        }
        if (!exportSources.length) fallback = true;
        rows.push({ row: rows.length + 2, draft, metadata: { logicalRowId: excluded.logicalRowId, sourceRefs: excluded.sourceRefs },
          ...(exportSources.length ? { exportSources } : {}), failureReason: excluded.reason });
      }
      return { rows, error: "", notice: fallback ? "缺少可信原表列证据，导出将使用标准库存模板；仅保留已核实候选和当前编辑值，不猜测原列或附注。" : "" };
    } catch (error) { return { rows: [], error: error instanceof Error ? error.message : "原行证据不可用", notice: "" }; }
  });
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void utils.client.channelInventory.customerSupplyContext.query({ ...expected, customerId: props.customerId }, { signal: abort.signal }).then(context => {
      if (!current() || abort.signal.aborted) return;
      if (context.customer.id !== props.customerId || context.customer.archivedAt || !context.canUpload || context.channel?.id !== confirmation?.batch.channelId) throw new Error("原客户或上传权限已变化");
      setContextVersion(context.customer.version);
    }).catch(error => { if (!abort.signal.aborted) report(error); });
    return () => { mounted.current = false; abort.abort(); };
  }, []);
  const session: RepairSession = { historyId: props.detail.history.historyId, confirmationId: confirmation?.confirmationId ?? "", customerId: props.customerId,
    batchId: confirmation?.batch.id ?? 0, historyRevision: props.detail.history.revision, batchRevision: props.detail.history.uploadBatch?.revision ?? 0, customerVersion: contextVersion };
  const checkedSession = (value: unknown): value is RepairSession => Boolean(value && typeof value === "object"
    && (value as RepairSession).historyId === session.historyId && (value as RepairSession).confirmationId === session.confirmationId
    && (value as RepairSession).customerId === session.customerId && (value as RepairSession).batchId === session.batchId
    && Number.isSafeInteger((value as RepairSession).historyRevision) && (value as RepairSession).historyRevision > 0
    && Number.isSafeInteger((value as RepairSession).batchRevision) && (value as RepairSession).batchRevision > 0
    && Number.isSafeInteger((value as RepairSession).customerVersion) && (value as RepairSession).customerVersion! > 0);
  const verifyEntries = (entries: ManagedBatchEntry[], detail: HistoryDetail) => {
    if (!current() || detail.history.historyId !== session.historyId || detail.history.customerId !== props.customerId
      || !detail.confirmation || detail.confirmation.confirmationId !== session.confirmationId || detail.confirmation.batch.id !== session.batchId) throw new Error("原修复批次未能核实");
    for (const entry of entries) {
      const persisted = detail.confirmation.entries.find(value => value.rowRequestId === entry.requestId);
      if (!persisted || persisted.uploadBatchId !== session.batchId || persisted.payload.channelId !== confirmation?.batch.channelId) throw new Error("原修复请求未能核实");
      const wire = canonicalConfirmationPayload(persisted.payload);
      const payload = entry.payload;
      if (fields.some(({ key }) => String(wire[key] ?? "") !== String(payload[key] ?? ""))) throw new Error("原修复内容不匹配，已阻止改写");
      canonical.current.set(entry.requestId, persisted);
    }
    return detail.confirmation;
  };
  const readOriginal = async () => {
    const detail = await utils.client.channelInventory.customerUploadHistoryGet.query({ ...expected, historyId: session.historyId });
    if (!current()) throw new Error("当前客户或权限已变化");
    return detail;
  };
  const verifyContext = async (version: number | undefined) => {
    if (!current() || !latest.current.detail.history.capabilities.canConfirm || latest.current.detail.history.batchClosed !== false) throw new Error("原客户、权限或修复版本已变化");
    const context = await utils.client.channelInventory.customerSupplyContext.query({ ...expected, customerId: props.customerId });
    if (!current() || !latest.current.detail.history.capabilities.canConfirm || context.customer.id !== props.customerId
      || context.customer.archivedAt || !context.canUpload || context.channel?.id !== confirmation?.batch.channelId) throw new Error("原客户或上传权限已变化");
    if (!Number.isSafeInteger(version) || context.customer.version !== version) throw new Error("客户版本已变化，请重新核验；原请求和冻结内容不会改写");
  };
  const reconcile = async (entries: ManagedBatchEntry[]) => {
    const detail = await readOriginal();
    const original = verifyEntries(entries, detail);
    await verifyContext(original.entries.find(entry => entry.rowRequestId === entries[0]?.requestId)?.payload.expectedCustomerVersion);
    const result = await utils.client.channelInventory.customerUploadReconcileBatch.mutate({ ...expected, historyId: session.historyId,
      confirmationId: original.confirmationId, requestId: inventoryRequestId() });
    if (!current() || result.batch.id !== session.batchId || result.history.historyId !== session.historyId) throw new Error("修复回执身份不匹配");
    return entries.map(entry => {
      const found = result.entries.find(value => value.rowRequestId === entry.requestId);
      if (!found) throw new Error("原修复请求回执缺失");
      if (found.status !== "success" || !found.receipt) return { ...entry, status: "unknown" as const };
      const receipt = found.receipt;
      if (receipt.uploadBatchId !== session.batchId || receipt.customerId !== props.customerId || receipt.channelId !== original.batch.channelId) throw new Error("修复回执归属不一致");
      return { ...entry, status: "success" as const, receipt: { item: { id: receipt.materialId, revision: receipt.materialRevision, channelId: receipt.channelId, uploadBatchId: receipt.uploadBatchId },
        idempotent: true, customerId: receipt.customerId, channelId: receipt.channelId, uploadBatchId: receipt.uploadBatchId } };
    });
  };
  const prepare = async (input: { requestId: string }, review?: CustomerConfirmRows) => {
    if (!current() || !confirmation || !review?.confirmedDrafts.length || !checkedSession(review.sessionData)) throw new Error("修复确认记录不完整");
    await verifyContext(frozenPrepare.current?.expectedCustomerVersion ?? review.sessionData.customerVersion);
    const missing = review.confirmedDrafts.some(row => !initial.rows.some(original => original.metadata.logicalRowId === (row.metadata as typeof initial.rows[number]["metadata"] | undefined)?.logicalRowId));
    if (missing && !frozenPrepare.current) {
      // A previous subset may already be durably claimed while its reply was lost.
      // Recover only the entire matching server-canonical set, never allocate new UUIDs.
      const detail = await readOriginal();
      if (!detail.confirmation || detail.confirmation.confirmationId !== session.confirmationId || detail.confirmation.batch.id !== session.batchId || detail.history.batchClosed !== false) throw new Error("原修复批次未能核实");
      const restored = review.confirmedDrafts.map(row => {
        const metadata = row.metadata as typeof initial.rows[number]["metadata"] | undefined;
        const entry = detail.confirmation!.entries.find(entry => entry.rowRequestId === row.rowRequestId && entry.logicalRowId === metadata?.logicalRowId);
        const payload = toPayload(row.draft, confirmation.batch.channelId);
        if (!metadata || !entry || entry.uploadBatchId !== session.batchId || entry.payload.requestId !== row.rowRequestId
          || entry.payload.expectedCustomerVersion !== (review.sessionData as RepairSession).customerVersion
          || JSON.stringify(entry.sourceRefs) !== JSON.stringify(metadata.sourceRefs)
          || fields.some(({ key }) => String(entry.payload[key] ?? "") !== String(payload[key] ?? ""))) throw new Error("原修复确认内容未能核实，请保留原请求");
        canonical.current.set(entry.rowRequestId, entry); return entry;
      });
      if (new Set(restored.map(entry => entry.rowRequestId)).size !== restored.length) throw new Error("原修复请求重复，不能恢复");
      prepared.current = recoveryEntries({ ...detail.confirmation, entries: restored });
      if (!detail.history.uploadBatch) throw new Error("原修复批次修订未能核实");
      return detail.history.uploadBatch;
    }
    if (!frozenPrepare.current) {
      const frozenSession = review.sessionData;
      customerVersion.current = frozenSession.customerVersion;
      frozenPrepare.current = { ...expected, historyId: frozenSession.historyId, confirmationId: frozenSession.confirmationId,
        expectedRevision: frozenSession.historyRevision, expectedBatchRevision: frozenSession.batchRevision,
        expectedCustomerVersion: frozenSession.customerVersion!, requestId: input.requestId,
        rows: review.confirmedDrafts.map(row => {
          const metadata = row.metadata as typeof initial.rows[number]["metadata"] | undefined;
          const original = initial.rows.find(value => value.metadata.logicalRowId === metadata?.logicalRowId);
          if (!metadata || !original || metadata.logicalRowId !== original.metadata.logicalRowId || JSON.stringify(metadata.sourceRefs) !== JSON.stringify(original.metadata.sourceRefs)) throw new Error("问题行来源已变化");
          const { channelId, ...fields } = toPayload(row.draft, confirmation.batch.channelId);
          return { logicalRowId: metadata.logicalRowId, rowRequestId: row.rowRequestId, sourceRefs: metadata.sourceRefs, fields };
        }) };
    }
    if (frozenPrepare.current.requestId !== input.requestId) throw new Error("请恢复原修复请求");
    const result = await utils.client.channelInventory.customerUploadRepairPrepareConfirmation.mutate(frozenPrepare.current);
    if (!current() || result.historyId !== session.historyId || result.confirmationId !== session.confirmationId
      || result.batch.id !== session.batchId || result.batch.customerId !== props.customerId || result.batch.channelId !== confirmation.batch.channelId
      || result.entries.length !== frozenPrepare.current.rows.length) throw new Error("修复确认回执归属不匹配");
    for (const entry of result.entries) {
      const row = frozenPrepare.current.rows.find(row => row.rowRequestId === entry.rowRequestId && row.logicalRowId === entry.logicalRowId);
      if (!row || entry.payload.requestId !== entry.rowRequestId || entry.payload.expectedCustomerVersion !== customerVersion.current
        || fields.some(({ key }) => String(entry.payload[key] ?? "") !== String(row.fields[key] ?? ""))) throw new Error("修复确认内容不匹配");
      canonical.current.set(entry.rowRequestId, entry);
    }
    prepared.current = recoveryEntries({ ...confirmation, entries: result.entries });
    return result.batch;
  };
  const exportProblems = async () => {
    if (!current() || exporting) return;
    setExporting(true); setMessage("");
    try {
      const result = await utils.client.channelInventory.customerUploadProblemsExport.mutate({ ...expected, historyId: session.historyId });
      if (!current() || result.historyId !== session.historyId) return;
      savePrivateFile(result);
    } catch (error) { report(error); }
    finally { if (current()) setExporting(false); }
  };
  const closed = props.detail.history.batchClosed !== false || confirmation?.batchClosed === true;
  const editable = Boolean(confirmation && initial.rows.length && !closed);
  return <Dialog open onOpenChange={open => { if (!open) controls.current?.close(); }}><DialogContent className="ci-dialog ci-batch-dialog customer-supply-dialog" style={{ ...batchUploadDialogStyle,
    width: fullscreen ? "100vw" : "90vw", maxWidth: fullscreen ? "100vw" : "90vw", height: fullscreen ? "100dvh" : "85dvh", maxHeight: fullscreen ? "100dvh" : "85dvh", borderRadius: fullscreen ? 0 : undefined }}
    aria-describedby={undefined} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => controls.current?.onEscapeKeyDown(event)}>
    <DialogHeader style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingRight: 30 }}><DialogTitle>处理失败</DialogTitle><div className="history-row-actions">{!editable ? <button type="button" className="ci-inline-link" disabled={exporting} onClick={() => void exportProblems()}>{exporting ? "导出中…" : "导出原失败记录"}</button> : null}<button type="button" className="ci-inline-link" onClick={() => setFullscreen(value => !value)}>{fullscreen ? "退出全屏" : "全屏"}</button></div></DialogHeader>
    {message || initial.error ? <p className="ci-error" role="alert">{message || initial.error}</p> : null}
    {initial.notice ? <p className="ci-dialog-note">{initial.notice}</p> : null}
    {confirmation && initial.rows.length && !closed ? <BatchUpload key={`${props.identity.key}:${session.historyId}:repair`} dialogMode="content" dialogControlsRef={controls}
      channels={[{ id: confirmation.batch.channelId, name: props.detail.history.customerName, active: true }]} channelTotal={1}
      enterpriseId={props.identity.enterpriseId} actorUserId={props.identity.actorUserId} initialChannelId={confirmation.batch.channelId}
      confirmationLabel="重新提交"
      customerReview
      sourceLabel="客户" fixedSource sourceDetails={<span>{props.detail.history.originalFile.fileName} · {initial.rows.length} 条失败</span>}
      initialRows={initial.rows} storageKeySuffix={`customer:${props.customerId}:${props.identity.key}:repair:${session.historyId}`}
      sessionData={session} customerSourceReady={props.detail.history.capabilities.canConfirm && contextVersion !== undefined} skipIssueRows={false}
      onClose={props.onClose} isCurrent={current} onDirtyChange={() => undefined} onBusyChange={() => undefined}
      onLoadMoreChannels={() => undefined} loadingMoreChannels={false}
      validateSavedSession={(data, entries) => checkedSession(data) && entries.every(entry => (entry as ManagedBatchEntry).uploadBatchId === session.batchId && entry.payload.channelId === confirmation.batch.channelId)}
      onRestoreSession={(data, entries) => { if (!checkedSession(data)) throw new Error("原修复批次归属不匹配"); if (entries.length) verifyEntries(entries, props.detail); }}
      onCreateCustomerBatch={prepare} preparedEntries={() => prepared.current} reconcileQueue={reconcile}
      onCreate={async (_payload, requestId, batchId) => {
        if (!current() || batchId !== session.batchId) throw new Error("原修复批次已变化");
        const entry = canonical.current.get(requestId);
        if (!entry) throw new Error("原修复请求内容未核实");
        const wire = canonicalConfirmationPayload(entry.payload);
        if (wire.uploadBatchId !== batchId || wire.requestId !== requestId || wire.customerId !== props.customerId
          || fields.some(({ key }) => String(wire[key] ?? "") !== String(_payload[key] ?? ""))) throw new Error("原修复请求不能改写");
        await verifyContext(wire.expectedCustomerVersion);
        const { channelId, ...payload } = wire;
        const receipt = await utils.client.channelInventory.createCustomerMaterial.mutate(payload);
        if (!current()) throw new Error("提交结果待原请求确认");
        return supplyReceipt(receipt, props.customerId, confirmation.batch.channelId, session.batchId);
      }} onComplete={() => { if (current()) latest.current.onComplete(); }}
      onViewResults={() => { if (current()) latest.current.onComplete(); }} />
      : <><p>{closed ? "该批次已关闭" : initial.error ? "" : "暂无可修正的失败行"}</p><div className="ci-dialog-footer"><Button type="button" variant="outline" onClick={props.onClose}>关闭</Button></div></>}
  </DialogContent></Dialog>;
}
