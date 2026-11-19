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
export type CustomerInitialRecovery = { channelId: number; entries: ManagedBatchEntry[]; name: string; sessionData?: unknown; uploadBatch: PersistentUploadBatch };
type Grid = (string | number | null | undefined)[][];
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
  customerSourceReady?: boolean;
  onOriginalFilePersist?: (file: File) => Promise<{ sessionData: unknown; rows: { row: number; metadata: unknown }[] }>;
  initialRows?: { row: number; draft: Draft; metadata: unknown }[];
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
};
export type BatchUploadDialogControls = { close: () => void; onEscapeKeyDown: (event: KeyboardEvent) => void };
export const batchUploadDialogStyle: React.CSSProperties = {
  width: "min(880px, calc(100vw - 24px))", maxWidth: "880px",
  height: "min(85dvh, 680px)", maxHeight: "85dvh", display: "flex",
  flexDirection: "column", gap: "12px", overflow: "hidden", padding: "18px",
};
type CustomerPreparation = { confirmation?: CustomerConfirmRows; rows: { row: number; requestId: string; draft: Draft }[]; requestId: string; name: string; sessionData?: unknown; entryMode: "table" | "single" };
type SavedBatch = { channelId: number; entries: ManagedBatchEntry[]; name: string; sessionData?: unknown; entryMode?: "table" | "single"; uploadBatch?: PersistentUploadBatch };
const storageKey = (props: Props) => `d51-channel-inventory-batch-v1:${props.actorUserId}:${props.enterpriseId}${props.storageKeySuffix ? `:${props.storageKeySuffix}` : ""}`;
function readSavedBatch(props: Props): { saved: SavedBatch | null; preparation?: CustomerPreparation; error: string; blocked: boolean } {
  const empty = { saved: null, error: "", blocked: false };
  try {
    const raw = sessionStorage.getItem(storageKey(props));
    if (!raw) return props.initialRecovery ? { saved: props.initialRecovery, error: "", blocked: false } : empty;
    const data = JSON.parse(raw);
    if (data.version === 2 && data.phase === "customer-source" && props.onCreateCustomerBatch
      && data.actorUserId === props.actorUserId && data.enterpriseId === props.enterpriseId) {
      const preparation = data.preparation as CustomerPreparation;
      if (preparation && /^[-0-9a-f]{36}$/i.test(preparation.requestId)
        && typeof preparation.name === "string" && preparation.name.length > 0
        && ["table", "single"].includes(preparation.entryMode) && Array.isArray(preparation.rows)
        && preparation.rows.length > 0 && preparation.rows.length <= 1000
        && preparation.rows.every(row => Number.isSafeInteger(row.row) && row.row > 0
          && /^[-0-9a-f]{36}$/i.test(row.requestId) && row.draft && validateDraft(row.draft).length === 0)
        && (!props.validateSavedSession || props.validateSavedSession(preparation.sessionData, [])))
        return { saved: null, preparation, error: "", blocked: false };
      return { saved: null, blocked: true, error: "原客户上传准备记录无效，已阻止另起批次，请核实原请求。" };
    }
    if (data.version === 1 && data.actorUserId === props.actorUserId && data.enterpriseId === props.enterpriseId
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
      return { saved: data, error: "", blocked: false };
    }
    if (props.storageKeySuffix || props.onCreateBatch || props.onCreateCustomerBatch) return { saved: null, blocked: true, error: "原批次恢复记录无效，已阻止重复导入，请核实原上传结果。" };
    return empty;
  } catch {
    return { saved: null, blocked: Boolean(props.onCreateBatch || props.onCreateCustomerBatch), error: "无法读取上次上传记录；请检查浏览器会话存储权限。" };
  }
}
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
  // Read synchronously once for this namespace: no post-paint resume-banner jump.
  const [initial] = useState(() => readSavedBatch(props));
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
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const restoreBlocked = initial.blocked;
  const [entryMode, setEntryMode] = useState<"table" | "single" | "parse">("table");
  const [parseDirty, setParseDirty] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [edits, setEdits] = useState<Record<number, Draft>>({});
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const customerMode = Boolean(props.onOriginalFilePersist);
  const [reviewedMapping, setReviewedMapping] = useState<(keyof Draft)[]>([]);
  const [blankBrand, setBlankBrand] = useState("");
  const excludedReasons = useRef<Record<number, string>>({});
  const rowMetadata = useRef(new Map<number, unknown>(props.initialRows?.map(r => [r.row, r.metadata]) ?? []));
  const importSession = useRef<unknown>(props.sessionData);
  importSession.current = props.sessionData ?? importSession.current;
  const [saved, setSaved] = useState<SavedBatch | null>(initial.saved);
  const [savedPreparation, setSavedPreparation] = useState(initial.preparation);
  const [preparing, setPreparing] = useState<CustomerPreparation | undefined>();
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
    setMapping(suggested);
    setName(fileName);
    setExcluded([]); setEdits({}); setCurrencyConfirmed(false); excludedReasons.current = {};
    setReviewedMapping([]); setBlankBrand("");
    setError("");
    setStep(customerMode ? 3 : 2);
    latest.current.onDirtyChange(true);
  };
  const selectFile = async (file: File, retry = false) => {
    const token = ++serial.current;
    setError("");
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("请选择 Excel（.xlsx/.xls）或 CSV 文件。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("每份文件最多 5MB，请拆分后上传。");
      return;
    }
    setLoading(true);
    try {
      if (latest.current.onOriginalFilePersist) {
        const original = retry && persistedFile.current?.file === file ? persistedFile.current.result : await latest.current.onOriginalFilePersist(file);
        persistedFile.current = { file, result: original };
        if (!current() || token !== serial.current) return;
        importSession.current = original.sessionData;
        rowMetadata.current = new Map(original.rows.map(r => [r.row, r.metadata]));
      }
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
      if (current() && token === serial.current) { setRetryFile(file); }
      if (current() && token === serial.current)
        setError(
          e instanceof Error ? e.message : "文件读取失败，请用模板整理后重试。"
        );
    } finally {
      if (current() && token === serial.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (initial.saved || initial.preparation || initial.blocked) return;
    if (props.initialRows?.length) {
      loadGrid([fields.map(f => f.label), ...props.initialRows.map(r => fields.map(f => r.draft[f.key]))], props.initialFile?.name ?? "解析结果核对");
      setEdits(Object.fromEntries(props.initialRows.map((r, i) => [i + 2, r.draft])));
      rowMetadata.current = new Map(props.initialRows.map((r, i) => [i + 2, r.metadata]));
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
  const allRows = mapGrid(grid, mapping, rawGrid).map(r => {
    let draft = edits[r.row] ?? r.draft;
    if (historyOptIn && !edits[r.row] && mapping.currency < 0) draft = { ...draft, currency: "" };
    const metadata = rowMetadata.current.get(r.row) as { issues?: { field: string; resolved: boolean }[] } | undefined;
    const originalCurrency = mapping.currency < 0 ? "" : String(grid[r.row - 1]?.[mapping.currency] ?? "").trim();
    const currencyNeedsConfirmation = customerMode && historyOptIn && (!originalCurrency || r.draft.currency !== "CNY" || Boolean(metadata?.issues?.some(issue => issue.field === "currency" && !issue.resolved)));
    if (customerMode && historyOptIn && !edits[r.row] && !originalCurrency) draft = { ...draft, currency: "" };
    if (currencyConfirmed && !customerMode) draft = { ...draft, currency: "CNY" };
    const errors = validateDraft(draft);
    if (historyOptIn && metadata?.issues?.some(issue => (issue.field === "source" || issue.field === "other") && !issue.resolved)) errors.push("来源或其他问题尚未填写核实依据");
    if (historyOptIn && draft.currency.trim() !== "CNY") errors.push("币种待人工明确CNY；不能默认或换算外币");
    if (currencyNeedsConfirmation && !currencyConfirmed) errors.push("请明确选择本次候选币种为CNY");
    if (historyOptIn && !rowMetadata.current.has(r.row)) errors.push("缺少服务端原行证据，不能猜测来源");
    return { ...r, draft, errors, currencyNeedsConfirmation };
  });
  const rows = allRows.filter(r => !excluded.includes(r.row));
  const excludeRow = (row: number) => {
    if (historyOptIn) {
      const reason = window.prompt(`请填写原表第${row}行的排除原因（1至1000字）`);
      if (!reason?.trim() || reason.trim().length > 1000) { setError("排除行必须填写1至1000字原因。"); return; }
      excludedReasons.current[row] = reason.trim();
    }
    setExcluded(v => [...v, row]);
  };
  const bad = rows.filter(r => r.errors.length);
  const mappingErrors = validateMapping(mapping).filter(message => !(customerMode && mapping.brand === -1 && rows.length > 0 && rows.every(row => row.draft.brand.trim()) && message === "品牌为必填字段，必须映射列"));
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
  const confirmDisabledReason = !current() ? "客户或授权已变化，请重新核验" : modeLocked ? "请先完成或恢复原批次" : !sourceReady ? "请先核实客户来源、工作表范围及全局问题" : mappingErrors.length ? mappingErrors.join("；") : !rows.length ? "没有可导入的候选行" : bad.length ? `还有 ${bad.length} 条需要核对：${bad[0].errors.join("；")}` : "";
  const changeMapping = (field: keyof Draft, column: number) => {
    setMapping(value => ({ ...value, [field]: column }));
    setReviewedMapping(value => [...value, field]);
    setEdits({}); setCurrencyConfirmed(false);
  };
  const renderMapping = (items: typeof fields) => <div className="ci-batch-mapping">{items.map(field => <label className="ci-field" key={field.key}>
    <span>{field.label}{field.required ? " *" : ""}</span>
    <select aria-label={`匹配${field.label}`} className="ci-batch-control" value={mapping[field.key]} onChange={event => changeMapping(field.key, Number(event.target.value))}>
      <option value={-1}>不导入 / 留空</option>{(grid[0] ?? []).map((header, index) => <option key={index} value={index}>{String(header || `第${index + 1}列`)}</option>)}
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
      if (mappingErrors.length || bad.length || !rows.length) {
        setError("请完成字段匹配并修正错误行。"); return;
      }
      if (latest.current.onCreateCustomerBatch) {
        preparation = { requestId: uuid(), name, entryMode: entryMode === "single" ? "single" : "table", sessionData: importSession.current,
          rows: rows.map(r => ({ row: r.row, requestId: uuid(), draft: r.draft })) };
        if (historyOptIn) preparation.confirmation = { batchRequestId: preparation.requestId, sessionData: importSession.current,
          confirmedDrafts: preparation.rows.map(r => ({ row: r.row, rowRequestId: r.requestId, draft: r.draft, metadata: rowMetadata.current.get(r.row) })),
          excludedRows: allRows.filter(r => excluded.includes(r.row)).map(r => ({ row: r.row, reason: excludedReasons.current[r.row] ?? "", metadata: rowMetadata.current.get(r.row) })) };
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
  const renderCustomerFields = (row: typeof rows[number]) => {
    const issues = (rowMetadata.current.get(row.row) as { issues?: { field: string; resolved: boolean }[] } | undefined)?.issues ?? [];
    const validValues: Draft = { partNumber: "核对", brand: "核对", qty: "", dateCode: "", price: "", currency: "CNY", taxIncluded: "unknown", leadTime: "", note: "" };
    const editable = fields.filter(field => field.key !== "currency");
    const problemFields = editable.filter(field => validateDraft({ ...row.draft, [field.key]: validValues[field.key] }).length < validateDraft(row.draft).length || issues.some(issue => !issue.resolved && issue.field === field.key));
    const input = (field: typeof fields[number]) => <label key={field.key} className="ci-field"><span>{field.label}</span><input aria-label={`核对第${row.row}行${field.label}`} value={row.draft[field.key]} onChange={event => setEdits(value => ({ ...value, [row.row]: { ...row.draft, [field.key]: event.target.value } }))} /></label>;
    return <>{problemFields.map(input)}<details><summary>{row.errors.length ? "编辑其他字段" : "编辑本行"}</summary>{editable.filter(field => !problemFields.includes(field)).map(input)}</details></>;
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
          {customerMode && props.renderParseEntry ? <details className="ci-batch-note" open={entryMode === "parse" || (step === 3 && mapping.partNumber < 0) || Boolean(retryFile)}>
            <summary>其他方式</summary><p>无法识别表格时，可提交原文件供人工整理；不会自动调用解析。</p>
            <Button type="button" variant="outline" className="ci-button" disabled={modeLocked} onClick={() => changeMode("parse")}>提交原文件人工整理</Button>
          </details> : null}
          {entryMode === "parse" && props.renderParseEntry ? props.renderParseEntry({ onDirtyChange: dirty => { setParseDirty(dirty); props.onDirtyChange(dirty); }, onBusyChange: setParseBusy }) : null}
          {entryMode !== "parse" ? <div className="ci-batch-steps" style={{ padding: "0" }}>
            {(customerMode ? [entryMode === "single" ? "填写物料" : "选文件", "核对", "结果"] : entryMode === "single" ? ["填写物料", "预览确认"] : ["选文件", "匹配字段", "确认上传"]).map((label, i) => (
              <span key={label} className={step >= (customerMode ? [1, 3, 4][i] : entryMode === "single" && i === 1 ? 3 : i + 1) ? "is-active" : ""}>
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
            <div
              className={`ci-batch-drop ${dragging ? "is-dragging" : ""}`}
              style={{ minHeight: "160px", padding: "10px 12px", gap: "5px" }}
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
                  ? "正在读取本地表格…"
                  : "拖拽库存表格到这里，或选择文件"}
              </strong>
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
              <Button
                type="button"
                className="ci-button ci-primary"
                disabled={loading || !!saved || !!savedPreparation || restoreBlocked}
                onClick={() => fileInput.current?.click()}
              >
                <Icon kind="upload" size={15} />
                选择库存表格
              </Button>
            </div>
            {retryFile ? <Button type="button" className="ci-button" disabled={loading} onClick={() => void selectFile(retryFile, true)}>按原文件重试保存／读取</Button> : null}
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
                    onChange={e =>
                      setMapping(v => ({
                        ...v,
                        [f.key]: Number(e.target.value),
                      }))
                    }
                  >
                    <option value={-1}>不导入 / 留空</option>
                    {(grid[0] ?? []).map((header, i) => (
                      <option key={i} value={i}>
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
            {customerMode && entryMode === "table" ? <>
              <div className="ci-batch-file"><Icon kind="file" /><div><strong>{name}</strong><p>已自动识别列并保留原表行号；请核对候选，不猜品牌、价格或币种。</p></div></div>
              {mappingNeedsReview.length ? <section aria-label="需要调整的列匹配"><p className="ci-error">以下列无法识别或存在歧义，请调整匹配；缺品牌也可批量补齐空白。</p>{renderMapping(mappingNeedsReview)}</section> : null}
              <details className="ci-batch-note"><summary>调整列匹配</summary>{renderMapping(fields.filter(field => !mappingNeedsReview.some(item => item.key === field.key)))}<p>未匹配列不会导入。调整匹配将重新生成候选，请重新核对币种和编辑值。</p></details>
            </> : null}
            <div className="ci-batch-summary">
              <span>
                <b>{rows.length - bad.length}</b> 条通过校验
              </span>
              <span className={bad.length ? "ci-batch-red" : ""}>
                <b>{bad.length}</b> 条需要修正
              </span>
              {excluded.length > 0 && (
                <small>已明确移除 {excluded.length} 行</small>
              )}
            </div>
            {historyOptIn && customerMode && (currencyConfirmed || rows.some(row => row.currencyNeedsConfirmation || row.draft.currency.trim() !== "CNY")) ? <label className="ci-field">
              <span>明确本次候选币种（不自动换算外币）</span>
              <select className="ci-batch-control" aria-label="明确确认本次核对币种为CNY" value={currencyConfirmed ? "CNY" : ""} onChange={event => {
                const confirmed = event.target.value === "CNY"; setCurrencyConfirmed(confirmed);
                if (confirmed) setEdits(value => ({ ...value, ...Object.fromEntries(rows.map(row => [row.row, { ...row.draft, currency: "CNY" }])) }));
              }}><option value="">尚未确认，请核对原币种和报价</option><option value="CNY">已核对，本次候选币种为 CNY</option></select>
              <small>只明确币种，不修改报价数字；如原报价为外币，请人工核实人民币报价后编辑，无法核实请排除。</small>
            </label> : historyOptIn && !customerMode ? <label className="ci-dialog-note"><input type="checkbox" aria-label="明确确认本次核对币种为CNY" checked={currencyConfirmed} onChange={e => setCurrencyConfirmed(e.target.checked)} /> 我已核对本次所选物料币种为CNY（不自动换算外币）；未知数量、价格和税务口径请核对后编辑，或注明问题排除。</label> : null}
            {customerMode && historyOptIn && rows.some(row => !row.draft.brand.trim()) ? <div className="ci-batch-channel">
              <label className="ci-field"><span>批量补齐空白品牌</span><input aria-label="空白行品牌" maxLength={64} value={blankBrand} onChange={event => setBlankBrand(event.target.value)} /></label>
              <Button type="button" variant="outline" className="ci-button" disabled={!blankBrand.trim()} onClick={() => setEdits(value => ({ ...value, ...Object.fromEntries(rows.filter(row => !row.draft.brand.trim()).map(row => [row.row, { ...row.draft, brand: blankBrand.trim() }])) }))}>仅填空白品牌</Button>
            </div> : null}
            {bad.length > 0 && (
              <div className="ci-error ci-batch-errors">
                <div>
                  {customerMode ? "请在此核对错误字段，或注明原因排除无法核实的行。不会静默跳过错误记录。" : "请修正文件后重新上传，或明确移除错误行。不会静默跳过错误记录。"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ci-button"
                  onClick={() => { if (historyOptIn) bad.forEach(r => excludeRow(r.row)); else setExcluded(v => [...v, ...bad.map(r => r.row)]); }}
                >
                  移除全部错误行
                </Button>
              </div>
            )}
            <div className="ci-batch-preview">
              <table>
                <thead>
                  <tr>
                    <th>原表行号</th>
                    <th>料号 / 品牌</th>
                    <th>可供数量</th>
                    <th>{customerMode ? "报价 / 币种" : "报价 CNY"}</th>
                    <th>税务口径</th>
                    {entryMode === "single" ? <><th>交期</th><th>Date Code</th><th>备注（仅本人）</th></> : null}
                    <th>校验</th>
                    {historyOptIn ? <th>人工核对编辑</th> : null}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(customerMode ? [...bad, ...rows.filter(row => !row.errors.length)] : rows).slice(0, 100).map(r => (
                    <tr
                      key={r.row}
                      className={r.errors.length ? "has-error" : ""}
                    >
                      <td>{r.row}</td>
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
                      <td>
                        {r.errors.length ? (
                          <span className="ci-batch-red">
                            {r.errors.join("；")}
                          </span>
                        ) : (
                          <span className="ci-batch-green">✓ 通过</span>
                        )}
                      </td>
                      {historyOptIn ? <td>{customerMode ? renderCustomerFields(r) : fields.map(f => <label key={f.key} className="ci-field"><span>{f.label}</span><input aria-label={`核对第${r.row}行${f.label}`} value={r.draft[f.key]} onChange={e => setEdits(v => ({ ...v, [r.row]: { ...r.draft, [f.key]: e.target.value } }))} /></label>)}
                        {(rowMetadata.current.get(r.row) as { issues?: { issueId: string; message: string; resolved: boolean; resolution: string | null; field: string }[] } | undefined)?.issues?.map(issue => <label key={issue.issueId} className="ci-field"><span>{issue.message}</span><input aria-label={`核对问题${issue.issueId}`} maxLength={1000} defaultValue={issue.resolution ?? ""} placeholder="核对结果或明确保留未知的依据（必填）" onChange={e => { issue.resolution = e.target.value.trim() || null; issue.resolved = Boolean(issue.resolution); setEdits(v => ({ ...v, [r.row]: v[r.row] ?? r.draft })); if (issue.field === "source" && issue.resolved) setEdits(v => { const { sourceIssue, ...draft } = v[r.row] ?? r.draft; return { ...v, [r.row]: draft }; }); }} /></label>)}
                        {r.draft.sourceIssue ? <button type="button" className="ci-inline-link" onClick={() => { const reason = window.prompt("请填写核验原始文本型号/来源精度的依据，无法核实请排除本行"); if (reason?.trim() && !((rowMetadata.current.get(r.row) as { issues?: { field: string; resolved: boolean }[] } | undefined)?.issues?.some(issue => issue.field === "source" && !issue.resolved))) { const { sourceIssue, ...draft } = r.draft; setEdits(v => ({ ...v, [r.row]: draft })); } }}>核实来源问题</button> : null}</td> : null}
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
            <p className="ci-batch-preview-note">
              {entryMode === "single" ? "确认后新增此条物料。" : customerMode ? `优先展示需要核对的行（最多100条），确认后导入全部 ${rows.length} 条候选。` : `预览前100条，确认后新增全部 ${rows.length} 条。`}
            </p>
          </>
        )}
        {step === 4 && (
          <>
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
                  : completed === entries.length && !preparing
                    ? "本批渠道库存已保存"
                    : "上传已暂停 / 中断"}
              </h3>
              <p>
                已确认保存 <strong>{completed}</strong> / {preparing?.rows.length ?? entries.length} 条
              </p>
              {customerMode ? <p>待确认 {entries.filter(entry => entry.status === "unknown").length} 条；未完成 {(preparing?.rows.length ?? entries.length) - completed} 条</p> : null}
              {uploadBatch.current?.id ? <small>上传批次：{uploadBatch.current.batchCode || `#${uploadBatch.current.id}`}</small> : null}
              <progress value={completed} max={entries.length || 1} />
              <small>
                每行独立保存；暂停不会撤回已保存行。继续时沿用原请求号，未知结果会安全重试确认。
              </small>
            </div>
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
                  {entries
                    .filter(e => e.status !== "success")
                    .slice(0, 50)
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
        {error && (
          <div className="ci-error" role="alert">
            {error}
          </div>
        )}
        </div>
        <div
          className="ci-dialog-footer ci-batch-footer"
          style={{
            flex: "0 0 auto",
            marginTop: 0,
            paddingTop: "10px",
            borderTop: "1px solid #e8edf3",
          }}
        >
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
              {customerMode ? `确认导入 ${rows.length} 条` : `确认上传 ${rows.length} 条`}
            </Button>
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
            <Button type="button" variant="outline" size="sm" className="ci-button" disabled={busy}
              onClick={() => props.onViewResults?.(entries)}>
              查看已上传结果 / 完成
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
