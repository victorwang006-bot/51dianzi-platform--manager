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
import "./batch.css";
import "./layout.css";

type Channel = { id: number; name: string; active: boolean };
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
  onCreate: (payload: Payload, requestId: string) => Promise<unknown>;
  onComplete: () => void;
  isCurrent: () => boolean;
  sourceLabel?: string;
  fixedSource?: boolean;
  sourceDetails?: React.ReactNode;
  storageKeySuffix?: string;
  sessionData?: unknown;
  validateSavedSession?: (data: unknown, entries: BatchEntry[]) => boolean;
  onRestoreSession?: (data: unknown) => void;
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
type SavedBatch = { channelId: number; entries: BatchEntry[]; name: string; sessionData?: unknown; entryMode?: "table" | "single" };
const storageKey = (props: Props) => `d51-channel-inventory-batch-v1:${props.actorUserId}:${props.enterpriseId}${props.storageKeySuffix ? `:${props.storageKeySuffix}` : ""}`;
function readSavedBatch(props: Props): { saved: SavedBatch | null; error: string; blocked: boolean } {
  const empty = { saved: null, error: "", blocked: false };
  try {
    const raw = sessionStorage.getItem(storageKey(props));
    if (!raw) return empty;
    const data = JSON.parse(raw);
    if (data.version === 1 && data.actorUserId === props.actorUserId && data.enterpriseId === props.enterpriseId
      && Number.isSafeInteger(data.channelId) && data.channelId > 0 && Array.isArray(data.entries)
      && data.entries.length <= 1000 && data.entries.length > 0 && data.entries.every((r: BatchEntry) =>
        /^[-0-9a-f]{36}$/i.test(r.requestId) && ["pending", "success", "unknown"].includes(r.status) && r.payload.channelId === data.channelId)) {
      if (props.validateSavedSession && !props.validateSavedSession(data.sessionData, data.entries))
        return { saved: null, blocked: true, error: "原批次客户版本或回执已变化，不能另起批次重复上传。请核实原上传结果后处理。" };
      return { saved: data, error: "", blocked: false };
    }
    if (props.storageKeySuffix) return { saved: null, blocked: true, error: "原批次恢复记录无效，已阻止重复导入，请核实原上传结果。" };
    return empty;
  } catch {
    return { saved: null, blocked: false, error: "无法读取上次上传记录；请检查浏览器会话存储权限。" };
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
const uuid = () => crypto.randomUUID();
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
  const [entryMode, setEntryMode] = useState<"table" | "single">("table");
  const [saved, setSaved] = useState<SavedBatch | null>(initial.saved);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
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
          ...(latest.current.sessionData === undefined ? {} : { sessionData: latest.current.sessionData }),
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
    setMapping(suggestMapping(next[0]?.map(String) ?? []));
    setName(fileName);
    setExcluded([]);
    setError("");
    setStep(2);
    latest.current.onDirtyChange(true);
  };
  const selectFile = async (file: File) => {
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
        defval: "",
        raw: false,
        blankrows: true,
      });
      const originalValues = XLSX.utils.sheet_to_json<(string | number)[]>(
        sheet,
        {
          header: 1,
          defval: "",
          raw: true,
          blankrows: true,
        }
      );
      if (next.length < 2)
        throw new Error("首行应为表头，且至少有一行库存数据。");
      if (current() && token === serial.current)
        loadGrid(next, `${file.name} · ${sheetName}`, originalValues);
    } catch (e) {
      if (current() && token === serial.current)
        setError(
          e instanceof Error ? e.message : "文件读取失败，请用模板整理后重试。"
        );
    } finally {
      if (current() && token === serial.current) setLoading(false);
    }
  };
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
  const rows = mapGrid(grid, mapping, rawGrid).filter(
    r => !excluded.includes(r.row)
  );
  const bad = rows.filter(r => r.errors.length);
  const mappingErrors = validateMapping(mapping);
  const selected = channels.find(c => c.id === Number(channelId));
  const completed = entries.filter(e => e.status === "success").length;
  const hasQueue = entries.length > 0;
  const modeLocked = busy || loading || hasQueue || !!saved || restoreBlocked;
  const changeMode = (mode: "table" | "single") => {
    if (!current() || running.current || modeLocked || mode === entryMode) return;
    if (grid.length && !window.confirm("切换上传方式将清除当前未提交的预览；单条录入草稿会保留。是否继续？")) return;
    serial.current += 1;
    setEntryMode(mode);
    setGrid([]); setRawGrid([]); setExcluded([]); setName(""); setError(""); setStep(1);
  };
  const previewSingle = (draft: Draft) => {
    if (!current() || running.current || modeLocked || entryMode !== "single" || !selected?.active) return;
    const errors = validateDraft(draft);
    if (errors.length) { setError(errors.join("；")); return; }
    // Use the same mapping, normalization, DTO and confirmation as file rows.
    loadGrid([fields.map(field => field.label), fields.map(field => draft[field.key])], "单条手工录入");
    setStep(3);
  };
  const start = async () => {
    if (running.current || !current() || restoreBlocked) return;
    if (!selected || !selected.active) {
      setError("请选择有权访问且启用的已加载渠道。");
      return;
    }
    let next = entries;
    if (!hasQueue) {
      if (mappingErrors.length || bad.length || !rows.length) {
        setError("请完成字段匹配并修正错误行。");
        return;
      }
      next = rows.map(r => ({
        row: r.row,
        requestId: uuid(),
        payload: toPayload(r.draft, selected.id),
        status: "pending",
      }));
    }
    if (!persist(next, selected.id)) return;
    stop.current = false;
    running.current = true;
    setBusy(true);
    setError("");
    setEntries(next);
    setStep(4);
    props.onBusyChange(true);
    props.onDirtyChange(true);
    try {
      const result = await runBatch(next, {
        submit: (payload, requestId) =>
          latest.current.onCreate(payload, requestId),
        isCurrent: current,
        shouldStop: () => stop.current,
        receiptFromResult: latest.current.receiptFromResult,
        onProgress: progress => {
          persist(progress, selected.id);
          if (current()) setEntries(progress);
        },
      });
      if (!current()) return;
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
    if (running.current) {
      stop.current = true;
      setError("正在停止：当前请求完成后不再提交下一行，请稍候。");
      return;
    }
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
    if (!saved) return;
    latest.current.onRestoreSession?.(saved.sessionData);
    setChannelId(String(saved.channelId));
    setEntries(saved.entries);
    setName(saved.name);
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
              <Button type="button" variant="outline" className={`ci-button${entryMode === "single" ? " ci-primary" : ""}`} aria-pressed={entryMode === "single"} disabled={modeLocked} onClick={() => changeMode("single")}>单条上传</Button>
            </div>
            {modeLocked ? <p className="ci-dialog-note">请先完成或恢复原批次。</p> : null}
          </div> : null}
          <div className="ci-batch-steps" style={{ padding: "0" }}>
            {(entryMode === "single" ? ["填写物料", "预览确认"] : ["选文件", "匹配字段", "确认上传"]).map((label, i) => (
              <span key={label} className={step >= (entryMode === "single" && i === 1 ? 3 : i + 1) ? "is-active" : ""}>
                <b>{step > (entryMode === "single" && i === 1 ? 3 : i + 1) ? "✓" : i + 1}</b>
                {label}
              </span>
            ))}
          </div>
          {props.sourceDetails}
          <div className={`ci-batch-channel${props.fixedSource ? " ci-batch-fixed-source" : ""}`} style={{ gap: "12px", paddingBottom: "9px" }}>
            <label className="ci-field">
              <span>{props.sourceLabel ? "客户供应来源" : "关联渠道 *"}</span>
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
          </div>
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
          {saved && (
            <div className="ci-batch-resume">
              <Icon kind="file" />
              <div>
                <strong>发现本标签页未完成的上传批次</strong>
                <p>
                  已确认{" "}
                  {saved.entries.filter(e => e.status === "success").length} /{" "}
                  {saved.entries.length} 条。建议恢复原批次，不要重复上传表格。
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
            {props.renderSingleEntry({ onPreview: previewSingle, disabled: modeLocked || !selected?.active || step !== 1 || entryMode !== "single" })}
          </div> : null}
          {step === 1 && entryMode === "table" && (
          <>
            <div
              className={`ci-batch-drop ${dragging ? "is-dragging" : ""}`}
              style={{ minHeight: "160px", padding: "10px 12px", gap: "5px" }}
              onDragOver={e => {
                e.preventDefault();
                if (!saved && !restoreBlocked) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file && !loading && !saved && !restoreBlocked) void selectFile(file);
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
                disabled={loading || !!saved || restoreBlocked}
                onClick={() => fileInput.current?.click()}
              >
                <Icon kind="upload" size={15} />
                选择库存表格
              </Button>
            </div>
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
        {step === 3 && (
          <>
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
            {bad.length > 0 && (
              <div className="ci-error ci-batch-errors">
                <div>
                  请修正文件后重新上传，或明确移除错误行。不会静默跳过错误记录。
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ci-button"
                  onClick={() =>
                    setExcluded(v => [...v, ...bad.map(r => r.row)])
                  }
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
                    <th>报价 CNY</th>
                    <th>税务口径</th>
                    {entryMode === "single" ? <><th>交期</th><th>Date Code</th><th>备注（仅本人）</th></> : null}
                    <th>校验</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map(r => (
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
                      <td>{r.draft.price || "面议"}</td>
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
                      <td>
                        <button
                          type="button"
                          title={`移除原表第${r.row}行`}
                          aria-label={`移除原表第${r.row}行`}
                          onClick={() => setExcluded(v => [...v, r.row])}
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
              {entryMode === "single" ? "确认后新增此条物料。" : `预览前100条，确认后新增全部 ${rows.length} 条。`}
            </p>
          </>
        )}
        {step === 4 && (
          <>
            <div className="ci-batch-result">
              <Icon
                kind={
                  completed === entries.length && entries.length
                    ? "check"
                    : "upload"
                }
                size={31}
              />
              <h3>
                {busy
                  ? "正在按行上传，请勿重复提交"
                  : completed === entries.length
                    ? "本批渠道库存已保存"
                    : "上传已暂停 / 中断"}
              </h3>
              <p>
                已确认保存 <strong>{completed}</strong> / {entries.length} 条
              </p>
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
          {step > 1 && !hasQueue && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ci-button"
              disabled={loading}
              onClick={() => {
                setStep(entryMode === "single" ? 1 : step === 3 ? 2 : 1);
                setError("");
              }}
            >
              上一步
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ci-button"
            onClick={close}
          >
            {busy
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
            <Button
              type="button"
              size="sm"
              className="ci-button ci-primary"
              disabled={
                !selected?.active ||
                !!bad.length ||
                !rows.length ||
                !!mappingErrors.length
              }
              onClick={() => void start()}
            >
              确认上传 {rows.length} 条
            </Button>
          )}
          {step === 4 && completed < entries.length && (
            <Button
              type="button"
              size="sm"
              className="ci-button ci-primary"
              disabled={busy || !selected?.active}
              onClick={() => void start()}
            >
              按原批次继续 / 重试
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
