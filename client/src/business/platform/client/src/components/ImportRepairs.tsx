import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../../../api/business-trpc";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * Import repairs live in inventory_import_repairs, never in the inventory draft
 * table. The host supplies its authoritative active user:enterprise key. Missing
 * scope is deliberately a masked state, not a fallback query.
 */
export type ImportRepairsProps = {
  /** Exact `${userId}:${enterpriseId}` from the active enterprise context. */
  scopeKey?: string | null;
  /** Set false while auth/enterprise selection is resolving or switching. */
  scopeReady?: boolean;
  /** Reports the server-confirmed unresolved repair count for this exact scope. */
  onCountChange?: (scopeKey: string, count: number) => void;
  /** Opens the hand-entered inventory draft area in the host's unified tab. */
  onShowManualDrafts?: () => void;
  /** Receives each repair child job after it is safely queued, never as "published". */
  onRepairQueued?: (jobId: string) => void;
  /** Optional result-card anchor; the ordinary panel always lists all issue rows. */
  initialJobId?: string;
};

type RepairStatus =
  | "pending"
  | "ready"
  | "queued"
  | "success"
  | "error"
  | "existing";
type InventoryRecord = Record<string, unknown>;
type RepairItem = {
  scopeKey: string;
  jobId: string;
  rowNumber: number;
  fileName: string;
  jobStatus: string;
  partNumber: string;
  brand: string;
  originalQuantity: string;
  raw: InventoryRecord;
  corrected: InventoryRecord | null;
  revision: number;
  status: RepairStatus;
  errorMessage: string;
  canEdit: boolean;
  /** Clear is an independent enterprise-level permission; it does not gate row editing. */
  canDismiss?: boolean;
  repairJobId: string | null;
  inventoryId: number | null;
};
type RepairList = {
  scopeKey: string;
  items: RepairItem[];
  total: number;
  page: number;
  pageCount: number;
};
type RepairSubmitResult = {
  scopeKey: string;
  jobId: string;
  status: string;
  idempotent: boolean;
};
type RepairExportResult = {
  scopeKey: string;
  items: RepairItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};
type RepairClearResult = {
  scopeKey: string;
  clearedRows: number;
  skippedRows: number;
  /** Null/absent on older idempotent receipts; the refreshed list remains authoritative. */
  remainingRows?: number | null;
  /** Present only when the server can classify every remaining row. */
  remainingReasons?: {
    permissionRows: number;
    processingRows: number;
    protectedRows: number;
  } | null;
  idempotent: boolean;
};
type EditableKey =
  | "partNumber"
  | "brand"
  | "dateCode"
  | "qtyOnSale"
  | "priceEx"
  | "leadTime"
  | "category"
  | "pkg"
  | "warehouseAddress"
  | "note"
  | "moq"
  | "spq"
  | "rohs";
type Editor = {
  item: RepairItem;
  base: InventoryRecord;
  values: Record<EditableKey, string>;
  changed: Partial<Record<EditableKey, boolean>>;
  taxIncluded: boolean;
  taxIncludedChanged: boolean;
};
type SaveInput = {
  jobId: string;
  rowNumber: number;
  revision: number;
  requestId: string;
  row: InventoryRecord;
};
type SubmitInput = {
  jobId: string;
  rowNumber: number;
  revision: number;
  requestId: string;
};
type ClearInput = { requestId: string };
type FrozenAction =
  | { kind: "saveThenSubmit"; save: SaveInput; submitRequestId?: string }
  | { kind: "submit"; input: SubmitInput }
  | { kind: "clear"; input: ClearInput };
/** Revision is an exported audit value and an optimistic write precondition. */
type ReuploadRow = {
  taskId: string;
  excelRow: number;
  revision: number;
  values: InventoryRecord;
};
type BatchContinuation = {
  rows: ReuploadRow[];
  taskId: string;
  remaining: number;
};
type BatchControl = { cancelled: boolean };

