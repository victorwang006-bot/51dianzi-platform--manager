import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
} from "./bridge";
import {
  fields,
  mapGrid,
  suggestMapping,
  templateGrid,
  validateDraft,
  validateMapping,
  toPayload,
  type Draft,
  type Payload,
} from "./import";
import { runBatch, type BatchEntry, type BatchReceipt } from "./queue";
import { inventoryRequestId, type UploadBatchInput, type UploadBatchReceipt, type PersistentUploadBatch, type ManagedBatchEntry } from "./management";
import "./batch.css";
import "./layout.css";

type Channel = { id: number; name: string; active: boolean };
export type CustomerConfirmRows = { batchRequestId: string; sessionData?: unknown; confirmedDrafts: { row: number; rowRequestId: string; draft: Draft; metadata?: unknown }[]; excludedRows: { row: number; reason: string; metadata?: unknown }[] };
export type CustomerInitialRecovery = { channelId: number; entries: ManagedBatchEntry[]; name: string; sessionData?: unknown; uploadBatch: PersistentUploadBatch; skippedRows?: number; failureExport?: FailureExportSnapshot };
type Grid = (string | number | null | undefined)[][];
// Download-only evidence. Neither these drafts nor cells may rebuild a queue.
export type FailureExportSource = { sheetIndex: number; sheetName: string; rowNumber: number; originalRowHash: string; header: Grid[number]; mapping: Record<keyof Draft, number>; cells: Grid[number] };
type FailureExportRow = { row: number; draft: Draft; reason: string; cells?: Grid[number]; sources?: FailureExportSource[] };
type FailureExportSnapshot = { header?: Grid[number]; mapping?: Record<keyof Draft, number>; rows: FailureExportRow[] };
type Props = {
  channels: Channel[];
  channelTotal: number | null;
  initialChannelId?: number;
  enterpriseId: number;
  actorUserId: number;
  onClose: () => void;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onLoadMoreChannels: () => void;
  loadingMoreChannels: boolean;
  onCreate: (payload: Payload, requestId: string, uploadBatchId?: number) => Promise<unknown>;
  onCreateBatch?: (input: UploadBatchInput) => Promise<UploadBatchReceipt>;
  /** Customer-only preparation: no virtual channel/placeholder material is ever queued. */
  onCreateCustomerBatch?: (input: Omit<UploadBatchInput, "channelId">, confirmation?: CustomerConfirmRows) => Promise<UploadBatchReceipt & { channelId: number }>;
  /** Customer spreadsheet opt-in. Ordinary channel/manual entry stays strict. */
  skipIssueRows?: boolean;
  initialExcludedRowCount?: number;
  customerSourceReady?: boolean;
  customerSourceDisabledReason?: string;
  onOriginalFilePersist?: (file: File) => Promise<{ sessionData: unknown; rows: { row: number; metadata: unknown }[] }>;
  initialRows?: { row: number; draft: Draft; metadata: unknown; exportSources?: FailureExportSource[]; failureReason?: string }[];
  initialFile?: File;
  initialRecovery?: CustomerInitialRecovery;
  renderParseEntry?: (controls: { onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void }) => React.ReactNode;
  /** Exact canonical server entries after prepare, not another importer. */
  preparedEntries?: () => ManagedBatchEntry[] | undefined;
  reconcileQueue?: (entries: ManagedBatchEntry[]) => Promise<ManagedBatchEntry[]>;
  onComplete: () => void;
  isCurrent: () => boolean;
  sourceLabel?: string;
  fixedSource?: boolean;
  sourceDetails?: React.ReactNode;
  renderConfirmationDetails?: () => React.ReactNode;
  storageKeySuffix?: string;
  sessionData?: unknown;
  validateSavedSession?: (data: unknown, entries: BatchEntry[]) => boolean;
  onRestoreSession?: (data: unknown, entries: ManagedBatchEntry[], batch?: PersistentUploadBatch) => void;
  receiptFromResult?: (response: unknown) => BatchReceipt;
  onFinish?: (result: { entries: BatchEntry[]; complete: boolean; reason?: string }) => void;
  onViewResults?: (entries: BatchEntry[]) => void;
  /** Opt-in customer entry only; both modes submit through this exact queue. */
  renderSingleEntry?: (controls: { onPreview: (draft: Draft) => void; disabled: boolean }) => React.ReactNode;
  /** The caller owns one stable Dialog/Portal across permission loading and ready. */
  dialogMode?: "standalone" | "content";
  dialogControlsRef?: React.Ref<BatchUploadDialogControls>;
  confirmationLabel?: string;
  customerReview?: boolean;
};
export type BatchUploadDialogControls = { close: () => void; onEscapeKeyDown: (event: KeyboardEvent) => void };
export const batchUploadDialogStyle: React.CSSProperties = {
  width: "min(880px, calc(100vw - 24px))", maxWidth: "880px",
  height: "min(85dvh, 680px)", maxHeight: "85dvh", display: "flex",
  flexDirection: "column", gap: "12px", overflow: "hidden", padding: "18px",
};
type CustomerPreparation = { confirmation?: CustomerConfirmRows; rows: { row: number; requestId: string; draft: Draft }[]; requestId: string; name: string; sessionData?: unknown; entryMode: "table" | "single"; skippedRows?: number; failureExport?: FailureExportSnapshot };
type SavedBatch = { channelId: number; entries: ManagedBatchEntry[]; name: string; sessionData?: unknown; entryMode?: "table" | "single"; uploadBatch?: PersistentUploadBatch; skippedRows?: number; failureExport?: FailureExportSnapshot };
const storageKey = (props: Props) => `d51-channel-inventory-batch-v1:${props.actorUserId}:${props.enterpriseId}${props.storageKeySuffix ? `:${props.storageKeySuffix}` : ""}`;
function Icon({
  kind,
  size = 18,
}: {
  kind: "upload" | "file" | "lock" | "check";
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "upload" ? (
        <>
          <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
        </>
      ) : kind === "file" ? (
        <>
          <path d="M14 2H6v20h12V6l-4-4ZM14 2v5h5M9 11h6m-6 4h6" />
        </>
      ) : kind === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 6v2" />
        </>
      ) : (
        <path d="m5 12 4 4L19 6" />
      )}
    </svg>
  );
}
const uuid = inventoryRequestId;
export function BatchUpload(props: Props) {
  // A changed recovery namespace must not render the previous identity's queue.
  return <BatchUploadSession key={storageKey(props)} {...props} />;
}
function BatchUploadSession(props: Props) {
  const {
    channels,
    channelTotal,
    initialChannelId,
    enterpriseId,
    actorUserId,
  } = props;
  const key = storageKey(props);
  const isFailureReasonHeader = (header: unknown) => String(header ?? "").normalize("NFKC").trim() === "失败原因";
  const validateFailureExport = (value: unknown): boolean => {
    if (value === undefined) return true; // Legacy queues have no export evidence.
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const snapshot = value as FailureExportSnapshot;
    if (Object.keys(snapshot).some(key => !["header", "mapping", "rows"].includes(key))
      || !Array.isArray(snapshot.rows) || snapshot.rows.length > 1000) return false;
    let textSize = 0;
    const safeText = (text: unknown): text is string => {
      if (typeof text !== "string" || text.length > 32_767) return false;
      textSize += text.length;
      return textSize <= 2_000_000;
    };
    const safeCells = (cells: unknown): cells is Grid[number] => Array.isArray(cells) && cells.length <= 40
      && cells.every(cell => cell == null || (typeof cell === "number" && Number.isFinite(cell)) || safeText(cell));
    const hasSource = snapshot.header !== undefined || snapshot.mapping !== undefined;
    const safeMapping = (header: unknown, mapping: FailureExportSnapshot["mapping"]) => {
      if (!safeCells(header) || !header.length || !mapping || typeof mapping !== "object" || Array.isArray(mapping)
        || Object.keys(mapping).some(key => !fields.some(field => field.key === key))
        || !fields.every(field => Number.isInteger(mapping[field.key]) && mapping[field.key] >= -1
          && mapping[field.key] < header.length
          && (mapping[field.key] < 0 || !isFailureReasonHeader(header[mapping[field.key]])))) return false;
      const columns = fields.map(field => mapping[field.key]).filter(column => column >= 0);
      return new Set(columns).size === columns.length;
    };
    if (hasSource && !safeMapping(snapshot.header, snapshot.mapping)) return false;
    const sourceRows = new Set<string>();
    const sourceSheets = new Map<number, string>();
    const safeSources = (sources: FailureExportSource[] | undefined) => sources === undefined || (Array.isArray(sources)
      && sources.length > 0 && sources.length <= 100 && sources.every(source => {
        if (!source || typeof source !== "object" || Array.isArray(source)
          || Object.keys(source).some(key => !["sheetIndex", "sheetName", "rowNumber", "originalRowHash", "header", "mapping", "cells"].includes(key))
          || !Number.isSafeInteger(source.sheetIndex) || source.sheetIndex < 0 || !safeText(source.sheetName) || !source.sheetName.trim()
          || !Number.isSafeInteger(source.rowNumber) || source.rowNumber < 2 || !/^[a-f0-9]{64}$/.test(source.originalRowHash)
          || !safeMapping(source.header, source.mapping) || !safeCells(source.cells)) return false;
        const rowKey = `${source.sheetIndex}:${source.rowNumber}`;
        const sheet = JSON.stringify([source.sheetName, source.header, source.mapping]);
        if (sourceRows.has(rowKey) || (sourceSheets.has(source.sheetIndex) && sourceSheets.get(source.sheetIndex) !== sheet)) return false;
        sourceRows.add(rowKey); sourceSheets.set(source.sheetIndex, sheet); return true;
      }));
    const seen = new Set<number>();
    return snapshot.rows.every(row => {
      if (!row || typeof row !== "object" || Array.isArray(row)
        || Object.keys(row).some(key => !["row", "draft", "reason", "cells", "sources"].includes(key))
        || !Number.isSafeInteger(row.row) || row.row < 2 || row.row > 1001 || seen.has(row.row)
        || !safeText(row.reason) || !row.draft || typeof row.draft !== "object" || Array.isArray(row.draft)
        || Object.keys(row.draft).some(key => key !== "sourceIssue" && !fields.some(field => field.key === key))
        || !fields.every(field => safeText(row.draft[field.key]))
        || (row.draft.sourceIssue !== undefined && !safeText(row.draft.sourceIssue))
        || (hasSource ? !safeCells(row.cells) : row.cells !== undefined) || !safeSources(row.sources)) return false;
      seen.add(row.row);
      return true;
    });
  };
  // Kept inside the native-compiled leaf: its external legacy helper cannot
  // validate newly persisted download-only evidence.
  function readSavedBatch(): { saved: SavedBatch | null; preparation?: CustomerPreparation; error: string; blocked: boolean } {
    const empty = { saved: null, error: "", blocked: false };
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return props.initialRecovery ? validateFailureExport(props.initialRecovery.failureExport)
        ? { saved: props.initialRecovery, error: "", blocked: false }
        : { saved: null, blocked: true, error: "原批次失败导出记录无效，已阻止重复上传，请核实原批次。" } : empty;
      if (raw.length > 10_000_000) return { saved: null, blocked: true, error: "原批次恢复记录超过安全大小，已阻止重复上传，请核实原批次。" };
      const data = JSON.parse(raw);
      if (data.version === 2 && data.phase === "customer-source" && props.onCreateCustomerBatch
        && data.actorUserId === actorUserId && data.enterpriseId === enterpriseId) {
        const preparation = data.preparation as CustomerPreparation;
        if (preparation && /^[-0-9a-f]{36}$/i.test(preparation.requestId)
          && typeof preparation.name === "string" && preparation.name.length > 0
          && ["table", "single"].includes(preparation.entryMode) && Array.isArray(preparation.rows)
          && preparation.rows.length > 0 && preparation.rows.length <= 1000
          && preparation.rows.every(row => Number.isSafeInteger(row.row) && row.row > 0
            && /^[-0-9a-f]{36}$/i.test(row.requestId) && row.draft && validateDraft(row.draft).length === 0)
          && validateFailureExport(preparation.failureExport)
          && (!props.validateSavedSession || props.validateSavedSession(preparation.sessionData, [])))
          return { saved: null, preparation, error: "", blocked: false };
        return { saved: null, blocked: true, error: "原客户上传准备记录无效，已阻止另起批次，请核实原请求。" };
      }
      if (data.version === 1 && data.actorUserId === actorUserId && data.enterpriseId === enterpriseId
        && Number.isSafeInteger(data.channelId) && data.channelId > 0 && Array.isArray(data.entries)
        && data.entries.length <= 1000 && data.entries.length > 0 && data.entries.every((r: BatchEntry) =>
          /^[-0-9a-f]{36}$/i.test(r.requestId) && ["pending", "success", "unknown"].includes(r.status) && r.payload.channelId === data.channelId)) {
        const batch = data.uploadBatch as PersistentUploadBatch | undefined;
        const validBatch = batch === undefined
          ? data.entries.every((entry: ManagedBatchEntry) => entry.uploadBatchId === undefined)
          : /^[-0-9a-f]{36}$/i.test(batch.requestId) && (batch.id === undefined
            ? data.entries.every((entry: ManagedBatchEntry) => entry.uploadBatchId === undefined)
            : Number.isSafeInteger(batch.id) && batch.id > 0 && data.entries.every((entry: ManagedBatchEntry) => entry.uploadBatchId === batch.id));
        if (!validBatch || (batch && !props.onCreateBatch && !props.onCreateCustomerBatch))
          return { saved: null, blocked: true, error: "原批次归属记录无效或当前入口无法核验批次，已阻止重复上传。请核实原上传结果。" };
        if (props.validateSavedSession && !props.validateSavedSession(data.sessionData, data.entries))
          return { saved: null, blocked: true, error: "原批次客户版本或回执已变化，不能另起批次重复上传。请核实原上传结果后处理。" };
        if (!validateFailureExport(data.failureExport))
          return { saved: null, blocked: true, error: "原批次失败导出记录无效，已阻止重复上传，请核实原批次。" };
        return { saved: data, error: "", blocked: false };
      }
      if (props.storageKeySuffix || props.onCreateBatch || props.onCreateCustomerBatch) return { saved: null, blocked: true, error: "原批次恢复记录无效，已阻止重复导入，请核实原上传结果。" };
      return empty;
    } catch {
      return { saved: null, blocked: Boolean(props.storageKeySuffix || props.onCreateBatch || props.onCreateCustomerBatch), error: "无法读取上次上传记录；请检查浏览器会话存储权限。" };
    }
  }
  // Read synchronously once for this namespace: no post-paint resume-banner jump.
  const [initial] = useState(() => readSavedBatch());
  const [channelId, setChannelId] = useState(String(initialChannelId ?? ""));
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [grid, setGrid] = useState<Grid>([]);
  const [rawGrid, setRawGrid] = useState<Grid>([]);
  const [mapping, setMapping] = useState<Record<keyof Draft, number>>(
    suggestMapping([])
  );
  const [name, setName] = useState("");
  const [error, setError] = useState(initial.error);
  const [loading, setLoading] = useState(false);
  const [fileStage, setFileStage] = useState<"original" | "table" | null>(null);
  const [fileErrorStage, setFileErrorStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [exclusionUndo, setExclusionUndo] = useState<number[][]>([]);
  const uploadSkippedRows = useRef(initial.saved?.skippedRows ?? initial.preparation?.skippedRows ?? 0);
  const [skippedRows, setSkippedRows] = useState(uploadSkippedRows.current);
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const restoreBlocked = initial.blocked;
  const [entryMode, setEntryMode] = useState<"table" | "single" | "parse">("table");
  const [parseDirty, setParseDirty] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, Draft>>({});
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const customerMode = Boolean(props.onOriginalFilePersist || props.customerReview);
  const [reviewPage, setReviewPage] = useState(1);
  const [resultPage, setResultPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const reviewOrder = useRef<number[]>([]);
  const rowCurrencyConfirmed = useRef(new Set<number>());
  const pageSize = 100;
  const [reviewedMapping, setReviewedMapping] = useState<(keyof Draft)[]>([]);
  const [blankBrand, setBlankBrand] = useState("");
  const excludedReasons = useRef<Record<number, string>>({});
  const rowMetadata = useRef(new Map<number, unknown>(props.initialRows?.map(r => [r.row, r.metadata]) ?? []));
  const initialExportRows = useRef(new Map(props.initialRows?.map((row, index) => [index + 2, row]) ?? []));
  const importSession = useRef<unknown>(props.sessionData);
  importSession.current = props.sessionData ?? importSession.current;
  const [saved, setSaved] = useState<SavedBatch | null>(initial.saved);
  const [savedPreparation, setSavedPreparation] = useState(initial.preparation);
  const [preparing, setPreparing] = useState<CustomerPreparation | undefined>();
  const failureExport = useRef<FailureExportSnapshot | undefined>(initial.saved?.failureExport ?? initial.preparation?.failureExport);
  const resolvedChannel = useRef<Channel | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const persistedFile = useRef<{ file: File; result: { sessionData: unknown; rows: { row: number; metadata: unknown }[] } } | null>(null);
  const mounted = useRef(true);
  const uploadBatch = useRef<PersistentUploadBatch | undefined>(undefined);
  const serial = useRef(0);
  const stop = useRef(false);
  const running = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const current = () => mounted.current && latest.current.isCurrent();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current += 1;
      stop.current = true;
    };
  }, [key]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (running.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const persist = (next: BatchEntry[], id: number) => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          enterpriseId,
          actorUserId,
          channelId: id,
          name,
          entries: next,
          ...(uploadBatch.current ? { uploadBatch: uploadBatch.current } : {}),
          ...(latest.current.skipIssueRows ? { skippedRows: uploadSkippedRows.current } : {}),
          ...(failureExport.current ? { failureExport: failureExport.current } : {}),
          ...(importSession.current === undefined ? {} : { sessionData: importSession.current }),
          ...(latest.current.renderSingleEntry ? { entryMode } : {}),
        })
      );
      return true;
    } catch {
      stop.current = true;
      if (current())
        setError(
          "浏览器无法保存幂等恢复记录，已停止后续上传。请勿另开新批次重复导入。"
        );
      return false;
    }
  };
  const loadGrid = (
    next: Grid,
    fileName: string,
    originalValues: Grid = []
  ) => {
    setGrid(next);
    setRawGrid(originalValues);
    const suggested = suggestMapping(next[0]?.map(String) ?? []);
    // Reuse the importer aliases, but never silently pick the first ambiguous column.
    if (customerMode) fields.forEach(field => {
      if ((next[0] ?? []).filter(header => suggestMapping([header])[field.key] === 0).length > 1) suggested[field.key] = -1;
    });
    fields.forEach(field => { if (isFailureReasonHeader(next[0]?.[suggested[field.key]])) suggested[field.key] = -1; });
    setMapping(suggested);
    setName(fileName);
    setExcluded([]); setEdits({}); setCurrencyConfirmed(false); excludedReasons.current = {};
    setReviewPage(1); setResultPage(1); reviewOrder.current = []; rowCurrencyConfirmed.current.clear();
    setExclusionUndo([]); uploadSkippedRows.current = 0; setSkippedRows(0);
    initialExportRows.current.clear();
    failureExport.current = undefined;
    setReviewedMapping([]); setBlankBrand("");
    setError("");
    setStep(customerMode ? 3 : 2);
    latest.current.onDirtyChange(true);
  };
  const selectFile = async (file: File, retry = false) => {
    const token = ++serial.current;
    setError("");
    setFileErrorStage("");
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setFileErrorStage("文件格式不符合要求");
      setError("请选择 Excel（.xlsx/.xls）或 CSV 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileErrorStage("文件超过大小限制");
      setError("每份文件最多 5MB，请拆分后上传。");
      return;
    }
    setLoading(true);
    let failureStage = "表格读取未完成";
    try {
      if (latest.current.onOriginalFilePersist) {
        failureStage = "原文件保存／记录核验未完成";
        setFileStage("original");
        const original = retry && persistedFile.current?.file === file ? persistedFile.current.result : await latest.current.onOriginalFilePersist(file);
        persistedFile.current = { file, result: original };
        if (!current() || token !== serial.current) return;
        importSession.current = original.sessionData;
        rowMetadata.current = new Map(original.rows.map(r => [r.row, r.metadata]));
      }
      failureStage = "表格读取未完成";
      setFileStage("table");
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      if (!current() || token !== serial.current) return;
      const workbook = XLSX.read(buffer, {
        type: "array",
        sheetRows: 1002,
        cellFormula: false,
        cellHTML: false,
        cellDates: false,
        raw: /\.csv$/i.test(file.name),
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("表格没有可读取的工作表。");
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(
        sheet["!fullref"] ?? sheet["!ref"] ?? "A1"
      );
      if (range.e.r > 1000)
        throw new Error(
          "每批最多1000行数据，请拆分表格；不会截断或静默跳过数据。"
        );
      if (range.e.c > 39)
        throw new Error("每份表格最多40列，请删除无关列后重新上传。");
      const next = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        range: 0,
        defval: "",
        raw: false,
        blankrows: true,
      });
      const originalValues = XLSX.utils.sheet_to_json<(string | number)[]>(
        sheet,
        {
          header: 1,
          range: 0,
          defval: "",
          raw: true,
          blankrows: true,
        }
      );
      if (next.length < 2)
        throw new Error("首行应为表头，且至少有一行库存数据。");
      if (current() && token === serial.current)
        { loadGrid(next, `${file.name} · ${sheetName}`, originalValues); setRetryFile(null); }
    } catch (e) {
      if (current() && token === serial.current) { setRetryFile(file); setFileErrorStage(failureStage); }
      if (current() && token === serial.current)
        setError(
          e instanceof Error ? e.message : "文件读取失败，请用模板整理后重试。"
        );
    } finally {
      if (current() && token === serial.current) { setLoading(false); setFileStage(null); }
    }
  };
  useEffect(() => {
    if (initial.saved || initial.preparation || initial.blocked) return;
    if (props.initialRows?.length) {
      loadGrid([fields.map(f => f.label), ...props.initialRows.map(r => fields.map(f => r.draft[f.key]))], props.initialFile?.name ?? "解析结果核对");
      setEdits(Object.fromEntries(props.initialRows.map((r, i) => [i + 2, r.draft])));
      rowMetadata.current = new Map(props.initialRows.map((r, i) => [i + 2, r.metadata]));
      // Display indices are not source row numbers: bind evidence to the same
      // initial row as its logical metadata, never index into originalSheets.
      initialExportRows.current = new Map(props.initialRows.map((r, i) => [i + 2, r]));
    } else if (props.initialFile) void selectFile(props.initialFile);
  }, []);
  const download = async () => {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(templateGrid());
      sheet["!cols"] = fields.map(f => ({ wch: f.key === "note" ? 35 : 18 }));
      XLSX.utils.book_append_sheet(workbook, sheet, "渠道库存");
      XLSX.writeFileXLSX(workbook, "渠道库存批量上传模板.xlsx");
    } catch {
      if (current()) setError("模板生成失败，请稍后重试。");
    }
  };
  const historyOptIn = (customerMode || rowMetadata.current.size > 0) && entryMode === "table";
  const skipIssues = Boolean(props.skipIssueRows && customerMode && props.onCreateCustomerBatch && historyOptIn);
  const allRows = mapGrid(grid, mapping, rawGrid).map(r => {
    let draft = edits[r.row] ?? r.draft;
    if (historyOptIn && !edits[r.row] && mapping.currency < 0) draft = { ...draft, currency: "" };
    const metadata = rowMetadata.current.get(r.row) as { issues?: { field: string; resolved: boolean; message?: string }[] } | undefined;
    const originalCurrency = mapping.currency < 0 ? "" : String(grid[r.row - 1]?.[mapping.currency] ?? "").trim();
    const currencyNeedsConfirmation = customerMode && historyOptIn && (!originalCurrency || r.draft.currency !== "CNY" || Boolean(metadata?.issues?.some(issue => issue.field === "currency" && !issue.resolved)));
    if (customerMode && historyOptIn && !edits[r.row] && !originalCurrency) draft = { ...draft, currency: "" };
    if (currencyConfirmed && !customerMode) draft = { ...draft, currency: "CNY" };
    const errors = validateDraft(draft);
    if (historyOptIn && metadata?.issues?.some(issue => (issue.field === "source" || issue.field === "other") && !issue.resolved)) errors.push("来源或其他问题尚未填写核实依据");
    if (historyOptIn && draft.currency.trim() !== "CNY") errors.push("币种待人工明确CNY；不能默认或换算外币");
    if (currencyNeedsConfirmation && !currencyConfirmed && !rowCurrencyConfirmed.current.has(r.row)) errors.push("请明确选择本次候选币种为CNY");
    if (historyOptIn && !rowMetadata.current.has(r.row)) errors.push("缺少服务端原行证据，不能猜测来源");
    // Pending version issues are not good rows merely because optional DTO fields allow null.
    if (skipIssues) metadata?.issues?.filter(issue => !issue.resolved).forEach(issue => errors.push(issue.message || "问题待核对"));
    return { ...r, draft, errors, currencyNeedsConfirmation };
  });
  const captureFailureExport = (): FailureExportSnapshot => ({
    ...(grid[0]?.length ? { header: [...grid[0]], mapping: { ...mapping } } : {}),
    // Empty reasons retain source-column evidence for frozen unfinished entries.
    rows: allRows.map(row => ({ row: row.row, draft: { ...row.draft },
      reason: excluded.includes(row.row) ? `已移除：${excludedReasons.current[row.row] || "用户移除"}` : row.errors.join("；")
        || (initialExportRows.current.get(row.row)?.failureReason ? "已修正，待重新提交" : ""),
      ...(grid[0]?.length ? { cells: [...(grid[row.row - 1] ?? [])] } : {}),
      ...(initialExportRows.current.get(row.row)?.exportSources ? { sources: initialExportRows.current.get(row.row)!.exportSources } : {}),
    })),
  });
  const rows = allRows.filter(r => !excluded.includes(r.row));
  const excludeRow = (row: number) => {
    if (skipIssues) {
      excludedReasons.current[row] = "用户移除";
      setExclusionUndo(value => [...value, [row]]);
    } else if (historyOptIn) {
      const reason = window.prompt(`请填写原表第${row}行的排除原因（1至1000字）`);
      if (!reason?.trim() || reason.trim().length > 1000) { setError("排除行必须填写1至1000字原因。"); return; }
      excludedReasons.current[row] = reason.trim();
    }
    setExcluded(v => [...v, row]);
  };
  const bad = rows.filter(r => r.errors.length);
  const goodRows = rows.filter(r => !r.errors.length);
  const importRows = skipIssues ? goodRows : rows;
  const filledBrandRows = skipIssues ? goodRows : rows;
  const pendingSkipCount = excluded.length + bad.length + (props.initialExcludedRowCount ?? 0);
  const mappingErrors = validateMapping(mapping).filter(message => !(customerMode && mapping.brand === -1 && filledBrandRows.length > 0 && filledBrandRows.every(row => row.draft.brand.trim()) && message === "品牌为必填字段，必须映射列"));
  const mappingNeedsReview = customerMode ? fields.filter(field => {
    const ambiguous = (grid[0] ?? []).filter(header => suggestMapping([header])[field.key] === 0).length > 1;
    return (ambiguous && !reviewedMapping.includes(field.key))
      || (field.required && mapping[field.key] < 0 && !(field.key === "brand" && rows.length > 0 && rows.every(row => row.draft.brand.trim())))
      || (mapping[field.key] >= 0 && fields.some(other => other.key !== field.key && mapping[other.key] === mapping[field.key]));
  }) : [];
  if (mappingNeedsReview.some(field => !reviewedMapping.includes(field.key) && (grid[0] ?? []).filter(header => suggestMapping([header])[field.key] === 0).length > 1)) mappingErrors.push("存在歧义列，请明确选择匹配列或不导入");
  const selected = channels.find(c => c.id === Number(channelId))
    ?? (resolvedChannel.current?.id === Number(channelId) ? resolvedChannel.current : undefined);
  const sourceReady = customerMode && props.customerSourceReady !== undefined ? props.customerSourceReady && (!selected || selected.active) : selected?.active || (props.onCreateCustomerBatch && props.customerSourceReady);
  const completed = entries.filter(e => e.status === "success").length;
  const hasQueue = entries.length > 0;
  const modeLocked = busy || loading || parseBusy || hasQueue || !!preparing || !!savedPreparation || !!saved || restoreBlocked;
  const confirmDisabledReason = !current() ? "客户或授权已变化，请重新核验" : modeLocked ? "请先完成或恢复原批次" : !sourceReady ? props.customerSourceDisabledReason || (selected && !selected.active ? "所选来源不可写或已停用，请核实上传权限" : "请选择有权访问且启用的已加载渠道") : mappingErrors.length ? mappingErrors.join("；") : !importRows.length ? (bad.length ? `没有可导入的行：${bad[0].errors.join("；")}` : "没有可导入的行") : !skipIssues && bad.length ? `还有 ${bad.length} 条需要核对：${bad[0].errors.join("；")}` : "";
  const changeMapping = (field: keyof Draft, column: number) => {
    if (modeLocked || !current()) return;
    if (!fields.some(item => item.key === field) || !Number.isInteger(column) || column < -1 || column >= (grid[0]?.length ?? 0)) return;
    if (column >= 0 && isFailureReasonHeader(grid[0]?.[column])) return;
    setReviewedMapping(value => [...value, field]);
    if (mapping[field] === column) return;
    const nextMapping = { ...mapping, [field]: column };
    setMapping(nextMapping);
    if (customerMode) {
      const remapped = new Map(mapGrid(grid, nextMapping, rawGrid).map(row => [row.row, row.draft]));
      setEdits(value => Object.fromEntries(Object.entries(value).map(([row, draft]) => {
        const source = remapped.get(Number(row));
        if (!source) return [row, draft];
        const updated = { ...draft, [field]: field === "currency" && column < 0 ? "" : source[field] };
        if (field === "partNumber") {
          delete updated.sourceIssue;
          if (source.sourceIssue) updated.sourceIssue = source.sourceIssue;
        }
        return [row, updated];
      })));
      if (field === "currency") { setCurrencyConfirmed(false); rowCurrencyConfirmed.current.clear(); }
    } else {
      setEdits({}); setCurrencyConfirmed(false); rowCurrencyConfirmed.current.clear();
    }
    reviewOrder.current = []; setReviewPage(1);
  };
  const renderMapping = (items: typeof fields) => <div className="ci-batch-mapping">{items.map(field => <label className="ci-field" key={field.key}>
    <span>{field.label}{field.required ? " *" : ""}</span>
    <select aria-label={`匹配${field.label}`} className="ci-batch-control" disabled={modeLocked || !current()} value={mapping[field.key]} onChange={event => changeMapping(field.key, Number(event.target.value))}>
      <option value={-1}>不导入 / 留空</option>{(grid[0] ?? []).map((header, index) => <option key={index} value={index} disabled={isFailureReasonHeader(header)}>{`第${index + 1}列 · ${String(header || "空白表头")}`}</option>)}
    </select>{mapping[field.key] >= 0 ? <small>示例：{String(grid[1]?.[mapping[field.key]] ?? "") || "空白"}</small> : null}
  </label>)}</div>;
  const changeMode = (mode: "table" | "single" | "parse") => {
    if (!current() || running.current || modeLocked || mode === entryMode) return;
    if (parseDirty && !window.confirm("解析上传尚未提交，切换将关闭草稿，是否继续？")) return;
    if (grid.length && !window.confirm("切换上传方式将清除当前未提交的预览；单条录入草稿会保留。是否继续？")) return;
    serial.current += 1;
    setEntryMode(mode);
    setGrid([]); setRawGrid([]); setExcluded([]); setName(""); setError(""); setStep(1); setEdits({}); setCurrencyConfirmed(false); rowMetadata.current.clear();
  };
  const previewSingle = (draft: Draft) => {
    if (!current() || running.current || modeLocked || entryMode !== "single" || !sourceReady) return;
    const errors = validateDraft(draft);
    if (errors.length) { setError(errors.join("；")); return; }
    // Use the same mapping, normalization, DTO and confirmation as file rows.
    loadGrid([fields.map(field => field.label), fields.map(field => draft[field.key])], "单条手工录入");
    setStep(3);
  };
  const start = async () => {
    if (running.current || !current() || restoreBlocked || saved || savedPreparation) return;
    if (customerMode && !hasQueue && !preparing && confirmDisabledReason) { setError(confirmDisabledReason); return; }
    if (!sourceReady) {
      setError("请选择有权访问且启用的已加载渠道。");
      return;
    }
    let next = entries;
    let preparation = preparing;
    let target = selected;
    if (!hasQueue && !preparation) {
      if (mappingErrors.length || (!skipIssues && bad.length) || !importRows.length || allRows.length > 1000) {
        setError("请完成字段匹配并修正错误行。"); return;
      }
      const snapshot = captureFailureExport();
      if (!validateFailureExport(snapshot)) { setError("失败导出记录超过安全范围或列映射无效，请整理原文件后重试；尚未提交上传。"); return; }
      failureExport.current = snapshot;
      if (latest.current.onCreateCustomerBatch) {
        if (latest.current.customerReview && !latest.current.validateSavedSession?.(importSession.current, [])) {
          setError("修复上下文尚未就绪，请稍后重试"); return;
        }
        uploadSkippedRows.current = skipIssues ? pendingSkipCount : excluded.length;
        setSkippedRows(uploadSkippedRows.current);
        preparation = { requestId: uuid(), name, entryMode: entryMode === "single" ? "single" : "table", sessionData: importSession.current,
          skippedRows: uploadSkippedRows.current, failureExport: snapshot, rows: importRows.map(r => ({ row: r.row, requestId: uuid(), draft: r.draft })) };
        if (historyOptIn) preparation.confirmation = { batchRequestId: preparation.requestId, sessionData: importSession.current,
          confirmedDrafts: preparation.rows.map(r => ({ row: r.row, rowRequestId: r.requestId, draft: r.draft, metadata: rowMetadata.current.get(r.row) })),
          excludedRows: allRows.filter(r => excluded.includes(r.row) || (skipIssues && r.errors.length)).map(r => ({ row: r.row,
            reason: excluded.includes(r.row) ? excludedReasons.current[r.row] ?? "" : `跳过问题行：${r.errors.join("；")}`.slice(0, 1000), metadata: rowMetadata.current.get(r.row) })) };
        setPreparing(preparation);
      } else {
        if (!target) return;
        next = rows.map(r => ({ row: r.row, requestId: uuid(), payload: toPayload(r.draft, target!.id), status: "pending" }));
        // Legacy recovered queues deliberately keep no ID; never invent historical attribution.
        if (latest.current.onCreateBatch) uploadBatch.current = { requestId: uuid() };
      }
    }
    if (uploadBatch.current?.id !== undefined) {
      const batchId = uploadBatch.current.id;
      next = next.map(entry => ({ ...entry, uploadBatchId: batchId }));
    }
    if (preparation) {
      try {
        // Persist original batch AND row request IDs before any source/batch write.
        sessionStorage.setItem(key, JSON.stringify({ version: 2, phase: "customer-source", enterpriseId, actorUserId, preparation }));
      } catch { setError("浏览器无法保存幂等恢复记录，已停止上传，请勿另开批次。"); return; }
    } else if (!target || !persist(next, target.id)) return;
    stop.current = false; running.current = true;
    setBusy(true); setError(""); setEntries(next); setStep(4);
    props.onBusyChange(true); props.onDirtyChange(true);
    try {
      if (preparation) {
        if (!latest.current.onCreateCustomerBatch) throw new Error("当前入口无法核验原客户批次。");
        const created = await latest.current.onCreateCustomerBatch({ fileName: preparation.name,
          totalRows: preparation.rows.length, requestId: preparation.requestId }, preparation.confirmation);
        if (!current()) return;
        if (!Number.isSafeInteger(created.channelId) || created.channelId <= 0 || !Number.isSafeInteger(created.id) || created.id <= 0
          || (target && created.channelId !== target.id)) throw new Error("客户批次回执渠道或批次无效，请按原请求重试。");
        target = { id: created.channelId, name: props.sourceLabel || "客户供应来源", active: true };
        resolvedChannel.current = target; setChannelId(String(target.id));
        uploadBatch.current = { requestId: preparation.requestId, id: created.id, batchCode: created.batchCode };
        next = (preparation.confirmation ? latest.current.preparedEntries?.() : undefined) ?? preparation.rows.map(row => ({ row: row.row, requestId: row.requestId,
          payload: toPayload(row.draft, created.channelId), uploadBatchId: created.id, status: "pending" }));
        if (preparation.confirmation && (next.length !== preparation.rows.length || next.some((entry, i) => entry.requestId !== preparation!.rows[i].requestId || entry.payload.channelId !== created.channelId || (entry as ManagedBatchEntry).uploadBatchId !== created.id))) throw new Error("服务端确认队列与冻结UUID不匹配，不能重建批次。");
        // Canonical recovery helpers may compact rows. Keep the frozen UI row
        // associated by request UUID so skipped/source evidence cannot shift.
        next = next.map(entry => ({ ...entry, row: preparation!.rows.find(row => row.requestId === entry.requestId)!.row }));
        setEntries(next);
        if (!persist(next, target.id)) return;
        setPreparing(undefined);
      }
      if (!target) throw new Error("真实渠道尚未确认，已停止上传。");
      const batch = uploadBatch.current;
      if (batch && batch.id === undefined) {
        if (!latest.current.onCreateBatch) throw new Error("当前入口无法继续原上传批次，请返回原入口重试。");
        const created = await latest.current.onCreateBatch({ channelId: target.id, fileName: name, totalRows: next.length, requestId: batch.requestId });
        if (!current()) return;
        if (!Number.isSafeInteger(created.id) || created.id <= 0) throw new Error("上传批次回执无效，请按原请求重试。");
        uploadBatch.current = { ...batch, id: created.id, batchCode: created.batchCode };
        next = next.map(entry => ({ ...entry, uploadBatchId: created.id }));
        setEntries(next);
        if (!persist(next, target.id)) return;
      }
      let result = await runBatch(next, {
        submit: (payload, requestId) => uploadBatch.current?.id === undefined
          ? latest.current.onCreate(payload, requestId)
          : latest.current.onCreate(payload, requestId, uploadBatch.current.id),
        isCurrent: current,
        shouldStop: () => stop.current,
        receiptFromResult: latest.current.receiptFromResult,
        onProgress: progress => {
          persist(progress, target!.id);
          if (current()) setEntries(progress);
        },
      });
      if (!current()) return;
      if (latest.current.reconcileQueue && importSession.current && entryMode === "table") {
        const reconciled = await latest.current.reconcileQueue(result.entries as ManagedBatchEntry[]);
        if (!current()) return;
        result = { entries: reconciled, complete: reconciled.length > 0 && reconciled.every(entry => entry.status === "success"), reason: reconciled.every(entry => entry.status === "success") ? undefined : "error" };
        if (!persist(reconciled, target.id)) return;
      }
      setEntries(result.entries);
      props.onComplete();
      if (result.complete) {
        sessionStorage.removeItem(key);
        props.onDirtyChange(false);
        setSaved(null);
      } else if (result.reason) {
        setError(
          result.reason === "stopped"
            ? "上传已暂停，已保存记录不会撤回；可继续原批次。"
            : result.reason === "context-changed"
              ? "当前企业或账号已变化，已停止后续上传。"
              : (result.entries.find(entry => entry.error)?.error ??
                "有记录的保存结果待确认，请按原批次重试。")
        );
      }
      // This is an attempt-end callback, never a per-row success callback. Clear
      // busy before consumers close/navigate, so the original queue isn't torn down.
      running.current = false;
      setBusy(false);
      props.onBusyChange(false);
      latest.current.onFinish?.(result);
    } catch (e) {
      if (current())
        setError(
          e instanceof Error ? e.message : "上传已中断，请保持当前批次并重试。"
        );
    } finally {
      running.current = false;
      if (current()) {
        setBusy(false);
        props.onBusyChange(false);
      }
    }
  };
  const close = () => {
    if (parseBusy) { setError("原文件提交结果待确认，请等待或按同一请求重试。"); return; }
    if (parseDirty && !window.confirm("解析上传尚未提交，是否关闭草稿？")) return;
    if (running.current) {
      stop.current = true;
      setError("正在停止：当前请求完成后不再提交下一行，请稍候。");
      return;
    }
    if (preparing && !window.confirm("客户渠道/批次结果可能待确认，关闭后请恢复原请求，勿重复上传。是否关闭？")) return;
    if (
      entries.length &&
      completed !== entries.length &&
      !window.confirm(
        `本批次已确认保存${completed}条，剩余记录可能尚未提交。关闭后可在当前标签页恢复原批次，切勿重新上传相同表格。是否关闭？`
      )
    )
      return;
    if (
      !entries.length &&
      (grid.length || entryMode === "single") &&
      !window.confirm(entryMode === "single" ? "尚未提交的单条录入将被关闭，是否继续？" : "尚未提交的表格将被关闭，是否继续？")
    )
      return;
    props.onDirtyChange(false);
    props.onClose();
  };
  const restore = () => {
    if (savedPreparation) {
      uploadSkippedRows.current = savedPreparation.skippedRows ?? savedPreparation.confirmation?.excludedRows.length ?? 0; setSkippedRows(uploadSkippedRows.current);
      failureExport.current = savedPreparation.failureExport;
      importSession.current = savedPreparation.sessionData; latest.current.onRestoreSession?.(savedPreparation.sessionData, []);
      setPreparing(savedPreparation); setName(savedPreparation.name); setEntryMode(savedPreparation.entryMode);
      setSavedPreparation(undefined); setStep(4); props.onDirtyChange(true);
      setError("已恢复原客户准备请求，将沿用原请求号确认渠道和批次。"); return;
    }
    if (!saved) return;
    importSession.current = saved.sessionData; latest.current.onRestoreSession?.(saved.sessionData, saved.entries, saved.uploadBatch);
    setChannelId(String(saved.channelId));
    setEntries(saved.entries);
    setName(saved.name);
    uploadSkippedRows.current = saved.skippedRows ?? 0; setSkippedRows(uploadSkippedRows.current);
    failureExport.current = saved.failureExport;
    uploadBatch.current = saved.uploadBatch;
    setEntryMode(saved.entryMode === "single" && latest.current.renderSingleEntry ? "single" : "table");
    setSaved(null);
    setStep(4);
    props.onDirtyChange(true);
    setError(
      "已恢复原批次。继续上传将使用原请求号确认未知结果，不会重复创建已保存记录。"
    );
  };
  const onEscapeKeyDown = (event: KeyboardEvent) => {
    if (running.current) { event.preventDefault(); stop.current = true; }
  };
  useImperativeHandle(props.dialogControlsRef, () => ({ close, onEscapeKeyDown }));
  // Keep the initial problem-first order stable while typing; repaired rows must
  // not jump to another page or lose focus before the user finishes editing.
  if (!reviewOrder.current.length && allRows.length) reviewOrder.current = [...bad, ...allRows.filter(row => !row.errors.length)].map(row => row.row);
  const rowOrder = new Map(reviewOrder.current.map((row, index) => [row, index]));
  const reviewRows = customerMode ? [...rows].sort((a, b) => (rowOrder.get(a.row) ?? a.row) - (rowOrder.get(b.row) ?? b.row)) : rows;
  const reviewPages = Math.max(1, Math.ceil(reviewRows.length / pageSize));
  const activeReviewPage = Math.min(reviewPage, reviewPages);
  const unfinishedEntries = entries.filter(entry => entry.status !== "success");
  const resultPages = Math.max(1, Math.ceil(unfinishedEntries.length / pageSize));
  const activeResultPage = Math.min(resultPage, resultPages);
  const renderPagination = (page: number, pages: number, count: number, change: (page: number) => void, label: string) => (
    <nav className="ci-batch-pagination" aria-label={label}>
      <span>共 {count} 条</span>
      <Button type="button" variant="outline" size="sm" className="ci-button" disabled={page <= 1} onClick={() => change(page - 1)}>上一页</Button>
      <label>第 <select aria-label={`${label}页码`} value={page} onChange={event => change(Number(event.target.value))}>{Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select> / {pages} 页</label>
      <Button type="button" variant="outline" size="sm" className="ci-button" disabled={page >= pages} onClick={() => change(page + 1)}>下一页</Button>
    </nav>
  );
  const payloadDraft = (payload: Payload): Draft => ({
    partNumber: payload.partNumber, brand: payload.brand, qty: payload.qty == null ? "" : String(payload.qty),
    dateCode: payload.dateCode ?? "", price: payload.price ?? "", currency: payload.currency,
    taxIncluded: payload.taxIncluded === true ? "true" : payload.taxIncluded === false ? "false" : "unknown",
    leadTime: payload.leadTime ?? "", note: payload.note ?? "",
  });
  const queuedRows = new Set([...entries.map(entry => entry.row), ...(preparing?.rows.map(row => row.row) ?? [])]);
  const exportSnapshot = step === 4 ? failureExport.current ?? { rows: [] } : captureFailureExport();
  const exportSourceRows = new Map(exportSnapshot.rows.map(row => [row.row, row]));
  const validationFailures = exportSnapshot.rows.filter(row => row.reason && (step !== 4 || !queuedRows.has(row.row)));
  const exportRows: FailureExportRow[] = step === 4 ? [...validationFailures, ...unfinishedEntries.map(entry => ({ row: entry.row,
    draft: payloadDraft(entry.payload), cells: exportSourceRows.get(entry.row)?.cells, sources: exportSourceRows.get(entry.row)?.sources, reason: entry.status === "unknown"
    ? `待确认（非已确认失败），请按原请求重试${entry.error ? `：${entry.error}` : ""}`
    : `未完成 / 等待上传${entry.error ? `：${entry.error}` : ""}` }))] : validationFailures;
  const exportDraftCell = (draft: Draft, field: typeof fields[number]) => field.key === "taxIncluded"
    ? draft.taxIncluded === "true" ? "含税" : draft.taxIncluded === "false" ? "未税" : draft.taxIncluded === "unknown" ? "待确认" : draft.taxIncluded
    : draft[field.key];
  const exportFailures = async () => {
    if (!current() || exporting || !exportRows.length) return;
    // Capture the displayed values, never change the queue, UUIDs or frozen payloads.
    if (!validateFailureExport(exportSnapshot)) { setError("原表失败导出证据无效或存在歧义，不能猜测来源。"); return; }
    const groups = new Map<string, { name: string; header: Grid[number]; mapping: Record<keyof Draft, number>; rows: { rowNumber: number; cells: Grid[number] }[] }>();
    const addRow = (row: FailureExportRow, source?: FailureExportSource) => {
      const header = source?.header ?? exportSnapshot.header ?? templateGrid()[0];
      const mapping = source?.mapping ?? exportSnapshot.mapping ?? suggestMapping(templateGrid()[0]);
      const columns = header.map((_, index) => index).filter(index => !isFailureReasonHeader(header[index]));
      const groupKey = source ? `sheet:${source.sheetIndex}` : "fallback";
      if (!groups.has(groupKey)) groups.set(groupKey, { name: source?.sheetName ?? "失败记录", header: [...columns.map(index => header[index]), "失败原因"], mapping, rows: [] });
      groups.get(groupKey)!.rows.push({ rowNumber: source?.rowNumber ?? row.row, cells: [...columns.map(index => {
        const field = fields.find(field => mapping[field.key] === index);
        return field ? exportDraftCell(row.draft, field) : (source?.cells ?? row.cells)?.[index] ?? "";
      }), row.reason] });
    };
    exportRows.forEach(row => row.sources?.length ? row.sources.forEach(source => addRow(row, source)) : addRow(row));
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      if (!current()) return;
      const workbook = XLSX.utils.book_new();
      for (const group of Array.from(groups.values())) {
        const sheet = XLSX.utils.aoa_to_sheet([group.header, ...group.rows.sort((a, b) => a.rowNumber - b.rowNumber).map(row => row.cells)]);
        sheet["!cols"] = group.header.map((_, index) => ({ wch: index === group.header.length - 1 ? 60 : 18 }));
        const base = group.name.replace(/[\\/?:*\[\]]/g, "_").slice(0, 31) || "失败记录";
        let sheetName = base, suffix = 1;
        while (workbook.SheetNames.some(name => name.toLowerCase() === sheetName.toLowerCase())) {
          const end = `_${suffix++}`; sheetName = `${base.slice(0, 31 - end.length)}${end}`;
        }
        XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
      }
      const date = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
      XLSX.writeFileXLSX(workbook, `库存_失败记录_${stamp}.xlsx`);
    } catch {
      if (current()) setError("失败记录导出失败，请重试。");
    } finally {
      if (current()) setExporting(false);
    }
  };
  const downloadOriginalFile = () => {
    if (!current() || !retryFile) return;
    try {
      const url = URL.createObjectURL(retryFile);
      const link = document.createElement("a");
      link.href = url; link.download = retryFile.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { if (current()) setError("原文件下载失败，请保留本地原文件后重试。"); }
  };
  const rowIssues = (row: typeof rows[number]) => (rowMetadata.current.get(row.row) as {
    issues?: { issueId: string; message: string; resolved: boolean; resolution: string | null; field: string }[];
  } | undefined)?.issues ?? [];
  const renderIssueControls = (row: typeof rows[number], field?: typeof fields[number]) => <>
    {rowIssues(row).filter(issue => !field || issue.field === field.key || (field.key === "partNumber" && issue.field === "source") || (field.key === "note" && issue.field === "other")).map(issue => (
      <label key={issue.issueId} className="ci-field ci-batch-issue"><span>{issue.message}</span><input aria-label={`核对问题${issue.issueId}`} maxLength={1000} disabled={modeLocked} defaultValue={issue.resolution ?? ""} placeholder="填写核实依据" onChange={event => {
        if (modeLocked || !current()) return;
        issue.resolution = event.target.value.trim() || null; issue.resolved = Boolean(issue.resolution);
        setEdits(value => ({ ...value, [row.row]: value[row.row] ?? row.draft }));
        if (issue.field === "source" && issue.resolved) setEdits(value => { const { sourceIssue, ...draft } = value[row.row] ?? row.draft; return { ...value, [row.row]: draft }; });
      }} /></label>
    ))}
    {row.draft.sourceIssue && !skipIssues && (!field || field.key === "partNumber") ? <button type="button" className="ci-inline-link" disabled={modeLocked} onClick={() => {
      if (modeLocked || !current()) return;
      const reason = window.prompt("请填写核验原始文本型号/来源精度的依据，无法核实请排除本行");
      if (reason?.trim() && !rowIssues(row).some(issue => issue.field === "source" && !issue.resolved)) { const { sourceIssue, ...draft } = row.draft; setEdits(value => ({ ...value, [row.row]: draft })); }
    }}>核实来源问题</button> : null}
  </>;
  const renderCustomerCell = (row: typeof rows[number], field: typeof fields[number]) => {
    const validValues: Draft = { partNumber: "核对", brand: "核对", qty: "", dateCode: "", price: "", currency: "CNY", taxIncluded: "unknown", leadTime: "", note: "" };
    const remainingErrors = validateDraft({ ...row.draft, [field.key]: validValues[field.key] });
    const cellErrors = validateDraft(row.draft).filter(message => !remainingErrors.includes(message));
    rowIssues(row).filter(issue => !issue.resolved && (issue.field === field.key || (field.key === "partNumber" && issue.field === "source") || (field.key === "note" && issue.field === "other"))).forEach(issue => cellErrors.push(issue.message));
    if (field.key === "partNumber" && row.draft.sourceIssue) cellErrors.push(row.draft.sourceIssue);
    if (field.key === "currency") cellErrors.push(...row.errors.filter(message => message.includes("币种")));
    const change = (value: string) => {
      if (modeLocked || !current() || step !== 3) return;
      if (field.key === "currency") { if (value === "CNY") rowCurrencyConfirmed.current.add(row.row); else rowCurrencyConfirmed.current.delete(row.row); }
      setEdits(previous => ({ ...previous, [row.row]: { ...(previous[row.row] ?? row.draft), [field.key]: value } }));
    };
    const label = `核对第${row.row}行${field.label}`;
    return <td key={field.key} className={`ci-batch-edit-cell${cellErrors.length ? " has-cell-error" : ""}`} title={cellErrors.join("；")}>
      {field.key === "currency" || field.key === "taxIncluded" ? <select className="ci-batch-cell-control" aria-label={label} aria-invalid={cellErrors.length > 0} disabled={modeLocked} value={row.draft[field.key]} onChange={event => change(event.target.value)}>
        {field.key === "currency" ? <><option value="">请选择</option>{row.draft.currency && row.draft.currency !== "CNY" ? <option value={row.draft.currency}>{row.draft.currency}</option> : null}<option value="CNY">CNY</option></>
          : <>{!["true", "false", "unknown"].includes(row.draft.taxIncluded) ? <option value={row.draft.taxIncluded}>{row.draft.taxIncluded || "请选择"}</option> : null}<option value="unknown">待确认</option><option value="true">含税</option><option value="false">未税</option></>}
      </select> : <input className="ci-batch-cell-control" aria-label={label} aria-invalid={cellErrors.length > 0} disabled={modeLocked} value={row.draft[field.key]} onChange={event => change(event.target.value)} />}
      {renderIssueControls(row, field)}
    </td>;
  };
  const content = <>
        <div
          data-testid="channel-inventory-batch-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            display: "grid",
            alignContent: "start",
            gap: "12px",
            paddingRight: "4px",
          }}
        >
          {props.renderSingleEntry ? <div className="customer-supply-methods">
            <div role="group" aria-label="客户物料上传方式" className="customer-supply-method-controls">
              <Button type="button" variant="outline" className={`ci-button${entryMode === "table" ? " ci-primary" : ""}`} aria-pressed={entryMode === "table"} disabled={modeLocked} onClick={() => changeMode("table")}>表格上传</Button>
              <Button type="button" variant="outline" className={`ci-button${entryMode === "single" ? " ci-primary" : ""}`} aria-pressed={entryMode === "single"} disabled={modeLocked} onClick={() => changeMode("single")}>{customerMode ? "手动录入" : "单条上传"}</Button>
              {!customerMode && props.renderParseEntry ? <Button type="button" variant="outline" className={`ci-button${entryMode === "parse" ? " ci-primary" : ""}`} aria-pressed={entryMode === "parse"} disabled={modeLocked} onClick={() => changeMode("parse")}>解析上传</Button> : null}
            </div>
            {modeLocked ? <p className="ci-dialog-note">请先完成或恢复原批次。</p> : null}
          </div> : null}
          {customerMode && props.renderParseEntry ? <details className="ci-batch-note" open={entryMode === "parse" || (step === 3 && mapping.partNumber < 0)}>
            <summary>其他方式</summary><p>无法识别表格时，可提交原文件供人工整理；不会自动调用解析。</p>
            <Button type="button" variant="outline" className="ci-button" disabled={modeLocked} onClick={() => changeMode("parse")}>提交原文件人工整理</Button>
          </details> : null}
          {entryMode === "parse" && props.renderParseEntry ? props.renderParseEntry({ onDirtyChange: dirty => { setParseDirty(dirty); props.onDirtyChange(dirty); }, onBusyChange: setParseBusy }) : null}
          {entryMode !== "parse" ? <div className={`ci-batch-steps${customerMode ? " ci-batch-three-step" : ""}`} style={{ padding: "0" }} aria-label={customerMode ? "上传进度：选文件、核对物料、上传结果" : undefined}>
            {(customerMode ? [entryMode === "single" ? "填写物料" : "选文件", "核对物料", "上传结果"] : entryMode === "single" ? ["填写物料", "预览确认"] : ["选文件", "匹配字段", "确认上传"]).map((label, i) => (
              <span key={label} aria-current={customerMode && step === [1, 3, 4][i] ? "step" : undefined} className={step >= (customerMode ? [1, 3, 4][i] : entryMode === "single" && i === 1 ? 3 : i + 1) ? "is-active" : ""}>
                <b>{step > (customerMode ? [1, 3, 4][i] : entryMode === "single" && i === 1 ? 3 : i + 1) ? "✓" : i + 1}</b>
                {label}
              </span>
            ))}
          </div> : null}
          {props.sourceDetails}
          {!props.fixedSource ? <div className="ci-batch-channel" style={{ gap: "12px", paddingBottom: "9px" }}>
            <label className="ci-field">
              <span>{props.sourceLabel ? "客户供应来源" : "关联渠道 *"}</span>
              {props.onCreateCustomerBatch && !channels.length ? <strong>{props.sourceLabel}</strong> : null}
              <select
                className="ci-batch-control"
                aria-label="批量关联渠道"
                value={channelId}
                disabled={hasQueue || busy || props.fixedSource}
                onChange={e => setChannelId(e.target.value)}
              >
                <option value="">请选择渠道</option>
                {channels.map(c => (
                  <option key={c.id} value={c.id} disabled={!c.active}>
                    {c.name}
                    {c.active ? "" : "（已停用）"}
                  </option>
                ))}
              </select>
            </label>
            {!props.fixedSource ? <p style={{ paddingBottom: "4px" }}>
              <Icon kind="lock" size={14} />
              本批使用同一渠道
            </p> : null}
          </div> : null}
          {channelTotal !== null && channels.length < channelTotal && (
            <p className="ci-dialog-note">
              已加载 {channels.length} / {channelTotal} 个渠道。
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ci-inline-link"
                onClick={props.onLoadMoreChannels}
                disabled={props.loadingMoreChannels || busy}
              >
                {props.loadingMoreChannels ? "正在加载…" : "加载更多渠道"}
              </Button>
            </p>
          )}
          {(saved || savedPreparation) && (
            <div className="ci-batch-resume">
              <Icon kind="file" />
              <div>
                <strong>发现本标签页未完成的上传批次</strong>
                <p>
                  已确认{" "}
                  {saved?.entries.filter(e => e.status === "success").length ?? 0} /{" "}
                  {saved?.entries.length ?? savedPreparation?.rows.length} 条。建议恢复原批次，不要重复上传表格。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="ci-button ci-primary"
                onClick={restore}
              >
                恢复原批次
              </Button>
            </div>
          )}
          {props.renderSingleEntry ? <div hidden={entryMode !== "single" || step !== 1}>
            {props.renderSingleEntry({ onPreview: previewSingle, disabled: modeLocked || !sourceReady || step !== 1 || entryMode !== "single" })}
          </div> : null}
          {step === 1 && entryMode === "table" && (
          <>
            <section className={customerMode ? "ci-batch-file-selection" : undefined} aria-label="选择库存文件">
            <div
              className={`ci-batch-drop ${dragging ? "is-dragging" : ""}`}
              style={{ minHeight: customerMode ? "124px" : "160px", padding: "10px 12px", gap: "5px" }}
              aria-busy={loading}
              onDragOver={e => {
                e.preventDefault();
                if (!saved && !savedPreparation && !restoreBlocked) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file && !loading && !saved && !savedPreparation && !restoreBlocked) void selectFile(file);
              }}
            >
              <Icon kind="upload" size={24} />
              <strong>
                {loading
                  ? fileStage === "original" ? "正在保存并核验原文件…" : "正在读取表格…"
                  : customerMode ? "拖拽库存表格到这里" : "拖拽库存表格到这里，或选择文件"}
              </strong>
              {customerMode ? <p>{loading ? "请勿重复提交，完成后自动进入核对。" : "或点击底部“选择库存表格”"}</p> : null}
              <input
                hidden
                ref={fileInput}
                type="file"
                aria-label="上传库存表格"
                accept=".xlsx,.xls,.csv"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void selectFile(file);
                  e.target.value = "";
                }}
              />
              {!customerMode ?
              <Button
                type="button"
                className="ci-button ci-primary"
                disabled={loading || !!saved || !!savedPreparation || restoreBlocked}
                onClick={() => fileInput.current?.click()}
              >
                <Icon kind="upload" size={15} />
                选择库存表格
              </Button> : null}
              {customerMode ? <small>Excel / CSV · 5MB以内 · 每批最多1000行</small> : null}
            </div>
            {customerMode && retryFile ? <div className="ci-batch-file ci-batch-retry-file"><Icon kind="file" /><div><strong>{retryFile.name}</strong><p>保留原文件和请求号，重试不会另起未知批次。</p></div><button type="button" className="ci-inline-link" onClick={downloadOriginalFile}>下载原文件</button></div> : null}
            {customerMode && error ? <div className="ci-error ci-batch-file-error" role="alert"><strong>{fileErrorStage || "暂无法继续上传"}</strong><p>{error}</p></div> : null}
            </section>
            {!customerMode && retryFile ? <><Button type="button" className="ci-button" disabled={loading} onClick={() => void selectFile(retryFile, true)}>按原文件重试保存／读取</Button>
              <button type="button" className="ci-inline-link" onClick={downloadOriginalFile}>下载原文件：{retryFile.name}</button></> : null}
            <button
              className="ci-batch-template"
              type="button"
              onClick={() => void download()}
            >
              <Icon kind="file" size={15} />
              下载空白Excel模板
            </button>
            <details className="ci-batch-note">
              <summary>填写说明</summary>
              <p>
                .xlsx/.xls/.csv，5MB内，最多1000条；首行为表头，仅读首张工作表。
              </p>
            </details>
          </>
        )}
        {step === 2 && (
          <>
            <div className="ci-batch-file">
              <Icon kind="file" />
              <div>
                <strong>{name}</strong>
                <p>识别到 {rows.length} 条非空记录；请核对字段对应关系。</p>
              </div>
            </div>
            <div className="ci-batch-mapping">
              {fields.map(f => (
                <label className="ci-field" key={f.key}>
                  <span>
                    {f.label}
                    {f.required ? " *" : ""}
                  </span>
                  <select
                    aria-label={`匹配${f.label}`}
                    className="ci-batch-control"
                    value={mapping[f.key]}
                    onChange={e => {
                      if (isFailureReasonHeader(grid[0]?.[Number(e.target.value)])) return;
                      setMapping(v => ({
                        ...v,
                        [f.key]: Number(e.target.value),
                      }));
                    }}
                  >
                    <option value={-1}>不导入 / 留空</option>
                    {(grid[0] ?? []).map((header, i) => (
                      <option key={i} value={i} disabled={isFailureReasonHeader(header)}>
                        {String(header || `第${i + 1}列`)}
                      </option>
                    ))}
                  </select>
                  {mapping[f.key] >= 0 && (
                    <small>
                      示例：{String(grid[1]?.[mapping[f.key]] ?? "") || "空白"}
                    </small>
                  )}
                </label>
              ))}
            </div>
            {mappingErrors.length > 0 && (
              <div className="ci-error">{mappingErrors.join("；")}</div>
            )}
          </>
        )}
        {(step === 3 || step === 4) ? props.renderConfirmationDetails?.() : null}
        {step === 3 && (
          <>
            {customerMode ? <div className="ci-batch-toolbar"><strong>核对库存</strong><Button type="button" variant="outline" size="sm" className="ci-button" disabled={exporting || !exportRows.length} onClick={() => void exportFailures()}>{exporting ? "正在导出…" : "导出失败记录"}</Button></div> : null}
            {customerMode && entryMode === "table" ? <>
              <div className="ci-batch-file"><Icon kind="file" /><div><strong>{name}</strong></div></div>
              {mappingNeedsReview.length ? <section aria-label="需要调整的列匹配"><p className="ci-error">以下列无法识别或存在歧义，请调整匹配；缺品牌也可批量补齐空白。</p>{renderMapping(mappingNeedsReview)}</section> : null}
              <p className="ci-batch-header-hint" id="ci-customer-header-hint">自动识别仅供参考，可直接使用表头下拉框调整原表列。调整只重读该字段（覆盖该字段编辑），其他编辑保留；原文件不变。</p>
              <details className="ci-batch-note"><summary>调整列匹配</summary>{renderMapping(fields.filter(field => !mappingNeedsReview.some(item => item.key === field.key)))}<p>未匹配列不会导入。同一原表列不能重复匹配；调整币种列后须重新确认币种。</p></details>
              {mappingErrors.length ? <div className="ci-error" role="alert">{mappingErrors.join("；")}</div> : null}
            </> : null}
            <div className="ci-batch-summary">
              {skipIssues ? <span>可导入 <b>{goodRows.length}</b> 条 · 问题 <b>{bad.length}</b> 条</span> : <><span>
                <b>{rows.length - bad.length}</b> 条通过校验
              </span>
              <span className={bad.length ? "ci-batch-red" : ""}>
                <b>{bad.length}</b> 条需要修正
              </span></>}
              {excluded.length > 0 && <small>已移除 {excluded.length} 条</small>}
              {skipIssues && exclusionUndo.length > 0 && (
                <Button type="button" variant="ghost" size="sm" className="ci-inline-link" onClick={() => {
                  const removed = exclusionUndo[exclusionUndo.length - 1];
                  setExcluded(value => value.filter(row => !removed.includes(row)));
                  removed.forEach(row => { delete excludedReasons.current[row]; });
                  setExclusionUndo(value => value.slice(0, -1));
                }}>撤销移除</Button>
              )}
            </div>
            {historyOptIn && customerMode && (currencyConfirmed || rows.some(row => row.currencyNeedsConfirmation || row.draft.currency.trim() !== "CNY")) ? <label className="ci-field">
              <span>币种</span>
              <select className="ci-batch-control" aria-label="明确确认本次核对币种为CNY" value={currencyConfirmed ? "CNY" : ""} onChange={event => {
                if (modeLocked || !current()) return;
                const confirmed = event.target.value === "CNY"; setCurrencyConfirmed(confirmed);
                rowCurrencyConfirmed.current.clear();
                if (confirmed) setEdits(value => ({ ...value, ...Object.fromEntries(rows.map(row => [row.row, { ...row.draft, currency: "CNY" }])) }));
              }}><option value="">请选择</option><option value="CNY">CNY</option></select>
            </label> : historyOptIn && !customerMode ? <label className="ci-dialog-note"><input type="checkbox" aria-label="明确确认本次核对币种为CNY" checked={currencyConfirmed} onChange={e => setCurrencyConfirmed(e.target.checked)} /> 我已核对本次所选物料币种为CNY（不自动换算外币）；未知数量、价格和税务口径请核对后编辑，或注明问题排除。</label> : null}
            {customerMode && historyOptIn && rows.some(row => !row.draft.brand.trim()) ? <div className="ci-batch-channel">
              <label className="ci-field"><span>批量补齐空白品牌</span><input aria-label="空白行品牌" maxLength={64} value={blankBrand} onChange={event => setBlankBrand(event.target.value)} /></label>
              <Button type="button" variant="outline" className="ci-button" disabled={!blankBrand.trim()} onClick={() => setEdits(value => ({ ...value, ...Object.fromEntries(rows.filter(row => !row.draft.brand.trim()).map(row => [row.row, { ...row.draft, brand: blankBrand.trim() }])) }))}>仅填空白品牌</Button>
            </div> : null}
            {bad.length > 0 && (
              <div className="ci-error ci-batch-errors">
                <div>
                  {skipIssues ? "问题行可修改或移除；导入时将跳过。" : customerMode ? "修改问题行或移除后导入。" : "请修正文件后重新上传，或明确移除错误行。不会静默跳过错误记录。"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ci-button"
                  onClick={() => {
                    if (skipIssues) {
                      const removed = bad.map(row => row.row);
                      removed.forEach(row => { excludedReasons.current[row] = "用户移除"; });
                      setExcluded(value => [...value, ...removed]);
                      setExclusionUndo(value => [...value, removed]);
                    } else if (historyOptIn) bad.forEach(r => excludeRow(r.row));
                    else setExcluded(v => [...v, ...bad.map(r => r.row)]);
                  }}
                >
                  {skipIssues ? "移除全部问题行" : "移除全部错误行"}
                </Button>
              </div>
            )}
            {customerMode ? renderPagination(activeReviewPage, reviewPages, reviewRows.length, setReviewPage, "核对表分页") : null}
            <div className={`ci-batch-preview${customerMode ? " ci-batch-review" : ""}`} tabIndex={0} aria-label={customerMode ? "库存核对表，可横向和纵向滚动" : "库存预览"}>
              <table>
                <thead>
                  <tr>
                    <th>原表行号</th>
                    {customerMode ? fields.map(field => <th key={field.key} scope="col">
                      <span>{field.label}{field.required ? " *" : ""}</span>
                      {entryMode === "table" ? <div className="ci-batch-header-mapping">
                        <select aria-label={`表头匹配${field.label}`} aria-describedby="ci-customer-header-hint" className="ci-batch-control" disabled={modeLocked || !current()} value={mapping[field.key]} onChange={event => changeMapping(field.key, Number(event.target.value))}>
                          <option value={-1}>不导入 / 留空</option>
                          {(grid[0] ?? []).map((header, index) => <option key={index} value={index} disabled={isFailureReasonHeader(header)}>{`第${index + 1}列 · ${String(header || "空白表头")}`}</option>)}
                        </select>
                        <small title={mapping[field.key] >= 0 ? String(grid[1]?.[mapping[field.key]] ?? "") : undefined}>{mapping[field.key] >= 0 ? `示例：${String(grid[1]?.[mapping[field.key]] ?? "") || "空白"}` : field.required ? "待匹配或手工补齐" : "未匹配"}</small>
                      </div> : null}
                    </th>) : <>
                    <th>料号 / 品牌</th>
                    <th>可供数量</th>
                    <th>报价 CNY</th>
                    <th>税务口径</th>
                    {entryMode === "single" ? <><th>交期</th><th>Date Code</th><th>备注（仅本人）</th></> : null}
                    </>}
                    <th>校验</th>
                    {historyOptIn && !customerMode ? <th>人工核对编辑</th> : null}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(customerMode ? reviewRows.slice((activeReviewPage - 1) * pageSize, activeReviewPage * pageSize) : rows.slice(0, 100)).map(r => (
                    <tr
                      key={r.row}
                      className={r.errors.length ? "has-error" : ""}
                    >
                      <td>{r.row}</td>
                      {customerMode ? fields.map(field => renderCustomerCell(r, field)) : <>
                      <td>
                        <strong>{r.draft.partNumber || "—"}</strong>
                        <small>{r.draft.brand || "—"}</small>
                      </td>
                      <td>{r.draft.qty || "待确认"}</td>
                      <td>{r.draft.price || (customerMode ? "未填写" : "面议")}{customerMode ? <small>{r.draft.currency || "币种未确认"}</small> : null}</td>
                      <td>
                        {r.draft.taxIncluded === "true"
                          ? "含税"
                          : r.draft.taxIncluded === "false"
                            ? "未税"
                          : "待确认"}
                      </td>
                      {entryMode === "single" ? <><td>{r.draft.leadTime || "待确认"}</td><td>{r.draft.dateCode || "—"}</td><td>{r.draft.note || "—"}</td></> : null}
                      </>}
                      <td>
                        {r.errors.length ? (
                          <span className="ci-batch-red">
                            {r.errors.join("；")}
                          </span>
                        ) : (
                          <span className="ci-batch-green">✓ 通过</span>
                        )}
                      </td>
                      {historyOptIn && !customerMode ? <td>{fields.map(f => <label key={f.key} className="ci-field"><span>{f.label}</span><input aria-label={`核对第${r.row}行${f.label}`} value={r.draft[f.key]} onChange={e => setEdits(v => ({ ...v, [r.row]: { ...r.draft, [f.key]: e.target.value } }))} /></label>)}{renderIssueControls(r)}</td> : null}
                      <td>
                        <button
                          type="button"
                          title={`移除原表第${r.row}行`}
                          aria-label={`移除原表第${r.row}行`}
                          onClick={() => excludeRow(r.row)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!customerMode ? <p className="ci-batch-preview-note">
              {entryMode === "single" ? "确认后新增此条物料。" : `预览前100条，确认后新增全部 ${rows.length} 条。`}
            </p> : null}
          </>
        )}
        {step === 4 && (
          <>
            <div className="ci-batch-toolbar"><strong>上传结果</strong><Button type="button" variant="outline" size="sm" className="ci-button" disabled={busy || exporting || !exportRows.length} onClick={() => void exportFailures()}>{exporting ? "正在导出…" : "导出失败记录"}</Button></div>
            <div className="ci-batch-result">
              <Icon
                kind={
                  completed === entries.length && entries.length && !preparing
                    ? "check"
                    : "upload"
                }
                size={31}
              />
              <h3>
                {busy
                  ? "正在按行上传，请勿重复提交"
                  : completed === entries.length && entries.length > 0 && !preparing
                    ? props.confirmationLabel ? "全部提交成功" : skipIssues ? `已导入${completed}条 · 跳过${skippedRows}条` : "本批渠道库存已保存"
                    : "上传已暂停 / 中断"}
              </h3>
              <p>
                已确认保存 <strong>{completed}</strong> / {preparing?.rows.length ?? entries.length} 条
              </p>
              {customerMode ? <p>待确认 {entries.filter(entry => entry.status === "unknown").length} 条；未完成 {(preparing?.rows.length ?? entries.length) - completed} 条</p> : null}
              {skipIssues && (busy || preparing || completed < entries.length) ? <p>跳过{skippedRows}条</p> : null}
              {uploadBatch.current?.id ? <small>上传批次：{uploadBatch.current.batchCode || `#${uploadBatch.current.id}`}</small> : null}
              <progress value={completed} max={entries.length || 1} />
              <small>
                每行独立保存；暂停不会撤回已保存行。继续时沿用原请求号，未知结果会安全重试确认。
              </small>
            </div>
            {preparing && !busy ? <p className="ci-batch-preview-note">客户批次结果待确认，请沿用原请求重试。</p> : null}
            {unfinishedEntries.some(entry => entry.status === "unknown") ? <p className="ci-batch-preview-note">待确认不代表已失败；已发出的内容不可编辑，请沿用原请求重试。</p> : null}
            {renderPagination(activeResultPage, resultPages, unfinishedEntries.length, setResultPage, "结果表分页")}
            <div className="ci-batch-preview">
              <table>
                <thead>
                  <tr>
                    <th>原表行号</th>
                    <th>料号</th>
                    <th>状态</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {unfinishedEntries
                    .slice((activeResultPage - 1) * pageSize, activeResultPage * pageSize)
                    .map(e => (
                      <tr key={e.requestId}>
                        <td>{e.row}</td>
                        <td>{e.payload.partNumber}</td>
                        <td>
                          {e.status === "unknown"
                            ? "待确认 / 重试"
                            : "等待上传"}
                        </td>
                        <td className="ci-batch-red">{e.error ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && !(customerMode && step === 1 && entryMode === "table") && (
          <div className="ci-error" role="alert">
            {error}
          </div>
        )}
        </div>
        <div
          className={`ci-dialog-footer ci-batch-footer${customerMode ? " ci-batch-footer-customer" : ""}`}
          style={{
            flex: "0 0 auto",
            marginTop: 0,
            paddingTop: "10px",
            borderTop: "1px solid #e8edf3",
          }}
        >
          {customerMode && step === 1 && entryMode === "table" ? <p className="ci-batch-footer-status" role="status">{loading ? fileStage === "original" ? "保存／核验原文件中…" : "读取表格中…" : retryFile ? "请沿用原文件重试" : "选好文件后自动进入核对"}</p> : null}
          {step > 1 && !hasQueue && (!customerMode || (!preparing && !busy)) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ci-button"
              disabled={loading}
              onClick={() => {
                setStep(customerMode || entryMode === "single" ? 1 : step === 3 ? 2 : 1);
                setError("");
              }}
            >
              {customerMode ? entryMode === "single" ? "返回录入" : "返回文件" : "上一步"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ci-button"
            onClick={close}
          >
            {customerMode ? "关闭" : busy
              ? "停止后关闭"
              : hasQueue && completed === entries.length
                ? "完成"
                : "取消"}
          </Button>
          {customerMode && step === 1 && entryMode === "table" ? <Button type="button" className="ci-button ci-primary" disabled={loading || !!saved || !!savedPreparation || restoreBlocked} onClick={() => retryFile ? void selectFile(retryFile, true) : fileInput.current?.click()}><Icon kind="upload" size={15} />{loading ? "处理中…" : retryFile ? "重试原文件" : "选择库存表格"}</Button> : null}
          {step === 2 && (
            <Button
              type="button"
              className="ci-button ci-primary"
              size="sm"
              disabled={!!mappingErrors.length || !rows.length}
              onClick={() => {
                setExcluded([]);
                setStep(3);
              }}
            >
              预览并校验
            </Button>
          )}
          {step === 3 && (
            <>
            {customerMode && confirmDisabledReason ? <p id="customer-import-disabled-reason" className="ci-dialog-note" role="status">暂不能导入：{confirmDisabledReason}</p> : null}
            <Button
              type="button"
              size="sm"
              className="ci-button ci-primary"
              aria-describedby={customerMode && confirmDisabledReason ? "customer-import-disabled-reason" : undefined}
              disabled={customerMode ? Boolean(confirmDisabledReason) :
                !sourceReady ||
                !!bad.length ||
                !rows.length ||
                !!mappingErrors.length
              }
              onClick={() => void start()}
            >
              {props.confirmationLabel ?? (skipIssues ? `导入${goodRows.length}条` : customerMode ? `确认导入 ${rows.length} 条` : `确认上传 ${rows.length} 条`)}
            </Button>
            {skipIssues ? <span className="ci-dialog-note" role="status">跳过{pendingSkipCount}条</span> : null}
            </>
          )}
          {step === 4 && (preparing || completed < entries.length) && (
            <Button
              type="button"
              size="sm"
              className="ci-button ci-primary"
              disabled={busy || !sourceReady}
              onClick={() => void start()}
            >
              {customerMode ? "继续处理未完成（沿用原请求）" : "按原批次继续 / 重试"}
            </Button>
          )}
          {step === 4 && completed > 0 && props.onViewResults && (
            <Button type="button" variant="outline" size="sm" className="ci-button" disabled={busy || (customerMode && (Boolean(preparing) || completed !== entries.length))}
              onClick={() => props.onViewResults?.(entries)}>
              {customerMode ? "查看物料" : "查看已上传结果 / 完成"}
            </Button>
          )}
          {busy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ci-button"
              onClick={() => {
                stop.current = true;
                setError("将在当前请求结束后暂停。");
              }}
            >
              暂停上传
            </Button>
          )}
        </div>
      </>;
  if (props.dialogMode === "content") return content;
  return <Dialog open onOpenChange={(value: boolean) => !value && close()}>
    <DialogContent className="ci-dialog ci-batch-dialog" data-testid="channel-inventory-batch-dialog"
      aria-describedby={undefined} style={batchUploadDialogStyle} onEscapeKeyDown={onEscapeKeyDown}
      onPointerDownOutside={(event: Event) => event.preventDefault()}>
      <DialogHeader style={{ flex: "0 0 auto" }}><DialogTitle>{props.sourceLabel ? "上传客户物料" : "表格上传渠道库存"}</DialogTitle></DialogHeader>
      {content}
    </DialogContent>
  </Dialog>;
}