const PAGE_SIZE = 20;
const PREFLIGHT_PAGE_SIZE = 50;
const EXPORT_LIMIT = 2_000;
const MAX_EXPORT_PAGES = 20;
const JOB_POLL_MS = 1_500;
const MAX_JOB_POLLS = 80;
const ACTIVE_JOB_STATUSES = new Set(["staging", "queued", "running"]);
const REUPLOAD_HEADERS = [
  "修正任务ID",
  "原Excel行号",
  "修正版本",
  "型号 / 料号",
  "品牌",
  "生产周期（Date Code）",
  "上架数量",
  "单价",
  "含税价",
  "交期",
  "分类",
  "封装",
  "仓库地址",
  "物料备注",
  "MOQ",
  "SPQ",
  "RoHS",
  "未导入原因",
] as const;
/** Old exports included an independent stock column. It is accepted but ignored. */
const LEGACY_REUPLOAD_HEADERS = [
  ...REUPLOAD_HEADERS.slice(0, 7),
  "实际库存",
  ...REUPLOAD_HEADERS.slice(7),
] as const;
const EDIT_FIELDS: Array<{
  key: EditableKey;
  label: string;
  required?: boolean;
  multiline?: boolean;
}> = [
  { key: "partNumber", label: "型号 / 料号", required: true },
  { key: "brand", label: "品牌", required: true },
  { key: "dateCode", label: "生产周期（Date Code）", required: true },
  { key: "qtyOnSale", label: "上架数量", required: true },
  { key: "priceEx", label: "单价" },
  { key: "leadTime", label: "交期", required: true },
  { key: "category", label: "分类" },
  { key: "pkg", label: "封装" },
  { key: "warehouseAddress", label: "仓库地址" },
  { key: "note", label: "物料备注", multiline: true },
  { key: "moq", label: "MOQ" },
  { key: "spq", label: "SPQ" },
  { key: "rohs", label: "RoHS" },
];
function requestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
function text(record: InventoryRecord, key: string, fallback = "") {
  const value = record[key];
  return value == null ||
    (typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean")
    ? fallback
    : String(value);
}
function boolean(record: InventoryRecord, key: string, fallback = true) {
  const value = record[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string")
    return ["true", "yes", "y", "是", "合规"].includes(
      value.trim().toLowerCase()
    )
      ? true
      : ["false", "no", "n", "否", "不合规"].includes(
            value.trim().toLowerCase()
          )
        ? false
        : fallback;
  return fallback;
}
/** Prefix formula-shaped cell text so Excel never evaluates exported business values. */
function spreadsheetText(value: unknown) {
  const valueText =
    value == null
      ? ""
      : typeof value === "boolean"
        ? value
          ? "是"
          : "否"
        : String(value);
  return /^[\t\r\n ]*[=+\-@]/.test(valueText) ? `'${valueText}` : valueText;
}
function actionMessage(error: unknown) {
  const candidate = error as {
    message?: unknown;
    data?: {
      code?: unknown;
      zodError?: { fieldErrors?: Record<string, string[]> };
    };
  } | null;
  const validation = candidate?.data?.zodError?.fieldErrors;
  const fieldMessage =
    validation &&
    Object.values(validation)
      .flat()
      .find(value => typeof value === "string" && value.trim());
  return typeof fieldMessage === "string"
    ? fieldMessage
    : typeof candidate?.message === "string" && candidate.message.trim()
      ? candidate.message
      : "操作未完成，请稍后重试。";
}
function errorCode(error: unknown) {
  return String(
    (error as { data?: { code?: unknown } } | null)?.data?.code ?? ""
  );
}
function isUnknownOutcome(error: unknown) {
  const code = errorCode(error);
  if (
    /^(BAD_REQUEST|CONFLICT|NOT_FOUND|PRECONDITION_FAILED|UNPROCESSABLE_CONTENT)$/i.test(
      code
    )
  )
    return false;
  return (
    !code ||
    /INTERNAL_SERVER_ERROR|PARSE_ERROR|TIMEOUT|TOO_MANY_REQUESTS|SERVICE_UNAVAILABLE|BAD_GATEWAY|GATEWAY_TIMEOUT|network|fetch|timeout|offline|connection|abort|gateway|网络|超时|连接/i.test(
      `${String((error as Error | null)?.name ?? "")} ${actionMessage(error)} ${code}`
    )
  );
}
function isAccessError(error: unknown) {
  return /UNAUTHORIZED|FORBIDDEN|permission|权限|无权|登录/i.test(
    `${errorCode(error)} ${actionMessage(error)}`
  );
}
function isActiveJobConflict(error: unknown) {
  return (
    errorCode(error).toUpperCase() === "CONFLICT" &&
    /活跃|正在.*处理|已有.*导入任务|任务.*进行|active/i.test(
      actionMessage(error)
    )
  );
}
function nonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}
function clearRemainingMessage(
  remaining: number,
  reasons: RepairClearResult["remainingReasons"]
) {
  const permissionRows = nonNegativeSafeInteger(reasons?.permissionRows);
  const processingRows = nonNegativeSafeInteger(reasons?.processingRows);
  const protectedRows = nonNegativeSafeInteger(reasons?.protectedRows);
  const classified =
    permissionRows !== undefined &&
    processingRows !== undefined &&
    protectedRows !== undefined &&
    permissionRows + processingRows + protectedRows === remaining;
  if (classified && permissionRows === remaining)
    return `${remaining} 条无清空权限`;
  if (classified && processingRows === remaining) return `${remaining} 条处理中`;
  return `${remaining} 条暂不可清空`;
}
function valueToSave(key: EditableKey, value: string): unknown {
  const trimmed = value.trim();
  if (["qtyOnSale", "moq", "spq"].includes(key))
    return /^(?:0|[1-9]\d*)$/.test(trimmed) &&
      Number.isSafeInteger(Number(trimmed))
      ? Number(trimmed)
      : value;
  if (key === "priceEx")
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed) &&
      Number.isFinite(Number(trimmed))
      ? Number(trimmed)
      : value;
  if (key === "rohs")
    return ["true", "yes", "y", "是", "1", "合规"].includes(
      trimmed.toLowerCase()
    )
      ? true
      : ["false", "no", "n", "否", "0", "不合规"].includes(
            trimmed.toLowerCase()
          )
        ? false
        : value;
  return value;
}
function sourceOf(item: RepairItem) {
  return item.corrected ? { ...item.corrected } : { ...item.raw };
}
function editorFor(item: RepairItem): Editor {
  const base = sourceOf(item);
  const values = Object.fromEntries(
    EDIT_FIELDS.map(field => [
      field.key,
      text(
        base,
        field.key,
        field.key === "qtyOnSale" ? item.originalQuantity : ""
      ),
    ])
  ) as Record<EditableKey, string>;
  return {
    item,
    base,
    values,
    changed: {},
    taxIncluded: boolean(base, "taxIncluded", true),
    taxIncludedChanged: false,
  };
}
function rowForSave(editor: Editor) {
  const row: InventoryRecord = { ...editor.base };
  for (const field of EDIT_FIELDS)
    if (editor.changed[field.key])
      row[field.key] = valueToSave(field.key, editor.values[field.key]);
  // The service still accepts the legacy internal field, but users now maintain
  // one quantity only. Invalid text remains untouched for server validation.
  row.qtyOnSale = valueToSave("qtyOnSale", editor.values.qtyOnSale);
  row.qtyStock = row.qtyOnSale;
  if (editor.taxIncludedChanged) row.taxIncluded = editor.taxIncluded;
  return row;
}
function problemExportValues(item: RepairItem) {
  const raw = item.raw ?? {};
  return [
    item.jobId,
    item.rowNumber,
    item.revision,
    text(raw, "partNumber", item.partNumber),
    text(raw, "brand", item.brand),
    text(raw, "dateCode"),
    text(raw, "qtyOnSale", item.originalQuantity),
    text(raw, "priceEx"),
    text(raw, "taxIncluded"),
    text(raw, "leadTime"),
    text(raw, "category"),
    text(raw, "pkg"),
    text(raw, "warehouseAddress"),
    text(raw, "note"),
    text(raw, "moq"),
    text(raw, "spq"),
    text(raw, "rohs"),
    item.errorMessage || "等待重新校验",
  ].map(spreadsheetText);
}
function restoreSpreadsheetText(value: unknown) {
  const string = typeof value === "string" ? value : String(value ?? "");
  // Export adds this marker only to stop Excel interpreting a cell as a formula.
  // Removing exactly that marker restores the user's leading whitespace too.
  return /^'(?=[\t\r\n ]*[=+\-@])/.test(string) ? string.slice(1) : string;
}
function reuploadBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  const normalized = restoreSpreadsheetText(value).trim().toLowerCase();
  if (["true", "yes", "y", "是", "1", "合规"].includes(normalized)) return true;
  if (["false", "no", "n", "否", "0", "不合规"].includes(normalized))
    return false;
  return restoreSpreadsheetText(value);
}
function reuploadOptionalText(value: unknown) {
  const restored = restoreSpreadsheetText(value);
  return restored === "" ? undefined : restored;
}
function supportedReuploadHeaders(headers: string[]) {
  return [REUPLOAD_HEADERS, LEGACY_REUPLOAD_HEADERS].some(
    expected =>
      expected.length === headers.length &&
      expected.every((header, index) => header === headers[index])
  );
}
function rawToReuploadRow(row: unknown): ReuploadRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  const taskId = String(source["修正任务ID"] ?? "").trim();
  const excelRow = Number(source["原Excel行号"]);
  const revisionText = String(source["修正版本"] ?? "").trim();
  const revision = Number(revisionText);
  if (
    !isUuid(taskId) ||
    !Number.isSafeInteger(excelRow) ||
    excelRow < 2 ||
    !/^(?:0|[1-9]\d*)$/.test(revisionText) ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return null;
  const values: InventoryRecord = {
    partNumber: restoreSpreadsheetText(source["型号 / 料号"]),
    brand: restoreSpreadsheetText(source["品牌"]),
    dateCode: restoreSpreadsheetText(source["生产周期（Date Code）"]),
    qtyOnSale: valueToSave(
      "qtyOnSale",
      restoreSpreadsheetText(source["上架数量"])
    ),
    taxIncluded: reuploadBoolean(source["含税价"]),
    leadTime: restoreSpreadsheetText(source["交期"]),
  };
  values.qtyStock = values.qtyOnSale;
  const optionals: Array<
    [keyof InventoryRecord, EditableKey | "taxIncluded", unknown]
  > = [
    ["priceEx", "priceEx", source["单价"]],
    ["category", "partNumber", source["分类"]],
    ["pkg", "partNumber", source["封装"]],
    ["warehouseAddress", "partNumber", source["仓库地址"]],
    ["note", "partNumber", source["物料备注"]],
    ["moq", "moq", source["MOQ"]],
    ["spq", "spq", source["SPQ"]],
    ["rohs", "rohs", source["RoHS"]],
  ];
  for (const [key, field, value] of optionals) {
    const restored = reuploadOptionalText(value);
    if (restored === undefined) continue;
    values[key] =
      field === "rohs"
        ? reuploadBoolean(restored)
        : ["priceEx", "moq", "spq"].includes(field)
          ? valueToSave(field as EditableKey, restored)
          : restored;
  }
  // Source-only metadata never enters repairSave. Exact, unambiguous scalar
  // conversion merely restores Excel display text to the existing row schema.
  // The server's freshly preflighted revision remains the write protection.
  return { taskId, excelRow, revision, values };
}
function wait(milliseconds: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));
}

/**
 * One physical UI entry under the host's “待发布” tab. It renders import issue
 * rows separately from hand-entered drafts, exports only unhandled issue rows,
 * and never calls createJob/stageBatch/finalizeJob for a re-upload.
 */
export function ImportRepairs({
  scopeKey,
  scopeReady = true,
  onCountChange,
  onShowManualDrafts,
  onRepairQueued,
  initialJobId,
}: ImportRepairsProps) {
  const [jobFilter, setJobFilter] = useState(() =>
    initialJobId && isUuid(initialJobId) ? initialJobId : ""
  );
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [frozen, setFrozen] = useState<FrozenAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reuploading, setReuploading] = useState(false);
  const [continuation, setContinuation] = useState<BatchContinuation | null>(
    null
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [clearDialog, setClearDialog] = useState(false);
  // The approved pending demo opens its list initially. This state folds only
  // the result table and its pager; it never closes an editor or cancels work.
  const [listExpanded, setListExpanded] = useState(true);
  const reuploadInput = useRef<HTMLInputElement>(null);
  const batchControlRef = useRef<BatchControl | null>(null);
  const actionLockRef = useRef(false);
  const currentScope = scopeReady && Boolean(scopeKey);
  const identityRef = useRef(currentScope ? scopeKey! : "unresolved");
  identityRef.current = currentScope ? scopeKey! : "unresolved";
  const queryInput = useMemo(
    () => ({
      ...(jobFilter ? { jobId: jobFilter } : {}),
      page,
      limit: PAGE_SIZE,
      __repairScopeKey: scopeKey ?? "unresolved",
    }),
    [jobFilter, page, scopeKey]
  );
  // `__repairScopeKey` is intentionally a client-only cache partition that the
  // server schema strips. Keep this compatibility boundary local to the panel.
  const repairApi = trpc.importInventory as any;
  const listQuery = repairApi.repairList.useQuery(queryInput, {
    enabled: currentScope && !accessBlocked,
    retry: false,
    keepPreviousData: false,
  });
  const repairSave = repairApi.repairSave.useMutation();
  const repairSubmit = repairApi.repairSubmit.useMutation();
  const repairClear = repairApi.repairClear.useMutation();
  const utils = trpc.useUtils();
  const repairUtils = utils.importInventory as any;
  const data =
    currentScope &&
    !accessBlocked &&
    !listQuery.isError &&
    (listQuery.data as RepairList | undefined)?.scopeKey === scopeKey
      ? (listQuery.data as RepairList)
      : undefined;
  const rows = data?.items ?? [];
  const locked = busy || Boolean(frozen) || reuploading;

  useEffect(() => {
    batchControlRef.current && (batchControlRef.current.cancelled = true);
    actionLockRef.current = false;
    setEditor(null);
    setFrozen(null);
    setBusy(false);
    setExporting(false);
    setReuploading(false);
    setContinuation(null);
    setNotice("");
    setError("");
    setAccessBlocked(false);
    setClearDialog(false);
    setListExpanded(true);
    setPage(1);
  }, [scopeKey, scopeReady]);
  useEffect(() => {
    setJobFilter(initialJobId && isUuid(initialJobId) ? initialJobId : "");
    setPage(1);
  }, [initialJobId]);

  const actionCurrent = (startedScope: string) =>
    identityRef.current === startedScope;
  const protectAccess = (message: string) => {
    batchControlRef.current && (batchControlRef.current.cancelled = true);
    setAccessBlocked(true);
    setEditor(null);
    setFrozen(null);
    setContinuation(null);
    setError(message);
  };
  const refresh = async (startedScope = identityRef.current) => {
    try {
      const result = await listQuery.refetch();
      const returned = result.data as RepairList | undefined;
      if (!actionCurrent(startedScope)) return undefined;
      if (returned && returned.scopeKey !== startedScope) {
        protectAccess("身份或企业上下文已变更，导入问题行已隐藏。");
        return undefined;
      }
      if (returned)
        onCountChange?.(startedScope, Math.max(0, Number(returned.total) || 0));
      return returned;
    } catch {
      if (actionCurrent(startedScope))
        setNotice("操作请求已返回，但列表刷新失败。请刷新确认，不要重复提交。");
      return undefined;
    }
  };
  const requireCurrentScope = (
    value: { scopeKey?: unknown },
    startedScope: string,
    failure: string
  ) => {
    if (!actionCurrent(startedScope)) return false;
    if (value?.scopeKey !== startedScope) {
      protectAccess(failure);
      return false;
    }
    return true;
  };
  const applySubmitResult = (
    submitted: RepairSubmitResult,
    startedScope: string
  ) => {
    if (
      !requireCurrentScope(
        submitted,
        startedScope,
        "发布结果无法确认当前身份，导入问题行已隐藏。"
      )
    )
      return false;
    onRepairQueued?.(submitted.jobId);
    setNotice(
      submitted.status === "queued" ? "已交由后台处理。" : "该行已有处理结果。"
    );
    return true;
  };
  const run = async (action: FrozenAction) => {
    if (
      actionLockRef.current ||
      busy ||
      reuploading ||
      !currentScope ||
      !scopeKey ||
      accessBlocked ||
      (action.kind === "clear" && exporting)
    )
      return;
    const startedScope = scopeKey;
    actionLockRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (action.kind === "saveThenSubmit") {
        const saved = (await repairSave.mutateAsync(action.save)) as RepairItem;
        if (
          !requireCurrentScope(
            saved,
            startedScope,
            "修正结果无法确认当前身份，导入问题行已隐藏。"
          )
        )
          return;
        if (saved.status !== "ready") {
          setEditor(null);
          setFrozen(null);
          setNotice(
            "修正已保存；服务端尚未通过校验，未进入发布队列。请查看最新原因。"
          );
          await refresh(startedScope);
          return;
        }
        const submitInput: SubmitInput = {
          jobId: saved.jobId,
          rowNumber: saved.rowNumber,
          revision: saved.revision,
          requestId: action.submitRequestId ?? requestId(),
        };
        action.submitRequestId = submitInput.requestId;
        const submitted = (await repairSubmit.mutateAsync(
          submitInput
        )) as RepairSubmitResult;
        if (!applySubmitResult(submitted, startedScope)) return;
        setEditor(null);
        setFrozen(null);
        await refresh(startedScope);
        return;
      }
      if (action.kind === "clear") {
        const cleared = (await repairClear.mutateAsync(
          action.input
        )) as RepairClearResult;
        if (
          !requireCurrentScope(
            cleared,
            startedScope,
            "清空结果无法确认当前身份，导入问题行已隐藏。"
          )
        )
          return;
        setClearDialog(false);
        setEditor(null);
        setFrozen(null);
        setPage(1);
        if (!cleared.idempotent) await repairUtils.repairList.invalidate?.();
        const refreshed = await refresh(startedScope);
        const responseRemaining = nonNegativeSafeInteger(cleared.remainingRows);
        const refreshedRemaining =
          refreshed?.scopeKey === startedScope
            ? nonNegativeSafeInteger(refreshed.total)
            : undefined;
        const remaining = responseRemaining ?? refreshedRemaining;
        if (cleared.clearedRows > 0) {
          setNotice(
            remaining === undefined
              ? "请刷新查看清空结果"
              : remaining > 0
                ? `已清空 ${cleared.clearedRows} 条，剩余 ${remaining} 条`
                : `已清空 ${cleared.clearedRows} 条`
          );
        } else if (remaining === 0) {
          setNotice("暂无异常记录");
        } else if (remaining !== undefined) {
          setNotice(clearRemainingMessage(remaining, cleared.remainingReasons));
        } else {
          setNotice("请刷新查看清空结果");
        }
        return;
      }
      const submitted = (await repairSubmit.mutateAsync(
        action.input
      )) as RepairSubmitResult;
      if (!applySubmitResult(submitted, startedScope)) return;
      setFrozen(null);
      await refresh(startedScope);
    } catch (caught) {
      if (!actionCurrent(startedScope)) return;
      if (isAccessError(caught))
        protectAccess("当前账号或企业已无修正权限，导入问题行已隐藏。");
      else if (isUnknownOutcome(caught)) {
        setFrozen(action);
        setError(
          action.kind === "clear"
            ? "清空结果未知，请重试清空。"
            : "网络结果未知，已冻结本次请求号和内容；请使用同一请求重试，避免重复保存或重复排队。"
        );
      } else setError(actionMessage(caught));
    } finally {
      actionLockRef.current = false;
      if (actionCurrent(startedScope)) setBusy(false);
    }
  };
  const saveAndSubmit = () => {
    if (!editor || locked) return;
    const id = requestId();
    void run({
      kind: "saveThenSubmit",
      save: {
        jobId: editor.item.jobId,
        rowNumber: editor.item.rowNumber,
        revision: editor.item.revision,
        requestId: id,
        row: rowForSave(editor),
      },
    });
  };
  const submitReady = (item: RepairItem) => {
    if (item.status !== "ready" || !item.canEdit || locked) return;
    const id = requestId();
    void run({
      kind: "submit",
      input: {
        jobId: item.jobId,
        rowNumber: item.rowNumber,
        revision: item.revision,
        requestId: id,
      },
    });
  };
  const clearProblems = () => {
    if (locked || exporting || !currentScope) return;
    void run({ kind: "clear", input: { requestId: requestId() } });
  };
  const exportProblems = async () => {
    if (!scopeKey || !currentScope || locked || exporting) return;
    const startedScope = scopeKey;
    setExporting(true);
    setError("");
    try {
      const all: RepairItem[] = [];
      let result = (await repairUtils.repairExport.fetch({
        page: 1,
        limit: EXPORT_LIMIT,
        __repairScopeKey: startedScope,
      })) as RepairExportResult;
      for (let fetchedPages = 1; ; fetchedPages += 1) {
        if (
          !requireCurrentScope(
            result,
            startedScope,
            "导出结果无法确认当前身份，导入问题行已隐藏。"
          )
        )
          return;
        all.push(...result.items);
        if (!result.hasMore) break;
        if (fetchedPages >= MAX_EXPORT_PAGES || !result.nextPage)
          throw new Error("问题行较多，请稍后重试导出。");
        result = (await repairUtils.repairExport.fetch({
          page: result.nextPage,
          limit: EXPORT_LIMIT,
          __repairScopeKey: startedScope,
        })) as RepairExportResult;
      }
      const problemRows = all.filter(
        item => !["success", "queued", "existing"].includes(item.status)
      );
      if (!problemRows.length) {
        setNotice("当前没有可导出的问题行。");
        return;
      }
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet([
        Array.from(REUPLOAD_HEADERS),
        ...problemRows.map(problemExportValues),
      ]);
      sheet["!cols"] = [
        { wch: 2, hidden: true },
        { wch: 2, hidden: true },
        { wch: 2, hidden: true },
        { wch: 24 },
        { wch: 18 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 24 },
        { wch: 32 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 36 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "导入问题行");
      const stamp = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date())
        .replace(/[^\d]/g, "");
      XLSX.writeFile(workbook, `待发布-问题行-${stamp}.xlsx`);
      setNotice(`已导出 ${problemRows.length} 条问题行。`);
    } catch (caught) {
      if (actionCurrent(startedScope)) setError(actionMessage(caught));
    } finally {
      if (actionCurrent(startedScope)) setExporting(false);
    }
  };
  const fetchTaskRows = async (
    taskId: string,
    startedScope: string,
    control: BatchControl
  ) => {
    const all: RepairItem[] = [];
    let nextPage = 1;
    let pageCount = 1;
    do {
      if (control.cancelled || !actionCurrent(startedScope)) return null;
      const result = (await repairUtils.repairList.fetch({
        jobId: taskId,
        page: nextPage,
        limit: PREFLIGHT_PAGE_SIZE,
        __repairScopeKey: startedScope,
      })) as RepairList;
      if (
        !requireCurrentScope(
          result,
          startedScope,
          "补传预检无法确认当前身份，导入问题行已隐藏。"
        )
      )
        return null;
      all.push(...result.items);
      pageCount = Math.max(1, Number(result.pageCount) || 1);
      nextPage += 1;
    } while (nextPage <= pageCount);
    return all;
  };
  const waitForJobTerminal = async (
    jobId: string,
    startedScope: string,
    control: BatchControl
  ) => {
    const fetchJob = repairUtils.getJob?.fetch;
    if (typeof fetchJob !== "function")
      throw new Error(
        "当前页面未提供子任务状态读取能力，已停止后续提交；已保存行仍为可发布状态。"
      );
    for (let attempt = 0; attempt < MAX_JOB_POLLS; attempt += 1) {
      if (control.cancelled || !actionCurrent(startedScope))
        return { kind: "cancelled" as const, status: "" };
      const job = (await fetchJob({ jobId })) as
        | { status?: unknown }
        | undefined;
      if (!actionCurrent(startedScope))
        return { kind: "cancelled" as const, status: "" };
      const status = String(job?.status ?? "").toLowerCase();
      // A paused child is neither completed nor safely progressing. Do not spend
      // the whole active-job timeout before preserving the remaining ready rows.
      if (status === "paused") return { kind: "paused" as const, status };
      if (status && !ACTIVE_JOB_STATUSES.has(status))
        return { kind: "terminal" as const, status };
      await wait(JOB_POLL_MS);
    }
    return { kind: "timeout" as const, status: "" };
  };
  const processReuploadRows = async (rowsToUpload: ReuploadRow[]) => {
    if (!scopeKey || !currentScope || busy || reuploading || Boolean(frozen))
      return;
    const startedScope = scopeKey;
    const control: BatchControl = { cancelled: false };
    // Continuation owns its expected revisions. Each successful save updates its
    // local source row before a continuation snapshot is made.
    const batchRows = rowsToUpload.map(row => ({
      ...row,
      values: { ...row.values },
    }));
    const plan: Array<{ source: ReuploadRow; current: RepairItem }> = [];
    batchControlRef.current = control;
    setReuploading(true);
    setError("");
    setNotice("");
    setContinuation(null);
    let saved = 0;
    let queued = 0;
    let skipped = 0;
    let stale = 0;
    let remaining = batchRows.length;
    const keepForContinuation = (message: string) => {
      if (!actionCurrent(startedScope)) return;
      const continuationRows = plan.map(entry => ({
        ...entry.source,
        values: { ...entry.source.values },
      }));
      setContinuation({
        rows: continuationRows,
        taskId: continuationRows[0]?.taskId ?? batchRows[0]?.taskId ?? "",
        remaining,
      });
      setNotice(message);
    };
    try {
      const taskId = batchRows[0]?.taskId;
      if (!taskId) throw new Error("补传文件没有问题行。");
      const authoritative = await fetchTaskRows(taskId, startedScope, control);
      if (!authoritative || control.cancelled || !actionCurrent(startedScope))
        return;
      const byRow = new Map(
        authoritative.map(item => [`${item.jobId}:${item.rowNumber}`, item])
      );
      for (const source of batchRows) {
        const current = byRow.get(`${source.taskId}:${source.excelRow}`);
        if (
          !current ||
          !current.canEdit ||
          ["success", "queued", "existing"].includes(current.status)
        ) {
          skipped += 1;
          continue;
        }
        // The export revision is auditable evidence only. Writes always use this
        // freshly fetched authoritative revision, and a stale file never writes.
        if (current.revision !== source.revision) {
          stale += 1;
          continue;
        }
        plan.push({ source, current });
      }
      if (!plan.length) {
        setNotice(
          `补传前预检发现 ${skipped} 条行已成功、排队、已有库存、无权限或不可见${stale ? `；${stale} 条“修正版本”已过期，未覆盖服务端当前版本，请重新导出` : ""}；未发出保存或提交请求。`
        );
        return;
      }
      // Phase 1: every eligible row is saved first. No child task is created if
      // one row is still invalid, so validated siblings remain safely "ready".
      for (const entry of plan.filter(
        entry => entry.current.status !== "ready"
      )) {
        if (control.cancelled || !actionCurrent(startedScope)) {
          remaining = plan.length - saved;
          keepForContinuation(
            `已取消后续自动提交；已有 ${saved} 条修正保存为“已校验，可发布”。其余约 ${remaining} 条可使用同一文件继续。`
          );
          return;
        }
        const savedItem = (await repairSave.mutateAsync({
          jobId: entry.current.jobId,
          rowNumber: entry.current.rowNumber,
          revision: entry.current.revision,
          requestId: requestId(),
          row: entry.source.values,
        })) as RepairItem;
        if (
          !requireCurrentScope(
            savedItem,
            startedScope,
            "补传保存无法确认当前身份，导入问题行已隐藏。"
          )
        )
          return;
        saved += 1;
        entry.current = savedItem;
        entry.source.revision = savedItem.revision;
        if (savedItem.status !== "ready") {
          remaining = plan.length - saved;
          keepForContinuation(
            `第 ${entry.current.rowNumber} 行未通过服务端校验，未创建任何新的修正子任务。已有 ${saved - 1} 条保持“已校验，可发布”；剩余 ${remaining} 条请修正后继续。`
          );
          return;
        }
      }
      // Phase 2: this same source-row-sorted plan remains authoritative after
      // saves. The service permits one active import task. Submit one ready
      // repair at a time and read only its existing child job to terminal before
      // the next; never create a normal import job or retry a queued source row.
      for (let index = 0; index < plan.length; index += 1) {
        if (control.cancelled || !actionCurrent(startedScope)) {
          remaining = plan.length - index;
          keepForContinuation(
            `已取消后续自动提交；已排队 ${queued} 条，仍有 ${remaining} 条保持“已校验，可发布”。可使用同一文件继续，已成功或排队行不会重发。`
          );
          return;
        }
        const current = plan[index].current;
        try {
          const submitted = (await repairSubmit.mutateAsync({
            jobId: current.jobId,
            rowNumber: current.rowNumber,
            revision: current.revision,
            requestId: requestId(),
          })) as RepairSubmitResult;
          if (
            !requireCurrentScope(
              submitted,
              startedScope,
              "补传发布无法确认当前身份，导入问题行已隐藏。"
            )
          )
            return;
          if (submitted.status !== "queued") {
            skipped += 1;
            continue;
          }
          queued += 1;
          onRepairQueued?.(submitted.jobId);
          const terminal = await waitForJobTerminal(
            submitted.jobId,
            startedScope,
            control
          );
          if (terminal.kind === "cancelled") {
            remaining = plan.length - index - 1;
            keepForContinuation(
              `已取消后续自动提交；已排队 ${queued} 条，仍有 ${remaining} 条保持“已校验，可发布”。`
            );
            return;
          }
          if (terminal.kind === "paused") {
            remaining = plan.length - index - 1;
            keepForContinuation(
              `第 ${current.rowNumber} 行子任务已暂停，已立即停止后续提交。已排队 ${queued} 条，剩余 ${remaining} 条保持“已校验，可发布”；请在恢复后继续，不要重发已排队行。`
            );
            return;
          }
          if (terminal.kind === "timeout") {
            remaining = plan.length - index - 1;
            keepForContinuation(
              `第 ${current.rowNumber} 行仍在后台处理中，已暂停后续提交。已排队 ${queued} 条，剩余 ${remaining} 条保持“已校验，可发布”；请稍后继续，不要重发已排队行。`
            );
            return;
          }
          if (
            !["completed", "success", "succeeded"].includes(terminal.status)
          ) {
            remaining = plan.length - index - 1;
            keepForContinuation(
              `第 ${current.rowNumber} 行子任务已停止，后续提交已暂停。剩余 ${remaining} 条保持“已校验，可发布”。`
            );
            return;
          }
        } catch (caught) {
          if (!actionCurrent(startedScope)) return;
          remaining = plan.length - index;
          if (isAccessError(caught)) {
            protectAccess("当前账号或企业已无修正权限，导入问题行已隐藏。");
            return;
          }
          const reason = isActiveJobConflict(caught)
            ? "企业已有活跃导入任务"
            : isUnknownOutcome(caught)
              ? "提交结果未知"
              : actionMessage(caught);
          keepForContinuation(
            `${reason}，已暂停后续提交。已有 ${saved} 条保存为“已校验，可发布”，已排队 ${queued} 条，剩余 ${remaining} 条保持 ready，可稍后继续；不会创建普通总导入或重复提交已处理行。`
          );
          return;
        }
      }
      setNotice(
        `已保存 ${saved} 条，已提交 ${queued} 条${skipped ? `，跳过 ${skipped} 条` : ""}${stale ? `，${stale} 条版本已变化` : ""}。`
      );
      await refresh(startedScope);
    } catch (caught) {
      if (actionCurrent(startedScope)) {
        if (isAccessError(caught))
          protectAccess("当前账号或企业已无修正权限，导入问题行已隐藏。");
        else {
          keepForContinuation(
            `${actionMessage(caught)} 已停止后续提交；已保存行保留为“已校验，可发布”，可在修正后使用同一文件续发。`
          );
          setError(actionMessage(caught));
        }
      }
    } finally {
      if (actionCurrent(startedScope)) setReuploading(false);
      if (batchControlRef.current === control) batchControlRef.current = null;
    }
  };
  const reupload = async (file: File) => {
    if (!scopeKey || !currentScope || locked) return;
    try {
      if (!/\.xlsx$/i.test(file.name))
        throw new Error("仅接受从本面板导出的 .xlsx 问题行文件。");
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false,
        raw: false,
      });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!firstSheet) throw new Error("补传文件没有可读取的工作表。");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        defval: "",
        raw: false,
        blankrows: false,
      });
      const headers = (matrix[0] ?? []).map(value => String(value));
      if (!supportedReuploadHeaders(headers))
        throw new Error("补传文件格式不正确，请使用本面板导出的文件。");
      const candidates = matrix
        .slice(1)
        .map(row =>
          Object.fromEntries(
            headers.map((header, index) => [header, row[index] ?? ""])
          )
        )
        .map(rawToReuploadRow);
      if (candidates.some(row => row === null))
        throw new Error("补传文件的隐藏信息无效，未执行补传。");
      const rowsToUpload = candidates as ReuploadRow[];
      if (!rowsToUpload.length) throw new Error("补传文件没有问题行。");
      const sourceTasks = new Set(rowsToUpload.map(row => row.taskId));
      if (sourceTasks.size !== 1)
        throw new Error(
          "一次补传只能包含同一个原导入任务的问题行；请按任务分别导出并补传。"
        );
      const uniqueRows = new Set(
        rowsToUpload.map(row => `${row.taskId}:${row.excelRow}`)
      );
      if (uniqueRows.size !== rowsToUpload.length)
        throw new Error("补传文件含重复原Excel行号，未执行任何补传。");
      rowsToUpload.sort((left, right) => left.excelRow - right.excelRow);
      await processReuploadRows(rowsToUpload);
    } catch (caught) {
      if (currentScope) setError(actionMessage(caught));
    }
  };
  const cancelReupload = () => {
    if (!batchControlRef.current || batchControlRef.current.cancelled) return;
    batchControlRef.current.cancelled = true;
    setNotice(
      "已请求取消本地后续自动提交；当前网络请求返回后将停止。已经保存为 ready 或已排队的行不会被撤销或重复提交。"
    );
  };
  const continueReupload = () => {
    if (continuation && !locked) void processReuploadRows(continuation.rows);
  };
  const update = (key: EditableKey, value: string) =>
    setEditor(current =>
      current
        ? {
            ...current,
            values: { ...current.values, [key]: value },
            changed: { ...current.changed, [key]: true },
          }
        : current
    );
  const safeScopeMasked =
    !currentScope ||
    accessBlocked ||
    Boolean(
      listQuery.data && (listQuery.data as RepairList).scopeKey !== scopeKey
    );
  const problemCount = data?.total ?? 0;

  useEffect(() => {
    if (!data || !scopeKey || data.scopeKey !== scopeKey) return;
    onCountChange?.(scopeKey, Math.max(0, Number(data.total) || 0));
  }, [data?.scopeKey, data?.total, onCountChange, scopeKey]);

  return (
    <section className="mt-4 space-y-2" aria-label="导入问题待发布">
      <Card className="overflow-hidden border-[#b9d3e8] bg-[#f8fbfe] p-0">
        <div className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <h2
              className="text-[13px] font-semibold text-[#1f3f5b]"
              aria-label={`异常记录共 ${problemCount} 条`}
            >
              异常记录（{problemCount}）
            </h2>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              aria-controls="import-repair-list"
              aria-expanded={listExpanded}
              disabled={problemCount === 0}
              onClick={() => setListExpanded(value => !value)}
            >
              {listExpanded
                ? `收起列表（${problemCount}）`
                : `显示列表（${problemCount}）`}
            </Button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            disabled={locked || !currentScope || exporting || problemCount === 0}
            onClick={() => void exportProblems()}
            title="导出当前可处理的问题行"
          >
            {exporting ? "处理中…" : "导出"}
          </Button>
          <input
            ref={reuploadInput}
            className="sr-only"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void reupload(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"
            disabled={locked || !currentScope || problemCount === 0}
            onClick={() => reuploadInput.current?.click()}
            title="上传本面板导出的修正表"
          >
            {reuploading ? "处理中…" : "上传修正表"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs text-destructive"
            disabled={locked || !currentScope || exporting || problemCount === 0}
            onClick={() => {
              setClearDialog(true);
              setError("");
              setNotice("");
            }}
          >
            清空
          </Button>
          </div>
        </div>
        {safeScopeMasked && (
          <p className="border-t border-[#dbe9f4] px-3 py-2 text-xs text-muted-foreground" role="status">
            当前登录或企业上下文尚未确认，导入问题行已隐藏。
          </p>
        )}
        {listQuery.isError && currentScope && !accessBlocked && (
          <p className="border-t border-[#dbe9f4] px-3 py-2 text-xs text-destructive" role="alert">
            {actionMessage(listQuery.error)}
          </p>
        )}
        {error && (
          <p className="border-t border-[#dbe9f4] px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="border-t border-[#dbe9f4] px-3 py-2 text-xs text-[#315a7d]" role="status">
            {notice}
          </p>
        )}
        {reuploading && (
          <div className="flex items-center justify-between gap-2 border-t border-[#dbe9f4] px-3 py-2 text-xs text-[#315a7d]" role="status">
            <span>补传处理中…</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={cancelReupload}
            >
              取消后续提交
            </Button>
          </div>
        )}
        {continuation && !reuploading && (
          <div className="flex flex-wrap items-center gap-2 border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span>仍有约 {continuation.remaining} 条待补传。</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={continueReupload}
              disabled={locked}
            >
              继续补传剩余行
            </Button>
          </div>
        )}
      </Card>

      {clearDialog && (
        <Card
          className="border-amber-300 bg-amber-50 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-repair-title"
        >
          <h3
            id="clear-repair-title"
            className="text-sm font-semibold text-amber-950"
          >
            清空异常记录？不删除已上架库存。
          </h3>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs"
              onClick={() => setClearDialog(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"
              onClick={clearProblems}
              disabled={locked || exporting}
            >
              清空
            </Button>
          </div>
        </Card>
      )}

      {editor && (
        <Card className="border-[#b9d3e8] p-4" aria-label="修正导入问题行">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                修正原 Excel 第 {editor.item.rowNumber} 行
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                未编辑字段保留原业务值；系统不会把空值或无效数量猜成 1。
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditor(null)}
              disabled={locked}
            >
              取消
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {EDIT_FIELDS.map(field => (
              <div
                key={field.key}
                className={field.key === "note" ? "md:col-span-2" : ""}
              >
                <Label htmlFor={`import-repair-${field.key}`}>
                  {field.required ? (
                    <span className="text-destructive">* </span>
                  ) : null}
                  {field.label}
                </Label>
                {field.multiline ? (
                  <Textarea
                    id={`import-repair-${field.key}`}
                    className="mt-1"
                    value={editor.values[field.key]}
                    disabled={locked}
                    onChange={event => update(field.key, event.target.value)}
                  />
                ) : (
                  <Input
                    id={`import-repair-${field.key}`}
                    className="mt-1"
                    value={editor.values[field.key]}
                    disabled={locked}
                    onChange={event => update(field.key, event.target.value)}
                  />
                )}
              </div>
            ))}
            <div>
              <Label>价格口径</Label>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={editor.taxIncluded}
                  disabled={locked}
                  onChange={event =>
                    setEditor(current =>
                      current
                        ? {
                            ...current,
                            taxIncluded: event.target.checked,
                            taxIncludedChanged: true,
                          }
                        : current
                    )
                  }
                />
                价格为含税价
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditor(null)}
              disabled={locked}
            >
              取消
            </Button>
            <Button
              type="button"
              className="bg-[#185FA5] hover:bg-[#0C447C]"
              onClick={saveAndSubmit}
              disabled={locked || !editor.item.canEdit}
            >
              {busy ? "保存并提交中…" : "保存并发布"}
            </Button>
          </div>
        </Card>
      )}

      {frozen && (
        <Card
          className="border-amber-300 bg-amber-50 p-4"
          aria-label="确认未知操作结果"
        >
          <p className="text-xs text-amber-900">
            {frozen.kind === "clear"
              ? "清空结果未知，请使用相同请求重试。"
              : "网络结果未知，当前请求编号和内容已冻结。"}
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-2"
            onClick={() => void run(frozen)}
            disabled={
              busy || reuploading || (frozen.kind === "clear" && exporting)
            }
          >
            {frozen.kind === "clear" ? "重试清空" : "使用相同请求重试"}
          </Button>
        </Card>
      )}

      {!safeScopeMasked && listQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          正在加载导入问题行…
        </Card>
      )}
      {!safeScopeMasked && !listQuery.isLoading && data && (
        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              当前没有导入问题行。
            </div>
          ) : (
            <div id="import-repair-list" hidden={!listExpanded}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr
                      className="h-8"
                    >
                      <th className="px-3 py-2 font-medium">源文件 / 行号</th>
                      <th className="px-3 py-2 font-medium">型号 / 品牌数量</th>
                      <th className="px-3 py-2 font-medium">原因</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(item => (
                      <tr
                        key={`${item.jobId}:${item.rowNumber}`}
                        className="h-11 border-t border-border/60 align-middle"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">
                            {item.fileName || "原导入文件"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            第{item.rowNumber}行
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">
                            {item.partNumber || "—"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {item.brand || "未填写品牌"} · 数量{" "}
                            {item.originalQuantity || "未填写"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div
                            className="max-w-md truncate text-destructive"
                            title={item.errorMessage || "等待重新校验"}
                          >
                            {item.errorMessage || "等待重新校验"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-2">
                            {item.canEdit &&
                              !["queued", "success", "existing"].includes(
                                item.status
                              ) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-3 text-xs"
                                  disabled={locked}
                                  onClick={() => {
                                    setEditor(editorFor(item));
                                    setError("");
                                    setNotice("");
                                  }}
                                >
                                  在线修正
                                </Button>
                              )}
                            {item.canEdit && item.status === "ready" && (
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 bg-[#185FA5] px-3 text-xs hover:bg-[#0C447C]"
                                disabled={locked}
                                onClick={() => submitReady(item)}
                              >
                                发布此行
                              </Button>
                            )}
                            {item.status === "existing" && onShowManualDrafts && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-3 text-xs"
                                disabled={locked}
                                onClick={onShowManualDrafts}
                              >
                                查看手工草稿
                              </Button>
                            )}
                            {!item.canEdit && (
                              <span className="text-[11px] text-muted-foreground">
                                只读
                              </span>
                            )}
                            {item.status === "queued" && (
                              <span className="text-[11px] text-muted-foreground">
                                后台处理中
                              </span>
                            )}
                            {item.status === "success" && (
                              <span className="text-[11px] text-muted-foreground">
                                已处理
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  问题行共 {data.total} 条 · 第 {data.page} /{" "}
                  {Math.max(1, data.pageCount)} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={locked || page <= 1}
                    onClick={() => setPage(value => Math.max(1, value - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={locked || page >= Math.max(1, data.pageCount)}
                    onClick={() => setPage(value => value + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}

export const IMPORT_REPAIRS_REUPLOAD_HEADERS = REUPLOAD_HEADERS;
